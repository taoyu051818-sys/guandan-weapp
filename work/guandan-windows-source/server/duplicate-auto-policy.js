import { createRoomBotPolicy } from './master-bot-policy.js'

/** Same master engine for duplicate bots and trustees; checkpoint follows the durable table draft. */
export const chooseDuplicateAutomaticCards = (table, seed) => {
  const state = table.state
  const policy = createRoomBotPolicy({ ruleProfile: state.ruleProfile, seed, checkpoint: table.aiCheckpoint })
  const cards = policy.chooseCards({ state, playerId: state.currentTurn }) || []
  table.aiCheckpoint = policy.checkpoint()
  return cards
}
