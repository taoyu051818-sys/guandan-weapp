// Audit-only, synthetic state. No server entrypoint, network, real files or timers.
import assert from 'node:assert/strict'
import { createWeAppOperationScheduler, operationKeyForCommand } from '../../../../work/guandan-windows-source/server/weapp-operation-scheduler.js'
import { durableReplaceFile, durableReplaceFileSync } from '../../../../work/guandan-windows-source/server/durable-file.js'
import { createRuntimePersistence } from '../../../../work/guandan-windows-source/server/weapp-runtime-persistence.js'

const tick = () => new Promise(resolve => setImmediate(resolve))
let seed = 912004
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 }
const errors = []
const scheduler = createWeAppOperationScheduler({ onError: (error, label) => errors.push([error.message, label]) })
const running = new Set(), order = new Map(), expected = new Map(), outcomes = []
let globalRunning = false, expectedFailures = 0
for (let i = 0; i < 120; i++) {
  const key = random() < 0.22 ? 'global' : `room:${Math.floor(random() * 3)}`
  const fail = random() < 0.12
  expectedFailures += Number(fail)
  if (key !== 'global') expected.set(key, [...(expected.get(key) || []), i])
  outcomes.push(scheduler.enqueue(key, async () => {
    assert.equal(globalRunning, false, 'no task can overlap exclusive work')
    if (key === 'global') { assert.equal(running.size, 0); globalRunning = true }
    else {
      assert.equal(running.has(key), false, 'same room must not overlap')
      running.add(key); order.set(key, [...(order.get(key) || []), i])
    }
    await tick()
    if (key === 'global') globalRunning = false
    else running.delete(key)
    if (fail) throw new Error(`synthetic-${i}`)
  }, `job-${i}`).then(() => true, error => {
    assert.match(error.message, /^synthetic-/)
    return false
  }))
}
await scheduler.drain()
assert.equal(scheduler.pendingCount(), 0)
assert.deepEqual(order, expected)
assert.equal((await Promise.all(outcomes)).filter(v => !v).length, expectedFailures)
assert.equal(errors.length, expectedFailures)

// Check the operation protocol of atomic replacement with injected filesystem APIs.
let replacementCases = 0
for (const asyncMode of [false, true]) for (const failure of [null, 'ensurePrivateDirectory', 'writePrivateFileAndSync', 'replace', 'syncDirectory']) {
  const calls = [], operations = {}
  for (const name of ['ensurePrivateDirectory', 'writePrivateFileAndSync', 'replace', 'syncDirectory', 'removeTemporary']) {
    const op = (...args) => { calls.push([name, ...args]); if (name === failure) throw Error(`injected:${name}`) }
    operations[name] = asyncMode ? async (...args) => op(...args) : op
  }
  const invoke = () => asyncMode
    ? durableReplaceFile('/synthetic-audit-only/rooms.json', '{"safe":true}', operations)
    : durableReplaceFileSync('/synthetic-audit-only/rooms.json', '{"safe":true}', operations)
  if (failure) {
    if (asyncMode) await assert.rejects(invoke, new RegExp(`injected:${failure}`))
    else assert.throws(invoke, new RegExp(`injected:${failure}`))
  } else await invoke()
  const stages = calls.map(c => c[0])
  const all = ['ensurePrivateDirectory', 'writePrivateFileAndSync', 'replace', 'syncDirectory']
  const prefix = failure ? all.slice(0, all.indexOf(failure) + 1) : all
  assert.deepEqual(stages, failure === 'ensurePrivateDirectory' ? prefix : [...prefix, 'removeTemporary'])
  const cleanup = calls.find(c => c[0] === 'removeTemporary')
  if (cleanup) {
    assert.match(cleanup[1], /^\/synthetic-audit-only\/rooms\.json\.\d+\.\d+\.\d+\.tmp$/)
    assert.notEqual(cleanup[1], '/synthetic-audit-only/rooms.json')
  }
  replacementCases++
}

// Concurrent writes confirm only exact captured acceptance objects.
const timers = new Map(), saved = [], accepted = new Map()
let gateRelease, writes = 0
const firstGate = new Promise(resolve => { gateRelease = resolve })
const persistence = createRuntimePersistence({
  acceptedActions: accepted, debounceMs: 10, isShuttingDown: () => false,
  persistedRuntimeSnapshot: () => ({ acceptedActions: [...accepted.entries()] }),
  setTimeout: (fn, delay) => { const key = { unref() {} }; timers.set(key, { fn, delay }); return key },
  clearTimeout: key => timers.delete(key),
  roomStateStore: { configured: true, save: async snapshot => {
    const copy = structuredClone(snapshot); writes++
    if (writes === 1) await firstGate
    saved.push(copy)
  } },
})
const original = { pendingDurability: true, response: { roomId: '111111', version: 1 } }
accepted.set('old:1', original)
persistence.persistRuntimeState()
const first = persistence.flushRuntimeState({ throwOnError: true })
const updated = { ...original, response: { roomId: '111111', version: 2 } }
accepted.set('old:1', updated)
accepted.set('rotated:1', original)
persistence.persistRuntimeState()
gateRelease(); await first
assert.equal(accepted.get('old:1'), updated)
assert.equal(accepted.get('rotated:1').pendingDurability, true)
await persistence.flushRuntimeState({ throwOnError: true })
assert.equal(accepted.get('old:1').pendingDurability, false)
assert.equal(accepted.get('rotated:1').pendingDurability, false)
assert.equal(saved[0].acceptedActions[0][1].response.version, 1)
assert.equal(saved[1].acceptedActions[0][1].response.version, 2)
assert.equal(timers.size, 0)
persistence.cancelPendingTimer()

// A diagnostic boundary, not a proven gameplay failure: keys are captured at enqueue.
const rooms = new Map([['111111', {}], ['222222', {}]])
const connection = { roomId: '111111' }, entryTypes = ['createRoom', 'joinRoom', 'rejoinRoom']
const query = message => operationKeyForCommand({ connection, message, rooms, entryTypes })
const oldKey = query({ type: 'setLobbyReady', payload: { roomId: '222222' } })
connection.roomId = '222222'
const currentKey = query({ type: 'setLobbyReady', payload: { roomId: '222222' } })
assert.equal(oldKey, 'room:111111'); assert.equal(currentKey, 'room:222222')
console.log({ jobs: 120, expectedFailures, fifoAndBarriers: true, replacementCases, capturedAcceptanceIdentity: true,
  queueKeyUsesConnectionAtEnqueue: true, oldKey, currentKey, diagnosticOnly: true })
