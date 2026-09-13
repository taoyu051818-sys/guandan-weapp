// SP-03-001
import assert from 'node:assert/strict'
import { createRoomExpiry } from './weapp-room-expiry.js'
import { createWeAppMatchLifecycle } from './weapp-match-lifecycle.js'
import { createGameCommandHandler } from './weapp-game-command-handler.js'
const ids = ['p1', 'p2', 'p3', 'p4'], noop = () => {}
const flags = v => Object.fromEntries(ids.map(id => [id, v]))
const room = { roomId: '321654', version: 1, gameVersion: 1,
  roomSettings: { format: 'rounds', rounds: 4, turnSeconds: 20, trusteeSeconds: 15, totalTimeMinutes: 0 },
  state: { phase: 'playing', currentTurn: 'p1', lastValidPlay: { type: 'Single' },
    players: Object.fromEntries(ids.map(id => [id, { hand: [{ id: `card-${id}` }] }])) },
  seats: Object.fromEntries(ids.map(id => [id, `connection-${id}`])),
  trustees: flags(null), consecutiveTimeouts: flags(0),
  dissolveVote: { initiator: 'p2', votes: { p1: 'pending', p2: 'agree', p3: 'pending', p4: 'pending' },
    expiresAt: Date.now() + 60000 } }
const rooms = new Map([[room.roomId, room]])
const turnTimers = new Map(), expiryTimers = new Map(), jobs = [], events = []
const enqueue = fn => { const p = Promise.resolve().then(fn); jobs.push(p); return p }
const timerInto = timers => (fn, delay) => {
  const id = { unref: noop }; timers.set(id, { fn, delay }); return id
}
const expiry = createRoomExpiry({ rooms, seatHasLiveConnection: () => true,
  hasConnectedHuman: () => true, enqueueServerOperation: enqueue, closeRoomWithoutAck: noop,
  commitRuntimeState: async () => events.push('committed'), publishDissolveVote: () => events.push('expired'),
  emptyRoomTimeoutMs: 1000, setTimeout: timerInto(expiryTimers), clearTimeout: id => expiryTimers.delete(id) })
const lifecycle = createWeAppMatchLifecycle({ playerIds: ids, rooms, connections: new Map(),
  turnTimeoutMs: 20000, friendSecondMs: 1000, totalMinuteMs: 60000,
  isShuttingDown: () => false, enqueueServerOperation: enqueue, ensureLiveMetadata: noop,
  isFriendRoom: () => true, isMatchRoom: () => false, isBotPlayer: () => false,
  botPolicyForRoom: noop, existingBotPolicyForRoom: () => null,
  dispatchMatchIntentImpl: () => { throw Error('injected action failure') }, shuffleRandom: () => 0.5,
  persistRuntimeState: noop, commitRuntimeState: async () => {}, stagePendingSideEffects: noop,
  broadcast: noop, send: noop, phaseFor: () => '', liveMetadataFor: () => ({}),
  publishTurnStatus: noop, publishState: noop, publishTribute: noop, publishRoundEnded: noop,
  recordRoomAction: noop, reportSpectatorEvent: noop, reportSpectatorAction: noop,
  reportSpectatorRoundEnd: noop, reportCompletedGame: noop, closeRoomWithoutAck: noop,
  log: { error: noop }, scheduleTimeout: timerInto(turnTimers), cancelTimeout: id => turnTimers.delete(id) })
try {
  const oldVote = room.dissolveVote
  expiry.scheduleDissolveExpiry(room)
  lifecycle.armTurnDeadline(room)
  const firstTurn = turnTimers.entries().next().value
  turnTimers.delete(firstTurn[0]); firstTurn[1].fn(); await jobs.shift()
  assert.notEqual(room.dissolveVote, oldVote)
  assert.deepEqual(room.dissolveVote, oldVote)
  const scheduled = expiryTimers.entries().next().value
  expiryTimers.delete(scheduled[0]); scheduled[1].fn(); await jobs.shift()
  assert.equal(room.dissolveVote, null)
  assert.equal(expiryTimers.size, 0)
  assert.deepEqual(events, ['committed', 'expired'])
  console.log('SP-03-001: original vote expires after automatic action rollback replaces its object')
} finally { lifecycle.dispose(); expiry.dispose() }
