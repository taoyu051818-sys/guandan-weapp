import assert from 'node:assert/strict'
import { createCommandGateway } from './weapp-command-gateway.js'

const replies = []
const connection = { id: 'c1', roomId: null, acceptedCacheKeys: new Map() }
let routedContext = null
const reservations = []
const gateway = createCommandGateway({
  rooms: new Map(),
  acceptedActions: new Map(),
  idempotentActionTypes: new Set(['play']),
  actionCacheKey: () => null,
  actionFingerprint: () => 'fingerprint',
  validateCommandRequestId: (_, requestId) => Number.isSafeInteger(requestId) ? null : { code: 'INVALID_REQUEST_ID' },
  validateExpectedVersion: () => null,
  playerIn: () => null,
  isFriendRoom: () => true,
  finalizePendingRound: async () => {},
  scheduleGameStartClaim: () => {},
  commitRuntimeState: async () => {},
  stagePendingSideEffects: () => {},
  publishState: () => {},
  rememberAccepted: () => {},
  reserveAccepted: key => { reservations.push(`reserve:${key}`); return key !== 'full' },
  releaseAccepted: key => reservations.push(`release:${key}`),
  listRooms: () => [{ roomId: '123456' }],
  send: (_, type, payload) => replies.push({ type, payload }),
  router: {
    dispatch: async context => { routedContext = context; return context.type === 'play' },
  },
})

await gateway(connection, { type: 'listRooms', requestId: 1 })
assert.deepEqual(replies.pop(), { type: 'roomList', payload: { requestId: 1, rooms: [{ roomId: '123456' }] } })

await gateway(connection, { type: 'play', requestId: 2, payload: { cardIds: ['a'] } })
assert.equal(routedContext.type, 'play')
assert.deepEqual(routedContext.payload, { cardIds: ['a'] })

await gateway(connection, { type: 'unknown', requestId: 3 })
assert.equal(replies.pop().payload.message, '未知协议消息')

await gateway(connection, { type: 'play' })
assert.equal(replies.pop().payload.code, 'INVALID_REQUEST_ID')

const room = { roomId: '123456', gameVersion: 0 }
const capacityReplies = []
const capacityConnection = { id: 'capacity', roomId: room.roomId, acceptedCacheKeys: new Map() }
const capacityGateway = createCommandGateway({
  rooms: new Map([[room.roomId, room]]),
  acceptedActions: new Map(),
  idempotentActionTypes: new Set(['play']),
  actionCacheKey: () => 'full',
  actionFingerprint: () => 'fingerprint',
  validateCommandRequestId: () => null,
  validateExpectedVersion: () => null,
  playerIn: () => 'p1',
  isFriendRoom: () => true,
  finalizePendingRound: async () => {},
  scheduleGameStartClaim: () => {},
  commitRuntimeState: async () => {},
  stagePendingSideEffects: () => {},
  publishState: () => {},
  rememberAccepted: () => assert.fail('capacity rejection must happen before mutation'),
  reserveAccepted: () => false,
  listRooms: () => [],
  send: (_, type, payload) => capacityReplies.push({ type, payload }),
  router: { dispatch: () => assert.fail('capacity rejection must happen before dispatch') },
})
await capacityGateway(capacityConnection, { type: 'play', requestId: 9, payload: { roomId: room.roomId } })
assert.equal(capacityReplies[0].payload.code, 'IDEMPOTENCY_CAPACITY_REACHED')

let crossRoomDispatched = false
const crossRoomGateway = createCommandGateway({
  rooms: new Map([[room.roomId, room]]),
  acceptedActions: new Map([['other:1', { pendingDurability: true, response: { roomId: '654321' } }]]),
  idempotentActionTypes: new Set(['play']),
  actionCacheKey: () => 'current:1',
  actionFingerprint: () => 'fingerprint',
  validateCommandRequestId: () => null,
  validateExpectedVersion: () => null,
  playerIn: () => 'p1',
  isFriendRoom: () => true,
  finalizePendingRound: async () => {},
  scheduleGameStartClaim: () => {},
  commitRuntimeState: async () => {},
  stagePendingSideEffects: () => {},
  publishState: () => {},
  rememberAccepted: () => {},
  listRooms: () => [],
  send: () => {},
  router: { dispatch: async () => { crossRoomDispatched = true; return true } },
})
await crossRoomGateway(capacityConnection, { type: 'play', requestId: 10, payload: { roomId: room.roomId } })
assert.equal(crossRoomDispatched, true, 'pending durability in another room must not globally block commands')

console.log('weapp command gateway tests passed')
