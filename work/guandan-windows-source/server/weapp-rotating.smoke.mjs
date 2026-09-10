import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { sendProtocolCommand } from './weapp-smoke-protocol.mjs'
const { representativeLegalMoves, variantAward } = createRequire(import.meta.url)('../../../shared-core/dist')
const probe = createServer()
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
const port = probe.address().port
await new Promise(resolve => probe.close(resolve))
const child = spawn(process.execPath, ['server/weapp-ws.js'], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], env: {
  PATH: process.env.PATH, NODE_ENV: 'test', WEAPP_HOST: '127.0.0.1', WEAPP_WS_PORT: String(port), WEAPP_TEST_RANDOM_SEED: '0x77665544',
} })
let logs = '', spawnError = null
const capture = bytes => { logs = (logs + bytes).slice(-12000) }
child.stdout.on('data', capture); child.stderr.on('data', capture)
child.on('error', error => { spawnError = error; capture(error.message) })
const closed = new Promise(resolve => child.once('close', resolve))
const clients = []
let requestId = 80000
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const connect = async () => {
  let lastError
  for (let attempt = 0; attempt < 80; attempt++) {
    if (spawnError || child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`rotating test server exited (${child.exitCode}/${child.signalCode}): ${logs}`)
    }
    try {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/weapp`)
      await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
      const packets = []
      const waiters = new Set()
      const client = { socket, packets, latest: null, wait: (filter, ms = 15000) => {
        const found = packets.find(filter)
        if (found) return Promise.resolve(found)
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => { waiters.delete(check); reject(new Error(`rotating packet timeout: ${filter.toString()} last=${packets.slice(-3).map(p => `${p.type}/${p.state?.roundId}/${p.state?.revision}`).join(',')}`)) }, ms)
          const check = packet => { if (filter(packet)) { clearTimeout(timer); waiters.delete(check); resolve(packet) } }
          waiters.add(check)
        })
      } }
      socket.addEventListener('message', ({ data }) => { const packet = JSON.parse(data); packets.push(packet); if (packet.state) client.latest = packet; waiters.forEach(check => check(packet)) })
      clients.push(client)
      return client
    } catch (error) { lastError = error; await delay(50) }
  }
  throw new Error(`rotating test server did not start: ${lastError?.message || lastError?.type}; ${logs}`)
}
const command = async (client, type, payload, response = 'actionAccepted') => {
  const id = ++requestId
  const result = client.wait(packet => packet.requestId === id && (packet.type === response || packet.type === 'error'))
  sendProtocolCommand(client.socket, type, payload, id)
  const packet = await result
  assert.notEqual(packet.type, 'error', `${type}: ${packet.message}`)
  return packet
}

try {
  for (const [caseIndex, rotation, scoring] of [[0, 'clockwise', 3], [1, 'draw', 6]]) {
    const roomId = `91820${caseIndex}`
    const players = new Map()
    const host = await connect()
    const created = await command(host, 'createRoom', { roomId, hostName: '转蛋回归', roomSettings: {
      mode: 'classic', format: 'rotating', rounds: 2, levelMode: 'random', levelRank: 2, tributeEnabled: false,
      teamRotation: rotation, rotatingScoring: scoring, scoring: 'double-3', trusteeSeconds: 0,
    } }, 'roomCreated')
    players.set('p1', host)
    for (let index = 2; index <= 4; index++) {
      const client = await connect()
      const joined = await command(client, 'joinRoom', { roomId, playerName: `转蛋${index}` }, 'roomJoined')
      players.set(joined.myPlayerId, client)
    }
    for (const client of players.values()) await command(client, 'setLobbyReady', { roomId })
    await command(host, 'startGame', { roomId })
    let totals = { p1: 0, p2: 0, p3: 0, p4: 0 }
    let initialOrder
    for (let roundId = 1; roundId <= 2; roundId++) {
      let packet = await host.wait(p => p.state?.roundId === roundId && p.state.phase === 'playing')
      const order = packet.state.turnOrder
      if (roundId === 1) initialOrder = order
      else if (rotation === 'clockwise') assert.deepEqual(order, [initialOrder[2], initialOrder[1], initialOrder[3], initialOrder[0]])
      assert.deepEqual(packet.state.playerScores, totals)
      assert.equal(packet.state.tribute, null)
      let actions = 0
      while (packet.state.phase === 'playing') {
        assert.ok(++actions < 500, 'round must finish')
        const active = packet.state.currentTurn
        const client = players.get(active)
        const ownPacket = await client.wait(p => p.state?.roundId === roundId && p.state.revision === packet.state.revision)
        const state = ownPacket.state
        for (const id of order.filter(id => id !== active)) assert.ok(state.players[id].hand.every(card => card.rank === undefined), 'live opponents must remain private')
        const moves = representativeLegalMoves(state.players[active].hand, state.lastValidPlay, state.ruleProfile)
        moves.sort((a, b) => b.length - a.length)
        const previous = state.revision
        await command(client, moves.length ? 'play' : 'pass', { roomId, ...(moves.length ? { cardIds: moves[0].map(card => card.id) } : {}) })
        packet = await host.wait(p => p.state?.roundId === roundId && p.state.revision > previous)
      }
      const result = packet.state.settlement
      const first = result.fullRank[0]
      const team = packet.state.players[first].team
      const matePlace = result.fullRank.findIndex(id => id !== first && packet.state.players[id].team === team) + 1
      const awards = variantAward(matePlace, scoring)
      for (const id of order) totals[id] += awards[packet.state.players[id].team === team ? 0 : 1]
      assert.deepEqual(packet.state.playerScores, totals)
      if (roundId === 1) {
        // Rejoin keeps the same authenticated identity even after rotating physical seats.
        host.socket.close()
        await delay(50)
        const restored = await connect()
        const rejoined = await command(restored, 'rejoinRoom', { roomId, myPlayerId: 'p1', resumeToken: created.resumeToken }, 'roomRejoined')
        assert.equal(rejoined.myPlayerId, 'p1')
        await command(restored, 'cancelTrustee', { roomId })
        players.set('p1', restored)
        // host remains a packet history source only for round 1; subsequent reads use the restored connection.
        host.wait = restored.wait
        host.socket = restored.socket
        for (const client of players.values()) await command(client, 'readyNextRound', { roomId })
      } else {
        const end = await host.wait(p => p.matchEnded?.reason === 'round-limit')
        assert.equal(end.matchEnded.winnerTeam, null)
        assert.deepEqual(end.matchEnded.playerScores, totals)
      }
    }
    for (const client of players.values()) client.socket.close()
  }
  console.log('Rotating WebSocket regression passed: 3/6 scores, two rounds, both rotations, private hands, rejoin, terminal totals')
} finally {
  clients.forEach(client => client.socket.close())
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
  await closed
  clearTimeout(timer)
}
