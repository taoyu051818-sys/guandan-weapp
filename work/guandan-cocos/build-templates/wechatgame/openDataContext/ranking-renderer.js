const { PAGE_SIZE, pageCount } = require('./ranking-model')
function createRenderer (wx, canvas) {
  const ctx = canvas.getContext('2d')
  const avatars = new Map()
  let view = null
  let revision = 0
  function text (value, x, y, size, color, align = 'left') {
    ctx.font = `${size}px sans-serif`; ctx.fillStyle = color; ctx.textAlign = align
    ctx.fillText(value, x, y)
  }
  function avatar (url) {
    if (!url) return null
    if (avatars.has(url)) return avatars.get(url)
    const entry = { image: wx.createImage(), ready: false }
    const token = revision
    avatars.set(url, entry)
    entry.image.onload = () => { if (token === revision) { entry.ready = true; draw() } }
    entry.image.onerror = () => {}
    entry.image.src = url
    return entry
  }
  function draw () {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (!view) return
    ctx.save(); ctx.scale(canvas.width / 1020, canvas.height / 450)
    if (view.message) text(view.message, 510, 218, 32, '#ddebed', 'center')
    else {
      text('名次', 28, 32, 25, '#a8ccda')
      text('好友', 210, 32, 25, '#a8ccda')
      text('综合分', 975, 32, 25, '#a8ccda', 'right')
      view.rows.slice(view.page * PAGE_SIZE, (view.page + 1) * PAGE_SIZE).forEach((row, index) => {
        const y = 48 + index * 69
        ctx.fillStyle = index % 2 ? '#204456' : '#244c60'
        ctx.fillRect(4, y, 1012, 64)
        text(String(row.rank), 61, y + 42, 29, row.rank <= 3 ? '#f1d696' : '#dfedf3', 'center')
        ctx.fillStyle = '#577888'; ctx.fillRect(128, y + 7, 50, 50)
        const entry = avatar(row.avatarUrl)
        if (entry?.ready) ctx.drawImage(entry.image, 128, y + 7, 50, 50)
        else text('友', 153, y + 42, 27, '#e5f0f4', 'center')
        const chars = Array.from(row.nickname)
        text(chars.slice(0, 14).join('') + (chars.length > 14 ? '…' : ''), 210, y + 42, 29, '#f0f5f6')
        text(String(row.score), 975, y + 42, 30, '#f1d696', 'right')
      })
      text(`第 ${view.page + 1} / ${pageCount(view.rows)} 页`, 510, 435, 25, '#a8ccda', 'center')
    }
    ctx.restore()
  }
  return {
    render (next) { view = next; draw() },
    clear () { revision++; view = null; avatars.clear(); draw() },
  }
}
module.exports = { createRenderer }
