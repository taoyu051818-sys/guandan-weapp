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

console.log('friend room service tests passed')
