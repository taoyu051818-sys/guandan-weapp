export const DEFAULT_RATING_CONFIG = Object.freeze({
  baseScale: 60_000,
  priorGames: 50,
  priorWinRate: 0.5,
  winRateExponent: 1.8,
  experienceFloor: 0.3,
  experienceWeight: 0.7,
  experienceReferenceGames: 100,
  eloK: 200,
  eloDivisor: 40_000,
  minimumScore: 1_000,
})

const validatePlayerRating = player => {
  if (!player || typeof player.id !== 'string' || !player.id) throw new TypeError('评分玩家 id 不能为空')
  if (!Number.isSafeInteger(player.games) || player.games < 0) throw new TypeError(`玩家 ${player.id} 的 games 必须是非负整数`)
  if (!Number.isSafeInteger(player.wins) || player.wins < 0 || player.wins > player.games) throw new TypeError(`玩家 ${player.id} 的 wins 必须是 0 到 games 的整数`)
  if (!Number.isFinite(player.eloOffset)) throw new TypeError(`玩家 ${player.id} 的 eloOffset 必须是有限数值`)
}

export const createInitialRating = id => ({ id, games: 0, wins: 0, eloOffset: 0, updatedAt: 0 })

export const calculateAdjustedWinRate = (player, config = DEFAULT_RATING_CONFIG) => {
  validatePlayerRating(player)
  const priorWins = config.priorGames * config.priorWinRate
  return (player.wins + priorWins) / (player.games + config.priorGames)
}

export const calculateExperienceFactor = (games, config = DEFAULT_RATING_CONFIG) => {
  if (!Number.isSafeInteger(games) || games < 0) throw new TypeError('games 必须是非负整数')
  return config.experienceFloor + config.experienceWeight * Math.log1p(games) / Math.log1p(config.experienceReferenceGames)
}

export const calculateBaseScore = (player, config = DEFAULT_RATING_CONFIG) => (
  config.baseScale *
  Math.pow(calculateAdjustedWinRate(player, config), config.winRateExponent) *
  calculateExperienceFactor(player.games, config)
)

export const calculateComprehensiveScore = (player, config = DEFAULT_RATING_CONFIG) => {
  validatePlayerRating(player)
  return Math.max(config.minimumScore, calculateBaseScore(player, config) + player.eloOffset)
}

export const createRatingSnapshot = (player, config = DEFAULT_RATING_CONFIG) => ({
  id: player.id,
  games: player.games,
  wins: player.wins,
  adjustedWinRate: calculateAdjustedWinRate(player, config),
  experienceFactor: calculateExperienceFactor(player.games, config),
  baseScore: calculateBaseScore(player, config),
  eloOffset: player.eloOffset,
  comprehensiveScore: calculateComprehensiveScore(player, config),
})

export const calculateTeamScore = (team, config = DEFAULT_RATING_CONFIG) => {
  if (!Array.isArray(team) || team.length !== 2) throw new TypeError('掼蛋队伍必须正好包含两名玩家')
  return (calculateComprehensiveScore(team[0], config) + calculateComprehensiveScore(team[1], config)) / 2
}

export const calculateExpectedScore = (ownTeamScore, opponentTeamScore, config = DEFAULT_RATING_CONFIG) => {
  if (!Number.isFinite(ownTeamScore) || !Number.isFinite(opponentTeamScore)) throw new TypeError('双方综合分必须是有限数值')
  const exponent = Math.max(-10, Math.min(10, (opponentTeamScore - ownTeamScore) / config.eloDivisor))
  return 1 / (1 + Math.pow(10, exponent))
}

export const calculateEloDelta = (expectedScore, result, config = DEFAULT_RATING_CONFIG) => {
  if (!Number.isFinite(expectedScore) || expectedScore < 0 || expectedScore > 1) throw new TypeError('expectedScore 必须在 0 到 1 之间')
  if (result !== 0 && result !== 1) throw new TypeError('result 必须是 0 或 1')
  return config.eloK * (result - expectedScore)
}

const updatedPlayer = (player, won, eloDelta) => ({
  ...player,
  games: player.games + 1,
  wins: player.wins + (won ? 1 : 0),
  eloOffset: player.eloOffset + eloDelta,
})

export const applyMatchRating = (teamA, teamB, winnerTeam, config = DEFAULT_RATING_CONFIG) => {
  if (!Array.isArray(teamA) || teamA.length !== 2 || !Array.isArray(teamB) || teamB.length !== 2) throw new TypeError('A 队和 B 队都必须正好包含两名玩家')
  if (winnerTeam !== 'teamA' && winnerTeam !== 'teamB') throw new TypeError('winnerTeam 必须是 teamA 或 teamB')
  const players = [...teamA, ...teamB]
  players.forEach(validatePlayerRating)
  if (new Set(players.map(player => player.id)).size !== 4) throw new TypeError('同一局不能包含重复玩家')

  const teamABeforeScore = calculateTeamScore(teamA, config)
  const teamBBeforeScore = calculateTeamScore(teamB, config)
  const expectedA = calculateExpectedScore(teamABeforeScore, teamBBeforeScore, config)
  const teamAEloDelta = calculateEloDelta(expectedA, winnerTeam === 'teamA' ? 1 : 0, config)
  const teamBEloDelta = -teamAEloDelta
  const nextTeamA = teamA.map(player => updatedPlayer(player, winnerTeam === 'teamA', teamAEloDelta))
  const nextTeamB = teamB.map(player => updatedPlayer(player, winnerTeam === 'teamB', teamBEloDelta))
  const changes = [...teamA, ...teamB].map((player, index) => {
    const afterPlayer = index < 2 ? nextTeamA[index] : nextTeamB[index - 2]
    const before = createRatingSnapshot(player, config)
    const after = createRatingSnapshot(afterPlayer, config)
    return {
      id: player.id,
      before,
      after,
      baseScoreDelta: after.baseScore - before.baseScore,
      eloDelta: index < 2 ? teamAEloDelta : teamBEloDelta,
      comprehensiveScoreDelta: after.comprehensiveScore - before.comprehensiveScore,
    }
  })

  return {
    winnerTeam,
    teamABeforeScore,
    teamBBeforeScore,
    expectedA,
    expectedB: 1 - expectedA,
    teamAEloDelta,
    teamBEloDelta,
    teamA: nextTeamA,
    teamB: nextTeamB,
    changes,
  }
}

export const formatComprehensiveScore = score => Math.round(score)
