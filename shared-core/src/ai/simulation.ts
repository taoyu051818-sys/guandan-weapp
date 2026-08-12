import { isRoundOver, passTurn, playCards, type EngineState } from '../lib/engine'
import { createAIEngine } from './engine'
import type { AIEngine, Difficulty } from './types'

export const runAiTurns = (
  state: EngineState,
  difficulty: Difficulty = 'medium',
  maxTurns = 12,
  injectedAI?: AIEngine,
): EngineState => {
  let next = state
  const ai = injectedAI ?? createAIEngine({ ruleProfile: state.ruleProfile })
  for (
    let count = 0;
    count < maxTurns && next.currentTurn !== 'p1' && !isRoundOver(next);
    count += 1
  ) {
    const playerId = next.currentTurn
    const player = next.players[playerId]
    const cards = ai.makeDecision(
      player.hand,
      next.lastValidPlay,
      difficulty,
      player.team,
      next.players,
      playerId,
      {
        currentLevel: next.currentLevel,
        teamLevels: { teamA: next.currentLevel, teamB: next.currentLevel },
        roundMeta: null,
        ruleProfile: next.ruleProfile,
      },
    )
    next = cards?.length
      ? playCards(next, playerId, cards)
      : passTurn(next, playerId)
  }
  return next
}
