import assert from 'node:assert/strict'
import { FriendRoomService } from './friend-room-service.js'
import { createEmptyPlatformState, MemoryPlatformStore } from './storage.js'

const state = createEmptyPlatformState()
state.users.host = { id: 'host' }
state.users.guest = { id: 'guest' }
const store = new MemoryPlatformStore(state)
let ticket = 0
const gameTickets = {
  issue (claims) {
    const jti = `ticket-${++ticket}`
    return { gameEndpoint: 'ws://game', gameTicket: jti, expiresAt: 11_000, claims: { ...claims, jti, exp: 11 } }
  },
  inspect (value) { return { jti: value, exp: 11 } },
}
const rooms = new FriendRoomService({
  store,
  gameTickets,
  now: () => 1000,
  createId: () => 'one',
  createInviteCode: () => 'A'.repeat(24),
  createEntryAttemptId: () => 'generated-entry-attempt-1',
  createRoomId: () => '123456',
  friendRoomTtlMs: 60_000,
})
const settings = { mode: 'classic', rounds: 8, scoring: 'double-4', scoreVisibility: 'hidden', turnSeconds: 60, trusteeSeconds: 30, totalTimeMinutes: 20, spectator: 'off', autoSort: false, disableInteraction: false, sortOrder: 'asc', authoritativeValidation: true }
const created = await rooms.create('host', { entryAttemptId: 'friend-create-attempt-0001', roomSettings: settings })
assert.equal(created.seat, 'p1')
assert.equal(created.inviteCode, 'A'.repeat(24))
assert.deepEqual(await rooms.create('host', { entryAttemptId: 'friend-create-attempt-0001', roomSettings: settings }), created)
const joined = await rooms.join('guest', { entryAttemptId: 'friend-guest-attempt-00001', roomId: created.roomId, inviteCode: created.inviteCode })
assert.equal(joined.seat, 'p2')
assert.equal('inviteCode' in joined, false)
const recovered = await rooms.recoverFriend('guest', { recoveryAttemptId: 'friend-recovery-attempt-01' })
assert.equal(recovered.matchId, created.matchId)
assert.equal(recovered.ticketPurpose, 'entry')

const enabledState = createEmptyPlatformState()
for (let i = 0; i < 14; i++) enabledState.users[`user-${i}`] = { id: `user-${i}` }
const enabledStore = new MemoryPlatformStore(enabledState)
const enabledRooms = new FriendRoomService({
  store: enabledStore, gameTickets, now: () => 1000, createId: () => 'observer-room',
  createInviteCode: () => 'B'.repeat(24), createRoomId: () => '623451', friendRoomTtlMs: 60_000,
})
const open = await enabledRooms.create('user-0', { entryAttemptId: 'observer-host-create-0001', roomSettings: { ...settings, spectator: 'delay-15' } })
const joinObserverRoom = i => enabledRooms.join(`user-${i}`, { entryAttemptId: `observer-guest-entry-${String(i).padStart(4, '0')}`, roomId: open.roomId, inviteCode: open.inviteCode })
for (let i = 1; i < 4; i++) assert.equal((await joinObserverRoom(i)).seat, `p${i + 1}`, 'players fill seats in order')
assert.equal((await joinObserverRoom(4)).seat, 'observer', 'a full enabled room admits a spectator without consuming a seat')
await enabledStore.transaction(draft => { draft.matches[open.matchId].status = 'playing' })
assert.equal((await joinObserverRoom(5)).seat, 'observer', 'post-start invitations can only enter the observer role')
const observerRecovery = await enabledRooms.recoverFriend('user-5', { recoveryAttemptId: 'observer-recovery-0001' })
assert.equal(observerRecovery.seat, 'observer')
assert.equal(observerRecovery.ticketPurpose, 'rejoin')
for (let i = 6; i < 12; i++) await joinObserverRoom(i)
await assert.rejects(joinObserverRoom(12), /上限|已满/, 'room membership stays bounded')

console.log('friend room service tests passed')
