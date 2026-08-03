const settingsKey = 'guandan-settings'
const launchKey = 'guandan-launch'
const statsKey = 'guandan-stats'
const onlineKey = 'guandan-online-session'
const defaults = { difficulty: 'medium', soundEnabled: true, bgmEnabled: true, sortOrder: 'desc', rulePreset: 'classic', visualTheme: 'luxury' }
const defaultStats = { gamesPlayed: 0, wins: 0, bombsPlayed: 0, firstPlaceFinishes: 0, elo: 1000, recentMatch: null }
const loadSettings = () => ({ ...defaults, ...(wx.getStorageSync(settingsKey) || {}) })
const saveSettings = (settings) => wx.setStorageSync(settingsKey, { ...loadSettings(), ...settings })
const loadLaunch = () => wx.getStorageSync(launchKey) || { difficulty: loadSettings().difficulty, gameMode: 'standard' }
const saveLaunch = (launch) => wx.setStorageSync(launchKey, launch)
const loadStats = () => ({ ...defaultStats, ...(wx.getStorageSync(statsKey) || {}) })
const saveStats = (stats) => wx.setStorageSync(statsKey, { ...loadStats(), ...stats })
const loadOnline = () => wx.getStorageSync(onlineKey) || null
const saveOnline = (session) => wx.setStorageSync(onlineKey, session)
const clearOnline = () => wx.removeStorageSync(onlineKey)
module.exports = { loadSettings, saveSettings, loadLaunch, saveLaunch, loadStats, saveStats, loadOnline, saveOnline, clearOnline }
