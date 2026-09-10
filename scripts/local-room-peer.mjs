import { performance } from 'node:perf_hooks'
import { sendProtocolCommand } from '../work/guandan-windows-source/server/weapp-smoke-protocol.mjs'

/** Test-only WebSocket peer. No remote URL can be supplied by the caller. */
export async function localPeer (port, timings) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/weapp`)
  const pending = new Map()
  let sequence = 0
  let state = null
  const settle = (requestId, error, packet) => {
    const request = pending.get(requestId)
    if (!request) return
    pending.delete(requestId)
    clearTimeout(request.timer)
    if (error) request.reject(error)
    else { timings.push(performance.now() - request.started); request.resolve(packet) }
  }
  socket.addEventListener('message', ({ data }) => {
    const packet = JSON.parse(data)
    if (packet.state) state = packet
    if (packet.type === 'error') settle(packet.requestId, new Error(`${packet.code || 'ERROR'}: ${packet.message}`))
    else if (pending.get(packet.requestId)?.type === packet.type) settle(packet.requestId, null, packet)
  })
  socket.addEventListener('close', () => {
    for (const id of pending.keys()) settle(id, new Error('Local load-test connection closed'))
  })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('Local WebSocket open timeout')) }, 5000)
    socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Local WebSocket failed')) }, { once: true })
  })
  return {
    get state () { return state },
    close: () => socket.close(),
    command (command, payload, type = 'actionAccepted') {
      const requestId = ++sequence
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => settle(requestId, new Error(`${command} acknowledgement timeout`)), 10000)
        pending.set(requestId, { type, timer, resolve, reject, started: performance.now() })
        try { sendProtocolCommand(socket, command, payload, requestId) }
        catch (error) { settle(requestId, error) }
      })
    },
  }
}

export async function until (condition, label, timeout = 10000) {
  const deadline = Date.now() + timeout
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`${label} timeout`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
