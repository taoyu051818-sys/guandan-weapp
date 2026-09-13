import assert from 'node:assert/strict'
import { GameResultReporter } from '../../../../work/guandan-windows-source/server/platform/result-reporter.js'
import { SpectatorEventReporter } from '../../../../work/guandan-windows-source/server/platform/spectator-event-reporter.js'
import { JsonGameResultOutboxStore } from '../../../../work/guandan-windows-source/server/platform/game-result-outbox-store.js'
import { JsonSpectatorOutboxStore } from '../../../../work/guandan-windows-source/server/platform/spectator-outbox-store.js'
import { canonicalJsonFingerprint, matchesJsonFingerprint } from '../../../../work/guandan-windows-source/server/platform/canonical-json.js'
import { ReportDeliveryLifetime } from '../../../../work/guandan-windows-source/server/platform/report-delivery-lifetime.js'

// Real add/remove/clone/conflict code, but the durable save boundary is in memory.
// Actual temporary-file durability is covered by the two separately run existing tests.
function memoryStore (Store) {
  const store = new Store()
  Object.defineProperty(store, 'configured', { value: true })
  const state = { failNext: false, commits: [], persisted: [] }
  store.save = events => {
    if (state.failNext) { state.failNext = false; throw new Error('synthetic save failure') }
    state.persisted = structuredClone(events)
    state.commits.push(structuredClone(events))
  }
  return { store, state }
}
const event = (sequence = 1, matchId = 'audit-match') => ({
  eventId: `${matchId}:${sequence}`, matchId, sequence, type: 'round-end',
  finishedAt: sequence * 1000, ranking: ['p1', 'p3', 'p2', 'p4'],
  metadata: { child: { z: 1, a: 2 } },
})
const accepted = (kind, body) => ({ ok: true, status: 200, json: async () => ({
  ok: true, data: { [kind]: { eventId: body.eventId, matchId: body.matchId, sequence: body.sequence, accepted: true, duplicate: true } },
}) })
const deferred = () => {
  let resolve, reject
  const promise = new Promise((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const options = { endpoint: 'https://audit.invalid/no-network', secret: 'synthetic-audit-only', maxAttempts: 1, retryBaseMs: 1, retryMaxMs: 1 }
const variants = [
  { name: 'result', Store: JsonGameResultOutboxStore, Reporter: GameResultReporter, kind: 'result', stop: r => r.stop() },
  { name: 'spectator', Store: JsonSpectatorOutboxStore, Reporter: SpectatorEventReporter, kind: 'event', stop: r => r.stop('audit-match') },
]
const results = []
const watchdog = setTimeout(() => { throw new Error('audit delivery timeout') }, 10_000)
try {
  for (const { name, Store, Reporter, kind, stop } of variants) {
    const { store, state } = memoryStore(Store)
    const source = event(), pristine = structuredClone(source)
    assert.equal(store.add(source), true)
    source.metadata.child.z = 900
    store.pending()[0].ranking.reverse()
    assert.deepEqual(store.pending(), [pristine])
    const reordered = Object.fromEntries(Object.entries(pristine).reverse())
    reordered.metadata = { child: { a: 2, z: 1 } }
    assert.equal(store.add(reordered), false)
    assert.throws(() => store.add({ ...pristine, ranking: ['p2', 'p3', 'p1', 'p4'] }), /不同正文/)
    state.failNext = true
    assert.throws(() => store.remove(pristine.eventId), /synthetic save/)
    assert.deepEqual(store.pending(), [pristine])
    assert.deepEqual(state.persisted, [pristine])
    assert.equal(store.remove(pristine.eventId), true)
    assert.equal(store.remove(pristine.eventId), false)
    if (kind === 'event') {
      store.add(pristine)
      assert.throws(() => store.add({ ...pristine, eventId: 'same-sequence-different-id' }), /match\/sequence/)
      store.remove(pristine.eventId)
    }

    // A failed synchronous stage must not poison the delivery queue.
    const calls = [], release = deferred(), began = deferred()
    const reporter = new Reporter({ ...options, outbox: store, fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body)
      assert.ok(state.persisted.some(e => e.eventId === body.eventId), 'persist before request')
      calls.push(body); began.resolve(); await release.promise
      if (calls.length === 1) state.failNext = true // remote ack accepted, local remove fails once
      return accepted(kind, body)
    } })
    try {
      state.failNext = true
      assert.throws(() => reporter.stage(pristine), /synthetic save/)
      assert.equal((reporter.operations || reporter.operationsByEventId).size, 0)
      assert.deepEqual(store.pending(), [])
      const first = reporter.stage(pristine), duplicate = reporter.stage(reordered)
      assert.equal(first, duplicate, 'same active identity shares one operation')
      assert.throws(() => reporter.stage({ ...pristine, type: 'different' }), /不同正文/)
      await began.promise
      assert.deepEqual(store.pending(), [pristine])
      release.resolve()
      await first; await reporter.whenIdle(); await flush()
      assert.equal(calls.length, 2, 'ack removal failure retries the exact durable event')
      assert.deepEqual(calls, [pristine, pristine])
      assert.deepEqual(store.pending(), [])
      assert.equal((reporter.operations || reporter.operationsByEventId).size, 0)
      results.push({ name, cloneAndConflict: true, failedStageRetry: true, sharedOperation: true, acknowledgedRemoveRetry: calls.length })
    } finally { stop(reporter) }
  }

  // Restore sorts each match, blocks only its own tail, and lets another match progress.
  const { store: timeline, state: timelineState } = memoryStore(JsonSpectatorOutboxStore)
  for (const e of [event(3, 'A'), event(2, 'B'), event(1, 'A'), event(1, 'B'), event(2, 'A')]) timeline.add(e)
  const blockA = deferred(), sent = [], bDone = deferred()
  const ordered = new SpectatorEventReporter({ ...options, outbox: timeline, fetchImpl: async (_url, request) => {
    const body = JSON.parse(request.body); sent.push(body.eventId)
    if (body.eventId === 'A:1') await blockA.promise
    if (body.eventId === 'B:2') bDone.resolve()
    return accepted('event', body)
  } })
  try {
    await bDone.promise; await ordered.whenIdle('B')
    assert.deepEqual(sent, ['A:1', 'B:1', 'B:2'])
    assert.deepEqual(timelineState.persisted.map(e => e.eventId).sort(), ['A:1', 'A:2', 'A:3'])
    blockA.resolve(); await ordered.whenIdle()
    assert.deepEqual(sent, ['A:1', 'B:1', 'B:2', 'A:2', 'A:3'])
    assert.deepEqual(timeline.pending(), [])
    results.push({ restorePerMatchOrder: true, unrelatedMatchNotBlocked: true })
  } finally { blockA.resolve(); ordered.stop('A'); ordered.stop('B') }

  // Result restore sorting is start order, not global serialization (by design).
  const { store: finalResults } = memoryStore(JsonGameResultOutboxStore)
  for (const e of [event(3, 'R3'), event(1, 'R1'), event(2, 'R2')]) finalResults.add(e)
  const unblock = deferred(), starts = [], allStarted = deferred()
  const concurrent = new GameResultReporter({ ...options, outbox: finalResults, fetchImpl: async (_url, request) => {
    const body = JSON.parse(request.body); starts.push(body.sequence)
    if (starts.length === 3) allStarted.resolve()
    await unblock.promise; return accepted('result', body)
  } })
  try {
    await allStarted.promise; assert.deepEqual(starts, [1, 2, 3])
    unblock.resolve(); await concurrent.whenIdle(); assert.deepEqual(finalResults.pending(), [])
    results.push({ resultRestoreStartOrder: starts, resultDeliveryConcurrent: true })
  } finally { unblock.resolve(); concurrent.stop() }

  // A stopped key stays stopped; a separate key's wait remains alive and completes.
  const lifetime = new ReportDeliveryLifetime()
  const one = assert.rejects(lifetime.wait('one', 10_000), /stop-one/)
  const two = lifetime.wait('two', 1)
  lifetime.stop('one', new Error('stop-one')); lifetime.stop('one', new Error('ignored'))
  await Promise.all([one, two])
  assert.equal(lifetime.waiters.size, 0)
  assert.throws(() => lifetime.assertActive('one'), /stop-one/)
  lifetime.assertActive('two')

  const object = JSON.parse('{"z":[{"b":2,"a":1}],"__proto__":{"polluted":true},"a":0}')
  const reverse = Object.fromEntries(Object.entries(object).reverse())
  assert.equal(canonicalJsonFingerprint(object), canonicalJsonFingerprint(reverse))
  assert.equal(matchesJsonFingerprint(JSON.stringify(reverse), object), true)
  assert.equal(matchesJsonFingerprint('not-json', object), false)
  assert.notEqual(canonicalJsonFingerprint([1, 2]), canonicalJsonFingerprint([2, 1]))
  assert.equal({}.polluted, undefined)
  results.push({ perKeyCancellation: true, canonicalNestedAndLegacyIdentity: true, arrayOrderPreserved: true })
  console.log(JSON.stringify({ reportDelivery07: results }, null, 2))
} finally { clearTimeout(watchdog) }
