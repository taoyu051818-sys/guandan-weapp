// SL-02-002（独立 Node 进程）
import assert from 'node:assert/strict'
import { createRoomMetadata } from './weapp-room-metadata.js'
import { createRoomPublisher } from './weapp-room-publisher.js'
import { createFriendRoomObserverRuntime } from './friend-room-observer-runtime.js'
for (const spectator of ['live', 'delay-15', 'delay-30', 'delay-60', 'delayed-round']) for (const credential of ['token', 'ticket']) {
const ids = ['p1', 'p2', 'p3', 'p4'], noop = () => {}, messages = []
const connection = { id: 'new-p2', acceptedCacheKeys: new Map() }
const connections = new Map([[connection.id, connection]])
const metadata = createRoomMetadata({ playerIds: ids, createResumeToken: () => 'new-token',
  createBotSeed: () => 'fixture-seed', entryKindForClaims: () => 'friend', entryDeadlineForClaims: () => null })
const room = metadata.createRoomRecord({ roomId: '100003', roomSettings: { spectator } })
room.state = { phase: 'playing', players: Object.fromEntries(ids.map(id => [id, {
  id, team: ['p1', 'p3'].includes(id) ? 'teamA' : 'teamB', hand: [{ id: `card-${id}` }],
}])) }
room.resumeTokens.p2 = 'old-token'
room.userIdsBySeat.p2 = 'user-p2'
room.friendMembers = [{ userId: 'user-p2', seat: 'p2', viewPlayerId: 'p2',
  resumeToken: 'old-token', connectionId: null }]
room.dissolveVote = { initiator: 'p1', votes: { p1: 'agree', p2: 'offline', p3: 'pending', p4: 'pending' },
  expiresAt: Date.now() + 60000 }
const rooms = new Map([[room.roomId, room]])
const send = (c, type, payload) => messages.push({ type, ...structuredClone(payload) })
const publisher = createRoomPublisher({ playerIds: ids, connections, send, broadcast: noop,
  ensureLobbyMetadata: metadata.ensureLobbyMetadata, ensureLiveMetadata: metadata.ensureLiveMetadata,
  isFriendRoom: () => true, seatIsOccupied: (r, id) => Boolean(r.seats[id]) })
let restores = 0
const runtime = createFriendRoomObserverRuntime({ rooms, connections, acceptedActions: new Map(),
  inspectEntryTicket: () => ({ claims: { sub: 'user-p2', seat: 'p2', purpose: 'rejoin', jti: 'fresh-ticket', entryAttemptId: 'recovery-attempt', exp: 9999999999 }, consumed: false }),
  ticketBlockedByClosedRoom: () => false, ticketMatchesRoom: () => true, gameTicketVerifier: { consume: noop },
  sameToken: (a, b) => typeof a === 'string' && a === b, entryConflictFor: () => null,
  reserveAccepted: () => true, releaseAccepted: noop, createResumeToken: () => 'new-token',
  rotateAcceptedActionIdentity: noop, clearEmptyRoomExpiry: noop, clearHostExpiry: noop,
  actionFingerprint: () => 'fingerprint', rememberAccepted: noop, commitRuntimeState: async () => {},
  send, ...publisher, restoreOfflineDissolveVote: (r, id) => {
    restores++; r.dissolveVote.votes[id] = 'pending'; return true
  } })
try {
  const handled = await runtime.enter({ type: credential === 'token' ? 'rejoinRoom' : 'joinRoom', requestId: 1,
    payload: { roomId: room.roomId, myPlayerId: 'p2', resumeToken: 'old-token', gameTicket: 'synthetic-ticket', entryAttemptId: 'recovery-attempt' },
    connection, reply: (type, payload) => messages.push({ type, ...payload }) })
  assert.equal(handled, true)
  assert.equal(room.seats.p2, connection.id)
  assert.equal(room.resumeTokens.p2, 'new-token')
  const reply = messages.find(m => m.type === 'roomRejoined')
  assert.ok(reply)
  assert.equal(reply.dissolveVote.votes.p2, 'pending')
  assert.equal(restores, 1)
  console.log({ rejoined: room.seats.p2, rotatedToken: room.resumeTokens.p2,
    returnedVote: reply.dissolveVote.votes.p2, restoreCalls: restores })
} finally { runtime.dispose() }
}
