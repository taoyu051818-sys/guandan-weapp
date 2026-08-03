const storage = require('../../lib/storage')
Page({
  data: { stats: {}, winRate: 0 },
  onShow() { const stats = storage.loadStats(); this.setData({ stats, winRate: stats.gamesPlayed ? Math.round(stats.wins / stats.gamesPlayed * 100) : 0 }) },
})
