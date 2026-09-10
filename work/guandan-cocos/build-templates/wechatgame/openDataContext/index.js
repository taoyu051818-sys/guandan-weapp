// Runs exclusively in WeChat's open data domain. Never post user records to the main domain.
const { SCORE_KEY, rowsFromFriends, pageCount } = require('./ranking-model')
const { createRenderer } = require('./ranking-renderer')
const renderer = createRenderer(wx, wx.getSharedCanvas())
let revision = 0
let active = false
let rows = []
let page = 0
let timer = null
let loaded = false
function show () {
  renderer.render({ rows, page, message: rows.length ? '' : '暂无已同步综合分的微信好友' })
}
wx.onMessage(message => {
  if (message?.type !== 'friend-ranking') return
  if (message.action === 'close') {
    active = false; revision++; rows = []; page = 0
    clearTimeout(timer); renderer.clear(); return
  }
  if (message.action === 'next' || message.action === 'previous') {
    if (!active || !loaded) return
    page = Math.max(0, Math.min(pageCount(rows) - 1, page + (message.action === 'next' ? 1 : -1)))
    show(); return
  }
  if (message.action !== 'open') return
  active = true; rows = []; page = 0; loaded = false
  const token = ++revision
  clearTimeout(timer)
  renderer.clear()
  renderer.render({ message: '正在读取微信好友排行…' })
  let completed = false
  const finish = (data, failed) => {
    if (completed || !active || token !== revision) return
    completed = true; clearTimeout(timer)
    if (failed) renderer.render({ message: '读取失败，请点刷新或检查权限设置' })
    else { rows = rowsFromFriends(data); loaded = true; show() }
  }
  timer = setTimeout(() => finish(null, true), 10000)
  try {
    wx.getFriendCloudStorage({ keyList: [SCORE_KEY], success: result => finish(result.data, false), fail: () => finish(null, true) })
  } catch { finish(null, true) }
})
