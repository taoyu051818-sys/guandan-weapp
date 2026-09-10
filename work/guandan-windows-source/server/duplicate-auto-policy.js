import { createRoomBotPolicy } from './master-bot-policy.js'
import { prepareBotPlay } from './bot-turn-pacing.js'

/** Same master policy AND durable pacing for both duplicate tables and trustees. */
export const prepareDuplicateAutomaticPlay = (table, seed, now, timing = {}) => {
  const holder = { state: table.state, turnDeadlineAt: table.deadlineAt, pendingBotPlay: table.pendingBotPlay }
  const policy = {
    chooseCards: input => {
      const engine = createRoomBotPolicy({ ruleProfile: table.state.ruleProfile, seed, checkpoint: table.aiCheckpoint })
      const cards = engine.chooseCards(input) || []
      table.aiCheckpoint = engine.checkpoint()
      return cards
    },
  }
  const result = prepareBotPlay(holder, table.state.currentTurn, policy, { now, ...timing })
  table.pendingBotPlay = holder.pendingBotPlay
  return result
}
