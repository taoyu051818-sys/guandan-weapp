/** Owns the durable game-start claim, reconnect grace, and entry-deadline lifecycle. */
export const createWeAppGameStartCoordinator = ({
  playerIds,
  rooms,
  connections,
  acceptedActions,
  emptyRoomTimeoutMs,
  testPersistFailures = 0,
  isShuttingDown,
  isFriendRoom,
  isMatchRoom,
  seatHasLiveConnection,
  seatIsOccupied = seatHasLiveConnection,
  enqueueServerOperation,
  commitRuntimeState,
  persistRuntimeState,
  spectatorEventReporter,
  initializeRoomMatch,
  armMatchDuration,
  armTurnDeadline,
  closeRoomWithoutAck,
  publishRoomMembers,
  publishLobbyReady,
  publishState,
  rememberAccepted,
  send,
  now = Date.now,
  scheduleTimeout = setTimeout,
  cancelTimeout = clearTimeout,
}) => {
  const claimTimers = new Map()
  const entryDeadlineTimers = new Map()
  const claimOperations = new Map()
  const claimedStarts = new Set()
  const reconnectRooms = new Set()
  let persistFailuresRemaining = testPersistFailures

  const clearTimer = (timers, roomId) => {
    const timer = timers.get(roomId)
    if (timer) cancelTimeout(timer)
    timers.delete(roomId)
  }

  const prepare = room => {
    if (!room.pendingGameStartEvent) {
      room.version += 1
      room.spectatorSequence = Math.max(0, Number(room.spectatorSequence) || 0) + 1
      room.pendingGameStartEvent = {
        eventId: `spectate:${room.matchId}:${room.spectatorSequence}`,
        matchId: room.matchId,
        roomId: room.roomId,
        sequence: room.spectatorSequence,
        at: now(),
        roundSequence: 1,
        type: 'game-start',
        ...(room.friendMembers?.length || room.entryKind === 'friend' && room.botPlayerIds?.length ? { friendRoster: { ...room.userIdsBySeat } } : {}),
      }
    }
    return room.pendingGameStartEvent
  }

  const publishPending = room => {
    if (isFriendRoom(room) && room.pendingGameStartEvent) {
      publishRoomMembers(room)
      publishLobbyReady(room)
    }
  }

  const autoStartMatchedRoom = room => {
    if (!isMatchRoom(room) || room.state || playerIds.some(id => !seatIsOccupied(room, id))) return false
    prepare(room)
    return true
  }

  const isTerminalClaimError = error => (
    Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)
  )

  const abandon = (room, event) => {
    if (!event || room.pendingGameStartEvent?.eventId !== event.eventId) return
    room.pendingGameStartEvent = null
    room.gameStartClaimedAt = null
    room.gameStartReconnectDeadlineAt = null
    claimedStarts.delete(event.eventId)
    reconnectRooms.delete(room.roomId)
    const hasLaterEvent = room.pendingSpectatorEvents?.some(item => Number(item.sequence) >= Number(event.sequence))
    if (!hasLaterEvent && room.spectatorSequence === event.sequence) {
      room.spectatorSequence = Math.max(0, event.sequence - 1)
    }
  }

  const commitClaimedStart = async () => {
    if (persistFailuresRemaining > 0) {
      persistFailuresRemaining -= 1
      throw new Error('injected game-start persistence failure')
    }
    await commitRuntimeState()
  }

  const persistClaimedStart = async (room, event) => {
    if (!rooms.has(room.roomId) || room.pendingGameStartEvent?.eventId !== event.eventId) return false
    const previousClaimedAt = room.gameStartClaimedAt
    const previousReconnectDeadlineAt = room.gameStartReconnectDeadlineAt
    const claimedAt = Number.isSafeInteger(previousClaimedAt) ? previousClaimedAt : now()
    const entryDeadlineAt = Number(room.entryDeadlineAt)
    room.gameStartClaimedAt = claimedAt
    room.gameStartReconnectDeadlineAt = Math.min(
      claimedAt + emptyRoomTimeoutMs,
      Number.isFinite(entryDeadlineAt) ? entryDeadlineAt : Number.POSITIVE_INFINITY,
    )
    try {
      await commitRuntimeState()
    } catch (error) {
      room.gameStartClaimedAt = previousClaimedAt
      room.gameStartReconnectDeadlineAt = previousReconnectDeadlineAt
      throw error
    }
    claimedStarts.add(event.eventId)
    return true
  }

  const scheduleClaim = (room, delay = 0) => {
    clearTimer(claimTimers, room.roomId)
    if (isShuttingDown() || !rooms.has(room.roomId) || !room.pendingGameStartEvent) return
    const deadline = Number.isSafeInteger(room.gameStartReconnectDeadlineAt)
      ? room.gameStartReconnectDeadlineAt
      : Number(room.entryDeadlineAt)
    const remaining = deadline - now()
    if (Number.isFinite(remaining) && remaining <= 0 && !Number.isSafeInteger(room.gameStartClaimedAt)) return
    const timer = scheduleTimeout(() => {
      claimTimers.delete(room.roomId)
      attemptClaim(room)
    }, Math.max(0, Math.min(delay, Number.isFinite(remaining) ? Math.max(0, remaining) : delay)))
    timer.unref?.()
    claimTimers.set(room.roomId, timer)
  }

  const finalizeClaimedStart = async (room, event) => {
    if (!rooms.has(room.roomId) || room.pendingGameStartEvent?.eventId !== event.eventId) return
    if (isFriendRoom(room) && (playerIds.some(id => !seatHasLiveConnection(room, id) && !room.botPlayerIds?.includes(id)) || playerIds.some(id => !room.lobbyReady?.[id]))) {
      const reconnectDeadlineAt = Number(room.gameStartReconnectDeadlineAt)
      if (reconnectRooms.has(room.roomId) && Number.isFinite(reconnectDeadlineAt) && now() < reconnectDeadlineAt) {
        publishPending(room)
        scheduleClaim(room, Math.min(500, Math.max(1, reconnectDeadlineAt - now())))
        return { status: 'waiting-for-reconnect' }
      }
      room.pendingGameStartEvent = null
      room.gameStartClaimedAt = null
      room.gameStartReconnectDeadlineAt = null
      claimedStarts.delete(event.eventId)
      reconnectRooms.delete(room.roomId)
      await closeRoomWithoutAck(room, 'start-participant-lost')
      return { status: 'closed' }
    }
    const roomBeforeInitialization = structuredClone(room)
    const wasInitialized = Boolean(room.state)
    if (!wasInitialized) {
      initializeRoomMatch(room, { matched: isMatchRoom(room) })
      room.matchStartedAt = now()
      room.totalDeadlineAt = null
      room.matchEnded = null
      room.version += 1
    }
    room.pendingGameStartEvent = null
    room.gameStartClaimedAt = null
    room.gameStartReconnectDeadlineAt = null
    const pendingRequest = room.pendingGameStartRequest
    const acceptedActionsBeforeInitialization = new Map(acceptedActions)
    let accepted = null
    if (pendingRequest?.cacheKey && Number.isSafeInteger(pendingRequest.requestId)) {
      accepted = {
        requestId: pendingRequest.requestId,
        requestType: 'startGame',
        roomId: room.roomId,
        version: room.version,
        gameVersion: room.gameVersion,
      }
      rememberAccepted(pendingRequest.cacheKey, pendingRequest.fingerprint, accepted)
    }
    try {
      await commitClaimedStart()
    } catch (error) {
      for (const key of Object.keys(room)) delete room[key]
      Object.assign(room, roomBeforeInitialization)
      acceptedActions.clear()
      for (const [key, value] of acceptedActionsBeforeInitialization) acceptedActions.set(key, value)
      claimedStarts.add(event.eventId)
      reconnectRooms.add(room.roomId)
      scheduleClaim(room, 500)
      publishPending(room)
      throw error
    }
    if (!wasInitialized) {
      armMatchDuration(room)
      armTurnDeadline(room, { publish: false })
    }
    claimedStarts.delete(event.eventId)
    reconnectRooms.delete(room.roomId)
    room.pendingGameStartRequest = null
    persistRuntimeState()
    clearTimer(entryDeadlineTimers, room.roomId)
    if (accepted) {
      const host = room.friendMembers?.find(member => member.userId === room.friendHostUserId)
      const hostConnection = connections.get(host ? host.connectionId : room.seats.p1)
      if (hostConnection) send(hostConnection, 'actionAccepted', accepted)
    }
    publishState(room)
    return { status: 'started' }
  }

  const attemptClaim = room => {
    const event = room.pendingGameStartEvent
    if (isShuttingDown() || !rooms.has(room.roomId) || !event) return
    if (claimOperations.has(room.roomId)) { scheduleClaim(room, 50); return }
    if (claimedStarts.has(event.eventId)) {
      void enqueueServerOperation(() => finalizeClaimedStart(room, event), `persist game-start ${room.roomId}`, room.roomId)
      return
    }
    const operation = enqueueServerOperation(() => commitRuntimeState(), `persist game-start intent ${room.roomId}`, room.roomId)
      .then(() => {
        publishPending(room)
        return spectatorEventReporter.claimStart(event)
      })
    claimOperations.set(room.roomId, operation)
    void operation.then(() => {
      if (isShuttingDown()) return undefined
      return enqueueServerOperation(async () => {
        if (!await persistClaimedStart(room, event)) return
        return finalizeClaimedStart(room, event)
      }, `finalize game-start ${room.roomId}`, room.roomId)
    }).catch(error => {
      if (!isShuttingDown() && rooms.has(room.roomId) && room.pendingGameStartEvent?.eventId === event.eventId) {
        console.warn(`Game-start claim failed for ${room.roomId}:`, error instanceof Error ? error.message : error)
        if (isTerminalClaimError(error)) {
          abandon(room, event)
          return enqueueServerOperation(() => closeRoomWithoutAck(room, 'start-rejected'), `reject game-start ${room.roomId}`, room.roomId)
        }
        scheduleClaim(room, 1000)
      }
      return undefined
    }).finally(() => {
      if (claimOperations.get(room.roomId) === operation) claimOperations.delete(room.roomId)
    })
  }

  const expireIncompleteRoom = async (room, expectedDeadline) => {
    if (!rooms.has(room.roomId) || room.state || room.entryDeadlineAt !== expectedDeadline) return
    if (now() < expectedDeadline) { scheduleEntryDeadline(room); return }
    const startEventId = room.pendingGameStartEvent?.eventId
    if ((startEventId && claimedStarts.has(startEventId)) || claimOperations.has(room.roomId)) {
      scheduleEntryDeadline(room, 100)
      return
    }
    try { await closeRoomWithoutAck(room, 'entry-timeout') } catch (error) {
      scheduleEntryDeadline(room, 500)
      throw error
    }
  }

  const scheduleEntryDeadline = (room, retryDelay = 0) => {
    clearTimer(entryDeadlineTimers, room.roomId)
    if (!room.ticketBound || room.state || !Number.isFinite(Number(room.entryDeadlineAt))) return
    const expectedDeadline = Number(room.entryDeadlineAt)
    const timer = scheduleTimeout(() => {
      entryDeadlineTimers.delete(room.roomId)
      void enqueueServerOperation(() => expireIncompleteRoom(room, expectedDeadline), `entry deadline ${room.roomId}`, room.roomId)
    }, Math.max(retryDelay, expectedDeadline - now(), 0))
    timer.unref?.()
    entryDeadlineTimers.set(room.roomId, timer)
  }

  const restoreClaim = room => {
    if (!room.pendingGameStartEvent || !Number.isSafeInteger(room.gameStartClaimedAt) || !Number.isSafeInteger(room.gameStartReconnectDeadlineAt)) return
    claimedStarts.add(room.pendingGameStartEvent.eventId)
    reconnectRooms.add(room.roomId)
  }

  const removeRoom = room => {
    clearTimer(entryDeadlineTimers, room.roomId)
    clearTimer(claimTimers, room.roomId)
    if (room.pendingGameStartEvent?.eventId) claimedStarts.delete(room.pendingGameStartEvent.eventId)
    reconnectRooms.delete(room.roomId)
  }

  const dispose = () => {
    for (const timers of [entryDeadlineTimers, claimTimers]) {
      for (const timer of timers.values()) cancelTimeout(timer)
      timers.clear()
    }
  }

  return {
    abandon,
    autoStartMatchedRoom,
    finalizeClaimedStart,
    isTerminalClaimError,
    persistClaimedStart,
    prepare,
    publishPending,
    removeRoom,
    restoreClaim,
    scheduleClaim,
    scheduleEntryDeadline,
    dispose,
  }
}
