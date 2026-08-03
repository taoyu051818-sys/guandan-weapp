const { makeDecision } = require('../core/lib/ai')

class AiExecutor {
  constructor() {
    this.worker = null
    this.sequence = 0
    this.pending = new Map()
  }

  ensureWorker() {
    if (this.worker || !wx.createWorker) return this.worker
    try {
      this.worker = wx.createWorker('workers/ai.js')
      this.worker.onMessage((message) => {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        if (message.error) pending.reject(new Error(message.error))
        else pending.resolve(message.cards || null)
      })
      this.worker.onError(() => {
        this.pending.forEach(({ reject }) => reject(new Error('AI Worker 不可用')))
        this.pending.clear()
        this.worker = null
      })
    } catch (_) { this.worker = null }
    return this.worker
  }

  decide(input) {
    // 简单/中等计算很轻，保留同步策略；高难度交给小程序 Worker，避免牌桌掉帧。
    if (!['hard', 'master'].includes(input.difficulty) || !this.ensureWorker()) {
      return Promise.resolve(makeDecision(input.hand, input.lastPlay, input.difficulty, input.myTeam, input.players, input.myPlayerId, input.aiContext))
    }
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ id, ...input })
    })
  }

  dispose() {
    this.pending.forEach(({ reject }) => reject(new Error('AI executor disposed')))
    this.pending.clear()
    if (this.worker) this.worker.terminate()
    this.worker = null
  }
}

module.exports = { AiExecutor }
