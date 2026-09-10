import assert from 'node:assert/strict'
import './tournament-standings.test.mjs'
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

await assert.rejects(() => tournaments.withdraw('user', 'cup', 'withdraw-paid'), error => error.code === 'WITHDRAWAL_UNAVAILABLE')
await store.transaction(snapshot => {
  snapshot.tournaments.free = { id: 'free', name: '16人赛', status: 'open', format: 'fixed16-latin-3', entryPoints: 0, capacity: 16, roundsTotal: 3, advanceCount: 8 }
})
await tournaments.enroll('user', 'free', 'free-1', { expectedEntryPoints: 0 })
await tournaments.checkIn('user', 'free')
await assert.rejects(() => tournaments.withdraw('user', 'free', ''), error => error.code === 'IDEMPOTENCY_KEY_REQUIRED')
const cancelled = await tournaments.withdraw('user', 'free', 'withdraw-1')
assert.equal(cancelled.checkedInCount, 0)
assert.deepEqual(cancelled.viewerEntry, { enrolled: false, checkedIn: false, rosterLocked: false })
assert.equal((await tournaments.listStandings('free', 'user')).viewerStanding, null)
assert.equal(await store.read(snapshot => snapshot.wallets.user.balance), 700, 'free withdrawal does not change wallet')
await assert.rejects(() => tournaments.enroll('user', 'free', 'free-1', { expectedEntryPoints: 0 }), error => error.code === 'ENROLLMENT_CANCELLED')
await tournaments.enroll('user', 'free', 'free-2', { expectedEntryPoints: 0 })
await tournaments.checkIn('user', 'free')
assert.deepEqual(await tournaments.withdraw('user', 'free', 'withdraw-1'), cancelled, 'old withdrawal retries return the receipt only')
assert.equal((await tournaments.getState('user', 'free')).viewerEntry.enrolled, true, 'old withdrawal cannot cancel a new enrollment')
await store.transaction(snapshot => { snapshot.tournaments.free.status = 'running' })
await assert.rejects(() => tournaments.withdraw('user', 'free', 'withdraw-locked'), error => error.code === 'ROSTER_LOCKED')
assert.equal((await tournaments.listStandings('free', 'user')).standings.length, 1)
console.log('tournament service tests passed (withdrawal, idempotency, re-enrollment, roster lock)')
