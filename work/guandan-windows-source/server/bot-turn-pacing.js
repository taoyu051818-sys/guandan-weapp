import { createRequire } from 'node:module'
const { resolvePlay, isBombResolution } = createRequire(import.meta.url)('../../../shared-core/dist')

/** Cosmetic pacing uses a separate RNG, never the shuffle/AI random stream. */
const unit = random => Math.max(0, Math.min(1, Number(random()) || 0))
export const botOpeningDelay = (baseMs, random = Math.random) =>
  Math.round(Math.min(1_000, Math.max(10, baseMs) * (0.75 + unit(random) * 0.75)))

export const isDeliberatePlay = (hand, cards, ruleProfile) => {
  if (!cards?.length) return false
  const count = collection => collection.reduce((map, card) => map.set(card.rank, (map.get(card.rank) || 0) + 1), new Map())
  const original = count(hand)
  const selected = count(cards)
  const resolution = ruleProfile ? resolvePlay(cards, ruleProfile) : null
  const bomb = resolution ? isBombResolution(resolution) : cards.length >= 4 && selected.size === 1
  // Breaking pairs/triples/bombs is a deliberate action even when the result is a single.
  return bomb || [...selected].some(([rank, amount]) => original.get(rank) >= 2 && amount < original.get(rank))
}

/** Kept in the durable room, not in a second timer queue or client metadata. */
export const prepareBotPlay = (room, playerId, policy, { now, random = Math.random, baseMs }) => {
  const state = room.state
  const hand = state.players[playerId].hand
  const signature = `${state.revision}:${playerId}:${hand.map(card => card.id).join(',')}:${state.playArea?.length ?? 0}`
  let plan = room.pendingBotPlay
  if (!plan || plan.signature !== signature) {
    const cards = policy.chooseCards({ state, teamLevels: room.teamLevels, playerId }) || []
    const start = Number.isFinite(room.botTurnStartedAt) ? room.botTurnStartedAt : now()
    // Honor explicitly accelerated test clocks; production's 500/650ms baseline
    // gets 1.2–3.0s total thinking for deliberate actions, not +3s after a delay.
    const scale = Math.min(1, Math.max(10, baseMs) / 500)
    const at = isDeliberatePlay(hand, cards, state.ruleProfile) ? start + Math.round((1_200 + unit(random) * 1_800) * scale) : now()
    plan = room.pendingBotPlay = { signature, cardIds: cards.map(card => card.id), at: Math.min(room.turnDeadlineAt, at) }
  }
  const cards = plan.cardIds.map(id => hand.find(card => card.id === id))
  if (cards.some(card => !card)) throw new Error('自动出牌计划已失效')
  return { cards, waitMs: Math.max(0, plan.at - now()) }
}
