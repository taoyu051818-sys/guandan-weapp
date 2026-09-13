// Audit only: run reviewed integration files unchanged, with current core source.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../../..')
const cases = {
  friendTicket: { file: 'weapp-friend-ticket.smoke.mjs', ports: [39116] },
  terminal: { file: 'weapp-terminal-lifecycle.smoke.mjs', ports: [19017,19018,19019,19020,19021,19022,19023,19024] },
  roundState: { file: 'weapp-round-state.smoke.mjs', ports: [39112,39113,39114] },
  websocket: { file: 'weapp-ws.smoke.mjs', ports: [] },
}
for (const [name, baseline] of Object.entries({ privateHand: 'websocket', privateTribute: 'roundState',
  replayConflict: 'websocket', durablePublish: 'terminal', revokedTicket: 'friendTicket' })) {
  cases[name] = { ...cases[baseline], mutation: name }
}
const names = process.argv.slice(2)
assert.ok(names.length && names.every(name => cases[name]), 'choose reviewed test names')
for (const name of names) {
  for (const port of cases[name].ports) {
    const probe = createServer()
    await new Promise((ok, fail) => { probe.once('error', fail); probe.listen(port, '127.0.0.1', ok) })
    await new Promise((ok, fail) => probe.close(error => error ? fail(error) : ok()))
  }
  const directory = await mkdtemp(join(tmpdir(), 'guandan-audit33-'))
  let child, stdout = '', stderr = '', timedOut = false, timer, escalation
  const started = Date.now()
  const signal = value => {
    if (!child?.pid) return
    try { process.kill(-child.pid, value) } catch (error) { if (error.code !== 'ESRCH') throw error }
  }
  const groupAlive = () => {
    if (!child?.pid) return false
    try { process.kill(-child.pid, 0); return true } catch (error) { if (error.code !== 'ESRCH') throw error; return false }
  }
  const drainGroup = async () => {
    if (!groupAlive()) return
    signal('SIGTERM')
    let deadline = Date.now() + 5000
    while (groupAlive() && Date.now() < deadline) await new Promise(ok => setTimeout(ok, 20))
    if (groupAlive()) {
      signal('SIGKILL'); deadline = Date.now() + 1000
      while (groupAlive() && Date.now() < deadline) await new Promise(ok => setTimeout(ok, 20))
    }
    assert.equal(groupAlive(), false, 'owned test process group must stop before cleanup')
  }
  try {
    child = spawn(process.execPath, ['server/' + cases[name].file], {
      cwd: join(root, 'work/guandan-windows-source'), detached: true, stdio: ['ignore','pipe','pipe'],
      env: { PATH: process.env.PATH, TMPDIR: directory, NODE_ENV: 'test', WEAPP_HOST: '127.0.0.1',
        ...(cases[name].mutation ? { AUDIT33_MUTATION: cases[name].mutation } : {}),
        NODE_OPTIONS: '--require=' + join(here, cases[name].mutation ? 'server-mutation-preload-33.cjs' : 'server-test-preload-32.cjs') },
    })
    child.stdout.on('data', bytes => { stdout = (stdout + bytes).slice(-24000) })
    child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-24000) })
    timer = setTimeout(() => { timedOut = true; signal('SIGTERM') }, 300000)
    escalation = setTimeout(() => { timedOut = true; signal('SIGKILL') }, 305000)
    const result = await new Promise((ok, fail) => { child.once('close', (code, signal) => ok({ code, signal })); child.once('error', fail) })
    clearTimeout(timer); clearTimeout(escalation)
    await drainGroup()
    const mutationHits = cases[name].mutation
      ? (await readFile(join(directory, 'audit33-mutation-hits.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)) : []
    let mutationDetected = null
    if (cases[name].mutation) {
      assert.ok(mutationHits.some(hit => hit.entry === 'weapp-ws.js' && hit.replacements === 1), 'mutation must load in the actual server')
      assert.equal(timedOut, false, 'runner deadline is not a valid mutation result')
      assert.notEqual(result.code, 0, 'original test must reject mutant')
      assert.match(stderr, /AssertionError|等待 .* 超时/, 'must fail through an original behavioral assertion or message deadline')
      assert.doesNotMatch(stderr, /SyntaxError|requires exactly one source target|Audit denied/, 'loader/setup failure is not detection')
      mutationDetected = true
    }
    console.log('AUDIT33_TEST=' + JSON.stringify({ name, ...result, timedOut, elapsedMs: Date.now()-started, stdout, stderr, mutationHits, mutationDetected }))
    if ((!cases[name].mutation && result.code !== 0) || timedOut) process.exitCode = 1
  } finally {
    clearTimeout(timer); clearTimeout(escalation)
    await drainGroup()
    await rm(directory, { recursive: true, force: true })
  }
}
