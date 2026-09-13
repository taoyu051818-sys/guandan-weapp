import assert from 'node:assert/strict'
import { DuplicateRoomRuntime } from './duplicate-room-runtime.js'
import { GameTicketService, GameTicketVerifier } from './platform/crypto.js'
import { normalizeFriendRoomSettings } from './friend-room-settings.js'
const secret = 'audit-synthetic-secret-not-used-outside-this-probe'
const now = Date.now(), connections = new Map()
const tickets = new GameTicketService({ secret, gameEndpoint: 'ws://127.0.0.1:1/weapp' })
const settings = normalizeFriendRoomSettings({ format: 'duplicate' })
const runtime = new DuplicateRoomRuntime({ connections, filePath: '', now: () => now,
  send: (c, type, payload) => c.packets.push({ type, ...payload }), verifier: new GameTicketVerifier({ secret, required: true }),
  reporter: { configured: true, claimStart: async () => {}, enqueue: async () => {} } })
clearInterval(runtime.timer)
const connection = id => { const c = { id, packets: [] }; connections.set(id, c); return c }
let requestId = 0
const cmd = async (c, type, payload) => { const id = ++requestId; await runtime.handle(c, { type, requestId: id, payload }); return c.packets.findLast(p => p.requestId === id) }
const enter = async (c, roomId, userId, seat = 'p1') => { const ticket = tickets.issue({ userId, roomId, matchId: `audit_${roomId}`, seat, roomKind: 'friend', roomSettings: settings, roomExpiresAt: now + 600000, hostUserId: `host_${roomId}` }); const payload = { roomId, gameTicket: ticket.gameTicket, entryAttemptId: ticket.claims.entryAttemptId }; return { reply: await cmd(c, 'joinRoom', payload), payload } }
try {
  const old = connection('audit-old'), entry = await enter(old, '908041', 'host_908041')
  assert.equal(entry.reply.type, 'roomJoined')
  const token = entry.reply.resumeToken, save = runtime.store.save.bind(runtime.store)
  runtime.store.save = async () => { throw new Error('synthetic one-shot disk failure') }
  await assert.rejects(runtime.disconnected(old), /one-shot/)
  connections.delete(old.id) // weapp-ws close handler deletes the physical connection even when disconnected rejects
  runtime.store.save = save
  const other = await enter(connection('audit-other-room'), '908042', 'host_908042')
  assert.equal(other.reply.type, 'roomJoined') // a later real entry/commit succeeds after storage recovers
  await runtime.serial(() => runtime.tick())
  const fresh = connection('audit-new')
  const resumed = await cmd(fresh, 'rejoinRoom', { roomId: '908041', resumeToken: token })
  const denied = await cmd(connection('audit-simultaneous'), 'rejoinRoom', { roomId: '908041', resumeToken: token })
  assert.equal(denied.type, 'error'); assert.match(denied.message, /账号已在线/)
  await runtime.disconnected(fresh); connections.delete(fresh.id)
  const reticketed = await cmd(connection('audit-ticket-recovery'), 'joinRoom', entry.payload)
  assert.equal(resumed.type, 'roomRejoined')
  assert.equal(reticketed.type, 'roomJoined')
  await runtime.disconnected(old)
  assert.equal(runtime.rooms.get('908041').members[0].connectionId, 'audit-ticket-recovery')
  assert.equal(connections.has(old.id), false)
  console.log('SD-04-001: failed disconnect save permits valid token/ticket recovery; double online and stale disconnect remain rejected')
} finally { await runtime.dispose() }
