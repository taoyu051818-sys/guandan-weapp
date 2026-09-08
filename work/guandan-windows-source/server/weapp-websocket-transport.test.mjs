import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import {
  frameTextMessage,
  isProtocolUpgradeRequest,
  sendProtocolMessage,
  upgradeToProtocolConnection,
} from './weapp-websocket-transport.js'

class TestSocket extends EventEmitter {
  constructor() {
    super()
    this.destroyed = false
    this.ended = false
    this.writes = []
  }

  write(data) {
    this.writes.push(Buffer.isBuffer(data) ? data : Buffer.from(data))
    return true
  }

  end(data) {
    if (data) this.write(data)
    this.ended = true
  }

  destroy() {
    this.destroyed = true
  }
}

const request = (overrides = {}) => ({
  url: '/weapp',
  headers: {
    upgrade: 'websocket',
    'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
    ...overrides,
  },
})

const maskedClientFrame = (payload, opcode = 1) => {
  const body = Buffer.from(payload)
  const mask = Buffer.from([1, 2, 3, 4])
  const header = body.length < 126
    ? Buffer.from([0x80 | opcode, 0x80 | body.length])
    : Buffer.from([0x80 | opcode, 0x80 | 126, body.length >> 8, body.length & 255])
  const masked = Buffer.from(body)
  for (let index = 0; index < body.length; index += 1) masked[index] ^= mask[index % mask.length]
  return Buffer.concat([header, mask, masked])
}

assert.deepEqual([...frameTextMessage('ok')], [0x81, 2, 111, 107])
assert.throws(() => frameTextMessage('x'.repeat(65536)), /WebSocket 消息过大/)
assert.equal(isProtocolUpgradeRequest(request()), true)
assert.equal(isProtocolUpgradeRequest({ ...request(), url: '/other' }), false)
assert.equal(isProtocolUpgradeRequest(request({ upgrade: 'h2c' })), false)

{
  const socket = new TestSocket()
  sendProtocolMessage({ socket }, 'ready', { version: 3 })
  assert.equal(socket.writes.length, 1)
  assert.equal(socket.writes[0].subarray(2).toString(), JSON.stringify({ type: 'ready', version: 3 }))
}

{
  const socket = new TestSocket()
  const messages = []
  const opened = []
  const connection = upgradeToProtocolConnection({
    request: request(),
    socket,
    allowedOrigins: [],
    connectionCount: 0,
    maxConnections: 10,
    maxMessageBytes: 2048,
    createConnectionId: () => 'w-test',
    onOpen: value => opened.push(value),
    onMessage: (_, message) => messages.push(message),
    onInvalidMessage: () => assert.fail('valid message rejected'),
    onClose: () => {},
  })
  assert.equal(connection.id, 'w-test')
  assert.equal(opened[0], connection)
  assert.match(socket.writes[0].toString(), /^HTTP\/1\.1 101 Switching Protocols/)
  socket.emit('data', maskedClientFrame(JSON.stringify({ type: 'listRooms', requestId: 1 })))
  assert.deepEqual(messages, [{ type: 'listRooms', requestId: 1 }])
}

{
  const socket = new TestSocket()
  const rejected = upgradeToProtocolConnection({
    request: request({ origin: 'https://blocked.example' }),
    socket,
    allowedOrigins: ['https://allowed.example'],
    connectionCount: 0,
    maxConnections: 10,
    maxMessageBytes: 2048,
    createConnectionId: () => 'unused',
    onOpen: () => assert.fail('blocked origin opened'),
    onMessage: () => {},
    onInvalidMessage: () => {},
    onClose: () => {},
  })
  assert.equal(rejected, null)
  assert.equal(socket.ended, true)
  assert.match(socket.writes[0].toString(), /403 Forbidden/)
}

{
  const socket = new TestSocket()
  let invalidMessages = 0
  upgradeToProtocolConnection({
    request: request(),
    socket,
    allowedOrigins: [],
    connectionCount: 0,
    maxConnections: 10,
    maxMessageBytes: 2048,
    createConnectionId: () => 'w-invalid',
    onOpen: () => {},
    onMessage: () => assert.fail('invalid JSON parsed'),
    onInvalidMessage: () => { invalidMessages += 1 },
    onClose: () => {},
  })
  socket.emit('data', maskedClientFrame('{'))
  assert.equal(invalidMessages, 1)
}

console.log('weapp websocket transport tests passed')
