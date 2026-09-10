import { normalizeFriendRoomSettings } from './friend-room-settings.js'

export const GAME_COMMAND_TYPES = [
  'play', 'pass',
  'nextRound', 'readyNextRound', 'roundReady', 'ready', 'cancelRoundReady', 'cancelReady',
  'setTrustee', 'cancelTrustee',
  'proposeDissolve', 'dissolveVote', 'voteDissolve',
  'tribute', 'returnTribute', 'finishTribute',
]

export const createGameCommandHandler = dependencies => async context => {
  const { type, payload, connection, requestId, cacheKey, reply, rememberActionAcceptance, acceptAction } = context
  const {
    ids, rooms, dissolveTimeoutMs,
    playerIn, ensureLiveMetadata, isFriendRoom, applyPlayerAction, commitPlayerAction,
    armTurnDeadline, prepareNextRound,
    publishTribute, publishRoundReady, publishTrustees, publishTurnStatus, scheduleDissolveExpiry,
    publishDissolveVote, clearDissolveTimer, rememberClosedRoomTombstone, reportSpectatorClosed,
    commitRuntimeState, stagePendingSideEffects, persistRuntimeState, finalizeRemovedRoom,
    send,
  } = dependencies

  const acceptanceFor = playerId => ({ cacheKey, playerId, remember: rememberActionAcceptance, accept: acceptAction })

  // Both a final human vote and an already-unanimous human + bot proposal
  // must follow the same durable close / acceptance path.
  const closeApprovedVote = async room => {
    room.closingReason = 'vote-approved'
    rememberClosedRoomTombstone(room)
    reportSpectatorClosed(room, 'dissolved')
    await commitRuntimeState()
    stagePendingSideEffects(room)
    rooms.delete(room.roomId)
    const accepted = rememberActionAcceptance(room)
    try { await commitRuntimeState() } catch (error) {
      rooms.set(room.roomId, room)
      if (cacheKey) { dependencies.acceptedActions.delete(cacheKey); connection.acceptedCacheKeys.delete(requestId) }
      persistRuntimeState()
      throw error
    }
    send(connection, 'actionAccepted', accepted)
    finalizeRemovedRoom(room)
  }

  if (type === 'play' || type === 'pass') {
    const room = rooms.get(String(payload.roomId || connection.roomId || ''))
    const playerId = room && playerIn(room, connection.id)
    if (room && !playerId) return reply('error', { code: 'OBSERVER_READ_ONLY', message: '观战位不能出牌' })
    if (!room || !playerId || !room.state) return reply('error', { message: '对局尚未开始' })
    ensureLiveMetadata(room)
    if (room.trustees[playerId]) return reply('error', { message: '请先取消托管再操作' })
    if (room.matchEnded || room.state.phase !== 'playing') return reply('error', { message: '当前阶段不能出牌' })
    try {
      const cardIds = type === 'play' && Array.isArray(payload.cardIds) ? payload.cardIds : []
      const outcome = applyPlayerAction(room, type === 'play'
        ? { type: 'PLAY_CARDS', playerId, cardIds } : { type: 'PASS', playerId })
      try { await commitPlayerAction(room, outcome, { acceptance: acceptanceFor(playerId) }) } catch (error) {
        if (!outcome.roundResult) throw error
        reply('error', { code: 'PERSISTENCE_PENDING', message: '终局动作已生成，正在等待安全落盘', retryAfterMs: 500 })
      }
    } catch (error) { reply('error', { message: error instanceof Error ? error.message : '出牌失败' }) }
    return
  }
  if (['nextRound', 'readyNextRound', 'roundReady', 'ready'].includes(type)) {
    const room = rooms.get(String(payload.roomId || connection.roomId || ''))
    const playerId = room && playerIn(room, connection.id)
    if (!room || !playerId || !room.roundResult) return reply('error', { message: '当前不能准备下一局' })
    if (room.matchEnded) return reply('error', { message: '本场已结束，请重新创建对局' })
    if (room.roundResult.isGameWon) return reply('error', { message: '本场已打过 A，请重新创建对局' })
    ensureLiveMetadata(room)
    room.roundReady[playerId] = true
    room.version += 1
    const prepared = ids.every(id => room.roundReady[id])
    if (prepared) prepareNextRound(room, false)
    await acceptAction(room)
    if (prepared) publishTribute(room, 'roundPrepared')
    else publishRoundReady(room)
    return
  }
  if (type === 'cancelRoundReady' || type === 'cancelReady') {
    const room = rooms.get(String(payload.roomId || connection.roomId || ''))
    const playerId = room && playerIn(room, connection.id)
    if (!room || !playerId || !room.roundResult) return reply('error', { message: '当前不能取消准备' })
    ensureLiveMetadata(room)
    room.roundReady[playerId] = false
    room.version += 1
    await acceptAction(room)
    publishRoundReady(room)
    return
  }
  if (type === 'setTrustee' || type === 'cancelTrustee') {
    const room = rooms.get(String(payload.roomId || connection.roomId || ''))
    const playerId = room && playerIn(room, connection.id)
    if (!room || !playerId || !room.state || room.matchEnded) return reply('error', { message: '当前不在进行中的对局' })
    ensureLiveMetadata(room)
    if (type === 'setTrustee' && isFriendRoom(room) && normalizeFriendRoomSettings(room.roomSettings).trusteeSeconds === 0) {
      return reply('error', { message: '本好友房已关闭托管' })
    }
    if (type === 'setTrustee') room.trustees[playerId] = { reason: 'manual', since: Date.now() }
    else { room.trustees[playerId] = null; room.consecutiveTimeouts[playerId] = 0 }
    room.version += 1
    if (!room.roundResult && room.deadlinePlayerId === playerId) armTurnDeadline(room, { publish: false })
    await acceptAction(room)
    publishTrustees(room)
    publishTurnStatus(room)
    return
  }
  if (type === 'proposeDissolve') {
    const room = rooms.get(String(payload.roomId || connection.roomId || ''))
    const playerId = room && playerIn(room, connection.id)
    if (!room || !playerId || !room.state) return reply('error', { message: '当前不在对局中' })
    ensureLiveMetadata(room)
    if (room.dissolveVote) return reply('error', { message: '已有解散投票进行中' })
    const votes = { p1: 'pending', p2: 'pending', p3: 'pending', p4: 'pending' }
    votes[playerId] = 'agree'
    room.botPlayerIds.forEach(id => { votes[id] = 'agree' })
    room.dissolveVote = { initiator: playerId, votes, expiresAt: Date.now() + dissolveTimeoutMs }
    room.version += 1
    if (ids.every(id => votes[id] === 'agree')) return closeApprovedVote(room)
    scheduleDissolveExpiry(room)
    await acceptAction(room)
    publishDissolveVote(room)
    return
  }
  if (type === 'dissolveVote' || type === 'voteDissolve') {
    const room = rooms.get(String(payload.roomId || connection.roomId || ''))
    const playerId = room && playerIn(room, connection.id)
    if (!room || !playerId || !room.dissolveVote) return reply('error', { message: '当前没有解散投票' })
    const agree = payload.agree === true
    room.dissolveVote.votes[playerId] = agree ? 'agree' : 'refuse'
    room.version += 1
    if (!agree) {
      room.dissolveVote = null
      clearDissolveTimer(room.roomId)
      await acceptAction(room)
      publishDissolveVote(room, 'rejected')
      return
    }
    if (ids.every(id => room.dissolveVote.votes[id] === 'agree')) {
      return closeApprovedVote(room)
    }
    await acceptAction(room)
    publishDissolveVote(room)
    return
  }
  if (type === 'tribute' || type === 'returnTribute') {
    const room = rooms.get(String(payload.roomId || connection.roomId || ''))
    const playerId = room && playerIn(room, connection.id)
    if (!room || !playerId || room.state?.phase !== 'tribute' || !room.state.tribute) return reply('error', { message: '当前不是贡还阶段' })
    if (room.trustees[playerId]) return reply('error', { message: '请先取消托管再操作' })
    if (room.deadlinePlayerId !== playerId || room.deadlineAction !== type) return reply('error', { message: '当前等待其他玩家完成贡还' })
    try {
      const outcome = applyPlayerAction(room, { type: type === 'tribute' ? 'SELECT_TRIBUTE_CARD' : 'SELECT_RETURN_CARD', playerId, cardId: payload.cardId })
      await commitPlayerAction(room, outcome, { acceptance: acceptanceFor(playerId) })
    } catch (error) { reply('error', { message: error instanceof Error ? error.message : '贡还失败' }) }
    return
  }
  if (type === 'finishTribute') {
    const room = rooms.get(String(payload.roomId || connection.roomId || ''))
    const playerId = room && playerIn(room, connection.id)
    if (!room || room.state?.phase !== 'tribute' || !['ready', 'resisted'].includes(room.state.tribute?.status)) return reply('error', { message: '贡还尚未完成' })
    if (!playerId || room.deadlinePlayerId !== playerId || room.deadlineAction !== 'finishTribute') return reply('error', { message: '当前等待指定玩家开始本局' })
    if (room.trustees[playerId]) return reply('error', { message: '请先取消托管再操作' })
    try {
      const outcome = applyPlayerAction(room, { type: 'BEGIN_PLAY_AFTER_TRIBUTE', playerId })
      await commitPlayerAction(room, outcome, { acceptance: acceptanceFor(playerId) })
    } catch (error) { reply('error', { message: error instanceof Error ? error.message : '开始本局失败' }) }
    return
  }
}
