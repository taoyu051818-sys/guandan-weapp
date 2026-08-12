import assert from 'node:assert/strict'
import { MatchmakingService } from './matchmaking-service.js'
import { createInitialRating } from './rating.js'
import { createEmptyPlatformState, MemoryPlatformStore } from './storage.js'

let now = 1_700_000_000_000
const state = createEmptyPlatformState()
for (const userId of ['u1', 'u2', 'u3', 'u4']) {
  state.users[userId] = { id: userId, displayName: userId }
  state.wallets[userId] = { userId, balance: 10_000, currency: 'points', updatedAt: now }
  state.playerRatings[userId] = createInitialRating(userId)
}
const store = new MemoryPlatformStore(state)
let id = 0
let entry = 0
const matchmaking = new MatchmakingService({
  store,
  gameTickets: {
    issue (claims) {
      return {
        gameEndpoint: 'ws://game.test',
        gameTicket: `ticket-${claims.userId}`,
        expiresAt: now + 90_000,
        claims: structuredClone(claims),
      }
    },
  },
  now: () => now,
  createId: () => `id-${++id}`,
  createEntryAttemptId: () => `entry-attempt-${String(++entry).padStart(12, '0')}`,
  createRoomId: () => '123456',
  ensurePlayerRating: (draft, userId) => (draft.playerRatings[userId] ||= createInitialRating(userId)),
  ensureParticipantEntryAttemptId: (participant, preferred = '') => (participant.entryAttemptId ||= preferred || `entry-attempt-${String(++entry).padStart(12, '0')}`),
  friendRooms: {
    hasExpired: () => false,
    cancelExpired: () => false,
    cancelByHost: () => false,
  },
})

const joined = []
for (const userId of ['u1', 'u2', 'u3', 'u4']) joined.push(await matchmaking.join(userId, { mode: 'quick' }))
assert.ok(joined.every(result => result.matchId === joined[0].matchId))
assert.equal(joined[3].status, 'matched')
assert.deepEqual(
  (await Promise.all(['u1', 'u2', 'u3', 'u4'].map(userId => matchmaking.getStatus(userId, joined[0].matchId)))).map(result => result.seat),
  ['p1', 'p2', 'p3', 'p4'],
)
assert.deepEqual(await store.read(snapshot => snapshot.matchQueues), {})
await assert.rejects(
  () => matchmaking.cancel('u1', joined[0].matchId),
  error => error.code === 'MATCH_ALREADY_ASSIGNED',
)

now += 90_001
assert.equal((await matchmaking.getStatus('u1', joined[0].matchId)).status, 'cancelled')
const expired = await store.read(snapshot => snapshot)
assert.deepEqual(expired.activeMatchByUser, {})
assert.equal(expired.spectatorFeeds[joined[0].matchId].abortReason, 'entry-timeout')

console.log('matchmaking service tests passed')
