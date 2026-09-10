import type { PlayerId, Rank, Team } from '../types/game'
import type { EngineState, MatchState } from './engine'
import { rotatingRoundPoints } from './variantRules'

const ranks: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 'J', 'Q', 'K', 'A']
const opposite = (team: Team): Team => team === 'teamA' ? 'teamB' : 'teamA'
const shift = (rank: Rank, delta: number): Rank =>
  ranks[Math.max(0, Math.min(ranks.length - 1, ranks.indexOf(rank) + delta))]

export interface SettlementResult {
  format?: 'independent' | 'upgrade' | 'rotating'
  playerPoints?: Record<PlayerId, number>
  playerScores?: Record<PlayerId, number>
  pointsEarned?: number
  winnerTeam: Team
  levelUp: number
  currentLevel: Rank
  teamLevels: Record<Team, Rank>
  aFailStreaks: Record<Team, number>
  fullRank: PlayerId[]
  isGameWon: boolean
  message: string
}

export const cloneSettlementResult = (result: SettlementResult): SettlementResult => ({
  ...result,
  teamLevels: { ...result.teamLevels },
  aFailStreaks: { ...result.aFailStreaks },
  fullRank: [...result.fullRank],
  ...(result.playerPoints ? { playerPoints: { ...result.playerPoints } } : {}),
  ...(result.playerScores ? { playerScores: { ...result.playerScores } } : {}),
})

/** Existing progression contract, kept independently testable for compatibility callers. */
export const settle = (
  state: EngineState,
  teamLevels: Record<Team, Rank>,
  aFailStreaks: Record<Team, number>,
): SettlementResult | null => {
  const first = state.finishedPlayers[0]
  if (!first) return null
  const mate = state.turnOrder.find(id => id !== first && state.players[id].team === state.players[first].team)
  const levelUp = state.finishedPlayers[1] === mate
    ? state.matchFormat?.doubleDown ?? 3
    : state.finishedPlayers[2] === mate
      ? 2
      : state.finishedPlayers.length >= 3
        ? 1
        : 0
  if (!levelUp) return null

  const winner = state.players[first].team
  const loser = opposite(winner)
  const levels = { ...teamLevels }
  const fails = { ...aFailStreaks }
  let awardTeam = winner
  let award = levelUp
  let won = false
  let message = ''
  let currentLevel: Rank

  if (levels[winner] === 'A' && levelUp >= 2) {
    won = true
    fails[winner] = 0
    levels[loser] = 2
    currentLevel = 'A'
    message = '恭喜！成功打过 A！'
  } else if (levels[winner] === 'A') {
    const consecutiveFailures = fails[winner] + 1
    const down = consecutiveFailures >= 3 ? 2 : shift('A', -consecutiveFailures)
    fails[winner] = consecutiveFailures >= 3 ? 0 : consecutiveFailures
    levels[winner] = down
    levels[loser] = shift(down, 1)
    awardTeam = loser
    award = ranks.indexOf(down) - ranks.indexOf('A')
    currentLevel = levels[loser]
    message = consecutiveFailures >= 3
      ? '冲A三次失败，退回2级；对手从3级继续。'
      : `冲A失败，降至 ${down} 级；对手从 ${levels[loser]} 级继续。`
  } else {
    const blockedAtKing = levels[winner] === 'K' && levelUp === 1
    levels[winner] = blockedAtKing ? 'K' : shift(levels[winner], levelUp)
    currentLevel = levels[winner]
    award = ranks.indexOf(levels[winner]) - ranks.indexOf(teamLevels[winner])
    message = blockedAtKing
      ? '头游+末游不能上A，仍停留在 K 级。'
      : `本局升级 ${award} 级。`
  }

  const fullRank = [
    ...state.finishedPlayers,
    ...(['p1', 'p2', 'p3', 'p4'] as PlayerId[]).filter(id => !state.finishedPlayers.includes(id)),
  ]
  return {
    winnerTeam: awardTeam,
    levelUp: award,
    currentLevel,
    teamLevels: levels,
    aFailStreaks: fails,
    fullRank,
    isGameWon: won,
    message,
  }
}

export interface MatchSettlementOperation {
  state: MatchState
  settlement: SettlementResult
}

/** New friend rooms: the target must actually be played; ordinary failures stay at the gate. */
const settleConfiguredUpgrade = (
  state: MatchState, teamLevels: Record<Team, Rank>, aFailStreaks: Record<Team, number>,
): SettlementResult | null => {
  const [first, second, third] = state.finishedPlayers
  if (!first) return null
  const winnerTeam = state.players[first].team
  const sameTeam = (id: PlayerId | undefined): boolean => Boolean(id && state.players[id].team === winnerTeam)
  const award = sameTeam(second) ? state.matchFormat!.doubleDown : sameTeam(third) ? 2 : third ? 1 : 0
  if (!award) return null
  const targetOption = state.matchFormat!.upgradeTarget!
  const target: Rank = targetOption === 'A-reset' ? 'A' : targetOption
  const targetIndex = ranks.indexOf(target)
  const levels = { ...teamLevels }
  const fails = { ...aFailStreaks }
  // levelTeam identifies whose gate is being attempted, not merely who wins this hand.
  const attackingTeam = state.levelTeam
  const gateAttempt = state.currentLevel === target && teamLevels[attackingTeam] === target
  const isGameWon = gateAttempt && winnerTeam === attackingTeam && award >= 2
  let message = ''
  if (gateAttempt && !isGameWon && targetOption === 'A-reset') {
    fails[attackingTeam] += 1
    if (fails[attackingTeam] >= 3) {
      levels[attackingTeam] = 2
      fails[attackingTeam] = 0
      message = '三次冲A未过，退回2级。'
    } else message = `冲A未过，累计 ${fails[attackingTeam]} 次。`
  }
  const before = levels[winnerTeam]
  if (isGameWon) {
    fails[winnerTeam] = 0
    message = `成功打过 ${target}！`
  } else if (!(gateAttempt && winnerTeam === attackingTeam)) {
    levels[winnerTeam] = ranks[Math.min(targetIndex, ranks.indexOf(before) + award)]
  }
  const levelUp = Math.max(0, ranks.indexOf(levels[winnerTeam]) - ranks.indexOf(teamLevels[winnerTeam]))
  return {
    format: 'upgrade', winnerTeam, levelUp, currentLevel: levels[winnerTeam],
    teamLevels: levels, aFailStreaks: fails, isGameWon,
    fullRank: [...state.finishedPlayers, ...state.turnOrder.filter(id => !state.finishedPlayers.includes(id))],
    message: message || (gateAttempt && winnerTeam === attackingTeam ? `头游搭档为末游，继续打 ${target}。` : `本局升级 ${levelUp} 级，${target} 必打。`),
  }
}

/** Applies ranking, level progression, A-gate state and score projection as one pure operation. */
export const settleMatchState = (state: MatchState): MatchSettlementOperation | null => {
  const result = state.matchFormat?.kind === 'rotating'
    ? settleRotatingRound(state)
    : state.matchFormat?.kind === 'independent'
    ? settleIndependentRound(state)
    : state.matchFormat?.kind === 'upgrade' && state.matchFormat.upgradeTarget !== undefined
    ? settleConfiguredUpgrade(state, state.teamLevels, state.aFailStreaks)
    : settle(state, state.teamLevels, state.aFailStreaks)
  if (!result) return null
  const settlement = cloneSettlementResult(result)
  return {
    settlement,
    state: {
      ...state,
      phase: 'settled',
      currentLevel: result.currentLevel,
      levelTeam: result.winnerTeam,
      teamLevels: { ...result.teamLevels },
      aFailStreaks: { ...result.aFailStreaks },
      lastRoundRank: [...result.fullRank],
      ...(result.playerScores ? { playerScores: { ...result.playerScores } } : {}),
      scores: {
        ...state.scores,
        [result.winnerTeam]: state.scores[result.winnerTeam] + (result.format === 'rotating' ? 0 : Math.max(0, result.pointsEarned ?? result.levelUp)),
      },
      settlement: cloneSettlementResult(result),
    },
  }
}

/** Single-hand results never pass through the K/A progression gates. */
const settleRotatingRound = (state: MatchState): SettlementResult | null => {
  const base = settleIndependentRound(state)
  if (!base) return null
  const first = base.fullRank[0]
  const matePlace = base.fullRank.findIndex(id => id !== first && state.players[id].team === state.players[first].team) + 1
  const playerPoints = rotatingRoundPoints(state, first, matePlace)
  const playerScores = { p1: 0, p2: 0, p3: 0, p4: 0 }
  state.turnOrder.forEach(id => { playerScores[id] = (state.playerScores?.[id] ?? 0) + playerPoints[id] })
  return { ...base, format: 'rotating', pointsEarned: playerPoints[first], playerPoints, playerScores, message: `转蛋${state.matchFormat?.rotatingScoring ?? 3}分制 · 积分按玩家累计` }
}

const settleIndependentRound = (state: MatchState): SettlementResult | null => {
  const [first, second, third] = state.finishedPlayers
  if (!first) return null
  const individual = Boolean(state.matchFormat?.individualRanking)
  if (individual && !third) return null
  const winnerTeam = state.players[first].team
  const sameTeam = (id: PlayerId | undefined): boolean => Boolean(id && state.players[id].team === winnerTeam)
  const pointsEarned = sameTeam(second) ? state.matchFormat!.doubleDown : sameTeam(third) ? 2 : third ? 1 : 0
  if (!pointsEarned) return null
  const fullRank = [...state.finishedPlayers, ...state.turnOrder.filter(id => !state.finishedPlayers.includes(id))]
  const playerPoints = { p1: 0, p2: 0, p3: 0, p4: 0 }
  if (individual) fullRank.forEach((id, index) => { playerPoints[id] = 3 - index })
  return {
    format: 'independent', pointsEarned, winnerTeam, levelUp: 0,
    currentLevel: state.currentLevel, teamLevels: { ...state.teamLevels },
    aFailStreaks: { teamA: 0, teamB: 0 }, isGameWon: false,
    fullRank,
    ...(individual ? { playerPoints } : {}),
    message: individual ? '本轮结束，个人按名次获得 3／2／1／0 分。' : `本局结束，胜方得 ${pointsEarned} 分。`,
  }
}
