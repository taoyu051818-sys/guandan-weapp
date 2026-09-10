export const createCommandGateway = ({
  rooms,
  acceptedActions,
  idempotentActionTypes,
  actionCacheKey,
  actionFingerprint,
  validateCommandRequestId,
  validateExpectedVersion,
  playerIn,
  isFriendRoom,
  finalizePendingRound,
  scheduleGameStartClaim,
  commitRuntimeState,
  stagePendingSideEffects,
  publishCurrentRoom,
  completeRoomExit,
  rememberAccepted,
  reserveAccepted = () => true,
  releaseAccepted = () => {},
  listRooms,
  send,
  router,
}) => async (connection, message) => {
  const type = typeof message?.type === 'string' ? message.type : ''
  const requestId = message?.requestId
  const payload = message?.payload && typeof message.payload === 'object' && !Array.isArray(message.payload) ? message.payload : {}
  const reply = (replyType, body = {}) => send(connection, replyType, { requestId, ...body })
  const requestValidation = validateCommandRequestId(type, requestId)
  if (requestValidation) return reply('error', requestValidation)
  const requestedRoom = rooms.get(String(payload.roomId || connection.roomId || ''))
  const aliasedCacheKey = Number.isSafeInteger(requestId) ? connection.acceptedCacheKeys.get(requestId) : null
  const cacheKey = aliasedCacheKey || (idempotentActionTypes.has(type) ? actionCacheKey(requestedRoom, connection, requestId) : null)
  const requestFingerprint = cacheKey ? actionFingerprint(type, payload) : null
  const previousAccepted = cacheKey ? acceptedActions.get(cacheKey) : null
  if (previousAccepted) {
    if (previousAccepted.fingerprint !== requestFingerprint) return reply('error', { code: 'IDEMPOTENCY_CONFLICT', message: '同一个 requestId 不能用于不同动作' })
    if (previousAccepted.completion?.kind === 'room-exit') return completeRoomExit(connection, cacheKey, previousAccepted)
    if (requestedRoom?.pendingRoundFinalization?.cacheKey === cacheKey) {
      try { await finalizePendingRound(requestedRoom) } catch {
        return reply('error', { code: 'PERSISTENCE_PENDING', message: '终局动作仍在等待安全落盘，请稍后用相同 requestId 重试', retryAfterMs: 500 })
      }
      return
    }
    if (type === 'startGame' && requestedRoom?.pendingGameStartEvent && isFriendRoom(requestedRoom)) {
      scheduleGameStartClaim(requestedRoom, 250)
      return reply('gameStartPending', {
        roomId: requestedRoom.roomId,
        phase: 'lobby',
        gameStartPending: true,
        version: requestedRoom.version,
        gameVersion: requestedRoom.gameVersion,
      })
    }
    if (previousAccepted.pendingDurability) {
      try { await commitRuntimeState() } catch {
        return reply('error', { code: 'PERSISTENCE_UNAVAILABLE', message: '请求结果尚未安全落盘，请稍后用相同 requestId 重试' })
      }
    }
    if (requestedRoom) stagePendingSideEffects(requestedRoom)
    send(connection, previousAccepted.messageType || 'actionAccepted', previousAccepted.response)
    if (requestedRoom) publishCurrentRoom(requestedRoom)
    return
  }
  if (requestedRoom?.closingReason) return reply('error', { code: 'ROOM_CLOSING', message: '房间正在安全关闭，请稍后重试' })
  if (requestedRoom?.pendingRoundFinalization && (idempotentActionTypes.has(type) || ['createRoom', 'joinRoom', 'rejoinRoom'].includes(type))) {
    return reply('error', { code: 'PERSISTENCE_PENDING', message: '本局结算正在等待安全落盘', retryAfterMs: 500 })
  }
  if (requestedRoom?.pendingGameStartEvent && isFriendRoom(requestedRoom) && type !== 'rejoinRoom') {
    if (type === 'startGame') {
      const pendingRequest = requestedRoom.pendingGameStartRequest
      if (pendingRequest && (pendingRequest.requestId !== requestId || pendingRequest.fingerprint !== requestFingerprint)) {
        return reply('error', { code: 'GAME_START_ALREADY_PENDING', message: '已有开局请求正在等待平台确认' })
      }
      return reply('gameStartPending', {
        roomId: requestedRoom.roomId,
        phase: 'lobby',
        gameStartPending: true,
        version: requestedRoom.version,
        gameVersion: requestedRoom.gameVersion,
      })
    }
    if (idempotentActionTypes.has(type) || type === 'leaveRoom' || type === 'safeExit') {
      return reply('error', { code: 'GAME_START_CONFIRMING', message: '平台正在确认开局，暂不能改变房间成员或准备状态' })
    }
  }
  if (requestedRoom?.matchEnded && idempotentActionTypes.has(type) && type !== 'leaveRoom' && type !== 'safeExit') {
    return reply('error', { code: 'MATCH_ENDED', message: '本场已结束，只能查看终局或离开房间' })
  }
  if (idempotentActionTypes.has(type) && [...acceptedActions.values()].some(accepted => (
    accepted.pendingDurability && (!requestedRoom || accepted.response?.roomId === requestedRoom.roomId)
  ))) {
    return reply('error', { code: 'PERSISTENCE_PENDING', message: '上一请求仍在等待安全落盘，请先重试原 requestId' })
  }
  if (cacheKey && !reserveAccepted(cacheKey)) {
    return reply('error', { code: 'IDEMPOTENCY_CAPACITY_REACHED', message: '安全落盘队列已满，请稍后重试', retryAfterMs: 500 })
  }
  try {
    const requestedPlayerId = requestedRoom && playerIn(requestedRoom, connection.id)
    if (requestedRoom && requestedPlayerId) {
      const versionValidation = validateExpectedVersion(type, payload.expectedVersion, requestedRoom.gameVersion)
      if (versionValidation) return reply('error', { ...versionValidation, version: requestedRoom.version, gameVersion: requestedRoom.gameVersion })
    }
    const rememberActionAcceptance = room => {
      const accepted = { requestId, requestType: type, roomId: room.roomId, version: room.version, gameVersion: room.gameVersion }
      rememberAccepted(cacheKey, requestFingerprint, accepted)
      if (cacheKey) connection.acceptedCacheKeys.set(requestId, cacheKey)
      return accepted
    }
    const acceptAction = async room => {
      const accepted = rememberActionAcceptance(room)
      await commitRuntimeState()
      stagePendingSideEffects(room)
      send(connection, 'actionAccepted', accepted)
      return accepted
    }
    if (type === 'updateState') return reply('error', { message: '该通道禁止整状态同步，请提交出牌或不要动作' })
    if (type === 'listRooms') return reply('roomList', { rooms: listRooms() })
    if (await router.dispatch({ type, payload, connection, requestId, cacheKey, requestFingerprint, reply, rememberActionAcceptance, acceptAction })) return
    reply('error', { message: '未知协议消息' })
  } finally {
    releaseAccepted(cacheKey)
  }
}
