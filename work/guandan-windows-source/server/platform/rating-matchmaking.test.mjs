import assert from 'node:assert/strict'
import { CLASSIC_STAKES, classicStakeForMode, settleClassicStake } from './classic-stakes.js'
import {
  applyMatchRating,
  calculateBaseScore,
  calculateComprehensiveScore,
  calculateEloDelta,
  calculateExpectedScore,
  createInitialRating,
  DEFAULT_RATING_CONFIG,
} from './rating.js'
import { allowedRatingSpread, selectRatingMatch } from './rating-matchmaking.js'

const closeTo = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} 应接近 ${expected}`)
const initial = createInitialRating('initial')
closeTo(calculateBaseScore(initial), 60_000 * Math.pow(0.5, 1.8) * 0.3)
closeTo(calculateComprehensiveScore(initial), calculateBaseScore(initial))
assert.equal(calculateComprehensiveScore({ ...initial, eloOffset: -100_000 }), DEFAULT_RATING_CONFIG.minimumScore)
const experiencedEvenPlayer = { id: 'experienced', games: 100, wins: 50, eloOffset: 0 }
closeTo(calculateBaseScore(experiencedEvenPlayer), 60_000 * Math.pow(0.5, 1.8))

const playerAtScore = (id, games, wins, targetScore) => {
  const player = { id, games, wins, eloOffset: 0 }
  player.eloOffset = targetScore - calculateBaseScore(player)
  closeTo(calculateComprehensiveScore(player), targetScore, 1e-7)
  return player
}
const lowTenGames = playerAtScore('low-10', 10, 5, 10_000)
const lowFiveThousandGames = playerAtScore('low-5000', 5_000, 2_500, 10_000)
const lowPartner = playerAtScore('low-partner', 80, 40, 10_000)
const highOne = playerAtScore('high-1', 100, 70, 50_000)
const highTwo = playerAtScore('high-2', 5_000, 3_500, 50_000)
const expectedLow = calculateExpectedScore(10_000, 50_000)
closeTo(expectedLow, 1 / 11)
closeTo(calculateEloDelta(expectedLow, 1), 181.8181818181818)
closeTo(calculateEloDelta(expectedLow, 0), -18.181818181818183)

const lowUpset = applyMatchRating([lowTenGames, lowPartner], [highOne, highTwo], 'teamA')
closeTo(lowUpset.teamAEloDelta, 181.8181818181818)
closeTo(lowUpset.teamBEloDelta, -181.8181818181818)
assert.equal(lowUpset.teamA[0].games, 11)
assert.equal(lowUpset.teamA[0].wins, 6)
assert.equal(lowTenGames.games, 10, '评分纯函数不得修改输入对象')

const expectedHighWin = applyMatchRating([lowTenGames, lowPartner], [highOne, highTwo], 'teamB')
closeTo(expectedHighWin.teamAEloDelta, -18.181818181818183)
closeTo(expectedHighWin.teamBEloDelta, 18.181818181818183)
const manyGamesSameScore = applyMatchRating([lowFiveThousandGames, lowPartner], [highOne, highTwo], 'teamA')
closeTo(manyGamesSameScore.teamAEloDelta, lowUpset.teamAEloDelta, 1e-9)
assert.notEqual(calculateBaseScore(lowFiveThousandGames), calculateBaseScore(lowTenGames), '场次只应通过基础分体现')

assert.deepEqual(CLASSIC_STAKES, { classic_50: 50, classic_300: 300, classic_2000: 2_000, classic_10000: 10_000 })
Object.entries(CLASSIC_STAKES).forEach(([mode, stake]) => assert.equal(classicStakeForMode(mode), stake))
assert.equal(classicStakeForMode('quick'), null)
const seats = { p1: 'a1', p2: 'b1', p3: 'a2', p4: 'b2' }
for (const [mode, stake] of Object.entries(CLASSIC_STAKES)) {
  const settlement = settleClassicStake({
    mode,
    winnerTeam: 'teamA',
    userIdsBySeat: seats,
    balancesByUser: { a1: 10_000, b1: 10_000, a2: 10_000, b2: 10_000 },
  })
  assert.deepEqual(settlement.deltasByUser, { a1: stake, b1: -stake, a2: stake, b2: -stake })
  assert.ok(settlement.transfers.every(transfer => transfer.amount === stake))
  assert.equal(Object.values(settlement.deltasByUser).reduce((sum, value) => sum + value, 0), 0)
}
assert.throws(() => settleClassicStake({
  mode: 'classic_50',
  winnerTeam: 'teamA',
  userIdsBySeat: seats,
  balancesByUser: { a1: 10_000, b1: 49, a2: 10_000, b2: 10_000 },
}), /余额不足以完成底分50结算/)

const now = 1_700_000_120_000
const recentHighMatch = {
  id: 'high-table',
  mode: 'classic_50',
  status: 'matching',
  createdAt: now - 1_000,
  participants: [{ userId: 'high', status: 'matching', joinedAt: now - 1_000, comprehensiveScoreAtJoin: 50_000 }],
}
const closeLowMatch = {
  id: 'low-table',
  mode: 'classic_50',
  status: 'matching',
  createdAt: now - 2_000,
  participants: [{ userId: 'low', status: 'matching', joinedAt: now - 2_000, comprehensiveScoreAtJoin: 11_000 }],
}
assert.equal(selectRatingMatch({ queueId: 'classic_50', matches: [recentHighMatch, closeLowMatch], joiningScore: 10_000, now }).id, 'low-table')
assert.equal(selectRatingMatch({ queueId: 'classic_300', matches: [recentHighMatch, closeLowMatch], joiningScore: 10_000, now }), null, '匹配不得跨底分场')
assert.equal(selectRatingMatch({ queueId: 'classic_50', matches: [recentHighMatch], joiningScore: 10_000, now }), null, '新等待桌不得立即放宽四万分差')
const agedHighMatch = structuredClone(recentHighMatch)
agedHighMatch.participants[0].joinedAt = now - 105_000
assert.equal(allowedRatingSpread(105_000), 40_000)
assert.equal(selectRatingMatch({ queueId: 'classic_50', matches: [agedHighMatch], joiningScore: 10_000, now }).id, 'high-table', '等待足够久后应逐级放宽分差')

console.log('rating, rating matchmaking and classic stake tests passed')
