import assert from 'node:assert/strict'
import { PlatformService } from '../../../../work/guandan-windows-source/server/platform/service.js'
import { MemoryPlatformStore, createEmptyPlatformState } from '../../../../work/guandan-windows-source/server/platform/storage.js'
import { normalizeSpectatorEvent } from '../../../../work/guandan-windows-source/server/platform/spectator-domain.js'

// Only synthetic memory state and injected clocks. No HTTP, sockets, user data or file store.
const base = 1_800_000_000_000
const roster = { p1: 'u1', p2: 'u2', p3: 'u3', p4: 'u4' }
const envelope = (sequence, detail = {}) => ({ eventId: `spectate:audit08:tx:${sequence}`, matchId: 'audit08:tx',
  roomId: '456789', sequence, roundSequence: 1, at: base + sequence, ...detail })
const variants = [
  { type: 'game-start', friendRoster: roster }, { type: 'round-start' }, { type: 'tribute-start' },
  { type: 'tribute', playerId: 'p1' }, { type: 'return-tribute', playerId: 'p2' },
  { type: 'anti-tribute' }, { type: 'play-start' },
  { type: 'play', playerId: 'p1', cards: [{ rank: 2, suit: 'club' }], playType: 'Single', automatic: false },
  { type: 'pass', playerId: 'p2', automatic: true },
  { type: 'round-end', ranking: Object.keys(roster), winnerTeam: 'teamA', isGameWon: true },
  { type: 'match-ended', reason: 'round-limit', scores: { teamA: 3, teamB: 1 }, roundsPlayed: 4,
    endedAt: base, winnerTeam: 'teamA' },
  { type: 'seat-left', playerId: 'observer', reason: 'left', userId: 'observer-audit' },
  { type: 'room-closed', reason: 'dissolved' },
]
for (const detail of variants) {
  const input = envelope(1, structuredClone(detail)), before = structuredClone(input)
  const output = normalizeSpectatorEvent(input.eventId, input, base + 1_000)
  assert.deepEqual(input, before)
  assert.equal(output.type, detail.type)
  if (output.cards) output.cards[0].rank = 7
  if (output.ranking) output.ranking.reverse()
  if (output.scores) output.scores.teamA = 9
  if (output.friendRoster) output.friendRoster.p1 = 'changed'
  assert.deepEqual(input, before, 'nested accepted payload must be copied')
  assert.throws(() => normalizeSpectatorEvent(input.eventId, { ...input, privateCards: [] }, base + 1_000), /不允许字段/)
}

class FaultStore extends MemoryPlatformStore {
  async persist () {
    if (this.failNext) { this.failNext = false; throw new Error('audit08 persist failure') }
  }
}
const seed = createEmptyPlatformState()
const matchId = 'audit08:tx'
for (const userId of Object.values(roster)) {
  seed.users[userId] = { id: userId, displayName: userId }
  seed.wallets[userId] = { userId, balance: 1_000, currency: 'points' }
  seed.activeMatchByUser[userId] = matchId
}
seed.matches[matchId] = { id: matchId, roomId: '456789', mode: 'quick', status: 'matched',
  createdAt: base - 100, matchedAt: base - 50,
  participants: Object.entries(roster).map(([seat, userId]) => ({ seat, userId, status: 'matched' })) }
seed.spectatorFeeds[matchId] = { matchId, mode: 'quick', startedAt: base, events: [] }
const store = new FaultStore(seed)
let now = base + 1_000, nextId = 0
const platform = new PlatformService({ store, accessTokens: {}, gameTickets: {}, now: () => now,
  createId: () => `audit08-tx-${++nextId}` })
const start = envelope(1, { type: 'game-start' })
const initial = await store.read(s => s)
store.failNext = true
await assert.rejects(platform.claimGameStart(start.eventId, start), /audit08 persist failure/)
assert.deepEqual(await store.read(s => s), initial, 'failed ingestion persists neither receipt, timeline nor lifecycle')
assert.equal((await platform.claimGameStart(start.eventId, start)).accepted, true)
const started = await store.read(s => s)
assert.equal(started.matches[matchId].status, 'playing')
const play = envelope(2, variants.find(v => v.type === 'play'))
const terminal = envelope(3, variants.find(v => v.type === 'round-end'))
await assert.rejects(platform.acceptSpectatorEvent(terminal.eventId, terminal), e => e.code === 'SPECTATOR_EVENT_OUT_OF_ORDER')
assert.deepEqual(await store.read(s => s), started)

const result = { eventId: 'audit08-result', matchId, roomId: '456789', ranking: Object.keys(roster),
  userIdsBySeat: roster, winnerTeam: 'teamA', finishedAt: base + 3, finalSpectatorSequence: 3 }
store.failNext = true
await assert.rejects(platform.acceptGameResult(result.eventId, result), /audit08 persist failure/)
assert.deepEqual(await store.read(s => s), started, 'no partial wallet/stat/rating/history/replay/result on failed commit')
const attempts = await Promise.all(Array.from({ length: 25 }, () => platform.acceptGameResult(result.eventId, structuredClone(result))))
assert.equal(attempts.filter(a => !a.duplicate).length, 1)
assert.equal(attempts.filter(a => a.duplicate).length, 24)
let settled = await store.read(s => s)
assert.equal(settled.ledgerEntries.filter(e => e.referenceId === result.eventId).length, 4)
for (const id of Object.values(roster)) {
  assert.equal(settled.userStats[id].gamesPlayed, 1)
  assert.equal(settled.playerRatings[id].games, 1)
}
await assert.rejects(platform.acceptGameResult(result.eventId, { ...result, finishedAt: base + 4 }), e => e.code === 'EVENT_ID_CONFLICT')
await assert.rejects(platform.acceptGameResult('audit08-another', { ...result, eventId: 'audit08-another' }), e => e.code === 'MATCH_ALREADY_SETTLED')
assert.deepEqual(await store.read(s => s), settled)

now = base + 30_003
assert.equal((await platform.getSpectatorFeed(matchId, 30)).timelineComplete, false, 'time elapsed but terminal event not delivered')
await platform.acceptSpectatorEvent(play.eventId, play)
const withPlay = await store.read(s => s)
await assert.rejects(platform.acceptSpectatorEvent(terminal.eventId, { ...terminal, isGameWon: false }), e => e.code === 'INVALID_FINAL_SPECTATOR_EVENT')
assert.deepEqual(await store.read(s => s), withPlay)
await platform.acceptSpectatorEvent(terminal.eventId, terminal)
now = base + 30_002
assert.equal((await platform.getSpectatorFeed(matchId, 30)).timelineComplete, false, 'fence complete but delay has one millisecond left')
now++
const publicFeed = await platform.getSpectatorFeed(matchId, 30)
assert.equal(publicFeed.timelineComplete, true)
assert.equal(publicFeed.status, 'finished')
assert.equal(publicFeed.totalEventCount, 3)
assert.equal(publicFeed.events.length, 3)
for (const event of publicFeed.events) for (const key of ['eventId', 'matchId', 'roomId', 'userId', 'friendRoster']) assert.equal(event[key], undefined)
settled = await store.read(s => s)
assert.deepEqual(settled.replays[`rpl_${result.eventId}`].events, settled.spectatorFeeds[matchId].events)
assert.equal((await platform.acceptSpectatorEvent(start.eventId, start)).duplicate, true)
assert.equal(await store.read(s => s.matches[matchId].status), 'completed', 'late duplicate start cannot revive completed match')
const close = envelope(4, { type: 'room-closed', reason: 'empty-timeout' })
assert.equal((await platform.acceptSpectatorEvent(close.eventId, close)).ignored, true)
assert.equal(await store.read(s => s.matches[matchId].status), 'completed')
assert.equal(await store.read(s => s.spectatorFeeds[matchId].events.length), 3)
console.log(JSON.stringify({ platformIngestion08: { normalizedTypes: variants.length, rejectedUnknownFieldVariants: variants.length,
  atomicPersistFailures: 2, concurrentResultAttempts: attempts.length, acceptedResultCount: 1,
  tailDeliveryAndDelayFence: true, duplicateStartDoesNotRevive: true, postResultCleanupDoesNotAbort: true } }, null, 2))
