import type { PlayerId, Rank, Team } from '../types/game'
import type { EngineState } from './engine'

const ranks: Rank[] = [2,3,4,5,6,7,8,9,10,'J','Q','K','A']
const opposite = (team: Team): Team => team === 'teamA' ? 'teamB' : 'teamA'
const shift = (rank: Rank, delta: number): Rank => ranks[Math.max(0, Math.min(ranks.length - 1, ranks.indexOf(rank) + delta))]

export interface SettlementResult { winnerTeam: Team; levelUp: number; currentLevel: Rank; teamLevels: Record<Team, Rank>; aFailStreaks: Record<Team, number>; fullRank: PlayerId[]; isGameWon: boolean; message: string }
export const settle = (state: EngineState, teamLevels: Record<Team, Rank>, aFailStreaks: Record<Team, number>): SettlementResult | null => {
  const first = state.finishedPlayers[0]; if (!first) return null
  const mate = state.players[first].team === 'teamA' ? (first === 'p1' ? 'p3' : 'p1') : (first === 'p2' ? 'p4' : 'p2')
  const levelUp = state.finishedPlayers[1] === mate ? 3 : state.finishedPlayers[2] === mate ? 2 : state.finishedPlayers.length >= 3 ? 1 : 0
  if (!levelUp) return null
  const winner = state.players[first].team; const loser = opposite(winner); const levels = { ...teamLevels }; const fails = { ...aFailStreaks }; let awardTeam = winner; let award = levelUp; let won = false; let message = ''
  let currentLevel: Rank
  if (levels[winner] === 'A' && levelUp >= 2) { won = true; fails[winner] = 0; levels[loser] = 2; currentLevel = 'A'; message = '恭喜！成功打过 A！' }
  else if (levels[winner] === 'A') { const n = fails[winner] + 1; const down = n >= 3 ? 2 : shift('A', -n); fails[winner] = n >= 3 ? 0 : n; levels[winner] = down; levels[loser] = shift(down, 1); awardTeam = loser; award = ranks.indexOf(down) - ranks.indexOf('A'); currentLevel = levels[loser]; message = n >= 3 ? '冲A三次失败，退回2级；对手从3级继续。' : `冲A失败，降至 ${down} 级；对手从 ${levels[loser]} 级继续。` }
  else { const blocked = levels[winner] === 'K' && levelUp === 1; levels[winner] = blocked ? 'K' : shift(levels[winner], levelUp); currentLevel = levels[winner]; award = ranks.indexOf(levels[winner]) - ranks.indexOf(teamLevels[winner]); message = blocked ? '头游+末游不能上A，仍停留在 K 级。' : `本局升级 ${award} 级。` }
  const fullRank = [...state.finishedPlayers, ...(['p1','p2','p3','p4'] as PlayerId[]).filter(id => !state.finishedPlayers.includes(id))]
  return { winnerTeam: awardTeam, levelUp: award, currentLevel, teamLevels: levels, aFailStreaks: fails, fullRank, isGameWon: won, message }
}
