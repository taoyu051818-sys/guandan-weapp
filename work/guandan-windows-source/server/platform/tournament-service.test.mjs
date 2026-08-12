import assert from 'node:assert/strict'
import { TournamentService } from './tournament-service.js'
import { createEmptyPlatformState, MemoryPlatformStore } from './storage.js'

const state = createEmptyPlatformState()
state.users.user = { id: 'user', displayName: '玩家' }
state.wallets.user = { userId: 'user', balance: 1000, currency: 'points', updatedAt: 0 }
state.tournaments.cup = { id: 'cup', name: '周末赛', queueId: 'weekend_cup', status: 'open', entryPoints: 300, roundsTotal: 1, advanceCount: 1 }
const store = new MemoryPlatformStore(state)
let id = 0
const tournaments = new TournamentService({ store, now: () => 3000, createId: () => `id-${++id}` })

const enrollment = await tournaments.enroll('user', 'cup', 'enroll-1', { expectedEntryPoints: 300 })
assert.equal(enrollment.entryPoints, 300)
assert.deepEqual(await tournaments.enroll('user', 'cup', 'enroll-1', { expectedEntryPoints: 300 }), enrollment)
await assert.rejects(
  () => tournaments.enroll('user', 'cup', 'enroll-1', { expectedEntryPoints: 301 }),
  error => error.code === 'IDEMPOTENCY_CONFLICT',
)
assert.equal((await store.read(snapshot => snapshot.wallets.user.balance)), 700)
assert.equal((await tournaments.list('user'))[0].enrolled, true)
const standings = await tournaments.listStandings('cup', 'user')
assert.equal(standings.viewerStanding.userId, 'user')
assert.equal(standings.viewerStanding.qualificationStatus, 'pending')

console.log('tournament service tests passed')
