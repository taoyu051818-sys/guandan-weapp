import assert from 'node:assert/strict'
import { createEmptyPlatformState } from '../../../../work/guandan-windows-source/server/platform/storage.js'
import { createSeededPlatformState, SAMPLE_PRODUCTS } from '../../../../work/guandan-windows-source/server/platform/seeds.js'
import { upgradeLoadedState, normalizeAccountId, findAvailableAccountId } from '../../../../work/guandan-windows-source/server/platform/state-migrations.js'
import { applyMatchRating, calculateComprehensiveScore, calculateBaseScore, createInitialRating, calculateExpectedScore } from '../../../../work/guandan-windows-source/server/platform/rating.js'
import { selectRatingMatch, allowedRatingSpread } from '../../../../work/guandan-windows-source/server/platform/rating-matchmaking.js'
import { CLASSIC_STAKES, settleClassicStake } from '../../../../work/guandan-windows-source/server/platform/classic-stakes.js'

// Pure synthetic-memory checks: no platform runtime startup, network or product writes.
const fallback = createSeededPlatformState()
const secondSeed = createSeededPlatformState()
secondSeed.products.tissue.name = 'isolated'
assert.notEqual(fallback.products.tissue.name, secondSeed.products.tissue.name)
assert.notEqual(SAMPLE_PRODUCTS[0].name, secondSeed.products.tissue.name)
const legacy = { schemaVersion: 1, users: {}, userStats: {}, playerRatings: {}, wallets: {}, ledgerEntries: [],
  products: { tissue: { id: 'tissue', stock: 0, name: 'operated', pointsPrice: 17 } },
  seasons: { 'season-lingshui-integration': { id: 'season-lingshui-integration', status: 'closed' } },
  matchQueues: { quick: ['waiting', 'waiting', null, 12], legacy: 'waiting' },
  matches: {}, userByAccountId: {}, activeMatchByUser: { stale: 'gone' }, extension: { preserved: true } }
for (let i = 0; i < 1_000; i++) {
  const id = `synthetic-${String(i).padStart(4, '0')}`
  legacy.users[id] = { id, createdAt: i, accountId: i % 3 === 0 ? '12345678' : (i % 3 === 1 ? 'invalid' : 20_000_000 + i) }
  legacy.userStats[id] = { gamesPlayed: i, wins: i + 1, elo: 500, updatedAt: i }
  if (i % 2 === 0) legacy.wallets[id] = { userId: id, balance: i, currency: 'points', updatedAt: i }
}
legacy.matches.waiting = { id: 'waiting', status: 'matching', participants: [
  { userId: 'synthetic-0000', seat: 'p1', status: 'matching' },
  { userId: 'synthetic-0001', seat: 'observer', status: 'matching' },
  { userId: 'cancelled-user', seat: 'p3', status: 'cancelled' },
  { userId: 'synthetic-bot', isBot: true, seat: 'p4', status: 'matching' },
] }
const before = structuredClone({ legacy, fallback })
const migrated = upgradeLoadedState(legacy, fallback)
assert.equal(migrated.changed, true)
assert.deepEqual({ legacy, fallback }, before)
const again = upgradeLoadedState(migrated.state, fallback)
assert.equal(again.changed, false)
assert.deepEqual(again.state, migrated.state)
assert.equal(Object.keys(again.state.userByAccountId).length, 1_000)
for (const [id, user] of Object.entries(again.state.users)) {
  assert.equal(normalizeAccountId(user.accountId), user.accountId)
  assert.equal(again.state.userByAccountId[user.accountId], id)
  assert.equal(again.state.playerRatings[id].wins, again.state.playerRatings[id].games)
  assert.equal(again.state.userStats[id].elo, undefined)
}
assert.equal(again.state.ledgerEntries.length, 500)
for (let i = 0; i < 1_000; i++) assert.equal(again.state.wallets[`synthetic-${String(i).padStart(4, '0')}`].balance, i % 2 ? 10_000 : i)
assert.deepEqual(again.state.activeMatchByUser, { 'synthetic-0000': 'waiting', 'synthetic-0001': 'waiting' })
assert.deepEqual(again.state.matchQueues, { quick: ['waiting'], legacy: ['waiting'] })
assert.deepEqual(again.state.products.tissue, legacy.products.tissue)
assert.equal(again.state.seasons['season-lingshui-integration'].status, 'closed')
assert.deepEqual(again.state.extension, { preserved: true })
for (const p of again.state.matches.waiting.participants) assert.match(p.entryAttemptId, /^[A-Za-z0-9_-]{22,128}$/)
const reordered = structuredClone(legacy)
reordered.users = Object.fromEntries(Object.entries(reordered.users).reverse())
const reorderedMigrated = upgradeLoadedState(reordered, fallback)
assert.deepEqual(reorderedMigrated.state.userByAccountId, migrated.state.userByAccountId)
assert.deepEqual(reorderedMigrated.state.wallets, migrated.state.wallets)
const collision = structuredClone(legacy)
collision.matches.another = { id: 'another', status: 'playing', participants: [{ userId: 'synthetic-0000', seat: 'p2', status: 'playing' }] }
const collisionBefore = structuredClone(collision)
assert.throws(() => upgradeLoadedState(collision, fallback), /多个活跃匹配/)
assert.deepEqual(collision, collisionBefore)
const candidate = findAvailableAccountId('same-key', new Set())
assert.notEqual(findAvailableAccountId('same-key', new Set([candidate])), candidate)
assert.deepEqual(upgradeLoadedState(createEmptyPlatformState(), createEmptyPlatformState()).changed, false)

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} differs from ${b}`)
let ratingCases = 0
for (let i = 0; i < 256; i++) {
  const players = [0, 1, 2, 3].map(j => ({ id: `p${j}`, games: i * (j + 1), wins: Math.floor(i * (j + 1) * j / 3), eloOffset: (i - 128) * (j + 1) }))
  const original = structuredClone(players)
  for (const winner of ['teamA', 'teamB']) {
    const result = applyMatchRating(players.slice(0, 2), players.slice(2), winner)
    const swapped = applyMatchRating(players.slice(2), players.slice(0, 2), winner === 'teamA' ? 'teamB' : 'teamA')
    near(result.expectedA + result.expectedB, 1)
    near(result.teamAEloDelta + result.teamBEloDelta, 0)
    near(result.teamAEloDelta, swapped.teamBEloDelta)
    const next = [...result.teamA, ...result.teamB]
    for (let j = 0; j < 4; j++) {
      assert.equal(next[j].games, players[j].games + 1)
      assert.equal(next[j].wins, players[j].wins + (j < 2 ? Number(winner === 'teamA') : Number(winner === 'teamB')))
      assert.ok(Number.isFinite(calculateComprehensiveScore(next[j])))
      assert.ok(calculateComprehensiveScore(next[j]) >= 1_000)
    }
    assert.deepEqual(players, original)
    ratingCases++
  }
}
for (const difference of [-1e12, -40_000, 0, 40_000, 1e12]) near(calculateExpectedScore(10_000, 10_000 + difference) + calculateExpectedScore(10_000 + difference, 10_000), 1)
for (const games of [1, 50, 100, 1_000]) {
  let previous = -1
  for (let wins = 0; wins <= games; wins++) {
    const score = calculateBaseScore({ ...createInitialRating('monotonic'), games, wins })
    assert.ok(score >= previous); previous = score
  }
}
assert.throws(() => applyMatchRating([createInitialRating('same'), createInitialRating('same')], [createInitialRating('c'), createInitialRating('d')], 'teamA'), /重复玩家/)
let stakeCases = 0
const seatIds = { p1: 'u1', p2: 'u2', p3: 'u3', p4: 'u4' }
for (const [mode, stake] of Object.entries(CLASSIC_STAKES)) for (const winner of ['teamA', 'teamB']) for (const extra of [0, 1, 137, 10_000]) {
  const input = { mode, winnerTeam: winner, userIdsBySeat: seatIds,
    balancesByUser: Object.fromEntries(Object.values(seatIds).map(id => [id, stake + extra])) }
  const original = structuredClone(input), result = settleClassicStake(input)
  assert.deepEqual(input, original)
  assert.equal(Object.values(result.deltasByUser).reduce((a, b) => a + b, 0), 0)
  assert.equal(Object.values(result.balancesAfter).reduce((a, b) => a + b, 0), 4 * (stake + extra))
  assert.ok(Object.values(result.balancesAfter).every(n => Number.isSafeInteger(n) && n >= 0))
  assert.deepEqual(Object.values(result.deltasByUser).sort((a, b) => a - b), [-stake, -stake, stake, stake])
  input.balancesByUser[winner === 'teamA' ? 'u2' : 'u1'] = stake - 1
  assert.throws(() => settleClassicStake(input), /余额不足/)
  stakeCases++
}
const now = 1_800_000_000_000
const candidateMatch = (id, score, wait) => ({ id, mode: 'classic_50', status: 'matching', createdAt: now - wait,
  participants: [{ status: 'matching', comprehensiveScoreAtJoin: score, joinedAt: now - wait }] })
let spreadCases = 0
for (let step = 0; step < 12; step++) {
  const wait = step * 15_000
  const limit = 5_000 + step * 5_000
  assert.equal(allowedRatingSpread(wait), limit)
  const exact = candidateMatch('exact', 10_000 + limit, wait)
  const beyond = candidateMatch('beyond', 10_000 + limit + 1, wait)
  const inputs = [exact, beyond], original = structuredClone(inputs)
  assert.equal(selectRatingMatch({ queueId: 'classic_50', matches: inputs, joiningScore: 10_000, now }), exact)
  assert.equal(selectRatingMatch({ queueId: 'classic_50', matches: [beyond], joiningScore: 10_000, now }), null)
  assert.equal(selectRatingMatch({ queueId: 'classic_300', matches: inputs, joiningScore: 10_000, now }), null)
  assert.deepEqual(inputs, original)
  spreadCases++
}
const tieA = candidateMatch('a', 12_000, 5_000), tieB = candidateMatch('b', 12_000, 5_000)
for (const matches of [[tieA, tieB], [tieB, tieA]]) assert.equal(selectRatingMatch({ queueId: 'classic_50', matches, joiningScore: 10_000, now }).id, 'a')
assert.equal(selectRatingMatch({ queueId: 'classic_50', matches: [{ ...tieA, status: 'matched' }, { ...tieB, participants: Array(4).fill(tieB.participants[0]) }], joiningScore: 10_000, now }), null)
console.log(JSON.stringify({ dataRating09: { migratedUsers: 1_000, createdWallets: 500,
  fixedPointAndOrderStable: true, ambiguousActiveMatchRejected: true, ratingCases, stakeCases, spreadCases } }, null, 2))
