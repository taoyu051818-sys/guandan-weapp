import { gameResultSignature } from './crypto.js'

export class GameResultReporter {
  constructor ({ endpoint, secret, fetchImpl = globalThis.fetch, now = () => Date.now(), maxAttempts = 3 }) {
    this.endpoint = endpoint
    this.secret = secret
    this.fetchImpl = fetchImpl
    this.now = now
    this.maxAttempts = maxAttempts
  }

  get configured () { return Boolean(this.endpoint) }

  async report (event) {
    if (!this.configured) return { skipped: true }
    const rawBody = JSON.stringify(event)
    let lastError
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const timestamp = String(this.now())
      try {
        const response = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-game-event-id': event.eventId,
            'x-game-timestamp': timestamp,
            'x-game-signature': gameResultSignature(rawBody, this.secret, timestamp),
          },
          body: rawBody,
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok || !payload?.ok) throw new Error(payload?.error?.message || `结算回调失败：HTTP ${response.status}`)
        return payload.data.result
      } catch (error) {
        lastError = error
        if (attempt < this.maxAttempts) await new Promise(resolve => setTimeout(resolve, 100 * (2 ** (attempt - 1))))
      }
    }
    throw lastError
  }
}

