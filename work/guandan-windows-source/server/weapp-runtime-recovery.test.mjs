import assert from 'node:assert/strict'
import { restoreWeAppRuntime } from './weapp-runtime-recovery.js'

const clock = 50_000
const calls = []
const rooms = new Map()
const acceptedActions = new Map()
const closedRoomTombstones = new Map()
const rawRoom = {
  roomId: '123456',
  resumeTokens: { p1: null, p2: null, p3: null, p4: null },
  version: 2,
  gameVersion: 0,
  state: null,
  pendingGameStartEvent: null,
  ticketBound: false,
}
const roomStateStore = {
  configured: true,
  filePath: '/tmp/weapp-state.json',
  load: () => ({
    acceptedActions: [['resume:1', { fingerprint: 'fp', response: { requestId: 1 }, pendingDurability: true }]],
    closedRoomTombstones: [
      { roomId: '111111', matchId: 'live', until: clock + 1 },
      { roomId: '222222', matchId: 'expired', until: clock - 1 },
    ],
    rooms: [rawRoom],
  }),
}

const restored = await restoreWeAppRuntime({
  roomStateStore,
  rooms,
  acceptedActions,
  closedRoomTombstones,
  maxAcceptedActions: 50,
  playerIds: ['p1', 'p2', 'p3', 'p4'],
  roomFromPersistence: room => structuredClone(room),
  migrateLegacyMatchState: () => { throw new Error('inactive room must not migrate match state') },
  ensureTicketBindings: () => calls.push('tickets'),
  ensureLobbyMetadata: () => calls.push('lobby'),
  ensureLiveMetadata: () => calls.push('live'),
  rulePresetForRoom: () => 'classic',
  ruleProfileForRoom: () => ({}),
  syncRoomFromMatchState: () => {},
  botPolicyForRoom: () => {},
  resetRoomBotPolicy: () => {},
  stagePendingSideEffects: () => calls.push('side-effects'),
  rememberClosedRoomTombstone: () => {},
  removeRoomBotPolicy: () => {},
  scheduleDissolveExpiry: () => {},
  schedulePendingRoundFinalization: () => {},
  gameStartCoordinator: {
    restoreClaim: () => calls.push('restore-claim'),
    scheduleEntryDeadline: () => {},
    scheduleClaim: () => {},
  },
  restoreTurnDeadline: () => {},
  armMatchDuration: () => {},
  scheduleEmptyRoomExpiry: () => {},
  scheduleHostExpiry: (roomId, delay) => calls.push(`host:${roomId}:${delay}`),
  commitRuntimeState: async () => calls.push('commit'),
  now: () => clock,
  log: { log: message => calls.push(message), warn: () => {} },
})

assert.equal(restored, 1)
assert.equal(rooms.get('123456').rulePreset, 'classic')
assert.deepEqual(acceptedActions.get('resume:1'), { fingerprint: 'fp', response: { requestId: 1 }, pendingDurability: false })
assert.equal(closedRoomTombstones.has('111111'), true)
assert.equal(closedRoomTombstones.has('222222'), false)
assert.deepEqual(calls.slice(0, 7), ['tickets', 'lobby', 'live', 'restore-claim', 'side-effects', 'host:123456:15000', 'commit'])
assert.match(calls.at(-1), /Restored 1 WeApp room/)

let disabledLoadCalled = false
assert.equal(await restoreWeAppRuntime({
  roomStateStore: { configured: false, load: () => { disabledLoadCalled = true } },
}), 0)
assert.equal(disabledLoadCalled, false)

console.log('weapp runtime recovery tests passed')
