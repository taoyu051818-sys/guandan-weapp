import { memberIsHost, roomMember } from './friend-room-members.js'
export const LOBBY_COMMAND_TYPES = [
  'startGame', 'setLobbyReady', 'cancelLobbyReady', 'kickMember', 'addBot', 'removeBot',
]

export const createLobbyCommandHandler = dependencies => async context => {
  const { type, payload, connection, requestId, cacheKey, requestFingerprint, reply, acceptAction } = context
  const {
    ids, rooms, connections, playerIn, isMatchRoom, isFriendRoom, seatIsOccupied,
    ensureLobbyMetadata, prepareGameStartClaim, commitRuntimeState, publishGameStartPending,
    spectatorEventReporter, persistClaimedGameStart, isTerminalGameStartClaimError,
    abandonUnclaimedGameStart, closeRoomWithoutAck, scheduleGameStartClaim, finalizeClaimedGameStart,
    initializeRoomMatch, reportSpectatorEvent, armMatchDuration, armTurnDeadline, publishState, deleteAcceptedActionIdentity,
    publishLobbyReady, ensureBotMetadata, syncConnectionRoomId, send, publishRoomMembers, broadcastRooms,
  } = dependencies

  if (type === 'startGame') {
    const room = rooms.get(String(payload.roomId || connection.roomId || ''))
    if (!room || !memberIsHost(room, connection.id)) return reply('error', { message: '只有房主可以开始游戏' })
    if (isMatchRoom(room)) return reply('error', { message: '匹配房必须等待平台确认后由服务器自动开局' })
    if (room.state) return reply('error', { message: '对局已经开始' })
    if (ids.some(id => !seatIsOccupied(room, id))) return reply('error', { message: '需要四个已占用席位才能开始' })
    ensureLobbyMetadata(room)
    if (isFriendRoom(room) && ids.some(id => !room.lobbyReady[id])) return reply('error', { message: '四名玩家都准备后才能开始' })
    let startClaimEvent = null
    if (room.ticketBound) {
      startClaimEvent = prepareGameStartClaim(room)
      room.pendingGameStartRequest ||= { cacheKey, fingerprint: requestFingerprint, requestId }
      try {
        await commitRuntimeState()
        publishGameStartPending(room)
        await spectatorEventReporter.claimStart(startClaimEvent)
        if (!await persistClaimedGameStart(room, startClaimEvent)) return
      } catch (error) {
        if (isTerminalGameStartClaimError(error)) {
          abandonUnclaimedGameStart(room, startClaimEvent)
          await closeRoomWithoutAck(room, 'start-rejected')
          return reply('error', {
            code: error?.code || 'GAME_START_REJECTED',
            message: error instanceof Error ? error.message : '平台拒绝好友房开局',
          })
        }
        scheduleGameStartClaim(room, 500)
        return reply('gameStartPending', {
          code: error?.code || 'GAME_START_CLAIM_FAILED',
          message: error instanceof Error ? error.message : '平台尚未确认好友房开局',
          roomId: room.roomId,
          phase: 'lobby',
          gameStartPending: true,
          version: room.version,
          gameVersion: room.gameVersion,
        })
      }
    }
    if (startClaimEvent) {
      try { await finalizeClaimedGameStart(room, startClaimEvent) } catch {
        publishGameStartPending(room)
        return reply('gameStartPending', {
          code: 'PERSISTENCE_PENDING',
          message: '平台已确认开局，正在安全保存牌局',
          roomId: room.roomId,
          phase: 'lobby',
          gameStartPending: true,
          version: room.version,
          gameVersion: room.gameVersion,
        })
      }
      return
    }
    initializeRoomMatch(room)
    room.matchStartedAt = Date.now()
    room.totalDeadlineAt = null
    room.matchEnded = null
    room.version += 1
    reportSpectatorEvent(room, { type: 'game-start', roundSequence: 1 })
    armMatchDuration(room)
    armTurnDeadline(room, { publish: false })
    await acceptAction(room)
    publishState(room)
    return
  }
  if (type === 'setLobbyReady' || type === 'cancelLobbyReady') {
    const room = rooms.get(String(payload.roomId || connection.roomId || ''))
    const playerId = room && playerIn(room, connection.id)
    if (!room || !playerId) return reply('error', { message: '当前不在房间中' })
    if (isMatchRoom(room)) return reply('error', { message: '匹配房由服务器自动开局，无需手动准备' })
    if (room.state) return reply('error', { message: '对局已经开始' })
    ensureLobbyMetadata(room)
    const ready = type === 'setLobbyReady'
    if (room.lobbyReady[playerId] !== ready) { room.lobbyReady[playerId] = ready; room.version += 1 }
    await acceptAction(room)
    publishLobbyReady(room)
    return
  }
  if (type === 'kickMember') {
    const room = rooms.get(String(payload.roomId || connection.roomId || ''))
    if (!room || !memberIsHost(room, connection.id)) return reply('error', { message: '只有房主可以移出成员' })
    if (isMatchRoom(room)) return reply('error', { message: '匹配房不允许房主移出成员' })
    if (room.state) return reply('error', { message: '对局开始后不能移出成员' })
    const targetPlayerId = String(payload.playerId || '')
    if (!ids.includes(targetPlayerId) || memberIsHost(room, room.seats[targetPlayerId])) return reply('error', { message: '只能移出其他有效席位' })
    const targetConnectionId = room.seats[targetPlayerId]
    const targetConnection = connections.get(targetConnectionId)
    if (!targetConnectionId || !targetConnection) return reply('error', { message: '该成员当前不在房间中' })
    ensureLobbyMetadata(room)
    if (room.lobbyReady[targetPlayerId]) return reply('error', { message: '已准备成员不能被移出，请等待其取消准备' })
    const targetUserId = room.userIdsBySeat?.[targetPlayerId]
    const targetTicketJti = room.ticketJtisBySeat?.[targetPlayerId]
    const targetTicketExp = room.ticketExpiresAtBySeat?.[targetPlayerId]
    const targetMember = roomMember(room, targetConnectionId)
    if (targetMember) room.friendMembers = room.friendMembers.filter(member => member !== targetMember)
    room.seats[targetPlayerId] = null
    deleteAcceptedActionIdentity(room.resumeTokens[targetPlayerId])
    room.resumeTokens[targetPlayerId] = null
    room.lobbyReady[targetPlayerId] = false
    if (room.entryKind === 'friend' && targetUserId) {
      room.revokedFriendUserIds = [...new Set([...(room.revokedFriendUserIds || []), targetUserId])]
      if (targetTicketJti && Number.isFinite(targetTicketExp)) room.revokedTicketJtis.push({ jti: targetTicketJti, exp: targetTicketExp })
      room.userIdsBySeat[targetPlayerId] = null
      room.ticketJtisBySeat[targetPlayerId] = null
      room.ticketExpiresAtBySeat[targetPlayerId] = null
      reportSpectatorEvent(room, { type: 'seat-left', playerId: targetPlayerId, userId: targetUserId, reason: 'kicked', roundSequence: 1 })
    }
    syncConnectionRoomId(targetConnection)
    room.version += 1
    await acceptAction(room)
    send(targetConnection, 'roomKicked', { roomId: room.roomId, reason: 'host-kicked', version: room.version })
    publishRoomMembers(room)
    broadcastRooms()
    return
  }
  const room = rooms.get(String(payload.roomId || connection.roomId || ''))
  if (!room || !memberIsHost(room, connection.id)) return reply('error', { message: '只有房主可以设置机器人' })
  if (room.ticketBound) return reply('error', { message: '平台票据房不允许设置机器人' })
  if (room.state) return reply('error', { message: '对局开始后不能设置机器人' })
  const targetPlayerId = String(payload.playerId || '')
  if (!ids.includes(targetPlayerId) || memberIsHost(room, room.seats[targetPlayerId])) return reply('error', { message: '只能设置空闲的其他席位' })
  ensureLobbyMetadata(room)
  const botIndex = room.botPlayerIds.indexOf(targetPlayerId)
  if (type === 'addBot') {
    if (room.seats[targetPlayerId] || room.friendMembers?.some(member => member.seat === targetPlayerId)) return reply('error', { message: '该席位已有玩家' })
    if (botIndex >= 0) return reply('error', { message: '该席位已经是机器人' })
    room.botPlayerIds.push(targetPlayerId)
    room.botPlayerIds.sort((left, right) => ids.indexOf(left) - ids.indexOf(right))
    ensureBotMetadata(room)
    room.lobbyReady[targetPlayerId] = true
  } else {
    if (botIndex < 0) return reply('error', { message: '该席位不是机器人' })
    room.botPlayerIds.splice(botIndex, 1)
    room.lobbyReady[targetPlayerId] = false
  }
  room.version += 1
  await acceptAction(room)
  publishRoomMembers(room)
  broadcastRooms()
}
