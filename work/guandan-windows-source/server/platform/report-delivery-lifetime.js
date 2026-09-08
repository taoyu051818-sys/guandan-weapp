/** Per-match cancellation owns HTTP, response-body reads and every retry timer. */
export class ReportDeliveryLifetime {
  constructor () {
    this.stopped = new Map()
    this.controllers = new Map()
    this.waiters = new Map()
  }

  assertActive (key) {
    const error = this.stopped.get(key)
    if (error) throw error
  }

  stop (key, reason) {
    if (this.stopped.has(key)) return
    const error = reason instanceof Error ? reason : new Error(String(reason))
    this.stopped.set(key, error)
    for (const controller of this.controllers.get(key) || []) controller.abort(error)
    for (const waiter of this.waiters.get(key) || []) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
    this.waiters.delete(key)
  }

  async request (key, timeoutMs, task) {
    this.assertActive(key)
    const controller = new AbortController()
    const active = this.controllers.get(key) || new Set()
    active.add(controller)
    this.controllers.set(key, active)
    const timeoutError = new Error(`观战事件回调超时：${timeoutMs}ms`)
    const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs)
    let onAbort
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(controller.signal.reason || timeoutError)
      controller.signal.addEventListener('abort', onAbort, { once: true })
    })
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => {
          this.assertActive(key)
          return task(controller.signal)
        }),
        aborted,
      ])
      this.assertActive(key)
      return result
    } finally {
      clearTimeout(timer)
      controller.signal.removeEventListener('abort', onAbort)
      active.delete(controller)
      if (!active.size) this.controllers.delete(key)
    }
  }

  wait (key, delay) {
    this.assertActive(key)
    return new Promise((resolve, reject) => {
      const active = this.waiters.get(key) || new Set()
      const waiter = { reject, timer: setTimeout(() => {
        active.delete(waiter)
        if (!active.size) this.waiters.delete(key)
        resolve()
      }, delay) }
      waiter.timer.unref?.()
      active.add(waiter)
      this.waiters.set(key, active)
    })
  }
}
