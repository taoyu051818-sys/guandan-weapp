const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('./support/typescript.cjs').loadTypeScript()
const root = path.resolve(__dirname, '..')
class Color { constructor (r, g, b, a = 255) { Object.assign(this, { r, g, b, a }) } }
class Vec3 { constructor (x, y, z) { Object.assign(this, { x, y, z }) } }
class UITransform { setContentSize (width, height) { Object.assign(this, { width, height }) } }
class Node {
  static EventType = { TOUCH_END: 'end' }
  constructor (name) { this.name = name; this.events = {}; this.children = []; this.isValid = true }
  set parent (node) { node.children.push(this); this.parentNode = node }
  setPosition (position) { Object.assign(this, position) }
  addComponent (Type) { return this.transform = new Type() }
  on (event, callback) { this.events[event] = callback }
  pauseSystemEvents () { this.paused = true }
  resumeSystemEvents () { this.paused = false }
}
const load = relative => {
  const module = { exports: {} }
  const source = fs.readFileSync(path.join(root, relative), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } })
  new Function('module', 'exports', 'require', outputText)(module, module.exports, name => {
    if (name === 'cc') return { Color, Vec3, Node, UITransform }
    if (name === '../../ui/LobbyLayoutPolicy') {
      const policy = { exports: {} }
      const code = ts.transpileModule(fs.readFileSync(path.join(root, 'assets/scripts/ui/LobbyLayoutPolicy.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
      new Function('module', 'exports', code)(policy, policy.exports)
      return policy.exports
    }
    if (name === '../../ui/LobbyAmbientMotion') return { attachLobbyAmbientMotion() {} }
    if (name === '../../ui/LobbyMenuView') return {
      renderLobbyEntries: (ui, layout, entries) => entries.forEach(e => {
        const r = layout[e.kind]; const node = ui.panel(e.name, r.x, r.y, r.width, r.height, {})
        Object.assign(node, { art: e.art, action: e.action })
      }),
      renderLobbyShop: (ui, layout, art, action) => {
        const r = layout.shop
        Object.assign(ui.panel('ShopChickArtwork', r.x, r.y, r.width, r.height, {}), { art, action })
      },
      lobbyLabel: (ui, text, x, y, size, width, scale, parent, color, outline, bold = true) =>
        Object.assign(ui.outlinedLabel(text, x, y, size * scale, { width, height: size * scale, parent, color }), { isBold: bold }),
    }
    if (name === './LobbyPageCatalog') return { LOBBY_ART: { entryClassic: 'classic', entryFriend: 'friend', entryTournament: 'tournament', shopChick: 'original-chick' } }
    return {}
  })
  return module.exports.LobbyPageDomain
}
const Current = load('assets/scripts/scenes/front-pages/LobbyPageDomain.ts')

const render = (Type, width, height, inset, recovery = false, pending = false) => {
  const parent = new Node('root'), nodes = [], labels = [], calls = []
  const record = (name, x, y, width, height, style, owner = parent) => {
    const node = new Node(name)
    Object.assign(node, { x, y, width, height, style })
    node.parent = owner
    nodes.push(node)
    return node
  }
  const ui = {
    parent,
    panel: record,
    image: (name, art, x, y, w, h, owner) => Object.assign(record(name, x, y, w, h, {}, owner), { art }),
    imageCard: (name, art, x, y, w, h, action) => Object.assign(record(name, x, y, w, h, {}), { art, action }),
    button: (name, text, x, w, h, fontSize, style) => Object.assign(record(name, x, 0, w, h, style), { text }),
    makeInteractive: (node, action) => { node.action = action },
    outlinedLabel: (text, x, y, fontSize, style) => {
      const label = { text, x, y, fontSize, ...style, isBold: true, node: { getComponent: () => null } }
      Object.defineProperty(label, 'string', { get () { return this.text }, set (value) { this.text = value } })
      labels.push(label)
      return label
    },
  }
  const domain = Object.create(Type.prototype)
  domain.dependencies = {
    router: { current: 'menu', open: () => ui }, gateways: { configured: recovery }, currentPageRequest: () => 0,
    lobby: { snapshot: { recoveryAvailable: recovery }, recoverActiveMatch: () => calls.push('recover') }, isDisposed: () => false,
    screen: { safeSize: () => ({ x: width - 2 * inset, y: height }), safeLeftX: n => -width / 2 + inset + n, safeRightX: n => width / 2 - inset - n, safeTopY: n => height / 2 - n, safeBottomY: n => -height / 2 + n },
    beginMatch: (...args) => calls.push(args), showRules () {}, showMoreMenu () {}, showCompetition () {}, showShop () {},
  }
  domain.playerProfilePresenter = { render () {} }
  domain.wechatInvite = { activate () {} }
  domain.recoveryPending = pending
  domain.refreshLobbyDashboard = () => {}
  domain.renderMenu()
  return { nodes, labels, calls, domain }
}
const geometry = node => [node.x, node.y, node.width, node.height]
const resume = render(Current, 1280, 589, 0, true)
const resumeButton = resume.nodes.find(n => n.name === 'LobbyQuickStart')
assert.equal(resume.labels.filter(n => n.text === '继续牌局').length, 1, 'resume must use the single primary entrance')
assert.equal(resume.nodes.some(n => n.text === '继续牌局'), false, 'no secondary resume button next to rules/more')
resumeButton.events.end()
assert.deepEqual(resume.calls, ['recover'], 'active game recovery must not create a new match')
const busy = render(Current, 1280, 589, 0, true, true)
const busyButton = busy.nodes.find(n => n.name === 'LobbyQuickStart')
assert.equal(busyButton.paused, true)
assert.ok(busy.labels.some(n => n.text === '正在恢复'))
busyButton.events.end()
assert.deepEqual(busy.calls, [], 'even a stale touch event must not submit twice during recovery')
assert.deepEqual(geometry(resumeButton), geometry(busyButton), 'recovery state must not shift the main entrance')
const stableNodes = [...resume.nodes]
resume.domain.setRecoveryPending(true)
assert.deepEqual(resume.nodes, stableNodes, 'pending updates cannot rebuild artwork or replay the entrance')
assert.equal(resume.domain.primaryAction.node, resumeButton, 'the original main button stays mounted')
assert.equal(resumeButton.paused, true)
resume.domain.setRecoveryPending(false)
assert.equal(resumeButton.paused, false, 'completion restores input without rebuilding the lobby')
for (const [width, height] of [[960, 600], [1280, 589], [1280, 720], [1600, 720]]) {
  for (const inset of [0, 44]) {
    const after = render(Current, width, height, inset)
    const scale = Math.min((width - 2 * inset) / 874, height / 402)
    const quick = after.nodes.find(n => n.name === 'LobbyQuickStart')
    assert.equal(quick.width, 210 * scale)
    assert.equal(quick.height, 46 * scale)
    assert.equal(after.nodes.find(n => n.name === 'ShopChickArtwork').width, 70 * scale)
    assert.deepEqual(after.nodes.filter(n => n.art).map(n => n.art), ['classic', 'friend', 'tournament', 'original-chick'])
    const title = after.labels.find(n => n.text === '快速开始'), subtitle = after.labels.find(n => n.text === '随机级牌 · 单局对战')
    assert.equal(title.fontSize, 23 * scale)
    assert.equal(subtitle.fontSize, 12 * scale)
    assert.equal(subtitle.isBold, false)
    for (const label of [title, subtitle]) {
      assert.equal(label.parent, quick, 'labels must inherit button press/release transforms')
      assert.ok(Math.abs(label.y) + label.height / 2 <= quick.height / 2, 'copy must stay inside the original button')
      assert.ok(label.width <= quick.width)
    }
    assert.ok(subtitle.y + subtitle.height / 2 < title.y - title.height / 2, 'title and subtitle must not overlap')
    assert.ok(quick.children.every(n => Object.keys(n.events).length === 0), 'decorations must not register competing input')
    quick.events.end()
    assert.deepEqual(after.calls, [['classic_50', '经典 · 初级场 · 底分50', 'menu']], 'match queue and return page remain unchanged')
    assert.equal(after.nodes.some(n => n.name === 'CompactButton'), false, 'retired lobby utilities stay removed')
  }
}
// Solid button colors: check both normal and pressed states, without crediting outlines.
const luminance = color => {
  const linear = [color.r, color.g, color.b].map(v => { const s = v / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4 })
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722
}
const sample = render(Current, 1280, 589, 0)
const quick = sample.nodes.find(n => n.name === 'LobbyQuickStart')
for (const label of sample.labels.filter(n => n.parent === quick)) {
  for (const background of [quick.style.fill, quick.style.pressedFill]) {
    const a = luminance(label.color), b = luminance(background)
    assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, 'main/subtitle contrast must survive pressing')
  }
}
console.log('Lobby refinement passed: approved art/footprints, copy hierarchy, button bounds, contrast and match route')
