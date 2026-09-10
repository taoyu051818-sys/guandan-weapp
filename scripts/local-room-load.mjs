import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir, cpus, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { localPeer, until } from './local-room-peer.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
assert.ok(args.length <= 2, 'Usage: node scripts/local-room-load.mjs [rooms:1..16] [actionsPerRoom:1..64]')
const roomCount = Number(args[0] ?? 4)
const actions = Number(args[1] ?? 16)
assert.ok(Number.isInteger(roomCount) && roomCount >= 1 && roomCount <= 16)
assert.ok(Number.isInteger(actions) && actions >= 1 && actions <= 64)
const directory = await mkdtemp(join(tmpdir(), 'guandan-local-load-'))
const probe = createServer()
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
const port = probe.address().port
await new Promise(resolve => probe.close(resolve))
const peers = []
const timings = []
const started = performance.now()
// Deliberately do NOT inherit GAME_* endpoints, secrets or real persistence paths.
const child = spawn(process.execPath, ['server/weapp-ws.js'], {
  cwd: join(root, 'work/guandan-windows-source'),
  env: {
    PATH: process.env.PATH, NODE_ENV: 'test', WEAPP_HOST: '127.0.0.1', WEAPP_WS_PORT: String(port),
    WEAPP_ROOM_STATE_FILE: join(directory, 'rooms.json'), WEAPP_TURN_TIMEOUT_MS: '600000',
    WEAPP_FRIEND_SECOND_MS: '10000', WEAPP_TEST_RANDOM_SEED: '12345',
  }, stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
child.stdout.on('data', data => { output = (output + data).slice(-12000) })
child.stderr.on('data', data => { output = (output + data).slice(-12000) })
// `close` also fires after a spawn error; `exit` alone could leave cleanup waiting forever.
const exited = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })))
child.on('error', error => { output += error.message })
let successful = false
let stateBytes = 0
try {
  await until(() => {
    if (child.exitCode !== null) throw new Error(`Test server exited: ${output}`)
    return output.includes('WebSocket server running')
  }, 'server startup')
  await Promise.all(Array.from({ length: roomCount }, async (_, index) => {
    const roomId = String(700000 + index)
    const seats = []
    for (let seat = 0; seat < 4; seat++) { const peer = await localPeer(port, timings); peers.push(peer); seats.push(peer) }
    await seats[0].command('createRoom', { roomId, hostName: '本地负载验收' }, 'roomCreated')
    for (const peer of seats.slice(1)) await peer.command('joinRoom', { roomId }, 'roomJoined')
    for (const peer of seats) await peer.command('setLobbyReady', { roomId })
    await seats[0].command('startGame', { roomId })
    await until(() => seats.every(peer => peer.state?.phase === 'playing'), 'four-seat deal')
    const playerIds = ['p1', 'p2', 'p3', 'p4']
    for (let turn = 0; turn < actions; turn++) {
      const state = seats[0].state.state
      const actor = state.currentTurn
      const peer = seats[playerIds.indexOf(actor)]
      // Keep the workload bounded: lead one card; following seats pass. This is NOT an AI capacity claim.
      const isLead = !state.lastValidPlay || state.lastValidPlay.type === 'Pass'
      const payload = isLead ? { cardIds: [peer.state.state.players[actor].hand[0].id] } : {}
      const accepted = await peer.command(isLead ? 'play' : 'pass', { roomId, ...payload })
      await until(() => seats.every(p => p.state.gameVersion >= accepted.gameVersion), 'version convergence')
      for (let viewer = 0; viewer < 4; viewer++) {
        const view = seats[viewer].state.state
        assert.equal(view.revision, accepted.gameVersion)
        for (let other = 0; other < 4; other++) {
          if (viewer === other) continue
          assert.ok(view.players[playerIds[other]].hand.every(card => Object.keys(card).length === 1 && card.id.startsWith('hidden-')),
            'load must never bypass private-hand projection')
        }
      }
    }
  }))
  successful = true
} finally {
  peers.forEach(peer => peer.close())
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }, 5000)
  const result = await exited
  clearTimeout(timer)
  stateBytes = (await stat(join(directory, 'rooms.json')).catch(() => ({ size: 0 }))).size
  await rm(directory, { recursive: true, force: true }) // Only this invocation's mkdtemp directory.
  if (successful) assert.equal(result.code, 0, `Test server shutdown failed: ${output}`)
}
const sorted = [...timings].sort((a, b) => a - b)
const percentile = fraction => Number(sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)].toFixed(2))
console.log(JSON.stringify({
  result: 'passed', scope: 'isolated-loopback-single-process-json', node: process.version, os: platform(), cpu: cpus()[0].model,
  rooms: roomCount, connections: roomCount * 4, turnActions: roomCount * actions, acknowledgedCommands: timings.length,
  ackMs: { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: percentile(1) },
  elapsedMs: Math.round(performance.now() - started), persistedBytes: stateBytes,
  limitations: ['Not a production capacity certification', 'No WAN/TLS/platform traffic or AI calculation load', 'Temporary synthetic data removed'],
}, null, 2))
