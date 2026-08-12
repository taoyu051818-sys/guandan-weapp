import { createRequire } from 'node:module'
import { createGameStatsBySeat } from './game-stats.js'
import { adjustDoubleDownSettlement, hasReachedRoundLimit, normalizeFriendRoomSettings } from './friend-room-settings.js'
import { MASTER_BOT_DIFFICULTY } from './master-bot-policy.js'
import { dispatchMatchIntent, matchFailureMessage, replaceSettlement } from './game-session.js'

const require = createRequire(import.meta.url)
const { createDeck, dealCards, shuffleDeck, highestCard, automaticReturnCard } = require('../../../shared-core/dist')

/** Owns authoritative turn, match-duration, and round-finalization lifecycles. */
export const createWeAppMatchLifecycle = ({
  playerIds,
  rooms,
  connections,
  turnTimeoutMs,
  trusteeActionDelayMs,
  botActionDelayMs,
  friendSecondMs,
  totalMinuteMs,
  matchEndFinalizeRetryMs = 500,
  automatedDeadlineMaxAttempts = 3,
  automatedDeadlineRetryBaseMs = 100,
  automatedDeadlineRetryMaxMs = 2_000,
  timeoutsBeforeTrustee = 2,
  testMatchEndPersistFailures = 0,
  testRoundFinalizationPersistFailures = 0,
  isShuttingDown,
  enqueueServerOperation,
  ensureLiveMetadata,
  isFriendRoom,
  isMatchRoom,
  isBotPlayer,
  botPolicyForRoom,
  existingBotPolicyForRoom,
  dispatchMatchIntentImpl = dispatchMatchIntent,
  shuffleRandom,
  persistRuntimeState,
  commitRuntimeState,
  stagePendingSideEffects,
  broadcast,
  send,
  phaseFor,
  liveMetadataFor,
  publishTurnStatus,
  publishState,
  publishTribute,
  publishRoundEnded,
  recordRoomAction,
  reportSpectatorEvent,
  reportSpectatorAction,
  reportSpectatorRoundEnd,
  reportCompletedGame,
  closeRoomWithoutAck,
  log = console,
  now = Date.now,
  scheduleTimeout = setTimeout,
  cancelTimeout = clearTimeout,
}) => {
  const turnTimers = new Map()
  const matchDurationTimers = new Map()
  const roundFinalizationTimers = new Map()
  let matchEndPersistFailuresRemaining = testMatchEndPersistFailures
  let roundFinalizationPersistFailuresRemaining = testRoundFinalizationPersistFailures
  const deadlineMaxAttempts = Math.max(1, Number(automatedDeadlineMaxAttempts) || 1)
  const deadlineRetryDelay = attempt => Math.min(Math.max(1, Number(automatedDeadlineRetryMaxMs) || 1), Math.max(1, Number(automatedDeadlineRetryBaseMs) || 1) * (2 ** Math.min(20, attempt - 1)))

  const clearTimer = (timers, roomId) => {
    const timer = timers.get(roomId)
    if (timer) cancelTimeout(timer)
    timers.delete(roomId)
  }
  const clearTurnTimer = roomId => clearTimer(turnTimers, roomId)
  const clearMatchDurationTimer = roomId => clearTimer(matchDurationTimers, roomId)
  const restoreRoom = (room, snapshot) => {
    for (const key of Object.keys(room)) delete room[key]
    Object.assign(room, snapshot)
  }
  const scheduleTurnRetry = (room, operation, label, delay) => {
    clearTurnTimer(room.roomId)
    if (isShuttingDown() || !rooms.has(room.roomId)) return
    const timer = scheduleTimeout(() => {
      if (turnTimers.get(room.roomId) === timer) turnTimers.delete(room.roomId)
      void enqueueServerOperation(operation, label, room.roomId)
    }, delay)
    timer.unref?.()
    turnTimers.set(room.roomId, timer)
  }
  const closeFailedDeadlineRoom = async room => {
    try { await closeRoomWithoutAck(room, 'automated-deadline-failed', 'roomDissolved', 'dissolved') } catch (error) {
      scheduleTurnRetry(room, () => closeFailedDeadlineRoom(room), `failed deadline close ${room.roomId}`, automatedDeadlineRetryMaxMs)
      throw error
    }
  }
  const syncRoomFromMatchState = room => {
    room.gameVersion = room.state.revision
    room.teamLevels = { ...room.state.teamLevels }
    room.aFailStreaks = { ...room.state.aFailStreaks }
    room.scores = { ...room.state.scores }
    room.lastRoundRank = [...room.state.lastRoundRank]
    room.roundResult = room.state.settlement
  }
  const applyRoomSettlementPolicy = (room, previousState, transitionResult) => {
    if (!transitionResult.ok) return transitionResult
    const settlementEvent = transitionResult.events.find(event => event.type === 'ROUND_SETTLED')
    if (!settlementEvent) return transitionResult
    const roomSettings = normalizeFriendRoomSettings(room.roomSettings)
    const adjusted = adjustDoubleDownSettlement({
      result: settlementEvent.settlement,
      state: transitionResult.state,
      previousTeamLevels: previousState.teamLevels,
      roomSettings,
    })
    if (adjusted === settlementEvent.settlement) return transitionResult
    return {
      ...transitionResult,
      state: replaceSettlement(previousState, transitionResult.state, adjusted),
      events: transitionResult.events.map(event => event.type === 'ROUND_SETTLED'
        ? { ...event, settlement: adjusted }
        : event),
    }
  }
  const markMatchEnded = (room, reason, { endedAt = now(), winnerTeam: settlementWinnerTeam = null } = {}) => {
    if (room.matchEnded) return false
    clearTurnTimer(room.roomId)
    clearMatchDurationTimer(room.roomId)
    room.turnDeadlineAt = null
    room.deadlinePlayerId = null
    room.deadlineAction = null
    const scores = {
      teamA: Number(room.scores?.teamA) || 0,
      teamB: Number(room.scores?.teamB) || 0,
    }
    const winnerTeam = reason === 'round-limit'
      ? (scores.teamA === scores.teamB ? null : scores.teamA > scores.teamB ? 'teamA' : 'teamB')
      : reason === 'passed-a' ? settlementWinnerTeam : null
    if (reason === 'passed-a' && !['teamA', 'teamB'].includes(winnerTeam)) {
      throw new Error('过 A 终局缺少权威结算胜方')
    }
    room.matchEnded = {
      reason,
      endedAt,
      roundsPlayed: Math.max(0, Number(room.roundSequence) || 0),
      configuredRounds: normalizeFriendRoomSettings(room.roomSettings).rounds,
      scores,
      winnerTeam,
    }
    return true
  }
  const reportConfiguredMatchEnd = room => {
    if (!['round-limit', 'time-limit'].includes(room.matchEnded?.reason)) return null
    return reportSpectatorEvent(room, {
      type: 'match-ended',
      roundSequence: Math.max(1, room.matchEnded.roundsPlayed),
      reason: room.matchEnded.reason,
      scores: { ...room.matchEnded.scores },
      roundsPlayed: room.matchEnded.roundsPlayed,
      endedAt: room.matchEnded.endedAt,
      winnerTeam: room.matchEnded.winnerTeam,
    })
  }
  const commitConfiguredMatchEnd = async () => {
    if (matchEndPersistFailuresRemaining > 0) {
      matchEndPersistFailuresRemaining -= 1
      persistRuntimeState()
      throw new Error('injected match-end persistence failure')
    }
    await commitRuntimeState()
  }
  const scheduleMatchEndFinalizationRetry = (room, expectedDeadline) => {
    clearMatchDurationTimer(room.roomId)
    if (isShuttingDown() || !rooms.has(room.roomId)) return
    const timer = scheduleTimeout(() => {
      if (matchDurationTimers.get(room.roomId) === timer) matchDurationTimers.delete(room.roomId)
      void enqueueServerOperation(() => expireMatchDuration(room, expectedDeadline), `match end finalization retry ${room.roomId}`, room.roomId)
    }, matchEndFinalizeRetryMs)
    timer.unref?.()
    matchDurationTimers.set(room.roomId, timer)
  }
  const expireMatchDuration = async (room, expectedDeadline) => {
    if (!rooms.has(room.roomId) || room.totalDeadlineAt !== expectedDeadline) return
    if (!room.matchEnded) {
      if (!markMatchEnded(room, 'time-limit', { endedAt: expectedDeadline })) return
      reportConfiguredMatchEnd(room)
      room.version += 1
    } else if (room.matchEnded.reason !== 'time-limit' || room.matchEnded.endedAt !== expectedDeadline) return
    try {
      await commitConfiguredMatchEnd()
      stagePendingSideEffects(room)
    } catch (error) {
      scheduleMatchEndFinalizationRetry(room, expectedDeadline)
      throw error
    }
    broadcast(room, 'matchEnded', { roomId: room.roomId, phase: phaseFor(room), version: room.version, ...liveMetadataFor(room) })
    publishState(room)
  }
  const armMatchDuration = room => {
    clearMatchDurationTimer(room.roomId)
    ensureLiveMetadata(room)
    const totalTimeMinutes = normalizeFriendRoomSettings(room.roomSettings).totalTimeMinutes
    if (!room.state || room.matchEnded || totalTimeMinutes === 0) {
      if (totalTimeMinutes === 0) room.totalDeadlineAt = null
      return
    }
    if (!Number.isFinite(room.matchStartedAt)) room.matchStartedAt = now()
    if (!Number.isFinite(room.totalDeadlineAt)) room.totalDeadlineAt = room.matchStartedAt + totalTimeMinutes * totalMinuteMs
    const expectedDeadline = room.totalDeadlineAt
    matchDurationTimers.set(room.roomId, scheduleTimeout(
      () => { void enqueueServerOperation(() => expireMatchDuration(room, expectedDeadline), `match duration ${room.roomId}`, room.roomId) },
      Math.max(0, expectedDeadline - now()),
    ))
  }
  const consumeRoundSettlement = (room, result) => {
    if (!result) return null
    clearTurnTimer(room.roomId)
    room.turnDeadlineAt = null
    room.deadlinePlayerId = null
    room.deadlineAction = null
    const roomSettings = normalizeFriendRoomSettings(room.roomSettings)
    room.roundSequence += 1
    if (result.isGameWon) markMatchEnded(room, 'passed-a', { winnerTeam: result.winnerTeam })
    else if (isFriendRoom(room) && hasReachedRoundLimit(room.roundSequence, roomSettings)) markMatchEnded(room, 'round-limit')
    else if (isFriendRoom(room) && Number.isFinite(room.totalDeadlineAt) && now() >= room.totalDeadlineAt) markMatchEnded(room, 'time-limit', { endedAt: room.totalDeadlineAt })
    room.roundReady = room.matchEnded
      ? { p1: false, p2: false, p3: false, p4: false }
      : Object.fromEntries(playerIds.map(id => [id, !room.seats[id]]))
    reportSpectatorRoundEnd(room, result)
    reportConfiguredMatchEnd(room)
    reportCompletedGame(room, result)
    return result
  }
  const commitPendingRoundFinalization = async () => {
    if (roundFinalizationPersistFailuresRemaining > 0) {
      roundFinalizationPersistFailuresRemaining -= 1
      persistRuntimeState()
      throw new Error('injected round finalization persistence failure')
    }
    await commitRuntimeState()
  }
  const schedulePendingRoundFinalization = (room, delay = 500) => {
    if (isShuttingDown() || !rooms.has(room.roomId) || !room.pendingRoundFinalization || roundFinalizationTimers.has(room.roomId)) return
    const timer = scheduleTimeout(() => {
      roundFinalizationTimers.delete(room.roomId)
      void enqueueServerOperation(() => finalizePendingRound(room), `round finalization ${room.roomId}`, room.roomId)
    }, delay)
    timer.unref?.()
    roundFinalizationTimers.set(room.roomId, timer)
  }
  const finalizePendingRound = async room => {
    const pending = room.pendingRoundFinalization
    if (!rooms.has(room.roomId) || !pending) return false
    try {
      await commitPendingRoundFinalization()
      stagePendingSideEffects(room)
      clearTimer(roundFinalizationTimers, room.roomId)
      if (pending.accepted && pending.playerId) {
        const actorConnection = connections.get(room.seats[pending.playerId])
        if (actorConnection) send(actorConnection, 'actionAccepted', pending.accepted)
      }
      if (pending.actionBroadcast) broadcast(room, pending.actionBroadcast.type, pending.actionBroadcast.payload)
      publishState(room)
      publishRoundEnded(room, pending.result)
      room.pendingRoundFinalization = null
      persistRuntimeState()
      return true
    } catch (error) {
      schedulePendingRoundFinalization(room)
      throw error
    }
  }
  const deadlineStepFor = room => {
    if (!room.state || room.roundResult || room.matchEnded) return null
    if (room.state.phase === 'tribute') {
      const tribute = room.state.tribute
      if (!tribute) return null
      if (tribute.status === 'ready' || tribute.status === 'resisted') {
        const first = room.state.lastRoundRank[0]
        const leader = tribute.status === 'resisted'
          ? room.state.dealerId
          : tribute.exchanges.find(exchange => exchange.to === first)?.from
        return leader ? { playerId: leader, action: 'finishTribute' } : null
      }
      if (tribute.status === 'selecting_tribute') {
        const exchange = tribute.exchanges.find(item => !item.tributeCardId)
        return exchange ? { playerId: exchange.from, action: 'tribute' } : null
      }
      if (tribute.status === 'selecting_return') {
        const exchange = tribute.exchanges.find(item => !item.returnCardId)
        return exchange ? { playerId: exchange.to, action: 'returnTribute' } : null
      }
      return null
    }
    if (room.state.phase !== 'playing') return null
    return { playerId: room.state.currentTurn, action: 'play' }
  }
  const finishTributeState = room => {
    const playerId = deadlineStepFor(room)?.playerId
    if (!playerId) throw new Error('贡还尚未完成')
    const result = dispatchMatchIntentImpl(room.state, { type: 'BEGIN_PLAY_AFTER_TRIBUTE', playerId })
    if (!result.ok) throw new Error(matchFailureMessage(result.reason))
    room.state = result.state
    syncRoomFromMatchState(room)
    room.tribute = null
    reportSpectatorEvent(room, { type: 'play-start', roundSequence: room.roundSequence + 1 })
    return result
  }
  const automatedDeadline = async (room, expectedPlayerId, expectedAction, expectedDeadline, attempt = 1) => {
    if (!rooms.has(room.roomId) || room.turnDeadlineAt !== expectedDeadline || room.deadlinePlayerId !== expectedPlayerId || room.deadlineAction !== expectedAction) return
    let snapshot
    let recordedKind = expectedAction
    let recordedPlayType = null
    let roundResult = null
    let isBot
    let wasTrustee
    let actionBroadcast
    try {
      snapshot = structuredClone(room)
      ensureLiveMetadata(room)
      isBot = isBotPlayer(room, expectedPlayerId)
      const roomSettings = normalizeFriendRoomSettings(room.roomSettings)
      const autoTrusteeEnabled = isMatchRoom(room) || roomSettings.trusteeSeconds > 0
      wasTrustee = Boolean(room.trustees[expectedPlayerId])
      if (!isBot && !wasTrustee) {
        room.consecutiveTimeouts[expectedPlayerId] += 1
        if (autoTrusteeEnabled && room.consecutiveTimeouts[expectedPlayerId] >= timeoutsBeforeTrustee) room.trustees[expectedPlayerId] = { reason: 'timeout', since: now() }
      }
      if (expectedAction === 'play') {
        const cards = isBot
          ? botPolicyForRoom(room).chooseCards({ state: room.state, teamLevels: room.teamLevels, playerId: expectedPlayerId })
          : (room.state.lastValidPlay ? [] : [room.state.players[expectedPlayerId].hand.at(-1)])
        const isPass = !cards || cards.length === 0
        const previousState = room.state
        let transitionResult = dispatchMatchIntentImpl(previousState, isPass
          ? { type: 'PASS', playerId: expectedPlayerId }
          : { type: 'PLAY_CARDS', playerId: expectedPlayerId, cardIds: cards.map(card => card.id) })
        if (!transitionResult.ok) throw new Error(matchFailureMessage(transitionResult.reason))
        transitionResult = applyRoomSettlementPolicy(room, previousState, transitionResult)
        room.state = transitionResult.state
        syncRoomFromMatchState(room)
        const playEvent = transitionResult.events.find(event => event.type === 'CARDS_PLAYED')
        roundResult = transitionResult.events.find(event => event.type === 'ROUND_SETTLED')?.settlement ?? null
        recordedKind = isPass ? 'pass' : 'play'
        recordedPlayType = playEvent?.action.type || null
        reportSpectatorAction(room, {
          type: isPass ? 'pass' : 'play', playerId: expectedPlayerId,
          cards: playEvent?.action.cards || [], automatic: true,
        })
      } else if (expectedAction === 'tribute') {
        const hand = room.state.players[expectedPlayerId].hand
        const eligible = hand.filter(card => !(card.isLevelCard && card.suit === 'heart'))
        const card = highestCard(eligible.length ? eligible : hand)
        if (!card) throw new Error('没有可进贡的牌')
        const result = dispatchMatchIntentImpl(room.state, { type: 'SELECT_TRIBUTE_CARD', playerId: expectedPlayerId, cardId: card.id })
        if (!result.ok) throw new Error(matchFailureMessage(result.reason))
        room.state = result.state
        syncRoomFromMatchState(room)
        reportSpectatorEvent(room, { type: 'tribute', playerId: expectedPlayerId, roundSequence: room.roundSequence + 1 })
      } else if (expectedAction === 'returnTribute') {
        const hand = room.state.players[expectedPlayerId].hand
        const card = automaticReturnCard(hand)
        if (!card) throw new Error('没有可还贡的牌')
        const result = dispatchMatchIntentImpl(room.state, { type: 'SELECT_RETURN_CARD', playerId: expectedPlayerId, cardId: card.id })
        if (!result.ok) throw new Error(matchFailureMessage(result.reason))
        room.state = result.state
        syncRoomFromMatchState(room)
        reportSpectatorEvent(room, { type: 'return-tribute', playerId: expectedPlayerId, roundSequence: room.roundSequence + 1 })
      } else if (expectedAction === 'finishTribute') finishTributeState(room)
      else throw new Error('未知自动动作')
      recordRoomAction(room, expectedPlayerId, {
        kind: recordedKind, playType: recordedPlayType,
        timedOut: !isBot, trustee: !isBot && Boolean(room.trustees[expectedPlayerId]),
      })
      room.version += 1
      consumeRoundSettlement(room, roundResult)
      if (!roundResult) armTurnDeadline(room, { publish: false })
      actionBroadcast = {
        type: isBot ? 'botAction' : 'turnTimedOut',
        payload: {
          roomId: room.roomId, playerId: expectedPlayerId, action: expectedAction,
          ...(isBot ? { difficulty: MASTER_BOT_DIFFICULTY } : { enteredTrustee: !wasTrustee && Boolean(room.trustees[expectedPlayerId]) }),
          version: room.version, ...liveMetadataFor(room),
        },
      }
      if (roundResult) {
        room.pendingRoundFinalization = { cacheKey: null, playerId: null, accepted: null, result: structuredClone(roundResult), actionBroadcast }
        try { await finalizePendingRound(room) } catch {}
        return
      }
    } catch (error) {
      if (snapshot) restoreRoom(room, snapshot)
      log.error(`Automated deadline attempt ${attempt} failed for ${room.roomId}/${expectedPlayerId}/${expectedAction}:`, error instanceof Error ? error.message : error)
      if (attempt >= deadlineMaxAttempts) await closeFailedDeadlineRoom(room)
      else scheduleTurnRetry(room, () => automatedDeadline(room, expectedPlayerId, expectedAction, expectedDeadline, attempt + 1), `automated turn retry ${room.roomId}`, deadlineRetryDelay(attempt))
      return
    }
    try { await commitRuntimeState() } catch (error) {
      restoreRoom(room, snapshot)
      scheduleTurnRetry(room, () => automatedDeadline(room, expectedPlayerId, expectedAction, expectedDeadline, attempt), `automated turn persistence retry ${room.roomId}`, deadlineRetryDelay(1))
      throw error
    }
    stagePendingSideEffects(room)
    broadcast(room, actionBroadcast.type, actionBroadcast.payload)
    if (expectedAction === 'play' || expectedAction === 'finishTribute') publishState(room)
    else publishTribute(room)
  }
  const armTurnDeadline = (room, { publish = true } = {}) => {
    clearTurnTimer(room.roomId)
    ensureLiveMetadata(room)
    const step = deadlineStepFor(room)
    if (!step) {
      room.turnDeadlineAt = null
      room.deadlinePlayerId = null
      room.deadlineAction = null
      return
    }
    const roomSettings = normalizeFriendRoomSettings(room.roomSettings)
    const delay = isBotPlayer(room, step.playerId)
      ? Math.min(botActionDelayMs, roomSettings.turnSeconds * friendSecondMs)
      : isMatchRoom(room)
        ? (room.trustees[step.playerId] ? trusteeActionDelayMs : turnTimeoutMs)
        : (room.trustees[step.playerId] && roomSettings.trusteeSeconds > 0
            ? roomSettings.trusteeSeconds * friendSecondMs
            : roomSettings.turnSeconds * friendSecondMs)
    const deadline = now() + delay
    room.turnDeadlineAt = deadline
    room.deadlinePlayerId = step.playerId
    room.deadlineAction = step.action
    turnTimers.set(room.roomId, scheduleTimeout(() => {
      void enqueueServerOperation(() => automatedDeadline(room, step.playerId, step.action, deadline), `automated turn ${room.roomId}`, room.roomId)
    }, delay))
    if (publish) publishTurnStatus(room)
  }

  const restoreTurnDeadline = room => {
    clearTurnTimer(room.roomId)
    const step = deadlineStepFor(room)
    if (!step) {
      room.turnDeadlineAt = null
      room.deadlinePlayerId = null
      room.deadlineAction = null
      return
    }
    const deadline = Number(room.turnDeadlineAt)
    const matchesStoredStep = Number.isFinite(deadline) && room.deadlinePlayerId === step.playerId && room.deadlineAction === step.action
    if (!matchesStoredStep) { armTurnDeadline(room); return }
    turnTimers.set(room.roomId, scheduleTimeout(() => {
      void enqueueServerOperation(() => automatedDeadline(room, step.playerId, step.action, deadline), `restored turn ${room.roomId}`, room.roomId)
    }, Math.max(0, deadline - now())))
  }

  const prepareNextRound = (room, incrementVersion = true) => {
    const result = room.roundResult
    const dealt = dealCards(shuffleDeck(createDeck(result.currentLevel), shuffleRandom))
    const dealtHands = Object.fromEntries(playerIds.map(id => [id, [...dealt[id]].sort((a, b) => b.value - a.value)]))
    const transitionResult = dispatchMatchIntent(room.state, { type: 'PREPARE_NEXT_ROUND', dealtHands })
    if (!transitionResult.ok) throw new Error(matchFailureMessage(transitionResult.reason))
    room.state = transitionResult.state
    syncRoomFromMatchState(room)
    room.tribute = null
    const policy = existingBotPolicyForRoom(room)
    if (policy) {
      policy.reset()
      room.botPolicyCheckpoint = policy.checkpoint()
    }
    room.roundReady = { p1: false, p2: false, p3: false, p4: false }
    room.roundStatsBySeat = createGameStatsBySeat()
    if (incrementVersion) room.version += 1
    reportSpectatorEvent(room, { type: 'round-start', roundSequence: room.roundSequence + 1 })
    reportSpectatorEvent(room, {
      type: room.state.tribute?.status === 'resisted' ? 'anti-tribute' : 'tribute-start',
      roundSequence: room.roundSequence + 1,
    })
    armTurnDeadline(room, { publish: false })
  }

  const markOfflineReady = (room, playerId) => {
    if (!room.roundResult || room.roundResult.isGameWon) return false
    ensureLiveMetadata(room)
    room.roundReady[playerId] = true
    if (playerIds.every(id => room.roundReady[id])) {
      prepareNextRound(room, false)
      return true
    }
    return false
  }

  const removeRoom = roomId => {
    clearTurnTimer(roomId)
    clearMatchDurationTimer(roomId)
    clearTimer(roundFinalizationTimers, roomId)
  }
  const dispose = () => {
    for (const timers of [turnTimers, matchDurationTimers, roundFinalizationTimers]) {
      for (const timer of timers.values()) cancelTimeout(timer)
      timers.clear()
    }
  }

  return {
    applyRoomSettlementPolicy,
    armMatchDuration,
    armTurnDeadline,
    clearMatchDurationTimer,
    clearTurnTimer,
    consumeRoundSettlement,
    finalizePendingRound,
    finishTributeState,
    markOfflineReady,
    prepareNextRound,
    restoreTurnDeadline,
    schedulePendingRoundFinalization,
    syncRoomFromMatchState,
    removeRoom,
    dispose,
  }
}
