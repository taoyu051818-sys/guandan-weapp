import { createHash } from 'node:crypto'
import { normalizeFriendRoomSettings } from './friend-room-settings.js'

export const ENTRY_COMMAND_TYPES = ['createRoom', 'joinRoom', 'rejoinRoom']

export const createEntryCommandHandler = dependencies => async context => {
  const { type, payload, connection, requestId, reply } = context
  const {
    ids, rooms, acceptedActions, maxRooms, gameTicketVerifier, inspectEntryTicket,
    ticketBlockedByClosedRoom, normalizeEntryAttemptId, pendingSeatReleaseFor,
    actionFingerprint, sameToken, seatHasAnotherActiveConnection, clearEmptyRoomExpiry,
    restoreOfflineDissolveVote, commitRuntimeState, stagePendingSideEffects, send,
    publishRoomMembers, publishDissolveVote, publishState, scheduleEntryDeadline,
    scheduleGameStartClaim, entryPayloadFor, rememberAccepted, entryConflictFor,
    reserveAccepted = () => true, releaseAccepted = () => {},
    createRoomRecord, ticketMatchesRoom, ensureTicketBindings, createResumeToken,
    entryKindForClaims, entryDeadlineForClaims, revokePreviousSeatTicket, clearHostExpiry,
    armMatchDuration, armTurnDeadline, autoStartMatchedRoom, broadcastRooms, playerIn,
    rotateAcceptedActionIdentity, deleteAcceptedActionIdentity, publishGameStartPending, isBotPlayer, seatIsOccupied,
    ensureLobbyMetadata,
  } = dependencies

  const credentialCacheKey = (kind, credential) => {
    if (!Number.isSafeInteger(requestId) || typeof credential !== 'string' || !credential) return null
    const digest = createHash('sha256').update(credential).digest('hex')
    return `${kind}:${digest}:${requestId}`
  }
  const replayEntryResponse = async (entryCacheKey, room, playerId) => {
    if (!entryCacheKey) return false
    const previous = acceptedActions.get(entryCacheKey)
    if (!previous) return false
    if (previous.fingerprint !== actionFingerprint(type, payload)) {
      reply('error', { code: 'IDEMPOTENCY_CONFLICT', message: '同一个 requestId 不能用于不同动作' })
      return true
    }
    if (previous.pendingDurability) {
      try { await commitRuntimeState() } catch {
        reply('error', { code: 'PERSISTENCE_UNAVAILABLE', message: '入桌结果尚未安全落盘，请稍后用相同 requestId 重试' })
        return true
      }
    }
    if (!room || previous.response?.roomId !== room.roomId || previous.response?.myPlayerId !== playerId) {
      reply('error', { message: '幂等入桌响应对应的房间已不存在' })
      return true
    }
    if (!sameToken(room.resumeTokens[playerId], previous.response.resumeToken)) {
      reply('error', { message: '幂等入桌响应已被后续会话替代' })
      return true
    }
    if (seatHasAnotherActiveConnection(room, playerId, connection)) {
      reply('error', { message: '该席位已被另一个活动连接占用' })
      return true
    }
    const sameConnection = room.seats[playerId] === connection.id
    room.seats[playerId] = connection.id
    connection.roomId = room.roomId
    clearEmptyRoomExpiry(room.roomId)
    const restoredDissolveVote = restoreOfflineDissolveVote(room, playerId)
    if (!sameConnection) room.version += 1
    connection.acceptedCacheKeys.set(requestId, entryCacheKey)
    await commitRuntimeState()
    stagePendingSideEffects(room)
    send(connection, previous.messageType, previous.response)
    publishRoomMembers(room)
    if (restoredDissolveVote) publishDissolveVote(room)
    if (room.state) publishState(room)
    else if (room.ticketBound) { scheduleEntryDeadline(room); scheduleGameStartClaim(room) }
    return true
  }
  const acceptEntryResponse = async (entryCacheKey, room, playerId, messageType) => {
    const response = { requestId, ...entryPayloadFor(room, playerId) }
    rememberAccepted(entryCacheKey, actionFingerprint(type, payload), response, messageType)
    if (entryCacheKey) connection.acceptedCacheKeys.set(requestId, entryCacheKey)
    await commitRuntimeState()
    stagePendingSideEffects(room)
    send(connection, messageType, response)
    if (room.ticketBound && !room.state) { scheduleEntryDeadline(room); scheduleGameStartClaim(room) }
    return response
  }
  const reserveEntryAcceptance = entryCacheKey => {
    if (!entryCacheKey || reserveAccepted(entryCacheKey)) return true
    reply('error', { code: 'IDEMPOTENCY_CAPACITY_REACHED', message: '安全落盘队列已满，请稍后重试', retryAfterMs: 500 })
    return false
  }
  const hasOtherPendingAcceptance = entryCacheKey => (
    [...acceptedActions].some(([key, accepted]) => (
      key !== entryCacheKey && accepted.pendingDurability && accepted.response?.roomId === String(payload.roomId || '')
    ))
  )

  if (type === 'createRoom') {
    const roomId = String(payload.roomId || '')
    if (!/^\d{6}$/.test(roomId)) return reply('error', { message: '房间号无效' })
    const conflictingRoom = entryConflictFor(connection, roomId)
    if (conflictingRoom) return reply('error', { code: 'ALREADY_IN_ROOM', message: `请先离开房间 ${conflictingRoom.roomId}` })
    if (!rooms.has(roomId) && rooms.size >= maxRooms) return reply('error', { code: 'ROOM_CAPACITY_REACHED', message: '房间服务已达到容量上限' })
    let ticketStatus
    try { ticketStatus = inspectEntryTicket(payload, { roomId, seat: 'p1' }) } catch (error) {
      return reply('error', { message: error instanceof Error ? error.message : '入桌票据无效' })
    }
    const claims = ticketStatus.claims
    if (ticketBlockedByClosedRoom(claims)) return reply('error', { code: 'ROOM_CLOSED', message: '该平台房间已经关闭' })
    if (claims?.purpose === 'rejoin') return reply('error', { code: 'RECOVERY_TICKET_REQUIRES_JOIN', message: '恢复票据必须使用 joinRoom' })
    const entryAttemptId = normalizeEntryAttemptId(payload.entryAttemptId)
    if (entryAttemptId === undefined) return reply('error', { code: 'INVALID_ENTRY_ATTEMPT_ID', message: 'entryAttemptId 必须是22至128位URL安全随机字符串' })
    if (claims && entryAttemptId !== claims.entryAttemptId) return reply('error', { code: 'ENTRY_ATTEMPT_MISMATCH', message: 'entryAttemptId 与签名入桌票据不匹配' })
    let requestedRoomSettings
    try { requestedRoomSettings = normalizeFriendRoomSettings(claims?.roomSettings ?? payload.roomSettings, { strict: true }) } catch (error) {
      return reply('error', { message: error instanceof Error ? error.message : '好友房设置无效' })
    }
    let room = rooms.get(roomId)
    if (claims && room?.revokedTicketJtis?.some(item => item.jti === claims.jti)) return reply('error', { code: 'ROOM_TICKET_REVOKED', message: '该入桌票据已被撤销' })
    if (pendingSeatReleaseFor(room, claims)) return reply('error', { code: 'FRIEND_SEAT_RELEASE_PENDING', message: '该席位正在等待平台确认离席' })
    const entryCacheKey = claims
      ? credentialCacheKey('entry-ticket', claims.jti)
      : credentialCacheKey(entryAttemptId ? 'entry-attempt' : 'entry-connection', entryAttemptId || connection.id)
    if (await replayEntryResponse(entryCacheKey, room, 'p1')) return
    if (hasOtherPendingAcceptance(entryCacheKey)) return reply('error', { code: 'PERSISTENCE_PENDING', message: '上一请求仍在等待安全落盘，请先重试原 requestId' })
    if (!reserveEntryAcceptance(entryCacheKey)) return
    try {
      if (ticketStatus.consumed || (claims && room?.ticketJtisBySeat?.p1 === claims.jti)) return reply('error', { code: 'GAME_TICKET_USED', message: '入桌票据已使用；请使用恢复票据或本地重连凭证' })
    let createdRoom = false
    if (room) {
      if (!claims || !room.ticketBound || !ticketMatchesRoom(room, claims)) return reply('error', { message: '房间号已存在' })
      if (room.state) return reply('error', { code: 'RECOVERY_TICKET_REQUIRED', message: '对局已经开始，请使用恢复票据或本地重连凭证' })
      ensureTicketBindings(room)
      if (seatHasAnotherActiveConnection(room, 'p1', connection)) return reply('error', { message: '房主席位已被占用' })
      if (room.userIdsBySeat.p1 && room.userIdsBySeat.p1 !== claims.sub) return reply('error', { message: '房主席位已绑定其他用户' })
    } else {
      room = createRoomRecord({
        roomId,
        hostName: String(payload.hostName || '玩家').trim().slice(0, 24) || '玩家',
        hostConnectionId: connection.id,
        ticketClaims: claims,
        roomSettings: requestedRoomSettings,
      })
      rooms.set(roomId, room)
      createdRoom = true
    }
    try { gameTicketVerifier.consume(claims) } catch (error) {
      if (createdRoom) rooms.delete(roomId)
      return reply('error', { message: error instanceof Error ? error.message : '入桌票据已使用' })
    }
    room.hostName = String(payload.hostName || '玩家').trim().slice(0, 24) || '玩家'
    room.seats.p1 = connection.id
    room.resumeTokens.p1 ||= createResumeToken()
    if (claims) {
      room.ticketBound = true
      room.entryKind = entryKindForClaims(claims)
      room.matchId = claims.matchId
      room.userIdsBySeat.p1 = claims.sub
      revokePreviousSeatTicket(room, 'p1', claims.jti)
      room.ticketJtisBySeat.p1 = claims.jti
      room.ticketExpiresAtBySeat.p1 = claims.exp
      room.entryDeadlineAt = claims.roomKind === 'friend' ? entryDeadlineForClaims(claims) : Math.max(Number(room.entryDeadlineAt) || 0, entryDeadlineForClaims(claims))
    }
    clearHostExpiry(roomId)
    clearEmptyRoomExpiry(roomId)
    connection.roomId = roomId
    if (room.state && !room.matchStartedAt) { room.matchStartedAt = Date.now(); armMatchDuration(room); armTurnDeadline(room, { publish: false }) }
    autoStartMatchedRoom(room)
    await acceptEntryResponse(entryCacheKey, room, 'p1', 'roomCreated')
    broadcastRooms()
    return
    } finally { releaseAccepted(entryCacheKey) }
  }

  if (type === 'rejoinRoom') {
    const roomId = String(payload.roomId || '')
    const conflictingRoom = entryConflictFor(connection, roomId)
    if (conflictingRoom) return reply('error', { code: 'ALREADY_IN_ROOM', message: `请先离开房间 ${conflictingRoom.roomId}` })
    const room = rooms.get(roomId)
    const myPlayerId = payload.myPlayerId
    if (!room || !ids.includes(myPlayerId)) return reply('error', { message: '房间或席位无效' })
    const entryCacheKey = credentialCacheKey('rejoin-token', payload.resumeToken)
    if (await replayEntryResponse(entryCacheKey, room, myPlayerId)) return
    if (hasOtherPendingAcceptance(entryCacheKey)) return reply('error', { code: 'PERSISTENCE_PENDING', message: '上一请求仍在等待安全落盘，请先重试原 requestId' })
    if (!reserveEntryAcceptance(entryCacheKey)) return
    try {
      if (isBotPlayer(room, myPlayerId)) return reply('error', { message: '该席位当前由机器人占用' })
    if (!sameToken(room.resumeTokens[myPlayerId], payload.resumeToken)) return reply('error', { message: '重连凭证无效' })
    if (seatHasAnotherActiveConnection(room, myPlayerId, connection)) return reply('error', { message: '该席位已被另一个活动连接占用' })
    const nextResumeToken = createResumeToken()
    rotateAcceptedActionIdentity(room.resumeTokens[myPlayerId], nextResumeToken, room)
    room.resumeTokens[myPlayerId] = nextResumeToken
    room.seats[myPlayerId] = connection.id
    room.version += 1
    connection.roomId = roomId
    clearEmptyRoomExpiry(roomId)
    const restoredDissolveVote = restoreOfflineDissolveVote(room, myPlayerId)
    if (myPlayerId === 'p1') clearHostExpiry(roomId)
    await acceptEntryResponse(entryCacheKey, room, myPlayerId, 'roomRejoined')
    publishRoomMembers(room)
    if (restoredDissolveVote) publishDissolveVote(room)
    return
    } finally { releaseAccepted(entryCacheKey) }
  }

  const roomId = String(payload.roomId || '')
  if (!/^\d{6}$/.test(roomId)) return reply('error', { message: '房间号无效' })
  const conflictingRoom = entryConflictFor(connection, roomId)
  if (conflictingRoom) return reply('error', { code: 'ALREADY_IN_ROOM', message: `请先离开房间 ${conflictingRoom.roomId}` })
  if (!rooms.has(roomId) && rooms.size >= maxRooms) return reply('error', { code: 'ROOM_CAPACITY_REACHED', message: '房间服务已达到容量上限' })
  let ticketStatus
  try { ticketStatus = inspectEntryTicket(payload, { roomId }) } catch (error) {
    return reply('error', { message: error instanceof Error ? error.message : '入桌票据无效' })
  }
  const claims = ticketStatus.claims
  if (ticketBlockedByClosedRoom(claims)) return reply('error', { code: 'ROOM_CLOSED', message: '该平台房间已经关闭' })
  const entryAttemptId = normalizeEntryAttemptId(payload.entryAttemptId)
  if (entryAttemptId === undefined) return reply('error', { code: 'INVALID_ENTRY_ATTEMPT_ID', message: 'entryAttemptId 必须是22至128位URL安全随机字符串' })
  if (claims && entryAttemptId !== claims.entryAttemptId) return reply('error', { code: 'ENTRY_ATTEMPT_MISMATCH', message: 'entryAttemptId 与签名入桌票据不匹配' })
  let room = rooms.get(roomId)
  if (claims?.roomKind === 'friend' && room?.revokedFriendUserIds?.includes(claims.sub)) return reply('error', { code: 'FRIEND_ROOM_PARTICIPANT_REVOKED', message: '该用户已被房主移出此好友房' })
  if (claims && room?.revokedTicketJtis?.some(item => item.jti === claims.jti)) return reply('error', { code: 'FRIEND_ROOM_TICKET_REVOKED', message: '该好友房入桌票据已被撤销' })
  if (pendingSeatReleaseFor(room, claims)) return reply('error', { code: 'FRIEND_SEAT_RELEASE_PENDING', message: '该席位正在等待平台确认离席' })
  const existingSeat = room && playerIn(room, connection.id)
  const entryCacheKey = claims
    ? credentialCacheKey('entry-ticket', claims.jti)
    : credentialCacheKey(entryAttemptId ? 'entry-attempt' : 'entry-connection', entryAttemptId || connection.id)
  const replaySeat = claims?.seat || acceptedActions.get(entryCacheKey)?.response?.myPlayerId
  if (replaySeat && await replayEntryResponse(entryCacheKey, room, replaySeat)) return
  if (hasOtherPendingAcceptance(entryCacheKey)) return reply('error', { code: 'PERSISTENCE_PENDING', message: '上一请求仍在等待安全落盘，请先重试原 requestId' })
  if (!reserveEntryAcceptance(entryCacheKey)) return
  try {
    if (existingSeat && (!claims || claims.seat !== existingSeat || !room.ticketBound || !ticketMatchesRoom(room, claims) || room.userIdsBySeat?.[existingSeat] !== claims.sub)) {
    return reply('error', { code: 'ALREADY_IN_ROOM', message: '当前连接已经在该房间中' })
  }
  if (claims?.purpose === 'rejoin') {
    const myPlayerId = claims.seat
    const waitingForClaimedStart = Boolean(room && !room.state && room.pendingGameStartEvent)
    if (!room || (!room.state && !waitingForClaimedStart) || !room.ticketBound || !ticketMatchesRoom(room, claims)) return reply('error', { code: 'RECOVERY_NOT_AVAILABLE', message: '恢复票据对应的进行中牌局不存在' })
    ensureTicketBindings(room)
    if (room.userIdsBySeat[myPlayerId] !== claims.sub) return reply('error', { code: 'RECOVERY_BINDING_MISMATCH', message: '恢复票据与原用户席位不匹配' })
    if (room.ticketJtisBySeat[myPlayerId] === claims.jti || ticketStatus.consumed) return reply('error', { code: 'RECOVERY_TICKET_USED', message: '恢复票据已使用' })
    if (seatHasAnotherActiveConnection(room, myPlayerId, connection)) return reply('error', { code: 'SEAT_ALREADY_CONNECTED', message: '该席位已被另一个活动连接占用' })
    try { gameTicketVerifier.consume(claims) } catch (error) { return reply('error', { code: 'RECOVERY_TICKET_USED', message: error instanceof Error ? error.message : '恢复票据已使用' }) }
    const previousResumeToken = room.resumeTokens[myPlayerId]
    const nextResumeToken = createResumeToken()
    revokePreviousSeatTicket(room, myPlayerId, claims.jti)
    if (previousResumeToken) rotateAcceptedActionIdentity(previousResumeToken, nextResumeToken, room)
    room.ticketJtisBySeat[myPlayerId] = claims.jti
    room.ticketExpiresAtBySeat[myPlayerId] = claims.exp
    room.resumeTokens[myPlayerId] = nextResumeToken
    room.seats[myPlayerId] = connection.id
    connection.roomId = roomId
    clearEmptyRoomExpiry(roomId)
    const restoredDissolveVote = restoreOfflineDissolveVote(room, myPlayerId)
    room.version += 1
    await acceptEntryResponse(entryCacheKey, room, myPlayerId, 'roomRejoined')
    publishRoomMembers(room)
    if (restoredDissolveVote) publishDissolveVote(room)
    if (room.state) publishState(room)
    else publishGameStartPending(room)
    return
  }
  if (claims?.seat === 'p1') return reply('error', { message: 'p1 席位必须使用 createRoom 入桌' })
  if (ticketStatus.consumed || (claims && room?.ticketJtisBySeat?.[claims.seat] === claims.jti)) return reply('error', { code: 'GAME_TICKET_USED', message: '入桌票据已使用；请使用恢复票据或本地重连凭证' })
  let createdRoom = false
  if (!room && claims) { room = createRoomRecord({ roomId, ticketClaims: claims, roomSettings: claims.roomSettings }); rooms.set(roomId, room); createdRoom = true }
  if (!room) return reply('error', { message: '房间不存在' })
  if (!ticketMatchesRoom(room, claims)) return reply('error', { message: room.ticketBound ? '该房间要求有效匹配票据' : '入桌票据与房间不匹配' })
  ensureTicketBindings(room)
  if (room.state) return reply('error', { message: '对局已经开始，请使用重连凭证恢复席位' })
  const myPlayerId = claims?.seat || ids.slice(1).find(id => !seatIsOccupied(room, id))
  if (!myPlayerId) return reply('error', { message: '房间已满' })
  if (seatHasAnotherActiveConnection(room, myPlayerId, connection)) return reply('error', { message: '匹配票据指定席位已被占用' })
  if (claims && room.userIdsBySeat[myPlayerId] && room.userIdsBySeat[myPlayerId] !== claims.sub) {
    const previousTicketExpired = Number(room.ticketExpiresAtBySeat?.[myPlayerId]) * 1000 <= Date.now()
    if (room.entryKind !== 'friend' || !previousTicketExpired || room.seats[myPlayerId]) return reply('error', { message: '匹配席位已绑定其他用户' })
    revokePreviousSeatTicket(room, myPlayerId)
    deleteAcceptedActionIdentity(room.resumeTokens[myPlayerId])
    room.resumeTokens[myPlayerId] = null
    room.userIdsBySeat[myPlayerId] = null
    room.ticketJtisBySeat[myPlayerId] = null
    room.ticketExpiresAtBySeat[myPlayerId] = null
  }
  try { gameTicketVerifier.consume(claims) } catch (error) {
    if (createdRoom) { clearHostExpiry(roomId); rooms.delete(roomId) }
    return reply('error', { message: error instanceof Error ? error.message : '入桌票据已使用' })
  }
  room.seats[myPlayerId] = connection.id
  room.resumeTokens[myPlayerId] ||= createResumeToken()
  ensureLobbyMetadata(room)
  if (!existingSeat) room.lobbyReady[myPlayerId] = false
  room.version += 1
  connection.roomId = roomId
  clearEmptyRoomExpiry(roomId)
  if (claims) {
    room.ticketBound = true
    room.entryKind = entryKindForClaims(claims)
    room.matchId = claims.matchId
    room.userIdsBySeat[myPlayerId] = claims.sub
    revokePreviousSeatTicket(room, myPlayerId, claims.jti)
    room.ticketJtisBySeat[myPlayerId] = claims.jti
    room.ticketExpiresAtBySeat[myPlayerId] = claims.exp
    room.entryDeadlineAt = claims.roomKind === 'friend' ? entryDeadlineForClaims(claims) : Math.max(Number(room.entryDeadlineAt) || 0, entryDeadlineForClaims(claims))
  }
  autoStartMatchedRoom(room)
  await acceptEntryResponse(entryCacheKey, room, myPlayerId, 'roomJoined')
  publishRoomMembers(room)
  broadcastRooms()
  } finally { releaseAccepted(entryCacheKey) }
}
