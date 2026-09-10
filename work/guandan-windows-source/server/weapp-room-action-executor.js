import { matchFailureMessage } from './game-session.js'

const ACTIONS = {
  PLAY_CARDS: 'play', PASS: 'pass',
  SELECT_TRIBUTE_CARD: 'tribute', SELECT_RETURN_CARD: 'returnTribute',
  BEGIN_PLAY_AFTER_TRIBUTE: 'finishTribute',
}

/**
 * Shared application/commit boundary for human, trustee and bot commands.
 * Admission, automated retry/rollback and next-round orchestration stay with their owners.
 */
export const createRoomActionExecutor = ({
  dispatch, applyRoomSettlementPolicy, syncRoomFromMatchState,
  recordRoomAction, reportSpectatorAction, reportSpectatorEvent,
  consumeRoundSettlement, armTurnDeadline,
  commitRuntimeState, stagePendingSideEffects, finalizePendingRound,
  publishState, publishTribute, broadcast,
}) => {
  const apply = (room, command, { automatic = false, timedOut = false, trustee = false } = {}) => {
    const kind = ACTIONS[command.type]
    if (!kind) throw new Error('不支持的牌局动作')
    const previous = room.state
    let transition = dispatch(previous, command)
    if (!transition.ok) throw new Error(matchFailureMessage(transition.reason))
    transition = applyRoomSettlementPolicy(room, previous, transition)
    room.state = transition.state
    syncRoomFromMatchState(room)
    const playEvent = transition.events.find(event => event.type === 'CARDS_PLAYED')
    const roundResult = transition.events.find(event => event.type === 'ROUND_SETTLED')?.settlement ?? null
    const playerId = command.playerId
    recordRoomAction(room, playerId, { kind, playType: playEvent?.action.type || null, timedOut, trustee })
    if (kind === 'play' || kind === 'pass') {
      reportSpectatorAction(room, { type: kind, playerId, cards: playEvent?.action.cards || [], automatic })
    } else {
      room.tribute = null
      reportSpectatorEvent(room, {
        type: kind === 'finishTribute' ? 'play-start' : kind === 'tribute' ? 'tribute' : 'return-tribute',
        ...(kind === 'finishTribute' ? {} : { playerId }),
        roundSequence: room.roundSequence + 1,
      })
    }
    if (!automatic) room.consecutiveTimeouts[playerId] = 0
    room.version += 1
    consumeRoundSettlement(room, roundResult)
    if (!roundResult) armTurnDeadline(room, { publish: false })
    return { kind, roundResult }
  }

  const commit = async (room, outcome, {
    acceptance = null, actionBroadcast = null,
  } = {}) => {
    if (outcome.roundResult) {
      room.pendingRoundFinalization = {
        cacheKey: acceptance?.cacheKey ?? null,
        playerId: acceptance?.playerId ?? null,
        accepted: acceptance ? acceptance.remember(room) : null,
        result: structuredClone(outcome.roundResult), actionBroadcast,
      }
      await finalizePendingRound(room)
      return
    }
    // A human acknowledgement includes durable acceptance-cache persistence.
    if (acceptance) await acceptance.accept(room)
    else await commitRuntimeState()
    try {
      if (!acceptance) stagePendingSideEffects(room)
      if (actionBroadcast) broadcast(room, actionBroadcast.type, actionBroadcast.payload)
      if (outcome.kind === 'tribute' || outcome.kind === 'returnTribute') publishTribute(room)
      else publishState(room)
    } catch (cause) {
      // A failed publication cannot roll back a state which already reached durable storage.
      throw Object.assign(new Error('Committed action publication failed', { cause }), { actionCommitted: true })
    }
  }
  return { apply, commit }
}
