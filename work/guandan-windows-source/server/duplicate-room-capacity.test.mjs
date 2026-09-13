import assert from 'node:assert/strict'
import { DuplicateRoomRuntime } from './duplicate-room-runtime.js'
import { GameTicketService, GameTicketVerifier } from './platform/crypto.js'
import { normalizeFriendRoomSettings } from './friend-room-settings.js'

const secret = 'synthetic-capacity-test-secret', now = Date.now(), connections = new Map()
const tickets = new GameTicketService({ secret, gameEndpoint: 'ws://127.0.0.1:1/weapp' })
const settings = normalizeFriendRoomSettings({ format: 'duplicate' })
const runtime = new DuplicateRoomRuntime({ connections, filePath: '', maxRooms: 64, now: () => now,
  send: (c, type, p) => c.packets.push({ type, ...p }), verifier: new GameTicketVerifier({ secret, required: true }),
  reporter: { configured: true, enqueue: async () => {}, claimStart: async () => {} } })
clearInterval(runtime.timer)
let sequence = 0
const command = async (c, type, payload) => { const requestId = ++sequence; await runtime.handle(c, { type, requestId, payload }); return c.packets.findLast(p => p.requestId === requestId) }
const entry = (roomId, c) => { const ticket = tickets.issue({ userId: c.id, roomId, matchId: `capacity-${roomId}`, seat: 'p1',
  roomKind: 'friend', roomSettings: settings, roomExpiresAt: now + 600000, hostUserId: c.id });
  return { roomId, gameTicket: ticket.gameTicket, entryAttemptId: ticket.claims.entryAttemptId } }
try {
  const closedHost = { id: 'closed-host', packets: [] }; connections.set(closedHost.id, closedHost)
  const closedTicket = entry('960000', closedHost)
  assert.equal((await command(closedHost, 'createRoom', closedTicket)).type, 'roomCreated')
  assert.equal((await command(closedHost, 'safeExit', { roomId: '960000' })).type, 'roomLeft')
  assert.equal(runtime.rooms.get('960000').phase, 'closed')
  for (let i = 1; i <= 64; i++) {
    const c = { id: `host-${i}`, packets: [] }; connections.set(c.id, c)
    assert.equal((await command(c, 'createRoom', entry(String(960000 + i), c))).type, 'roomCreated')
  }
  assert.equal(runtime.rooms.size, 65, 'audit tombstones stay retained but do not consume active room quota')
  const extra = { id: 'extra-host', packets: [] }; connections.set(extra.id, extra)
  const denied = await command(extra, 'createRoom', entry('960065', extra))
  assert.equal(denied.type, 'error'); assert.match(denied.message, /房间已满/)
  assert.equal((await command(closedHost, 'createRoom', closedTicket)).type, 'error', 'old signed ticket cannot recreate a closed room')
} finally { await runtime.dispose() }
console.log('SD-04-003: closed tombstone retained; 64 active rooms admitted; the 65th is rejected')
