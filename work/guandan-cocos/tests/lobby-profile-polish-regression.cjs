const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTypeScript } = require('./support/typescript.cjs')
const ts = loadTypeScript()
const root = path.resolve(__dirname, '..')
const compile = (file, imports) => {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } })
  const module = { exports: {} }
  new Function('module', 'exports', 'require', outputText)(module, module.exports, name => {
    if (!(name in imports)) throw new Error('Unexpected import ' + name)
    return imports[name]
  })
  return module.exports
}
class Color { constructor (...values) { this.values = values } }
class Vec3 { constructor (x, y, z) { Object.assign(this, { x, y, z }) } }
class UITransform { setContentSize (width, height) { Object.assign(this, { width, height }) } }
class Node {
  static EventType = { TOUCH_END: 'touch-end' }
  constructor (name) { this.name = name; this.components = []; this.events = {} }
  set parent (root) { root.nodes.push(this) }
  setPosition (value) { this.position = value }
  addComponent (Type) { const component = new Type(); this.components.push(component); return component }
  on (event, callback) { this.events[event] = callback }
}
const storage = new Map([['guandan-local-account-id-v1', '12345678']])
const { LobbyPlayerProfilePresenter } = compile('assets/scripts/scenes/front-pages/LobbyPlayerProfilePresenter.ts', {
  cc: { Color, Node, Vec3, UITransform, Label: { HorizontalAlign: { LEFT: 0 }, Overflow: { SHRINK: 2 } }, sys: { localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } } },
  '../../ui/LobbyMenuView': { lobbyLabel: (ui, text, x, y, size, width, scale) => ui.outlinedLabel(text, x, y, size * scale, { width, height: (size + 4) * scale }) },
  './LobbyPageCatalog': { LOBBY_ART: { defaultAvatar: 'avatar', coin: 'coin' } },
  '../../ui/ProfileAvatar': { mountProfileAvatar: () => {} },
})
const render = ({ width = 1280, configured = true, dashboard = null, fresh = false, points = 99999, inset = 0 } = {}) => {
  const nodes = [], labels = [], panels = []
  let opened = 0, edited = 0
  const left = -width / 2 + inset
  const right = width / 2 - inset
  const ui = {
    parent: { nodes },
    panel: (name, x, y, width, height, style) => panels.push({ name, x, y, width, height, style }),
    image: () => {},
    outlinedLabel: (text, x, y, size, style) => {
      const label = { text, x, y, size, ...style, isBold: true, outlineWidth: 3 }
      labels.push(label)
      return label
    },
  }
  const layout = compile('assets/scripts/ui/LobbyLayoutPolicy.ts', {}).resolveLobbyLayout({ width: right - left, height: 720, left, right, top: 360, bottom: -360 })
  new LobbyPlayerProfilePresenter({
    screen: { safeLeftX: margin => left + margin, safeRightX: margin => right - margin, safeTopY: margin => 360 - margin },
    player: { dashboard }, wallet: { fresh, value: { points } }, platformConfigured: configured,
    session: {}, showPlayerCenter: () => { opened += 1 },
    editProfile: () => { edited += 1 }, auth: {},
  }).render(ui, layout)
  const hit = nodes.find(node => node.name === 'LobbyPlayerProfileHitArea')
  assert.ok(hit)
  const box = hit.components[0]
  const bounds = panels.map(panel => ({ left: panel.x - panel.width / 2, right: panel.x + panel.width / 2 }))
  assert.ok(hit.position.x - box.width / 2 >= left, 'profile must stay within left safe edge')
  assert.ok(hit.position.x + box.width / 2 <= right, 'profile must stay within right safe edge')
  const backing = panels.find(p => p.name === 'LobbyAccountBacking')
  assert.equal(backing.width, 180 * layout.scale)
  assert.equal(backing.style.fill.values[3], 102)
  assert.ok(Math.abs(hit.position.x + box.width / 2 - (backing.x + backing.width / 2)) < .00001)
  assert.deepEqual(labels.map(l => l.size), [17 * layout.scale, 15 * layout.scale])
  assert.ok(labels.every(label => !/胜率|场次|综合分/.test(label.text)), 'performance is disclosed in personal center, not crowded into lobby')
  hit.events[Node.EventType.TOUCH_END]()
  assert.equal(opened, 1, 'account group must open the real personal center')
  nodes.find(node => node.name === 'EditOwnAvatar').events[Node.EventType.TOUCH_END]()
  assert.equal(edited, 1, 'avatar opens the editor directly')
  return labels.map(label => label.text)
}
for (const width of [960, 1280, 1600, 2000]) {
  for (const inset of [0, 44]) {
    assert.deepEqual(render({ width, inset }), ['账号同步中', '--'])
  }
}
assert.deepEqual(render({ dashboard: { user: { displayName: '测试玩家', accountId: '87654321' } }, fresh: true, points: 5200 }), ['测试玩家', '5200'])
assert.deepEqual(render({ configured: false, fresh: true, points: 0 }), ['陵水玩家', '0'])
assert.deepEqual(render({ dashboard: { user: { displayName: '很长的昵称'.repeat(10), accountId: 'invalid' } } }), ['很长的昵…', '--'])
console.log('Compact lobby profile: freshness, safe bounds, text and real navigation verified')
