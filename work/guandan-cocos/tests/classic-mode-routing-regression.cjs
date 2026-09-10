const assert = require('node:assert/strict')
const path = require('node:path')
const { loadTs } = require('./support/load-typescript-module.cjs')
const root = path.resolve(__dirname, '../assets/scripts')
const core = loadTs(path.join(root, 'core/generated/lib/classicModes.ts'))
class Color { constructor (...rgba) { this.rgba = rgba } }
class Vec3 { constructor (x, y, z) { Object.assign(this, { x, y, z }) } }
class Node {
  static EventType = { TOUCH_END: 'end' }
  constructor (name) { this.name = name; this.events = {} }
  setPosition (p) { this.position = p }
  on (type, fn) { this.events[type] = fn }
}
const cc = { Color, Vec3, Node, tween: node => ({ delay () { return this }, to (_, props) { Object.assign(node, props); return this }, start () {} }) }
const catalog = loadTs(path.join(root, 'scenes/front-pages/LobbyPageCatalog.ts'), { cc, '../../core/generated/lib/classicModes': core })
const imports = { cc, './LobbyPageCatalog': catalog, '../../core/generated/lib/classicModes': core }
for (const module of ['../../ui/RuntimeUiFactory', '../../ui/LobbyLayoutPolicy', '../../ui/LobbyMenuView', '../../ui/LobbyAmbientMotion', '../../services/WechatFriendInvite',
  './FriendRoomSettingsPresenter', './FriendRoomPlatformFlow', './FriendRoomWaitingPresenter', './LobbyPlayerProfilePresenter']) imports[module] = {}
const { LobbyPageDomain } = loadTs(path.join(root, 'scenes/front-pages/LobbyPageDomain.ts'), imports)

for (const [width, height] of [[960, 600], [1280, 589], [1280, 720]]) {
  let nodes, labels, cards
  const calls = []
  const record = (name, x, y, w, h) => { const n = new Node(name); Object.assign(n, { width: w, height: h }); n.setPosition(new Vec3(x, y, 0)); nodes.push(n); return n }
  const ui = {
    panel: (name, x, y, w, h) => record(name, x, y, w, h),
    button: (name, text, x, w, h) => Object.assign(record(name, x, 0, w, h), { text }),
    outlinedLabel: text => { labels.push(text) },
    imageCard: (name, art, x, y, w, h, action) => { const n = record(name, x, y, w, h); cards.push({ n, action }); return n },
  }
  const domain = Object.create(LobbyPageDomain.prototype)
  Object.assign(domain, { destroyed: false, reflowing: true, classicRoomMode: 'classic', dependencies: {
    isDisposed: () => false,
    router: { open: () => { nodes = []; labels = []; cards = []; return ui } },
    screen: { safeSize: () => ({ x: width, y: height }), safeLeftX: n => -width / 2 + n, safeRightX: n => width / 2 - n, safeTopY: n => height / 2 - n, safeBottomY: n => -height / 2 + n },
    beginMatch: (...args) => calls.push(args),
  } })
  domain.showClassicRooms()
  for (const mode of core.CLASSIC_MODES) {
    const tab = nodes.find(n => n.text === mode.label)
    tab.events.end?.()
    assert.equal(domain.classicRoomMode, mode.id)
    assert.deepEqual(nodes.filter(n => n.name === 'ClassicModeTab').map(n => n.text), ['经典', '不洗牌', '连打过A'])
    assert.ok(labels.includes(mode.description))
    assert.ok(!labels.includes('经典掼蛋'), 'no duplicate title may obscure the first mode')
    const tabs = nodes.filter(n => n.name === 'ClassicModeTab'), panel = nodes.find(n => n.name === 'ClassicModePanel')
    for (const t of tabs) {
      assert.equal(t.height, 48)
      assert.ok(Math.abs(t.position.y - panel.position.y) + t.height / 2 < panel.height / 2)
    }
    assert.ok(tabs[0].position.y - tabs[1].position.y - 48 >= 8)
    cards.forEach(({ action }) => action())
  }
  assert.deepEqual(calls.map(c => c[0]), core.CLASSIC_QUEUES.map(q => q.id))
  assert.ok(calls.every(c => c[2] === 'classic-rooms'))
}
console.log('Classic mode routing passed: three tabs, 12 queue actions, compact menu bounds and return origin')
