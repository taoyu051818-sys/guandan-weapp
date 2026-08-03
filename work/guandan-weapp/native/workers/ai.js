const { makeDecision } = require('../core/lib/ai')

worker.onMessage((payload) => {
  try {
    const cards = makeDecision(payload.hand, payload.lastPlay, payload.difficulty, payload.myTeam, payload.players, payload.myPlayerId, payload.aiContext)
    worker.postMessage({ id: payload.id, cards })
  } catch (error) {
    worker.postMessage({ id: payload.id, error: error && error.message ? error.message : 'AI 计算失败' })
  }
})
