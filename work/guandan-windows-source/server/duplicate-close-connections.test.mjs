import assert from 'node:assert/strict'
import { DuplicateRoomRuntime } from './duplicate-room-runtime.js'
import { GameTicketService, GameTicketVerifier } from './platform/crypto.js'
import { normalizeFriendRoomSettings } from './friend-room-settings.js'
const secret = 'audit-synthetic-secret-not-used-outside-this-probe', now = Date.now(), connections = new Map()
const tickets = new GameTicketService({ secret, gameEndpoint: 'ws://127.0.0.1:1/weapp' })
const settings = normalizeFriendRoomSettings({ format: 'duplicate' })
const runtime = new DuplicateRoomRuntime({ connections, filePath: '', now: () => now,
  send: (c, type, payload) => c.packets.push({ type, ...payload }), verifier: new GameTicketVerifier({ secret, required: true }),
  reporter: { configured: true, claimStart: async () => {}, enqueue: async () => {} } })
clearInterval(runtime.timer)
const connection = id => { const c = { id, packets: [] }; connections.set(id, c); return c }
let requestId = 0
const cmd = async (c, type, payload) => { const id = ++requestId; await runtime.handle(c, { type, requestId: id, payload }); return c.packets.findLast(p => p.requestId === id) }
const issue = (roomId, userId, seat) => { const ticket = tickets.issue({ userId, roomId, matchId: `audit_${roomId}`, seat, roomKind: 'friend', roomSettings: settings, roomExpiresAt: now + 600000, hostUserId: `host_${roomId}` }); return { roomId, gameTicket: ticket.gameTicket, entryAttemptId: ticket.claims.entryAttemptId } }
try {
  const host = connection('audit-host'), guest = connection('audit-guest'), roomId = '908043'
  assert.equal((await cmd(host, 'createRoom', issue(roomId, `host_${roomId}`, 'p1'))).type, 'roomCreated')
  assert.equal((await cmd(guest, 'joinRoom', issue(roomId, 'audit_guest_user', 'p2'))).type, 'roomJoined')
  assert.equal((await cmd(host, 'safeExit', { roomId })).type, 'roomLeft')
  assert.ok(guest.packets.some(p => p.type === 'roomDissolved' && p.roomId === roomId))
  assert.equal(host.roomId, null); assert.equal(guest.roomId, null); assert.equal(guest.duplicateRoomId, null)
  assert.equal(runtime.owns(guest, { type: 'joinRoom', payload: { roomId: '999991', roomSettings: { format: 'independent' } } }), false)
  const nextPayload = issue('908044', 'host_908044', 'p1')
  const nextRoom = await cmd(guest, 'createRoom', nextPayload)
  const leaveClosed = await cmd(host, 'safeExit', { roomId })
  assert.equal(nextRoom.type, 'roomCreated')
  assert.equal(leaveClosed.type, 'error') // Old-room actions cannot reclaim the detached connection.
  const normalRoomRequestStillRoutedDuplicate = runtime.owns(guest, { type: 'joinRoom', payload: { roomId: '999991', roomSettings: { format: 'independent' } } })
  assert.equal(normalRoomRequestStillRoutedDuplicate, true)
  await runtime.disconnected(guest); connections.delete(guest.id)
  const fresh = connection('audit-guest-fresh')
  const afterReconnect = await cmd(fresh, 'createRoom', nextPayload)
  assert.equal(afterReconnect.type, 'roomCreated')
  console.log('SD-04-002: host close releases guest connection; first same-connection entry succeeds')
} finally { await runtime.dispose() }
