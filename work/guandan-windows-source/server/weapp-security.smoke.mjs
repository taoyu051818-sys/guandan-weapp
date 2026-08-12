import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createConnection } from 'node:net'
import { spawn } from 'node:child_process'

const port = 39115
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const child = spawn(process.execPath, ['server/weapp-ws.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    WEAPP_WS_PORT: String(port),
    WEAPP_ALLOWED_ORIGINS: 'https://allowed.example',
    WEAPP_MAX_CONNECTIONS: '4',
    WEAPP_MAX_ROOMS: '1',
    WEAPP_COMMAND_RATE_LIMIT: '10',
    WEAPP_COMMAND_RATE_WINDOW_MS: '10000',
  },
  stdio: 'ignore',
})

const sockets = []
let requestId = 1
const connectOnce = () => new Promise((resolve, reject) => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/weapp`)
  socket.addEventListener('open', () => resolve(socket), { once: true })
  socket.addEventListener('error', reject, { once: true })
})
const connect = async () => {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    try {
      return await connectOnce()
    } catch { await delay(40) }
  }
  throw new Error('安全边界测试服务启动超时')
}
const waitFor = (socket, type, predicate = () => true) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`等待 ${type} 超时`)), 3000)
  const listener = ({ data }) => {
    const packet = JSON.parse(data)
    if (packet.type !== type || !predicate(packet)) return
    clearTimeout(timer)
    socket.removeEventListener('message', listener)
    resolve(packet)
  }
  socket.addEventListener('message', listener)
})
const send = (socket, type, payload = {}) => {
  const current = requestId++
  socket.send(JSON.stringify({ type, requestId: current, payload }))
  return current
}
const rawUpgrade = origin => new Promise((resolve, reject) => {
  const socket = createConnection({ host: '127.0.0.1', port }, () => {
    socket.write([
      'GET /weapp HTTP/1.1',
      `Host: 127.0.0.1:${port}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`,
      'Sec-WebSocket-Version: 13',
      `Origin: ${origin}`,
      '',
      '',
    ].join('\r\n'))
  })
  let response = ''
  socket.on('data', chunk => { response += chunk.toString() })
  socket.on('end', () => resolve(response))
  socket.on('error', reject)
})
const rawUpgradeWhenReady = async origin => {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    try {
      return await rawUpgrade(origin)
    } catch (error) {
      if (error?.code !== 'ECONNREFUSED') throw error
      await delay(40)
    }
  }
  throw new Error('安全边界测试服务启动超时')
}

try {
  assert.match(await rawUpgradeWhenReady('https://evil.example'), /^HTTP\/1\.1 403 Forbidden/, '非允许 Origin 必须在升级前拒绝')

  for (let index = 0; index < 4; index += 1) sockets.push(await connect())
  await assert.rejects(() => connectOnce(), '连接总数达到上限后必须拒绝新升级')

  const firstCreateId = requestId
  const firstCreated = waitFor(sockets[0], 'roomCreated', packet => packet.requestId === firstCreateId)
  send(sockets[0], 'createRoom', { roomId: '111111', hostName: '容量测试' })
  await firstCreated

  const secondCreateId = requestId
  const secondRejected = waitFor(sockets[1], 'error', packet => packet.requestId === secondCreateId)
  send(sockets[1], 'createRoom', { roomId: '222222', hostName: '超限房间' })
  assert.equal((await secondRejected).code, 'ROOM_CAPACITY_REACHED')

  const rateLimited = waitFor(sockets[2], 'error', packet => packet.code === 'RATE_LIMITED')
  for (let index = 0; index < 12; index += 1) send(sockets[2], 'listRooms')
  assert.equal((await rateLimited).code, 'RATE_LIMITED')

  console.log('weapp origin, connection, room and rate limits passed')
} finally {
  sockets.forEach(socket => socket.close())
  child.kill('SIGTERM')
}
