import assert from 'node:assert/strict'
import { GameResultReporter } from './result-reporter.js'
import { SpectatorEventReporter } from './spectator-event-reporter.js'

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = async () => { for (let i = 0; i < 16; i += 1) await Promise.resolve() }
const makeEvent = (sequence = 1, matchId = 'match-delivery') => ({
  eventId: `${matchId}:${sequence}`, matchId, sequence, type: 'round-end',
  ranking: ['p1', 'p3', 'p2', 'p4'], cards: [{ id: 's3', rank: 3 }],
})
const ack = event => ({ eventId: event.eventId, matchId: event.matchId, sequence: event.sequence, accepted: true, duplicate: false })
const response = (kind, receipt) => ({ ok: true, status: 200, json: async () => ({ ok: true, data: { [kind]: receipt } }) })
const memoryOutbox = () => {
  const events = new Map()
  return {
    configured: true,
    add (event) { events.set(event.eventId, structuredClone(event)) },
    remove (id) { events.delete(id) },
    pending () { return structuredClone([...events.values()]) },
  }
}
const variants = [
  { kind: 'result', Reporter: GameResultReporter, stop: (reporter, event, reason) => reporter.stop(reason) },
  { kind: 'event', Reporter: SpectatorEventReporter, stop: (reporter, event, reason) => reporter.stop(event.matchId, reason) },
]
const options = { endpoint: 'https://report-delivery.test/events', secret: 'test-secret', maxAttempts: 1, retryBaseMs: 1, retryMaxMs: 1 }
const watchdog = setTimeout(() => { throw new Error('report delivery regression timed out') }, 10_000)
try {
  for (const { kind, Reporter, stop } of variants) {
    // Bad success envelopes are not acknowledgements and cannot delete durable work.
    const event = makeEvent()
    const badReceipts = [undefined, {}, { ...ack(event), accepted: false }, { ...ack(event), eventId: 'another-event' }]
    if (kind === 'event') badReceipts.push({ ...ack(event), matchId: 'another-match' }, { ...ack(event), sequence: 99 })
    for (const receipt of badReceipts) {
      const outbox = memoryOutbox()
      let calls = 0
      const retryStarted = deferred()
      const retryResponse = deferred()
      const reporter = new Reporter({ ...options, outbox, fetchImpl: async () => {
        calls += 1
        if (calls === 1) return response(kind, receipt)
        retryStarted.resolve()
        return retryResponse.promise
      } })
      const delivered = reporter.stage(event)
      await retryStarted.promise
      assert.deepEqual(outbox.pending(), [event], `${kind}: invalid ack must keep the event`)
      retryResponse.resolve(response(kind, { ...ack(event), duplicate: true }))
      assert.equal((await delivered).duplicate, true, 'a matching duplicate receipt is a valid acknowledgement')
      assert.deepEqual(outbox.pending(), [])
    }

    // A caller mutating top-level identity and nested data after stage cannot change the owned DTO.
    const ownedEvent = makeEvent()
    const expected = structuredClone(ownedEvent)
    const outbox = memoryOutbox()
    const sent = []
    const reporter = new Reporter({ ...options, outbox, maxAttempts: 2, fetchImpl: async (_, request) => {
      sent.push(request)
      if (sent.length === 1) {
        ownedEvent.ranking.reverse()
        ownedEvent.eventId = 'mutated-during-retry'
        throw new Error('transient network failure')
      }
      return response(kind, ack(JSON.parse(request.body)))
    } })
    const delivered = reporter.stage(ownedEvent)
    ownedEvent.eventId = 'mutated-before-send'
    ownedEvent.matchId = 'mutated-match'
    ownedEvent.sequence = 42
    ownedEvent.cards[0].rank = 14
    assert.deepEqual(outbox.pending(), [expected])
    await delivered
    assert.equal(sent.length, 2)
    for (const request of sent) {
      assert.deepEqual(JSON.parse(request.body), expected)
      assert.equal(request.headers[kind === 'result' ? 'x-game-event-id' : 'x-spectator-event-id'], expected.eventId)
    }
    assert.deepEqual(outbox.pending(), [])
    await reporter.whenIdle()
    await flush()
    assert.equal((reporter.operations || reporter.operationsByEventId).size, 0, 'cleanup must use the owned event id')

    // The bounded public API also owns its input throughout all retries.
    const direct = makeEvent()
    let directCalls = 0
    const immediate = new Reporter({ ...options, maxAttempts: 2, fetchImpl: async (_, request) => {
      directCalls += 1
      const body = JSON.parse(request.body)
      if (directCalls === 1) { direct.eventId = 'mutated'; throw new Error('retry') }
      assert.equal(request.headers[kind === 'result' ? 'x-game-event-id' : 'x-spectator-event-id'], body.eventId)
      return response(kind, ack(body))
    } })
    await immediate.report(direct)
    assert.equal(directCalls, 2)

    // Stop during fetch or during response.json, even for a non-cooperating transport.
    for (const phase of ['fetch', 'body']) {
      const began = deferred()
      const hanging = deferred()
      const durable = memoryOutbox()
      let calls = 0
      let signal
      const stoppedReporter = new Reporter({ ...options, outbox: durable, maxAttempts: 3, fetchImpl: async (_, request) => {
        calls += 1
        signal = request.signal
        if (phase === 'fetch') { began.resolve(); return hanging.promise }
        return { ok: true, status: 200, json: () => { began.resolve(); return hanging.promise } }
      } })
      const pending = stoppedReporter.stage(event)
      const rejected = assert.rejects(pending, /explicit shutdown/)
      await began.promise
      stop(stoppedReporter, event, new Error('explicit shutdown'))
      await rejected
      assert.equal(signal.aborted, true)
      assert.deepEqual(durable.pending(), [event])
      hanging.resolve(phase === 'fetch' ? response(kind, ack(event)) : { ok: true, data: { [kind]: ack(event) } })
      await flush()
      assert.equal(calls, 1, 'no inner retry after shutdown')
      assert.deepEqual(durable.pending(), [event], 'late success after stop must not acknowledge')
    }
  }

  // Stopping one match must not stop another, or allow later events in its queue to send.
  const began = deferred()
  const outbox = memoryOutbox()
  const sent = []
  const reporter = new SpectatorEventReporter({ ...options, outbox, fetchImpl: async (_, request) => {
    const event = JSON.parse(request.body)
    sent.push(event.eventId)
    if (event.matchId === 'blocked') { began.resolve(); return new Promise(() => {}) }
    return response('event', ack(event))
  } })
  const blocked = [makeEvent(1, 'blocked'), makeEvent(2, 'blocked')]
  const pending = blocked.map(event => reporter.stage(event))
  const rejected = Promise.all(pending.map(task => assert.rejects(task, /stop match/)))
  await began.promise
  reporter.stop('blocked', new Error('stop match'))
  await reporter.stage(makeEvent(1, 'other'))
  await rejected
  assert.deepEqual(outbox.pending(), blocked)
  assert.deepEqual(sent, ['blocked:1', 'other:1'])
  assert.equal(reporter.lifetime.controllers.size, 0)
  assert.equal(reporter.lifetime.waiters.size, 0)

  // Stop both the bounded inner backoff and the durable outer backoff immediately.
  for (const maxAttempts of [1, 3]) {
    const retrier = new SpectatorEventReporter({ ...options, maxAttempts, retryBaseMs: 10_000, retryMaxMs: 10_000,
      outbox: memoryOutbox(), fetchImpl: async () => { throw new Error('offline') },
    })
    const pending = retrier.stage(makeEvent())
    const rejected = assert.rejects(pending, /stop backoff/)
    await flush()
    assert.equal(retrier.lifetime.waiters.size, 1)
    retrier.stop('match-delivery', new Error('stop backoff'))
    await rejected
    assert.equal(retrier.lifetime.waiters.size, 0)
    assert.equal(retrier.outbox.pending().length, 1)
  }

  const timed = new SpectatorEventReporter({ ...options, timeoutMs: 100, fetchImpl: async () => new Promise(() => {}) })
  await assert.rejects(timed.report(makeEvent()), /观战事件回调超时/)
  assert.equal(timed.lifetime.controllers.size, 0)
  console.log('reporter acknowledgement, snapshot ownership and cancellation regressions passed')
} finally {
  clearTimeout(watchdog)
}
