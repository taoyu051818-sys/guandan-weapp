import { gameResultSignature } from './crypto.js'
import { JsonGameResultOutboxStore } from './game-result-outbox-store.js'
import { snapshotReportEvent, requireResultAcknowledgement } from './report-event-contract.js'

export class GameResultReporter {
  constructor ({
    endpoint,
    secret,
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    maxAttempts = 3,
    retryBaseMs = 100,
    retryMaxMs = 30_000,
    timeoutMs = 3000,
    outbox = null,
    outboxFilePath = '',
  }) {
    this.endpoint = endpoint
    this.secret = secret
    this.fetchImpl = fetchImpl
    this.now = now
    this.maxAttempts = Math.max(1, Number(maxAttempts) || 1)
    this.retryBaseMs = Math.max(1, Number(retryBaseMs) || 1)
    this.retryMaxMs = Math.max(this.retryBaseMs, Number(retryMaxMs) || 30_000)
    this.timeoutMs = Math.max(1, Number(timeoutMs) || 3000)
    this.outbox = outbox || (outboxFilePath ? new JsonGameResultOutboxStore({ filePath: outboxFilePath }) : null)
    this.operations = new Map()
    this.activeControllers = new Set()
    this.waiters = new Set()
    this.stopped = null
    if (this.configured && this.durable) this.restorePending()
  }

  get configured () { return Boolean(this.endpoint) }
  get durable () { return Boolean(this.outbox && this.outbox.configured !== false) }

  /**
   * Persists before starting delivery. The returned promise settles only after
   * the platform acknowledges the idempotent event, or this reporter is stopped.
   */
  enqueue (event) {
    try {
      return this.stage(event)
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /** Synchronously stages the durable record, then returns its delivery promise. */
  stage (event) {
    if (!this.configured) return Promise.resolve({ skipped: true })
    if (!this.durable) throw new Error('结算 enqueue 必须配置持久 outbox')
    event = snapshotReportEvent(event)
    this.outbox.add(event)
    if (this.stopped) throw this.stopped
    const eventId = String(event.eventId)
    return this.operations.get(eventId) || this.schedule(event)
  }

  restorePending () {
    const pending = this.outbox.pending().sort((left, right) => {
      const timeOrder = (Number(left.finishedAt) || 0) - (Number(right.finishedAt) || 0)
      return timeOrder || String(left.eventId).localeCompare(String(right.eventId))
    })
    for (const event of pending) this.schedule(event)
  }

  schedule (event) {
    event = snapshotReportEvent(event)
    const eventId = String(event.eventId)
    const existing = this.operations.get(eventId)
    if (existing) return existing
    const operation = Promise.resolve().then(() => this.reportUntilAccepted(event))
    this.operations.set(eventId, operation)
    void operation.finally(() => {
      if (this.operations.get(eventId) === operation) this.operations.delete(eventId)
    }).catch(() => {})
    return operation
  }

  whenIdle (eventId) {
    if (eventId !== undefined) return this.operations.get(String(eventId)) || Promise.resolve()
    return Promise.all([...this.operations.values()])
  }

  /** Stops all delivery work without deleting unacknowledged durable events. */
  stop (reason = new Error('结算上报已停止')) {
    if (this.stopped) return false
    this.stopped = reason instanceof Error ? reason : new Error(String(reason))
    for (const controller of this.activeControllers) controller.abort(this.stopped)
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer)
      waiter.reject(this.stopped)
    }
    this.waiters.clear()
    return true
  }

  async reportUntilAccepted (event) {
    let retryRound = 0
    while (true) {
      if (this.stopped) throw this.stopped
      try {
        const accepted = await this.report(event)
        if (this.stopped) throw this.stopped
        this.outbox.remove(event.eventId)
        return accepted
      } catch (error) {
        if (this.stopped) throw this.stopped
        retryRound += 1
        const delay = Math.min(this.retryMaxMs, this.retryBaseMs * (2 ** Math.min(20, retryRound - 1)))
        await this.wait(delay)
      }
    }
  }

  /** Keeps the original bounded, immediate reporting API for callers and tests. */
  async report (event) {
    if (!this.configured) return { skipped: true }
    event = snapshotReportEvent(event)
    const rawBody = JSON.stringify(event)
    let lastError
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      if (this.stopped) throw this.stopped
      const timestamp = String(this.now())
      try {
        return await this.request(event, rawBody, timestamp)
      } catch (error) {
        lastError = error
        if (this.stopped) throw this.stopped
        if (attempt < this.maxAttempts) {
          await this.wait(Math.min(2000, this.retryBaseMs * (2 ** (attempt - 1))))
        }
      }
    }
    throw lastError
  }

  async request (event, rawBody, timestamp) {
    const controller = new AbortController()
    this.activeControllers.add(controller)
    const timeoutError = new Error(`结算回调超时：${this.timeoutMs}ms`)
    const timer = setTimeout(() => controller.abort(timeoutError), this.timeoutMs)
    const aborted = new Promise((resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason || timeoutError), { once: true })
    })
    const requested = Promise.resolve().then(async () => {
      if (this.stopped) throw this.stopped
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-game-event-id': event.eventId,
          'x-game-timestamp': timestamp,
          'x-game-signature': gameResultSignature(rawBody, this.secret, timestamp),
        },
        body: rawBody,
        signal: controller.signal,
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.ok) throw new Error(payload?.error?.message || `结算回调失败：HTTP ${response.status}`)
      return requireResultAcknowledgement(payload.data?.result, event)
    })
    try {
      return await Promise.race([requested, aborted])
    } finally {
      clearTimeout(timer)
      this.activeControllers.delete(controller)
    }
  }

  wait (delay) {
    if (this.stopped) return Promise.reject(this.stopped)
    return new Promise((resolve, reject) => {
      const waiter = {
        timer: setTimeout(() => {
          this.waiters.delete(waiter)
          resolve()
        }, delay),
        reject,
      }
      this.waiters.add(waiter)
    })
  }
}
