import { normalizeFriendRoomSettings } from './friend-room-settings.js'
import { dispatchMatchIntent, matchFailureMessage } from './game-session.js'

export const GAME_COMMAND_TYPES = [
  'play', 'pass',
  'nextRound', 'readyNextRound', 'roundReady', 'ready', 'cancelRoundReady', 'cancelReady',
  'setTrustee', 'cancelTrustee',
  'proposeDissolve', 'dissolveVote', 'voteDissolve',
  'tribute', 'returnTribute', 'finishTribute',
  'chat',
]

export const createGameCommandHandler = dependencies => async context => {
  const { type, payload, connection, requestId, cacheKey, reply, rememberActionAcceptance, acceptAction } = context
  const {
    ids, rooms, dissolveTimeoutMs, quickChatIntervalMs, quickChatRepeatMs, quickChatPhrases,
    playerIn, ensureLiveMetadata, isFriendRoom, applyRoomSettlementPolicy,
    syncRoomFromMatchState, recordRoomAction, reportSpectatorAction, consumeRoundSettlement,
    armTurnDeadline, finalizePendingRound, publishState, prepareNextRound,
    publishTribute, publishRoundReady, publishTrustees, publishTurnStatus, scheduleDissolveExpiry,
    publishDissolveVote, clearDissolveTimer, rememberClosedRoomTombstone, reportSpectatorClosed,
    commitRuntimeState, stagePendingSideEffects, persistRuntimeState, finalizeRemovedRoom,
    reportSpectatorEvent, finishTributeState, broadcast, send,
  } = dependencies

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
      const previousState = room.state
      const cardIds = type === 'play' && Array.isArray(payload.cardIds) ? payload.cardIds : []
      let transitionResult = dispatchMatchIntent(previousState, type === 'play'
        ? { type: 'PLAY_CARDS', playerId, cardIds }
        : { type: 'PASS', playerId })
      if (!transitionResult.ok) throw new Error(matchFailureMessage(transitionResult.reason))
      transitionResult = applyRoomSettlementPolicy(room, previousState, transitionResult)
      room.state = transitionResult.state
      syncRoomFromMatchState(room)
      const playEvent = transitionResult.events.find(event => event.type === 'CARDS_PLAYED')
      const roundResult = transitionResult.events.find(event => event.type === 'ROUND_SETTLED')?.settlement ?? null
      recordRoomAction(room, playerId, { kind: type, playType: playEvent?.action.type || null })
      reportSpectatorAction(room, { type, playerId, cards: playEvent?.action.cards || [], automatic: false })
      room.consecutiveTimeouts[playerId] = 0
      room.version += 1
      consumeRoundSettlement(room, roundResult)
      if (!roundResult) armTurnDeadline(room, { publish: false })
      if (roundResult) {
        const accepted = rememberActionAcceptance(room)
        room.pendingRoundFinalization = {
          cacheKey,
          playerId,
          accepted,
          result: structuredClone(roundResult),
          actionBroadcast: null,
        }
        try { await finalizePendingRound(room) } catch {
          reply('error', { code: 'PERSISTENCE_PENDING', message: '终局动作已生成，正在等待安全落盘', retryAfterMs: 500 })
        }
      } else {
        await acceptAction(room)
        publishState(room)
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
      const result = type === 'tribute'
        ? dispatchMatchIntent(room.state, { type: 'SELECT_TRIBUTE_CARD', playerId, cardId: payload.cardId })
        : dispatchMatchIntent(room.state, { type: 'SELECT_RETURN_CARD', playerId, cardId: payload.cardId })
      if (!result.ok) throw new Error(matchFailureMessage(result.reason))
      room.state = result.state
      syncRoomFromMatchState(room)
      room.tribute = null
      room.consecutiveTimeouts[playerId] = 0
      room.version += 1
      recordRoomAction(room, playerId, { kind: type })
      reportSpectatorEvent(room, { type: type === 'tribute' ? 'tribute' : 'return-tribute', playerId, roundSequence: room.roundSequence + 1 })
      armTurnDeadline(room, { publish: false })
      await acceptAction(room)
      publishTribute(room)
    } catch (error) { reply('error', { message: error instanceof Error ? error.message : '贡还失败' }) }
    return
  }
  if (type === 'finishTribute') {
    const room = rooms.get(String(payload.roomId || connection.roomId || ''))
    const playerId = room && playerIn(room, connection.id)
    if (!room || room.state?.phase !== 'tribute' || !['ready', 'resisted'].includes(room.state.tribute?.status)) return reply('error', { message: '贡还尚未完成' })
    if (!playerId || room.deadlinePlayerId !== playerId || room.deadlineAction !== 'finishTribute') return reply('error', { message: '当前等待指定玩家开始本局' })
    if (room.trustees[playerId]) return reply('error', { message: '请先取消托管再操作' })
    try { finishTributeState(room) } catch (error) { return reply('error', { message: error instanceof Error ? error.message : '开始本局失败' }) }
    room.consecutiveTimeouts[playerId] = 0
    room.version += 1
    armTurnDeadline(room, { publish: false })
    await acceptAction(room)
    publishState(room)
    return
  }
  if (type === 'chat') {
    const room = rooms.get(String(payload.roomId || connection.roomId || ''))
    const playerId = room && playerIn(room, connection.id)
    const text = typeof payload.text === 'string' ? payload.text.trim() : ''
    if (!room || !playerId) return reply('error', { message: '当前不在房间中' })
    if (isFriendRoom(room) && normalizeFriendRoomSettings(room.roomSettings).disableInteraction) return reply('error', { message: '本好友房已禁止互动' })
    if (!quickChatPhrases.has(text)) return reply('error', { message: '仅支持固定快捷语' })
    room.chatLastAcceptedAt ||= { p1: 0, p2: 0, p3: 0, p4: 0 }
    room.chatLastPhraseAt ||= { p1: {}, p2: {}, p3: {}, p4: {} }
    const now = Date.now()
    const intervalRemaining = room.chatLastAcceptedAt[playerId] + quickChatIntervalMs - now
    if (intervalRemaining > 0) return reply('error', { message: '快捷语发送过于频繁', retryAfterMs: intervalRemaining })
    const repeatRemaining = (room.chatLastPhraseAt[playerId][text] || 0) + quickChatRepeatMs - now
    if (repeatRemaining > 0) return reply('error', { message: '相同快捷语仍在冷却中', retryAfterMs: repeatRemaining })
    room.chatLastAcceptedAt[playerId] = now
    room.chatLastPhraseAt[playerId][text] = now
    await acceptAction(room)
    broadcast(room, 'chat', { roomId: room.roomId, playerId, text, version: room.version })
    return
  }
}
