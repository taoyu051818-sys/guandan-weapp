import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

const port = 39102
const child = spawn(process.execPath, ['server/weapp-ws.js'], { cwd: process.cwd(), env: { ...process.env, WEAPP_WS_PORT: String(port) }, stdio: 'ignore' })
const sockets = []
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const connect = () => new Promise((resolve, reject) => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/weapp`)
  socket.addEventListener('open', () => resolve(socket), { once: true })
  socket.addEventListener('error', reject, { once: true })
})
const message = (socket, type, matches = () => true) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`等待 ${type} 超时`)), 3000)
  const handler = ({ data }) => { const payload = JSON.parse(data); if (payload.type === type && matches(payload)) { clearTimeout(timer); socket.removeEventListener('message', handler); resolve(payload) } }
  socket.addEventListener('message', handler)
})
const send = (socket, type, payload) => socket.send(JSON.stringify({ type, payload }))

try {
  await delay(300)
  for (let i = 0; i < 4; i += 1) sockets.push(await connect())
  const created = message(sockets[0], 'roomCreated')
  send(sockets[0], 'createRoom', { roomId: '314159', hostName: '集成测试' })
  await created
  for (let i = 1; i < 4; i += 1) { const joined = message(sockets[i], 'roomJoined'); send(sockets[i], 'joinRoom', { roomId: '314159' }); await joined }
  const initial = message(sockets[0], 'gameState')
  send(sockets[0], 'startGame', { roomId: '314159' })
  const state = await initial
  assert.equal(state.state.players.p1.hand.length, 27)
  assert.equal(state.state.players.p2.hand[0].rank, undefined, '不应向 p1 泄露 p2 手牌')
  const nextState = message(sockets[1], 'gameState', payload => payload.state.playArea.length === 1)
  send(sockets[0], 'play', { roomId: '314159', cardIds: [state.state.players.p1.hand[0].id] })
  const afterPlay = await nextState
  assert.equal(afterPlay.state.currentTurn, 'p2')
  const receivedChat = message(sockets[0], 'chat')
  send(sockets[2], 'chat', { roomId: '314159', text: '集成测试消息' })
  assert.equal((await receivedChat).text, '集成测试消息')
  const members = message(sockets[0], 'roomMembers', payload => !payload.memberPlayerIds.includes('p2'))
  send(sockets[1], 'leaveRoom', { roomId: '314159' })
  assert.deepEqual((await members).memberPlayerIds, ['p1', 'p3', 'p4'])
  console.log('weapp websocket integration passed')
} finally {
  sockets.forEach(socket => socket.close())
  child.kill('SIGTERM')
}
