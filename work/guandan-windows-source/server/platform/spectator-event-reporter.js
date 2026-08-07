import { gameResultSignature, spectatorEventSignature } from './crypto.js'
import { JsonSpectatorOutboxStore } from './spectator-outbox-store.js'

const unrefDelay = (delay) => new Promise(resolve => {
  const timer = setTimeout(resolve, delay)
  timer.unref?.()
})

/**
 * 牌局服到平台的低权限公开事件写入器。
 *
 * 每个 matchId 单独串行，避免 HTTP 重试导致后一个 sequence 抢先到达；调用方只
 * 需要 fire-and-forget `enqueue()`，网络超时和平台故障不会阻塞牌局状态机。
 */
export class SpectatorEventReporter {
  constructor ({ endpoint, secret, lifecycleSecret = '', fetchImpl = globalThis.fetch, now = () => Date.now(), maxAttempts = 5, retryBaseMs = 100, retryMaxMs = 30_000, timeoutMs = 3000, outbox = null, outboxFilePath = '' }) {
    this.endpoint = endpoint
    this.secret = secret
    this.lifecycleSecret = lifecycleSecret
    this.fetchImpl = fetchImpl
    this.now = now
    this.maxAttempts = Math.max(1, Number(maxAttempts) || 1)
    this.retryBaseMs = Math.max(1, Number(retryBaseMs) || 1)
    this.retryMaxMs = Math.max(this.retryBaseMs, Number(retryMaxMs) || 30_000)
    this.timeoutMs = Math.max(100, Number(timeoutMs) || 3000)
    this.queues = new Map()
    this.stopped = new Map()
    this.retryWaiters = new Map()
    this.operationsByEventId = new Map()
    this.outbox = outbox || (outboxFilePath ? new JsonSpectatorOutboxStore({ filePath: outboxFilePath }) : null)
    if (this.configured && this.outbox) this.restorePending()
  }

  get configured () { return Boolean(this.endpoint) }

  enqueue (event) {
    if (!this.configured) return Promise.resolve({ skipped: true })
    const key = String(event?.matchId || '')
    const stopped = this.stopped.get(key)
    if (stopped) return Promise.reject(stopped)
    if (this.outbox) {
      try {
        this.outbox.add(event)
      } catch (error) {
        this.stop(key, error)
        return Promise.reject(error)
      }
      const existingOperation = this.operationsByEventId.get(String(event?.eventId || ''))
      if (existingOperation) return existingOperation
    }
    return this.schedule(key, event)
  }

  restorePending () {
    const pending = this.outbox.pending().sort((left, right) => {
      const matchOrder = String(left.matchId).localeCompare(String(right.matchId))
      return matchOrder || left.sequence - right.sequence || String(left.eventId).localeCompare(String(right.eventId))
    })
    for (const event of pending) this.schedule(String(event.matchId), event)
  }

  schedule (key, event) {
    const previous = this.queues.get(key) || Promise.resolve()
    // Never catch `previous` here: a stopped head must reject the rest of that
    // match queue, while a transient failure is retained and retried in place.
    const operation = previous.then(() => this.reportUntilAccepted(key, event))
    this.queues.set(key, operation)
    this.operationsByEventId.set(String(event.eventId), operation)
    void operation.finally(() => {
      if (this.queues.get(key) === operation) this.queues.delete(key)
      if (this.operationsByEventId.get(String(event.eventId)) === operation) this.operationsByEventId.delete(String(event.eventId))
    }).catch(() => {})
    return operation
  }

  whenIdle (matchId) {
    if (matchId !== undefined) return this.queues.get(String(matchId)) || Promise.resolve()
    return Promise.all([...this.queues.values()])
  }

  /** Stops one match queue and wakes an unref'ed retry wait. Primarily used during explicit room/service shutdown. */
  stop (matchId, reason = new Error('观战事件上报已停止')) {
    const key = String(matchId || '')
    const error = reason instanceof Error ? reason : new Error(String(reason))
    this.stopped.set(key, error)
    const waiter = this.retryWaiters.get(key)
    if (waiter) {
      clearTimeout(waiter.timer)
      this.retryWaiters.delete(key)
      waiter.reject(error)
    }
  }

  async reportUntilAccepted (key, event) {
    let retryRound = 0
    while (true) {
      const stopped = this.stopped.get(key)
      if (stopped) throw stopped
      try {
        const accepted = await this.report(event)
        this.outbox?.remove(event.eventId)
        return accepted
      } catch (error) {
        const stopError = this.stopped.get(key)
        if (stopError) throw stopError
        retryRound += 1
        const delay = Math.min(this.retryMaxMs, this.retryBaseMs * (2 ** Math.min(20, retryRound - 1)))
        await this.waitForRetry(key, delay)
      }
    }
  }

  waitForRetry (key, delay) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.retryWaiters.get(key)?.timer === timer) this.retryWaiters.delete(key)
        resolve()
      }, delay)
      timer.unref?.()
      this.retryWaiters.set(key, { timer, reject })
    })
  }

  async report (event) {
    if (!this.configured) return { skipped: true }
    const rawBody = JSON.stringify(event)
    let lastError
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const timestamp = String(this.now())
      try {
        const headers = {
          'content-type': 'application/json',
          'x-spectator-event-id': event.eventId,
          'x-spectator-timestamp': timestamp,
          'x-spectator-signature': spectatorEventSignature(rawBody, this.secret, timestamp),
        }
        if (event.type === 'room-closed' && this.lifecycleSecret) {
          headers['x-game-event-id'] = event.eventId
          headers['x-game-timestamp'] = timestamp
          headers['x-game-signature'] = gameResultSignature(rawBody, this.lifecycleSecret, timestamp)
        }
        const response = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          headers,
          body: rawBody,
          signal: AbortSignal.timeout(this.timeoutMs),
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok || !payload?.ok) throw new Error(payload?.error?.message || `观战事件回调失败：HTTP ${response.status}`)
        return payload.data.event
      } catch (error) {
        lastError = error
        if (attempt < this.maxAttempts) {
          const delay = Math.min(2000, this.retryBaseMs * (2 ** (attempt - 1)))
          await unrefDelay(delay)
        }
      }
    }
    throw lastError
  }
}
