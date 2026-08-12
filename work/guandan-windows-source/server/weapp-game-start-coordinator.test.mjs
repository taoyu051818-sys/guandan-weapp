import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createWeAppGameStartCoordinator } from './weapp-game-start-coordinator.js'

const playerIds = ['p1', 'p2', 'p3', 'p4']
let clock = 1_000
let nextTimerId = 1
let rejectCommit = false
const timers = new Map()
const cancelled = []
const events = []
const rooms = new Map()
const acceptedActions = new Map()
const connections = new Map([['host', { id: 'host' }]])
const scheduleTimeout = (callback, delay) => {
  const timer = { id: nextTimerId++, unref () {} }
  timers.set(timer, { callback, delay })
  return timer
}
const cancelTimeout = timer => {
  cancelled.push(timer.id)
  timers.delete(timer)
}

const coordinator = createWeAppGameStartCoordinator({
  playerIds,
  rooms,
  connections,
  acceptedActions,
  emptyRoomTimeoutMs: 3_000,
  isShuttingDown: () => false,
  isFriendRoom: () => false,
  isMatchRoom: () => true,
  seatHasLiveConnection: () => true,
  enqueueServerOperation: operation => Promise.resolve().then(operation),
  commitRuntimeState: async () => {
    events.push('commit')
    if (rejectCommit) throw new Error('disk unavailable')
  },
  persistRuntimeState: () => events.push('persist'),
  spectatorEventReporter: { claimStart: async () => events.push('claim') },
  initializeRoomMatch: room => {
    events.push('initialize')
    room.state = { phase: 'playing' }
    room.gameVersion = 1
  },
  armMatchDuration: () => events.push('arm-match'),
  armTurnDeadline: () => events.push('arm-turn'),
  closeRoomWithoutAck: async () => events.push('close'),
  publishRoomMembers: () => events.push('members'),
  publishLobbyReady: () => events.push('ready'),
  publishState: () => events.push('publish'),
  rememberAccepted: (key, fingerprint, response) => {
    events.push('remember')
    acceptedActions.set(key, { fingerprint, response })
  },
  send: (_, type) => events.push(`send:${type}`),
  now: () => clock,
  scheduleTimeout,
  cancelTimeout,
})

const room = {
  roomId: '123456',
  matchId: 'match-1',
  version: 0,
  gameVersion: 0,
  spectatorSequence: 0,
  pendingSpectatorEvents: [],
  pendingGameStartEvent: null,
  pendingGameStartRequest: { cacheKey: 'start:1', fingerprint: 'fp', requestId: 7 },
  entryDeadlineAt: clock + 10_000,
  ticketBound: true,
  seats: { p1: 'host', p2: 'guest-2', p3: 'guest-3', p4: 'guest-4' },
}
rooms.set(room.roomId, room)

const event = coordinator.prepare(room)
assert.equal(coordinator.prepare(room), event, 'preparing an existing claim must be idempotent')
assert.equal(room.version, 1)
assert.equal(room.spectatorSequence, 1)

rejectCommit = true
await assert.rejects(coordinator.persistClaimedStart(room, event), /disk unavailable/)
assert.equal(room.gameStartClaimedAt, undefined, 'failed marker persistence must roll back the claim')
assert.equal(room.gameStartReconnectDeadlineAt, undefined)

rejectCommit = false
assert.equal(await coordinator.persistClaimedStart(room, event), true)
assert.equal(room.gameStartClaimedAt, clock)
assert.equal(room.gameStartReconnectDeadlineAt, clock + 3_000)

events.length = 0
assert.deepEqual(await coordinator.finalizeClaimedStart(room, event), { status: 'started' })
assert.deepEqual(events, ['initialize', 'remember', 'commit', 'arm-match', 'arm-turn', 'persist', 'send:actionAccepted', 'publish'])
assert.equal(room.pendingGameStartEvent, null)
assert.equal(room.pendingGameStartRequest, null)
assert.equal(acceptedActions.get('start:1').response.requestId, 7)

const waitingRoom = {
  ...room,
  roomId: '654321',
  matchId: 'match-2',
  state: null,
  ticketBound: true,
  entryDeadlineAt: clock + 2_000,
  pendingGameStartEvent: null,
  gameStartClaimedAt: null,
  gameStartReconnectDeadlineAt: null,
}
rooms.set(waitingRoom.roomId, waitingRoom)
coordinator.prepare(waitingRoom)
coordinator.scheduleEntryDeadline(waitingRoom)
coordinator.scheduleClaim(waitingRoom, 250)
assert.equal(timers.size, 2, 'entry and claim timers are lifecycle-owned')
coordinator.removeRoom(waitingRoom)
assert.equal(timers.size, 0)
assert.equal(cancelled.length >= 2, true)
coordinator.dispose()

const rootSource = readFileSync(new URL('./weapp-ws.js', import.meta.url), 'utf8')
assert.doesNotMatch(rootSource, /const claimTimers = new Map/)
assert.doesNotMatch(rootSource, /const entryDeadlineTimers = new Map/)

console.log('weapp game-start coordinator tests passed')
