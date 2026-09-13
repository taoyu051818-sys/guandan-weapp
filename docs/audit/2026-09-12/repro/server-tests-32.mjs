// Runs only pre-reviewed tests with synthetic env and temporary storage.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../../..')
const app = join(root, 'work/guandan-windows-source')
const cases = {
  protocol: ['server/weapp-protocol.test.mjs'],
  transport: ['server/weapp-websocket-transport.test.mjs'],
  security: ['server/weapp-security.smoke.mjs'],
  securityInherited: ['server/weapp-security.smoke.mjs'],
  settings: ['server/weapp-room-settings.smoke.mjs'],
  bots: ['server/weapp-bots.smoke.mjs'],
  friendBots: ['server/weapp-friend-bots.smoke.mjs'],
  observer: ['server/weapp-friend-observer.smoke.mjs'],
  observerDelayed: ['server/weapp-friend-observer.smoke.mjs', '--delayed'],
  rotating: ['server/weapp-rotating.smoke.mjs'],
  persistence: ['server/weapp-persistence.smoke.mjs'],
  ticket: ['server/weapp-ticket.smoke.mjs'],
  matchClassic: ['server/weapp-match-bot-ticket.smoke.mjs', 'classic_50'],
  matchNoShuffle: ['server/weapp-match-bot-ticket.smoke.mjs', 'no-shuffle_50'],
  matchConsecutive: ['server/weapp-match-bot-ticket.smoke.mjs', 'consecutive_50'],
  load: [join(root, 'scripts/local-room-load.mjs'), '4', '16'],
}
const fixedPorts = { security: 39115, securityInherited: 39115, settings: 39108, bots: 39107, friendBots: 39143, persistence: 39114, ticket: 39103 }
const names = process.argv.slice(2); assert.ok(names.length && names.every(n => cases[n]))
for (const name of names) {
  if (fixedPorts[name]) {
    const probe = createServer()
    await new Promise((ok, fail) => { probe.once('error', fail); probe.listen(fixedPorts[name], '127.0.0.1', ok) })
    await new Promise(ok => probe.close(ok))
  }
  const directory = await mkdtemp(join(tmpdir(), 'guandan-audit32-'))
  const started = Date.now()
  let stdout = '', stderr = '', timedOut = false
  let child
  try {
    const inheritedFile = name === 'securityInherited' ? join(directory, 'synthetic-caller-owned-state.json') : null
    const initialState = JSON.stringify({ schemaVersion: 1, rooms: [], acceptedActions: [], closedRoomTombstones: [], auditSentinel: 'synthetic-caller-owned' })
    if (inheritedFile) await writeFile(inheritedFile, initialState)
    child = spawn(process.execPath, cases[name], { cwd: app, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, TMPDIR: directory, NODE_ENV: 'test', WEAPP_HOST: '127.0.0.1',
        ...(inheritedFile ? { WEAPP_ROOM_STATE_FILE: inheritedFile } : {}),
        NODE_OPTIONS: '--require=' + join(here, 'server-test-preload-32.cjs') } })
    child.stdout.on('data', b => { stdout = (stdout + b).slice(-18000) })
    child.stderr.on('data', b => { stderr = (stderr + b).slice(-18000) })
    const killGroup = signal => { try { process.kill(-child.pid, signal) } catch (e) { if (e.code !== 'ESRCH') throw e } }
    const timeout = setTimeout(() => { timedOut = true; killGroup('SIGTERM') }, name === 'friendBots' ? 300000 : 120000)
    const escalation = setTimeout(() => { timedOut = true; killGroup('SIGKILL') }, name === 'friendBots' ? 305000 : 125000)
    const result = await new Promise((ok, fail) => { child.once('close', (code, signal) => ok({ code, signal })); child.once('error', fail) })
    clearTimeout(timeout); clearTimeout(escalation)
    // Only this invocation's owned process group, never an existing server on a port.
    killGroup('SIGTERM')
    const groupAlive = () => {
      try { process.kill(-child.pid, 0); return true } catch (e) { if (e.code !== 'ESRCH') throw e; return false }
    }
    const cleanupDeadline = Date.now() + 5000
    while (groupAlive() && Date.now() < cleanupDeadline) await new Promise(ok => setTimeout(ok, 20))
    if (groupAlive()) {
      killGroup('SIGKILL')
      const forceDeadline = Date.now() + 1000
      while (groupAlive() && Date.now() < forceDeadline) await new Promise(ok => setTimeout(ok, 20))
    }
    assert.equal(groupAlive(), false, 'owned process group must stop before temporary files are removed')
    let inheritedState = null
    if (inheritedFile) {
      const finalState = await readFile(inheritedFile, 'utf8')
      const hash = data => createHash('sha256').update(data).digest('hex')
      inheritedState = { syntheticOnly: true, beforeSha256: hash(initialState), afterSha256: hash(finalState),
        changed: initialState !== finalState, callerSentinelRetained: JSON.parse(finalState).auditSentinel === 'synthetic-caller-owned' }
      assert.equal(inheritedState.changed, true, 'the original smoke test changed its inherited caller-owned synthetic store')
    }
    console.log('AUDIT32_TEST=' + JSON.stringify({ name, ...result, timedOut, elapsedMs: Date.now() - started, stdout, stderr, inheritedState }))
    if (result.code !== 0 || timedOut) process.exitCode = 1
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, 'SIGKILL') } catch (e) { if (e.code !== 'ESRCH') throw e }
    }
    await rm(directory, { recursive: true, force: true })
  }
}
