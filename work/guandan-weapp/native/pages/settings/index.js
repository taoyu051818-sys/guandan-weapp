const storage = require('../../lib/storage')
Page({
  data: { settings: {} },
  onShow() { this.setData({ settings: storage.loadSettings() }) },
  choose(e) { const { key, value } = e.currentTarget.dataset; const settings = { ...this.data.settings, [key]: value }; storage.saveSettings(settings); this.setData({ settings }) },
  toggle(e) { const key = e.currentTarget.dataset.key; const settings = { ...this.data.settings, [key]: !this.data.settings[key] }; storage.saveSettings(settings); this.setData({ settings }) },
})
