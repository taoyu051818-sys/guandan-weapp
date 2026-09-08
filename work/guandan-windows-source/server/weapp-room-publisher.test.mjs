import assert from 'node:assert/strict'
import { createRoomPublisher, phaseForRoom } from './weapp-room-publisher.js'

const playerIds = ['p1', 'p2', 'p3', 'p4']
const sent = []
const broadcasts = []
const connections = new Map([
  ['c1', { id: 'c1' }],
  ['c2', { id: 'c2' }],
])

const state = {
  phase: 'playing',
  currentLevel: 3,
  players: {
    p1: { id: 'p1', hand: [{ id: 'a', rank: '3', suit: 'club', value: 3 }] },
    p2: { id: 'p2', hand: [{ id: 'b', rank: '4', suit: 'club', value: 4 }] },
    p3: { id: 'p3', hand: [] },
    p4: { id: 'p4', hand: [] },
  },
  playArea: [],
}
const room = {
  roomId: '123456',
  seats: { p1: 'c1', p2: 'c2', p3: null, p4: null },
  state,
  resumeTokens: { p1: 'token-1', p2: 'token-2', p3: null, p4: null },
  roundResult: null,
  roundStatsBySeat: { p1: { bombsPlayed: 2 }, p2: { bombsPlayed: 0 } },
  roomSettings: {},
  lobbyReady: { p1: true, p2: false, p3: false, p4: false },
  botPlayerIds: [],
  ticketBound: false,
  entryKind: 'friend',
  pendingGameStartEvent: null,
  turnDeadlineAt: 1000,
  deadlinePlayerId: 'p1',
  deadlineAction: 'play',
  trustees: { p1: null, p2: null, p3: null, p4: null },
  consecutiveTimeouts: { p1: 0, p2: 0, p3: 0, p4: 0 },
  roundReady: { p1: false, p2: false, p3: false, p4: false },
  dissolveVote: null,
  matchStartedAt: 10,
  totalDeadlineAt: null,
  matchEnded: null,
  gameVersion: 7,
  version: 9,
  roundSequence: 1,
  teamLevels: { teamA: 3, teamB: 2 },
}

const publisher = createRoomPublisher({
  playerIds,
  connections,
  send: (connection, type, payload) => sent.push({ connection, type, payload }),
  broadcast: (targetRoom, type, payload) => broadcasts.push({ targetRoom, type, payload }),
  ensureLobbyMetadata: () => {},
  ensureLiveMetadata: () => {},
  isFriendRoom: targetRoom => !targetRoom.ticketBound,
  seatIsOccupied: (targetRoom, playerId) => Boolean(targetRoom.seats[playerId]),
})

assert.equal(phaseForRoom(room), 'playing')
assert.equal(phaseForRoom({ ...room, state: { phase: 'tribute' } }), 'tribute')
assert.equal(phaseForRoom({ ...room, roundResult: {} }), 'settlement')

publisher.publishState(room)
assert.equal(sent.length, 2)
assert.equal(sent[0].type, 'gameState')
assert.equal(sent[0].payload.state.players.p1.hand.length, 1)
assert.deepEqual(sent[0].payload.state.players.p2.hand, [{ id: 'hidden-p2-0' }])
assert.equal(sent[1].payload.state.players.p2.hand.length, 1)
assert.equal(sent[0].payload.viewerRoundStats.bombsPlayed, 2)
assert.equal(sent[0].payload.gameVersion, 7)
assert.equal(sent[0].payload.gameStartPending, false, 'authoritative game state must explicitly clear the pending-start projection')

const entry = publisher.entryPayloadFor(room, 'p1')
const entryBeforeMutation = structuredClone(entry)
room.trustees.p1 = { reason: 'manual', since: 1 }
room.consecutiveTimeouts.p1 = 3
room.teamLevels.teamA = 7
assert.deepEqual(entry, entryBeforeMutation, 'room mutations cannot change an already projected entry snapshot')
entry.trustees.p2 = { reason: 'manual', since: 2 }
assert.equal(room.trustees.p2, null, 'projection consumers cannot mutate authoritative state')
assert.equal(entry.myPlayerId, 'p1')
assert.equal(entry.resumeToken, 'token-1')
assert.deepEqual(entry.capabilities, {
  canUseBots: true,
  canKickMembers: true,
  requiresLobbyReady: true,
})

publisher.publishTurnStatus(room)
publisher.publishRoomMembers(room)
assert.equal(broadcasts[0].type, 'turnDeadline')
assert.equal(broadcasts[0].payload.currentTurn, 'p1')
assert.equal(broadcasts[1].type, 'roomMembers')
assert.deepEqual(broadcasts[1].payload.memberPlayerIds, ['p1', 'p2'])

const watchedRoom = structuredClone(room)
for (const id of playerIds) watchedRoom.state.players[id].team = ['p1', 'p3'].includes(id) ? 'teamA' : 'teamB'
watchedRoom.state.players.p1.hand = []
watchedRoom.state.players.p3.hand = [{ id: 'partner-card', rank: 'K', suit: 'heart', value: 13 }]
watchedRoom.state.finishedPlayers = ['p1']
sent.length = 0
publisher.publishState(watchedRoom)
assert.equal(sent[0].payload.state.players.p3.hand[0].id, 'partner-card', 'live snapshot reveals only the finished viewer teammate')
assert.ok(sent[1].payload.state.players.p3.hand[0].id.startsWith('hidden-'), 'same broadcast redacts opponent recipient')
const recovered = publisher.entryPayloadFor(watchedRoom, 'p1')
assert.equal(recovered.myPlayerId, 'p1', 'watching must never change authenticated identity')
assert.equal(recovered.state.players.p3.hand[0].id, 'partner-card', 'reconnection projects current authorized teammate hand immediately')
assert.deepEqual(recovered.state.players.p2.hand, [{ id: 'hidden-p2-0' }])
console.log('weapp room publisher and teammate live/recovery projection tests passed')
