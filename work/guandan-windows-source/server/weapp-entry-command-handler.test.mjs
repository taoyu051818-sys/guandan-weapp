import assert from 'node:assert/strict'
import { createEntryCommandHandler } from './weapp-entry-command-handler.js'

const replies = []
const rooms = new Map()
let ticketConsumes = 0
let releases = 0
const handler = createEntryCommandHandler({
  ids: ['p1', 'p2', 'p3', 'p4'],
  rooms,
  acceptedActions: new Map(),
  maxRooms: 10,
  inspectEntryTicket: () => ({ claims: null, consumed: false }),
  ticketBlockedByClosedRoom: () => false,
  normalizeEntryAttemptId: value => value,
  pendingSeatReleaseFor: () => false,
  actionFingerprint: () => 'fingerprint',
  entryConflictFor: () => null,
  reserveAccepted: () => false,
  releaseAccepted: () => { releases += 1 },
  gameTicketVerifier: { consume: () => { ticketConsumes += 1 } },
})

await handler({
  type: 'createRoom',
  requestId: 7,
  connection: { id: 'capacity-connection', acceptedCacheKeys: new Map() },
  payload: {
    roomId: '123456',
    entryAttemptId: 'entry_attempt_capacity_7',
    roomSettings: { mode: 'classic' },
  },
  reply: (type, payload) => replies.push({ type, payload }),
})

assert.equal(replies[0].payload.code, 'IDEMPOTENCY_CAPACITY_REACHED')
assert.equal(rooms.size, 0, 'capacity rejection must happen before a room or seat is created')
assert.equal(ticketConsumes, 0, 'capacity rejection must happen before consuming an entry credential')
assert.equal(releases, 0, 'a failed reservation must not release a key it never acquired')

console.log('weapp entry command handler tests passed')
