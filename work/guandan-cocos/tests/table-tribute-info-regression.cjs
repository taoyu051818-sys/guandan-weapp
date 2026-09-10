const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('./support/typescript.cjs').loadTypeScript()
const root = path.resolve(__dirname, '../assets/scripts')
const labels = []
class Vec3 { constructor (x, y, z) { Object.assign(this, { x, y, z }) } }
const load = file => {
  const module = { exports: {} }
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  new Function('require', 'module', 'exports', source)(id => {
    if (id === 'cc') return { Vec3, Color: class {} }
    if (id === './TableGameHudFoundation') return { createTableHudLabel: () => {
      const label = { node: { active: false, setPosition (v) { this.position = v }, setScale (v) { this.scale = v }, destroy () { this.destroyed = true } } }
      labels.push(label); return label
    } }
    return load(path.resolve(path.dirname(file), id + '.ts'))
  }, module, module.exports)
  return module.exports
}
const { tributeInfoText, TableTributeInfoView } = load(path.join(root, 'ui/TableTributeInfoView.ts'))
const { tableButtonWidth, TABLE_BUTTON_HEIGHT } = load(path.join(root, 'ui/TableButtonMetrics.ts'))
const { resolveTableHudFrameLayout, TABLE_HUD_TURN_OPERATION_ANCHORS } = load(path.join(root, 'ui/TableHudLayoutPolicy.ts'))
const players = { p1: { name: '甲' }, p2: { name: '乙' }, p3: { name: '丙' }, p4: { name: '丁' } }
const tribute = { phase: 'tributing', isAntiTribute: false, actions: [{ from: 'p1', to: 'p2' }, { from: 'p3', to: 'p4' }] }
assert.equal(tributeInfoText(tribute, players, 'tribute'), '进贡阶段\n甲 给 乙\n丙 给 丁')
assert.equal(tributeInfoText({ ...tribute, phase: 'returning' }, players, 'tribute'), '还牌阶段\n乙 给 甲\n丁 给 丙')
assert.equal(tributeInfoText(tribute, players, 'playing'), '')
assert.equal(tributeInfoText({ ...tribute, isAntiTribute: true }, players, 'tribute'), '抗贡成立')
const view = new TableTributeInfoView()
view.mount({})
view.render(tributeInfoText(tribute, players, 'tribute'))
assert.equal(labels[0].node.active, true)
for (const height of [589, 720]) {
  const layout = resolveTableHudFrameLayout({ viewport: { width: 1280, height }, backSize: { width: 134.4, height: 69.6 }, roundSize: { width: 240, height: 84 }, seatSize: { width: 280, height: 100 }, suitSize: { width: 480, height: 69.6 }, toolbarSize: { width: 460, height: 69.6 } })
  view.layout(layout.seats.top)
  const node = labels[0].node
  assert.equal(node.position.x, layout.seats.top.x)
  assert.ok(node.position.y + 39 * node.scale.y < layout.seats.top.y - 42 * node.scale.y, 'tribute text is below the partner name')
  const button = TABLE_HUD_TURN_OPERATION_ANCHORS.bottom
  const clearsX = Math.abs(node.position.x - button.x) > 120 * node.scale.x + tableButtonWidth('确认贡牌') / 2
  const clearsY = Math.abs(node.position.y - button.y) > 39 * node.scale.y + TABLE_BUTTON_HEIGHT / 2
  assert.ok(clearsX || clearsY, 'tribute text rectangle does not intersect the tribute submit button')
}
view.render(''); assert.equal(labels[0].node.active, false)
view.dispose(); assert.equal(labels[0].node.destroyed, true)
console.log('Tribute info: direction, phase, partner anchor and button separation passed')
