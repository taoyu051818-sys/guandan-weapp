import assert from 'node:assert/strict'
import { GameResultService } from './game-result-service.js'
import { createInitialRating } from './rating.js'
import { createEmptyPlatformState, MemoryPlatformStore } from './storage.js'

const now = 1_700_000_000_000
const state = createEmptyPlatformState()
const userIdsBySeat = { p1: 'u1', p2: 'u2', p3: 'u3', p4: 'u4' }
for (const userId of Object.values(userIdsBySeat)) {
  state.users[userId] = { id: userId, displayName: userId.toUpperCase() }
  state.wallets[userId] = { userId, balance: 1_000, currency: 'points', updatedAt: now }
  state.playerRatings[userId] = createInitialRating(userId)
  state.activeMatchByUser[userId] = 'match-1'
}
state.matches['match-1'] = {
  id: 'match-1',
  mode: 'quick',
  status: 'playing',
  roomId: '123456',
  matchedAt: now - 10_000,
  participants: Object.entries(userIdsBySeat).map(([seat, userId]) => ({ seat, userId, status: 'playing' })),
}
state.spectatorFeeds['match-1'] = {
  matchId: 'match-1',
  mode: 'quick',
  startedAt: now - 10_000,
  finishedAt: null,
  events: [{ sequence: 1, at: now - 2_000, type: 'round-end', isGameWon: true }],
}
const store = new MemoryPlatformStore(state)
let id = 0
const results = new GameResultService({
  store,
  now: () => now,
  createId: () => `id-${++id}`,
  ensurePlayerRating: (draft, userId) => (draft.playerRatings[userId] ||= createInitialRating(userId)),
})
const event = {
  eventId: 'result-1',
  matchId: 'match-1',
  roomId: '123456',
  ranking: ['p1', 'p2', 'p3', 'p4'],
  userIdsBySeat,
  winnerTeam: 'teamA',
  finishedAt: now - 1_000,
  finalSpectatorSequence: 1,
  statsBySeat: { p1: { bombsPlayed: 2 } },
}

assert.equal((await results.accept(event.eventId, event)).duplicate, false)
assert.equal((await results.accept(event.eventId, event)).duplicate, true)
const reorderedEvent = Object.fromEntries(Object.entries(event).reverse())
reorderedEvent.userIdsBySeat = Object.fromEntries(Object.entries(event.userIdsBySeat).reverse())
assert.equal((await results.accept(event.eventId, reorderedEvent)).duplicate, true, '字段顺序变化不能改变幂等事件身份')
const settled = await store.read(snapshot => snapshot)
assert.deepEqual(Object.values(userIdsBySeat).map(userId => settled.wallets[userId].balance), [1_100, 1_060, 1_030, 1_010])
assert.equal(settled.ledgerEntries.filter(item => item.referenceId === event.eventId).length, 4)
assert.equal(settled.userStats.u1.gamesPlayed, 1)
assert.equal(settled.userStats.u1.wins, 1)
assert.equal(settled.userStats.u1.bombsPlayed, 2)
assert.equal(settled.playerRatings.u1.games, 1)
assert.equal(settled.matches['match-1'].status, 'completed')
assert.deepEqual(settled.activeMatchByUser, {})
assert.equal(settled.gameResultByMatch['match-1'], event.eventId)
assert.equal(settled.replays[`rpl_${event.eventId}`].events[0].type, 'round-end')
await assert.rejects(
  () => results.accept(event.eventId, { ...event, finishedAt: event.finishedAt + 1 }),
  error => error.code === 'EVENT_ID_CONFLICT',
)
await assert.rejects(
  () => results.accept('result-2', { ...event, eventId: 'result-2' }),
  error => error.code === 'MATCH_ALREADY_SETTLED',
)

console.log('game result service tests passed')
