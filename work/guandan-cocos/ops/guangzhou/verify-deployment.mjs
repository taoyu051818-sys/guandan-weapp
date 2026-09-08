import assert from 'node:assert/strict'
import https from 'node:https'

const origin = 'https://api.yutechhn.cn'
const base = `${origin}/guandan`
for (const [path, method, expected] of [
  ['/api/v1/health', 'GET', 200],
  ['/api/v1/profile', 'GET', 401],
  ['/api/v1/auth/dev-login', 'POST', 403],
  ['/', 'GET', 200],
]) {
  const response = await fetch(`${base}${path}`, {
    method,
    ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: '{}' } : {}),
    signal: AbortSignal.timeout(15000),
  })
  assert.equal(response.status, expected, `${method} ${path}`)
  await response.arrayBuffer()
  console.log(`${method} ${path}: HTTP ${expected}`)
}

await new Promise((resolve, reject) => {
  const ws = new WebSocket('wss://api.yutechhn.cn/guandan/weapp')
  const timeout = setTimeout(() => { ws.close(); reject(new Error('WSS protocol check timed out')) }, 10000)
  ws.addEventListener('open', () => {
    // An unsupported, non-mutating command checks protocol routing without
    // creating users, rooms or matches in the live service.
    ws.send(JSON.stringify({ type: 'deploymentHealthProbe', requestId: 'deployment-health', payload: {} }))
  })
  ws.addEventListener('message', event => {
    try {
      const response = JSON.parse(event.data)
      assert.equal(response.type, 'error')
      clearTimeout(timeout)
      ws.close()
      console.log('WSS TLS + upgrade + application protocol: PASS')
      resolve()
    } catch (error) { clearTimeout(timeout); ws.close(); reject(error) }
  }, { once: true })
  ws.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('WSS connection failed')) }, { once: true })
})

await new Promise((resolve, reject) => {
  const request = https.request(`${base}/weapp`, {
    headers: {
      Connection: 'Upgrade', Upgrade: 'websocket',
      'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      Origin: 'https://untrusted.example',
    },
  }, response => {
    response.resume()
    try {
      assert.equal(response.statusCode, 403)
      console.log('Untrusted WebSocket Origin: HTTP 403')
      resolve()
    } catch (error) { reject(error) }
  })
  request.on('upgrade', (_response, socket) => { socket.destroy(); reject(new Error('Untrusted Origin was accepted')) })
  request.on('error', reject)
  request.setTimeout(10000, () => request.destroy(new Error('Origin check timed out')))
  request.end()
})
console.log('Deployment transport/auth boundaries verified; real wx.login and four-device gameplay remain manual acceptance items.')
