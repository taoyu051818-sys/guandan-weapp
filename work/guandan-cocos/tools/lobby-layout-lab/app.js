import { resolveLobbyLayout, LOBBY_LAYOUT_BASELINE } from '/shared/LobbyLayoutPolicy.js'
import { resolveSafeHorizontalLane } from '/shared/SafeAreaLayout.js'
import { auditTableLayoutOverlaps } from '/shared/TableLayoutOverlapAudit.js'
import { drawCandidate02, candidate02Layout } from '/candidate02.js'
import { createLobbyFlows } from '/flows.js'

const W = 874, H = 402, SCALE = W / 1280
const $ = id => document.getElementById(id)
const canvas = $('canvas'), ctx = canvas.getContext('2d')
const storageKey = 'lingshui:lobby-layout-lab:v1'
const preset = { ...LOBBY_LAYOUT_BASELINE, gapDelta: 4 / SCALE, quickY: 8 / SCALE }
// Align the button's right edge to the right card's outer rim in this candidate.
const baseFrame = { width: 1280, height: H / SCALE, left: -640, right: 640, top: H / SCALE / 2, bottom: -H / SCALE / 2 }
const initial = resolveLobbyLayout(baseFrame, preset)
preset.quickX = initial.firstCardX + 2 * (initial.cardWidth + initial.gap) + initial.cardWidth / 2 + 4 - (initial.quickX + initial.quickWidth / 2)
const fields = [
  ['cardsX', '玩法区左右', -90, 90, 1, 'px'], ['cardsY', '玩法区上下', -70, 70, 1, 'px'],
  ['gapDelta', '卡片间距增量', -6, 24, 1, 'px'], ['cardScale', '卡片大小', 85, 110, 1, '%'],
  ['titleY', '标题上下', -24, 30, 1, 'px'], ['quickX', '主按钮左右', -90, 30, 1, 'px'],
  ['quickY', '主按钮上下', -10, 70, 1, 'px'], ['shopScale', '商城大小', 80, 110, 1, '%'],
]
// Visual controls use top-left screen coordinates; shared engine geometry uses Y-up.
const toUi = (key, value) => key.endsWith('Scale') ? value * 100 : value * SCALE * (key.endsWith('Y') ? -1 : 1)
const fromUi = (key, value) => key.endsWith('Scale') ? value / 100 : value / SCALE * (key.endsWith('Y') ? -1 : 1)
const valid = input => input && fields.every(([key, , min, max]) => Number.isFinite(input[key]) && toUi(key, input[key]) >= min - .01 && toUi(key, input[key]) <= max + .01)
let candidate = { ...preset }, history = [], mode = 'candidate', gesture = null, regions = [], images = {}, ready = false
let restored = false
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || 'null')
  if (saved?.schema === 1 && valid(saved.adjustments)) { candidate = { ...saved.adjustments }; restored = true }
} catch { /* unavailable local storage must not prevent preview */ }
const drafts = { candidate: { value: candidate, history: [] }, candidate2: { value: { ...LOBBY_LAYOUT_BASELINE }, history: [] } }
try { const saved=JSON.parse(localStorage.getItem(storageKey+':candidate2')||'null'); if(saved?.schema===1&&valid(saved.adjustments)) drafts.candidate2.value={...saved.adjustments} } catch {}
let variant = 'candidate2'
candidate = drafts.candidate2.value
const isV2 = () => mode !== 'baseline' && variant === 'candidate2'
const versionName = () => mode === 'baseline' ? '原版基准' : variant === 'candidate2' ? '候选 02' : '候选 01'
const status = text => { $('feedback').textContent = text }
const flows = createLobbyFlows(status, () => $('state').value)
const pushHistory = () => { history.push({ ...candidate }); if (history.length > 60) history.shift() }
fields.forEach(([key, label, min, max, step, unit]) => {
  const block = document.createElement('div'); block.className = 'control'
  block.innerHTML = `<label for="${key}-range">${label}<span>${unit}</span></label><div class="row"><input id="${key}-range" type="range" min="${min}" max="${max}" step="${step}"><input id="${key}-number" type="number" min="${min}" max="${max}" step="${step}" aria-label="${label}数值"></div>`
  $('controls').append(block)
  const start = () => { if (gesture !== key) { pushHistory(); gesture = key } }
  for (const suffix of ['range', 'number']) {
    const input = $(`${key}-${suffix}`)
    input.addEventListener('input', () => {
      if (mode !== 'candidate' || !Number.isFinite(input.valueAsNumber)) return
      start(); candidate[key] = fromUi(key, Math.min(max, Math.max(min, input.valueAsNumber)))
      render(); status('候选参数已修改；原版基准未改变。可撤销或导出。')
    })
    input.addEventListener('change', () => { gesture = null; render() })
    input.addEventListener('blur', () => { gesture = null; render() })
  }
})
function panel(x, y, w, h, fill, stroke = '', radius = 6, line = 1) {
  ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, radius)
  if (fill) { ctx.fillStyle = fill; ctx.fill() }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = line; ctx.stroke() }
}
function label(text, x, y, size, width, color = '#fff1b2', outline = '#3a2c18', line = 2, bold = true) {
  ctx.save(); ctx.font = `${bold ? 'bold ' : ''}${size}px Arial, 'PingFang SC', sans-serif`
  const measured = ctx.measureText(text).width
  if (measured > width) ctx.font = `${bold ? 'bold ' : ''}${size * width / measured}px Arial, 'PingFang SC', sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'
  if (line) { ctx.strokeStyle = outline; ctx.lineWidth = line * 2; ctx.strokeText(text, x, y) }
  ctx.fillStyle = color; ctx.fillText(text, x, y); ctx.restore()
}
const point = (x, y) => [W / 2 + x * SCALE, H / 2 - y * SCALE]
function image(name, x, y, w, h) { ctx.drawImage(images[name], x - w / 2, y - h / 2, w, h) }
function region(id, name, x, y, w, h, role = 'control', disabled = false) {
  const item = { id, label: name, role, interactive: role === 'control', rect: { left: x - w / 2, bottom: H - y - h / 2, width: w, height: h } }
  regions.push(item)
  if (!item.interactive) return
  let button = $(`hit-${id}`)
  if (!button) {
    button = document.createElement('button'); button.id = `hit-${id}`
    button.addEventListener('click', () => {
      if (isV2()) flows.open(id)
      else status(`布局模拟：点击「${button.getAttribute('aria-label')}」。不登录、不进入真实房间、不提交请求。`)
    })
    $('hotspots').append(button)
  }
  button.setAttribute('aria-label', name); button.disabled = disabled
  Object.assign(button.style, { left: `${(x - w / 2) / W * 100}%`, top: `${(y - h / 2) / H * 100}%`, width: `${w / W * 100}%`, height: `${h / H * 100}%` })
}
function drawProfile(frame, layout) {
  const long = $('state').value === 'long', name = long ? '陵水海岸的快乐掼蛋玩家' : '陵水玩家', points = long ? '积分 123456789' : '积分 10000'
  const estimate = (text, size) => [...text].reduce((sum, c) => sum + (c.charCodeAt(0) < 128 ? size * .58 : size), 0)
  const identityWidth = Math.max(176, Math.min(210, Math.max(estimate(name, 24) + 30, estimate('ID 12345678', 20) + 24)))
  const left = frame.left + 14, right = Math.max(left + 220, Math.min(layout.profileRight, frame.right - 14))
  const lane = resolveSafeHorizontalLane(left, right, [
    { id: 'avatar', preferredWidth: 64, minWidth: 60, priority: 100, canHide: false },
    { id: 'identity', preferredWidth: identityWidth, minWidth: 140, priority: 95, canHide: false },
    { id: 'points', preferredWidth: Math.max(150, estimate(points, 24) + 42), minWidth: 112, priority: 90, canHide: false },
  ], 12)
  for (const item of lane) {
    const [x, y] = point(item.x, frame.top - 52), w = item.width * SCALE
    if (item.id === 'avatar') {
      panel(x, y, 64 * SCALE, 64 * SCALE, '#050908b2', '', 32 * SCALE)
      image('avatar', x, y, 58 * SCALE, 58 * SCALE); region('avatar', '个人头像', x, y, 64 * SCALE, 64 * SCALE)
    } else if (item.id === 'identity') {
      panel(x, y, w, 64 * SCALE, '#040808ac', '', 32 * SCALE)
      label(name, x, y - 13 * SCALE, 24 * SCALE, w - 18 * SCALE, '#fff1b2', '#2e2418', 3 * SCALE)
      label('ID 12345678', x, y + 16 * SCALE, 20 * SCALE, w - 18 * SCALE, '#cedad6', '#182a26', SCALE, false)
      region('identity', '账号资料', x, y, w, 64 * SCALE)
    } else {
      panel(x, y, w, 44 * SCALE, '#040808ac', '', 22 * SCALE)
      image('coin', x - w / 2 + 18 * SCALE, y, 26 * SCALE, 27 * SCALE)
      label(points, x + 12 * SCALE, y, 24 * SCALE, w - 38 * SCALE, '#ffeea8', '#2f311f', 2 * SCALE)
      region('points', '积分信息', x, y, w, 44 * SCALE, 'information')
    }
  }
}
function render() {
  document.body.classList.toggle('baseline', mode === 'baseline')
  const adjustments = mode === 'baseline' ? LOBBY_LAYOUT_BASELINE : candidate
  fields.forEach(([key]) => ['range', 'number'].forEach(suffix => {
    const el = $(`${key}-${suffix}`); el.value = Math.round(toUi(key, adjustments[key]) * 10) / 10; el.disabled = mode === 'baseline' || (isV2() && key === 'titleY')
    el.closest('.control').hidden = isV2() && key === 'titleY'
  }))
  $('baseline').setAttribute('aria-pressed', String(mode === 'baseline'))
  $('candidate').setAttribute('aria-pressed', String(mode === 'candidate' && variant === 'candidate'))
  $('candidate2').setAttribute('aria-pressed', String(isV2()))
  $('version').textContent = versionName() + (mode === 'baseline' ? ' · 参数锁定' : ' · 独立参数')
  $('notes-title').textContent = isV2() ? '两主一辅，左侧留景' : '原版与第一轮微调对照'
  $('notes-copy').textContent = isV2() ? '头像、昵称、积分共用一块半透明底板，位置保持不变。取消大厅标题、玩法说明和设置入口；商城小鸡 70 px，底部渐隐。' : '候选 01 仅增加 4 px 卡片间距，并调整快速开始位置。原版参数与素材保留。'
  $('undo').disabled = mode === 'baseline' || !history.length
  $('save').disabled = mode === 'baseline'
  if (!ready) return
  const inset = $('safe').value === 'notch' ? 32 / SCALE : 0, bottomInset = inset ? 8 / SCALE : 0
  const frame = { ...baseFrame, width: 1280 - 2 * inset, height: baseFrame.height - bottomInset, left: -640 + inset, right: 640 - inset, bottom: baseFrame.bottom + bottomInset }
  const layout = resolveLobbyLayout(frame, adjustments)
  ctx.setTransform(2, 0, 0, 2, 0, 0); ctx.clearRect(0, 0, W, H); regions = []
  const cover = Math.max(W / images.background.width, H / images.background.height)
  image('background', W / 2, H / 2, images.background.width * cover, images.background.height * cover)
  if (isV2()) {
    drawCandidate02({ ctx, images, panel, label, image, region }, adjustments, inset*SCALE, bottomInset*SCALE, $('state').value)
  } else {
  drawProfile(frame, layout)
  const [tx, ty] = point(layout.titleX, layout.titleY)
  label('陵水掼蛋', tx, ty, layout.titleSize * SCALE, layout.cardsAreaWidth * SCALE, '#ffefa4', '#3a2c18', 4 * SCALE)
  region('title', '游戏标题', tx, ty, 178 * SCALE, (layout.titleSize + 6) * SCALE, 'information')
  ;[['classic', '经典掼蛋'], ['friend', '好友房'], ['tournament', '赛事玩法（开发中）']].forEach(([key, name], i) => {
    const [x, y] = point(layout.firstCardX + i * (layout.cardWidth + layout.gap), layout.cardY)
    const w = layout.cardWidth * SCALE, h = layout.cardHeight * SCALE
    panel(x, y, w + 8 * SCALE, h + 8 * SCALE, '#fff8dcf5', '#ffdc71', 8 * SCALE, 3 * SCALE)
    image(key, x, y, w, h)
    if (key === 'tournament') {
      const bx = x + w / 2 - 53 * SCALE, by = y - h / 2 + 23 * SCALE
      panel(bx, by, 90 * SCALE, 30 * SCALE, '#1c394aee', '', 8 * SCALE)
      label('开发中', bx, by, 20 * SCALE, 80 * SCALE, '#f5edcf', '#1c394a', SCALE, false)
    }
    region(key, name, x, y, w + 8 * SCALE, h + 8 * SCALE)
  })
  for (const [name, offset] of [['规则', 62], ['更多', 156]]) {
    const [x, y] = point(frame.left + offset, layout.utilityY)
    panel(x, y, 84 * SCALE, 44 * SCALE, '#1a3338e0', '#f1cf65f5', 6 * SCALE, 2 * SCALE)
    label(name, x, y, 22 * SCALE, 72 * SCALE, '#fff0b5', '#302820', 2 * SCALE)
    region(name, name, x, y, 84 * SCALE, 44 * SCALE)
  }
  const [sx, sy] = point(layout.shopX, layout.shopY), size = layout.shopSize * SCALE
  image('shop', sx, sy, size, size)
  label('商城', sx, sy + size * .34, Math.max(24, layout.shopSize * .18) * SCALE, size - 12 * SCALE, '#ffe269', '#3a2311', 4 * SCALE)
  region('shop', '商城', sx, sy, size + 6 * SCALE, size + 6 * SCALE)
  const [qx, qy] = point(layout.quickX, layout.quickY), qw = layout.quickWidth * SCALE, qh = layout.quickHeight * SCALE
  panel(qx, qy, qw, qh, '#efb943', '#ffebad', 9 * SCALE, 2 * SCALE)
  panel(qx, qy, qw - 8 * SCALE, qh - 8 * SCALE, '', '#ae6e1b7d', 6 * SCALE, SCALE)
  panel(qx, qy - qh / 2 + 5 * SCALE, qw - 20 * SCALE, 2 * SCALE, '#fff8d0c8', '', 1)
  const state = $('state').value, busy = state === 'loading'
  const title = busy ? '正在恢复' : state === 'resume' ? '继续牌局' : '快速开始'
  const subtitle = busy ? '正在确认牌局状态' : state === 'resume' ? '返回尚未结束的牌局' : '经典 · 初级场'
  label(title, qx, qy - 11 * SCALE, 30 * SCALE, qw - 24 * SCALE, '#562e11', '#ffe8a3', SCALE)
  label(subtitle, qx, qy + 18 * SCALE, 20 * SCALE, qw - 24 * SCALE, '#563119', '#ffdf92', .5 * SCALE, false)
  region('quick', title, qx, qy, qw, qh, 'control', busy)
  }
  for (const button of $('hotspots').children) button.hidden = !regions.some(r => button.id === `hit-${r.id}`)
  const report = auditTableLayoutOverlaps(regions, { width: W, height: H })
  $('audit-count').textContent = ` · ${report.overlaps.length} 处`
  const outside = regions.filter(r => r.rect.left < inset * SCALE || r.rect.left + r.rect.width > W - inset * SCALE || r.rect.bottom < bottomInset * SCALE || r.rect.bottom + r.rect.height > H)
  const list = document.createElement('ul')
  for (const overlap of report.overlaps) {
    const li = document.createElement('li')
    li.textContent = `${overlap.firstLabel} × ${overlap.secondLabel}：${overlap.widthPx} × ${overlap.heightPx} px，${overlap.areaPx2} px²；分别占 ${(overlap.firstAreaRatio * 100).toFixed(1)}% / ${(overlap.secondAreaRatio * 100).toFixed(1)}%。`
    list.append(li)
  }
  for (const r of outside) { const li = document.createElement('li'); li.textContent = `${r.label}：超出当前安全区域（仅告警）。`; list.append(li) }
  if (!list.children.length) { const li = document.createElement('li'); li.textContent = '当前布局没有区域交叠或越界。头像框、按钮文字等内部叠层不作为冲突。'; list.append(li) }
  $('audit-list').replaceChildren(list)
  if ($('guides').checked) {
    ctx.save(); ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.strokeStyle = '#edffb9'
    ctx.strokeRect(inset * SCALE, 0, W - 2 * inset * SCALE, H - bottomInset * SCALE)
    for (const r of regions) {
      const { left, bottom, width, height } = r.rect
      ctx.strokeStyle = report.overlaps.some(o => o.firstId === r.id || o.secondId === r.id) ? '#ff5d79' : '#64ebdc'
      ctx.strokeRect(left, H - bottom - height, width, height)
    }
    ctx.restore()
  }
}
$('baseline').onclick = () => { mode = 'baseline'; render(); status('已切换到原版布局参数。素材与几何保持基准，候选修改未丢失。') }
function switchCandidate(next) {
  drafts[variant] = { value: candidate, history }; variant=next; candidate=drafts[next].value; history=drafts[next].history
  mode='candidate';gesture=null;render();status(`已切换到${versionName()}，各版本参数独立保留。`)
}
$('candidate').onclick = () => switchCandidate('candidate')
$('candidate2').onclick = () => switchCandidate('candidate2')
$('undo').onclick = () => { if (history.length) candidate = history.pop(); gesture = null; render(); status('已撤销上一步参数修改。') }
$('reset').onclick = () => { pushHistory(); candidate = { ...(variant === 'candidate2' ? LOBBY_LAYOUT_BASELINE : preset) }; mode = 'candidate'; render(); status(`已重置${versionName()}，可撤销。其他版本不变。`) }
$('save').onclick = () => {
  try { localStorage.setItem(storageKey+(variant==='candidate2'?':candidate2':''), JSON.stringify({ schema: 1, adjustments: candidate })); $('save-note').textContent = `${versionName()}已保存到本机；刷新后可切换查看。`; status('保存成功；未写入正式游戏。') }
  catch { status('浏览器不允许本地保存，请使用“导出参数”。') }
}
function download(blob, filename) {
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = filename; a.hidden = true; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000)
}
$('export').onclick = () => {
  const data = { schema: 1, baseline: 'table-polish-final-20260907', mode: mode==='baseline'?mode:variant, designSize: { width: W, height: H }, engineWidth: 1280, safePreset: $('safe').value, state: $('state').value, adjustments: mode === 'baseline' ? LOBBY_LAYOUT_BASELINE : candidate,
    ...(isV2()?{candidateOnly:true,rectangles:candidate02Layout(candidate,$('safe').value==='notch'?32:0,$('safe').value==='notch'?8:0)}:{}) }
  download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `lobby-layout-${data.mode}.json`)
  status('已导出布局参数；这是候选配置，不会自动改动 Cocos。')
}
$('png').onclick = () => {
  const guides = $('guides').checked; $('guides').checked = false; render()
  // Export design pixels (874×402), not the backing canvas retina resolution.
  const out = document.createElement('canvas'); out.width = W; out.height = H; out.getContext('2d').drawImage(canvas, 0, 0, W, H)
  const name=mode==='baseline'?mode:variant
  out.toBlob(blob => { if (blob) download(blob, `lobby-${name}-874x402.png`) })
  $('guides').checked = guides; render(); status('已生成 874 × 402 无辅助线画面并触发下载，请查看浏览器下载列表。')
}
for (const id of ['guides', 'safe', 'state']) $(id).addEventListener('change', () => { render(); status('模拟状态已更新；不会访问游戏服务。') })
render()
Promise.all(['background', 'classic', 'friend', 'tournament', 'shop', 'coin', 'avatar'].map(name => new Promise((resolve, reject) => {
  const img = new Image(); const timer = setTimeout(() => reject(new Error(name + ' 加载超时')), 10000)
  img.onload = () => { clearTimeout(timer); images[name] = img; resolve() }
  img.onerror = () => { clearTimeout(timer); reject(new Error(name + ' 加载失败')) }; img.src = '/assets/' + name
}))).then(() => { ready = true; render(); status('候选 02 已就绪。可切换原版与候选 01，或点击大厅入口预览流程。') }).catch(error => { status(`素材加载失败：${error.message}。请刷新或检查本地服务。`); $('png').disabled = true })
