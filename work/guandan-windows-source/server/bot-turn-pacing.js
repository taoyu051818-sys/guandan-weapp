/** Cosmetic RNG never consumes the shuffle/strategy RNG stream. */
export const decisionDelayMs = (elapsedMs, random = Math.random) => {
  const cost = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0
  const base = Math.max(500, Math.min(3000, cost * 50))
  return Math.round(base * (random() < 0.1 ? 3 : 1))
}

/** One durable plan per state revision. Restarts/retries reuse cards AND timing.
 * Computation time is included, not added a second time to the humanized wait.
 * measure is monotonic CPU-wall time; now is the authoritative scheduling clock.
 */
export const prepareBotPlay = (room, playerId, policy, {
  now, random = Math.random, measure = () => performance.now(),
}) => {
  const state = room.state
  const hand = state.players[playerId].hand
  const signature = `thinking-v2:${state.roundId}:${state.revision}:${playerId}:${hand.map(card => card.id).join(',')}:${state.playArea?.length ?? 0}`
  let plan = room.pendingBotPlay
  if (!plan || plan.signature !== signature) {
    const startedAt = now()
    const measuredStart = measure()
    const cards = policy.chooseCards({ state, teamLevels: room.teamLevels, playerId }) || []
    const elapsedMs = Math.max(0, measure() - measuredStart)
    const delayMs = decisionDelayMs(elapsedMs, random)
    const deadline = Number.isFinite(room.turnDeadlineAt) ? room.turnDeadlineAt : Infinity
    plan = room.pendingBotPlay = {
      signature, cardIds: cards.map(card => card.id),
      at: Math.min(deadline, startedAt + delayMs), elapsedMs, delayMs,
    }
  }
  const cards = plan.cardIds.map(id => hand.find(card => card.id === id))
  if (cards.some(card => !card)) throw new Error('自动出牌计划已失效')
  return { cards, waitMs: Math.max(0, plan.at - now()) }
}
