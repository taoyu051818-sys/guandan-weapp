// Additional audit-only transport and test-helper boundary checks.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { frameTextMessage, upgradeToProtocolConnection } from '../../../../work/guandan-windows-source/server/weapp-websocket-transport.js'
import { sendProtocolCommand, gameVersionFor } from '../../../../work/guandan-windows-source/server/weapp-smoke-protocol.mjs'
class Socket extends EventEmitter {
  constructor () { super(); this.writes = []; this.destroyed = false; this.ended = false }
  write (b) { this.writes.push(Buffer.from(b)); return true }
  end () { this.ended = true }
  destroy () { this.destroyed = true }
}
const frame = (body, { opcode = 1, final = true, masked = true } = {}) => {
  body = Buffer.from(body)
  const mask = Buffer.from([0x32, 0x91, 0xA1, 0x12])
  const prefix = Buffer.from(body.length < 126 ? [(final ? 128 : 0) | opcode, (masked ? 128 : 0) | body.length]
    : [(final ? 128 : 0) | opcode, (masked ? 128 : 0) | 126, body.length >> 8, body.length & 255])
  return Buffer.concat([prefix, ...(masked ? [mask, Buffer.from(body.map((v, i) => v ^ mask[i % 4]))] : [body])])
}
const open = (options = {}) => {
  const socket = new Socket(), messages = [], state = { invalid: 0, closed: 0 }
  const connection = upgradeToProtocolConnection({
    request: { url: '/weapp', headers: { upgrade: 'websocket', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', origin: 'https://audit.example' } },
    socket, allowedOrigins: ['https://audit.example'], connectionCount: 0, maxConnections: 4, maxMessageBytes: 1024,
    createConnectionId: () => 'audit-connection', onOpen: () => {}, onMessage: (_, m) => messages.push(m),
    onInvalidMessage: () => { state.invalid++ }, onClose: () => { state.closed++ }, ...options,
  })
  return { socket, messages, state, connection }
}
let segmentationCases = 0
for (const length of [0, 4, 120, 126, 500]) {
  const value = { text: 'x'.repeat(length) }, bytes = frame(JSON.stringify(value))
  for (let split = 0; split <= bytes.length; split++) {
    const t = open()
    t.socket.emit('data', bytes.subarray(0, split))
    t.socket.emit('data', bytes.subarray(split))
    assert.deepEqual(t.messages, [value]); assert.equal(t.connection.buffer.length, 0)
    assert.equal(t.socket.destroyed, false)
    segmentationCases++
  }
  const t = open(); for (const byte of bytes) t.socket.emit('data', Buffer.from([byte]))
  assert.deepEqual(t.messages, [value]); segmentationCases++
}
const combined = open(), values = Array.from({ length: 100 }, (_, i) => ({ id: i }))
combined.socket.emit('data', Buffer.concat(values.map(v => frame(JSON.stringify(v)))))
assert.deepEqual(combined.messages, values); assert.equal(combined.connection.buffer.length, 0)
const limits = []
for (const spec of [
  { name: 'unmasked', body: '{}', options: { masked: false } },
  { name: 'fragmented-unsupported', body: '{}', options: { final: false } },
  { name: 'binary-unsupported', body: '{}', options: { opcode: 2 } },
  { name: 'oversize-data', body: 'x'.repeat(1025), options: {} },
  { name: 'oversize-ping', body: 'x'.repeat(126), options: { opcode: 9 } },
]) {
  const t = open(); t.socket.emit('data', frame(spec.body, spec.options))
  assert.equal(t.socket.destroyed, true, spec.name); assert.equal(t.messages.length, 0); limits.push(spec.name)
}
const invalidThenValid = open()
invalidThenValid.socket.emit('data', Buffer.concat([frame('{'), frame('{"ok":true}')]))
assert.equal(invalidThenValid.state.invalid, 1); assert.deepEqual(invalidThenValid.messages, [{ ok: true }])
const ping = open(); ping.socket.emit('data', frame('hello', { opcode: 9 }))
assert.deepEqual(ping.socket.writes.at(-1), Buffer.from([0x8a, 5, ...Buffer.from('hello')]))
ping.socket.emit('data', frame('hello', { opcode: 10 })); assert.equal(ping.messages.length, 0)
ping.socket.emit('data', frame('', { opcode: 8 })); assert.equal(ping.socket.ended, true)
ping.socket.emit('close'); assert.equal(ping.state.closed, 1)
const capacity = open({ connectionCount: 4 })
assert.equal(capacity.connection, null); assert.match(capacity.socket.writes.length ? capacity.socket.writes[0].toString() : '', /^$/)
// The fake end does not retain payload; existing transport test separately checks HTTP 403 payload.
for (const length of [0, 1, 125, 126, 65535]) {
  const b = frameTextMessage('x'.repeat(length)); assert.equal(b.length, length + (length < 126 ? 2 : 4))
}
assert.throws(() => frameTextMessage('x'.repeat(65536)))
class Peer extends EventTarget {
  packets = []
  send (text) { this.packets.push(JSON.parse(text)) }
  receive (roomId, gameVersion) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ roomId, gameVersion }) })) }
}
const a = new Peer(), b = new Peer(), roomId = 'audit-helper-room'
sendProtocolCommand(a, 'listRooms', {}, 1); sendProtocolCommand(b, 'listRooms', {}, 2)
a.receive(roomId, 7); b.receive(roomId, 9)
sendProtocolCommand(a, 'play', { roomId, cardIds: ['synthetic-card'] }, 3)
assert.equal(a.packets.at(-1).payload.expectedVersion, 9, 'existing smoke helper borrows another client latest revision')
sendProtocolCommand(a, 'play', { roomId, expectedVersion: 7, cardIds: ['synthetic-card'] }, 4)
assert.equal(a.packets.at(-1).payload.expectedVersion, 7, 'explicit stale revision remains testable')
console.log('AUDIT32_PROBE=' + JSON.stringify({
  segmentationCases, combinedFrames: values.length, rejectionControls: limits,
  controlFrames: ['ping', 'pong', 'close'], frameLengthControls: 6, invalidJsonThenValid: true,
  smokeHelper: { ownReceivedVersion: 7, borrowedDefaultVersion: gameVersionFor(a, roomId), explicitStalePreserved: 7,
    limit: 'shared room cache makes this helper unsuitable for proving independent stale-client behavior; not production client code' },
  limits: 'Not RFC conformance, full network fuzzing, denial-of-service capacity or browser/WeChat validation.',
}))
