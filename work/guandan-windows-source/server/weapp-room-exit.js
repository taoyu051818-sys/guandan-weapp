import { createRoomExpiryJobs } from './weapp-room-expiry-jobs.js'
import { roomMember, memberIsHost } from './friend-room-members.js'

export const EXIT_COMMAND_TYPES = ['leaveRoom', 'safeExit']

/** An accepted exit keeps its receipt until durable completion, even after its seat is gone. */
export const createRoomExit = dependencies => {
  const {
    rooms, acceptedActions, playerIn, ensureLiveMetadata, ensureLobbyMetadata,
    markOfflineReady, armTurnDeadline, deleteAcceptedActionIdentity,
    rememberClosedRoomTombstone, reportSpectatorClosed, reportSpectatorEvent,
    rememberAccepted, commitRuntimeState, persistRuntimeState, stagePendingSideEffects,
    finalizeRemovedRoom, syncConnectionRoomId, send, publishCurrentRoom, broadcastRooms,
    scheduleEmptyRoomExpiry, enqueueServerOperation,
    setTimeout = globalThis.setTimeout, clearTimeout = globalThis.clearTimeout,
  } = dependencies
  const jobs = createRoomExpiryJobs({ rooms, enqueueServerOperation, setTimeout, clearTimeout })

  const complete = async (connection, cacheKey, accepted) => {
    const room = rooms.get(accepted.response.roomId)
    const sameRoom = room && room.botSeed === accepted.completion.roomSeed && room.matchId === accepted.completion.matchId
    const kind = `exit:${cacheKey}`
    try {
      await commitRuntimeState()
      if (sameRoom) {
        stagePendingSideEffects(room)
        if (accepted.completion.hostLeft) {
          rooms.delete(room.roomId)
          try { await commitRuntimeState() } catch (error) { rooms.set(room.roomId, room); throw error }
          finalizeRemovedRoom(room, 'host-left', 'hostLeft', cacheKey)
        }
        jobs.cancel(kind, room.roomId)
      }
      syncConnectionRoomId(connection)
      send(connection, 'roomLeft', accepted.response)
      if (sameRoom && !accepted.completion.hostLeft) {
        publishCurrentRoom(room)
        if (room.state) scheduleEmptyRoomExpiry(room)
        else broadcastRooms()
      }
    } catch (error) {
      // Keep both the mutated room and its receipt: retries finish, not mutate again.
      persistRuntimeState()
      if (sameRoom) jobs.schedule(kind, room, 500, () => complete(connection, cacheKey, accepted))
      throw error
    }
  }

  const handle = async ({ payload, connection, requestId, cacheKey, requestFingerprint, reply }) => {
    const room = rooms.get(String(payload.roomId || connection.roomId || ''))
    const playerId = room && playerIn(room, connection.id)
    const member = roomMember(room, connection.id)
    if (!room || (!playerId && !member)) return reply('error', { message: '当前不在房间中' })
    const hostLeft = !room.state && memberIsHost(room, connection.id)
    room.version += 1
    if (member) {
      member.connectionId = null
      if (!room.state || !member.seat) room.friendMembers = room.friendMembers.filter(item => item !== member)
    }
    if (room.state && playerId) {
      ensureLiveMetadata(room)
      room.seats[playerId] = null
      room.trustees[playerId] = { reason: 'disconnected', since: Date.now() }
      if (room.dissolveVote?.votes[playerId] === 'pending') room.dissolveVote.votes[playerId] = 'offline'
      markOfflineReady(room, playerId)
      if (!room.roundResult && room.deadlinePlayerId === playerId) armTurnDeadline(room, { publish: false })
    } else if (hostLeft) {
      room.closingReason = 'host-left'
      rememberClosedRoomTombstone(room)
      reportSpectatorClosed(room, 'host-left')
    } else if (playerId) {
      const userId = room.userIdsBySeat?.[playerId]
      const jti = room.ticketJtisBySeat?.[playerId]
      const exp = room.ticketExpiresAtBySeat?.[playerId]
      room.seats[playerId] = null
      deleteAcceptedActionIdentity(room.resumeTokens[playerId])
      room.resumeTokens[playerId] = null
      ensureLobbyMetadata(room)
      room.lobbyReady[playerId] = false
      if (room.entryKind === 'friend' && userId) {
        if (jti && Number.isFinite(exp)) room.revokedTicketJtis.push({ jti, exp })
        room.userIdsBySeat[playerId] = null
        room.ticketJtisBySeat[playerId] = null
        room.ticketExpiresAtBySeat[playerId] = null
        reportSpectatorEvent(room, { type: 'seat-left', playerId, userId, reason: 'left', roundSequence: 1 })
      }
    } else if (member && room.ticketBound) {
      if (member.jti && Number.isFinite(member.exp)) room.revokedTicketJtis.push({ jti: member.jti, exp: member.exp })
      reportSpectatorEvent(room, { type: 'seat-left', playerId: 'observer', userId: member.userId, reason: 'left', roundSequence: 1 })
    }
    const response = { requestId, roomId: room.roomId, version: room.version, seatReserved: Boolean(room.state && playerId) }
    const completion = { kind: 'room-exit', hostLeft, roomSeed: room.botSeed, matchId: room.matchId }
    rememberAccepted(cacheKey, requestFingerprint, response, 'roomLeft', completion)
    if (cacheKey) connection.acceptedCacheKeys.set(requestId, cacheKey)
    await complete(connection, cacheKey, acceptedActions.get(cacheKey) || { response, completion })
  }
  return { handle, complete, dispose: jobs.dispose }
}
