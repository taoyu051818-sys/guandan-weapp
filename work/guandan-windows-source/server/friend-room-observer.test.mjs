import assert from 'node:assert/strict'
import { FRIEND_SEATS as seats, registerRoomMember, moveRoomMember, roomMember, memberIsHost } from './friend-room-members.js'
import { FriendRoomObserverBuffer } from './friend-room-observer-buffer.js'
import { applyFriendRoomRoster } from './platform/friend-room-roster.js'

const room = () => ({ entryKind: 'friend', roomSettings: { spectator: 'live' }, version: 1, roundSequence: 1,
  ...Object.fromEntries(['seats', 'resumeTokens', 'userIdsBySeat', 'ticketJtisBySeat', 'ticketExpiresAtBySeat', 'lobbyReady'].map(field => [field, Object.fromEntries(seats.map(id => [id, null]))])), botPlayerIds: [] })
const table = room()
for (const seat of seats) {
  table.seats[seat] = `connection-${seat}`; table.resumeTokens[seat] = `token-${seat}`; table.userIdsBySeat[seat] = `user-${seat}`
  registerRoomMember(table, seat)
}
const host = roomMember(table, 'connection-p1')
assert.equal(roomMember(table, null), null)
assert.equal(memberIsHost(table, null), false)
moveRoomMember(table, host, null)
assert.equal(table.seats.p1, null)
assert.equal(table.resumeTokens.p1, null)
assert.equal(memberIsHost(table, host.connectionId), true)
const guest = roomMember(table, 'connection-p2')
moveRoomMember(table, guest, 'p1')
moveRoomMember(table, host, 'p2')
assert.equal(table.userIdsBySeat.p1, 'user-p2')
assert.equal(table.resumeTokens.p2, 'token-p1')
assert.equal(memberIsHost(table, 'connection-p2'), false)
assert.equal(memberIsHost(table, 'connection-p1'), true)
assert.throws(() => moveRoomMember(table, host, 'p4'), /已有人/)
assert.throws(() => moveRoomMember(table, host, 'p9'), /无效/)
table.pendingGameStartEvent = {}
assert.throws(() => moveRoomMember(table, host, null), /开局后/)
table.pendingGameStartEvent = null
table.state = {}
assert.throws(() => moveRoomMember(table, host, null), /开局后/)

let now = 100000
for (const [mode, delay] of [['live', 0], ['delay-15', 15000], ['delay-30', 30000], ['delay-60', 60000]]) {
  const table = room(); table.roomSettings.spectator = mode
  const buffer = new FriendRoomObserverBuffer({ now: () => now })
  table.state = { players: Object.fromEntries(seats.map(id => [id, { hand: [{ id: `secret-${id}`, rank: 'A' }] }])), tribute: { exchanges: [{ returnCardId: 'private' }] } }
  const original = structuredClone(table.state)
  buffer.capture(table, { state: table.state, version: 1, gameVersion: 1, tribute: { card: 'private' }, turnDeadlineAt: now + 20000 })
  if (delay) { now += delay - 1; assert.equal(buffer.project(table, 'p1'), null); now += 1 }
  for (const view of seats) {
    const projected = buffer.project(table, view)
    assert.equal(projected.state.players[view].hand[0].id, `secret-${view}`)
    for (const other of seats.filter(id => id !== view)) assert.deepEqual(projected.state.players[other].hand, [{ id: `hidden-${other}-0` }])
    assert.equal(projected.state.tribute, null); assert.equal(projected.tribute, null)
    projected.state.players[view].hand[0].rank = '2'
  }
  assert.deepEqual(table.state, original, 'projections cannot alias authoritative cards')
  table.version = 2; buffer.capture(table, { state: table.state, version: 2, gameVersion: 2, roundResult: { winnerTeam: 'teamB' } })
  if (delay) assert.equal(buffer.project(table, 'p1').roundResult, undefined, 'future results must not leak alongside delayed hands')
  assert.equal(new FriendRoomObserverBuffer().project(table, 'p1'), null, 'restart must buffer again rather than replay a future snapshot')
}
const delayedRound = room(); delayedRound.roomSettings.spectator = 'delayed-round'; delayedRound.state = { players: Object.fromEntries(seats.map(id => [id, { hand: [] }])) }
const buffer = new FriendRoomObserverBuffer({ now: () => now, maxSnapshots: 2 })
buffer.capture(delayedRound, { state: delayedRound.state, version: 1 })
assert.equal(buffer.project(delayedRound, 'p1'), null)
delayedRound.roundSequence = 2
assert.equal(buffer.project(delayedRound, 'p1').version, 1)
delayedRound.roomSettings.spectator = 'off'
assert.equal(buffer.project(delayedRound, 'p1'), null)

const match = { kind: 'friend-room', status: 'matched', roomSettings: { spectator: 'live' }, participants: [...seats, 'observer'].map((seat, index) => ({ userId: `u${index}`, seat, status: 'matched' })) }
assert.throws(() => applyFriendRoomRoster(match, { p1: 'u0', p2: 'u0', p3: 'u2', p4: 'u3' }), /四名不同/)
assert.throws(() => applyFriendRoomRoster(match, { p1: 'intruder', p2: 'u1', p3: 'u2', p4: 'u3' }), /授权/)
const roster = { p1: 'u1', p2: 'u4', p3: 'u2', p4: 'u3' }
applyFriendRoomRoster(match, roster)
assert.equal(match.participants[0].seat, 'observer')
assert.equal(match.participants[4].seat, 'p2')
match.status = 'playing'
assert.doesNotThrow(() => applyFriendRoomRoster(match, roster))
assert.throws(() => applyFriendRoomRoster(match, { ...roster, p1: 'u0' }), /不能修改/)
console.log('Friend-room observer membership, private delay buffer and roster checks passed')
