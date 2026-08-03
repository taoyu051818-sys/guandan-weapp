const storage = require('../../lib/storage')
Page({
  data: { modePicker: false },
  start(e) {
    const { difficulty, mode } = e.currentTarget.dataset
    storage.saveLaunch({ difficulty, gameMode: mode })
    wx.navigateTo({ url: '/pages/grouping/index' })
  },
  toggleModes() { this.setData({ modePicker: !this.data.modePicker }) },
  open(e) { wx.navigateTo({ url: e.currentTarget.dataset.url }) },
})
