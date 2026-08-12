const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTypeScript } = require('./support/typescript.cjs')

const projectRoot = path.resolve(__dirname, '..')
const sourcePath = path.join(projectRoot, 'assets/scripts/ui/TableHudTurnTimerView.ts')
const ts = loadTypeScript()

assert.equal(fs.existsSync(sourcePath), true)
assert.equal(fs.existsSync(`${sourcePath}.meta`), true)

class MockColor {
  constructor (r = 0, g = 0, b = 0, a = 255) { this.r = r; this.g = g; this.b = b; this.a = a }
}
class MockVec3 {
  constructor (x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z }
}
class MockGraphics {
  constructor () { this.commands = []; this.node = null }
  clear () { this.commands = [] }
  circle (...values) { this.commands.push(['circle', ...values]) }
  fill () { this.commands.push(['fill']) }
  stroke () { this.commands.push(['stroke']) }
  arc (...values) { this.commands.push(['arc', ...values]) }
}
class MockLabel {
  constructor () { this.node = null; this.string = ''; this.color = null }
}
class MockNode {
  constructor (name) {
    this.name = name
    this.children = []
    this.components = new Map()
    this.active = true
    this.isValid = true
    this.position = new MockVec3()
    this.siblingIndex = null
  }
  set parent (parent) {
    if (this._parent) this._parent.children = this._parent.children.filter(child => child !== this)
    this._parent = parent
    if (parent) parent.children.push(this)
  }
  get parent () { return this._parent }
  addComponent (ComponentType) {
    const component = new ComponentType()
    component.node = this
    this.components.set(ComponentType, component)
    return component
  }
  getComponent (ComponentType) { return this.components.get(ComponentType) ?? null }
  setPosition (position) { this.position = position }
  setSiblingIndex (index) { this.siblingIndex = index }
  destroy () {
    if (!this.isValid) return
    this.isValid = false
    this.children.slice().forEach(child => child.destroy())
    this.parent = null
  }
}

const foundation = {
  clamp: (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value)),
  finiteOr: (value, fallback) => Number.isFinite(value) ? Number(value) : fallback,
  configureTransform: node => node,
  createTableHudLabel: parent => {
    const node = new MockNode('TurnSeconds')
    node.parent = parent
    return node.addComponent(MockLabel)
  },
}
const cc = { Color: MockColor, Graphics: MockGraphics, Label: MockLabel, Node: MockNode, Vec3: MockVec3 }
const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  fileName: sourcePath,
  reportDiagnostics: true,
})
const errors = (output.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
assert.deepEqual(errors, [], 'TableHudTurnTimerView must transpile')
const moduleRecord = { exports: {} }
new Function('exports', 'module', 'require', output.outputText)(moduleRecord.exports, moduleRecord, request => {
  if (request === 'cc') return cc
  if (request === './TableGameHudFoundation') return foundation
  throw new Error(`unexpected dependency ${request}`)
})
const { TableHudTurnTimerView } = moduleRecord.exports

const parentA = new MockNode('ParentA')
const timer = new TableHudTurnTimerView()
timer.render({ turnVisible: true, turnSeconds: 40, turnDurationSeconds: 15 })
const timerNode = timer.mount(parentA)
const graphics = timerNode.getComponent(MockGraphics)
const label = timerNode.children[0].getComponent(MockLabel)
assert.equal(timerNode.name, 'CircularTurnTimer')
assert.equal(label.string, '40', 'room seconds must remain unclamped in the label')
const arc = graphics.commands.find(command => command[0] === 'arc')
assert.equal(arc[6], false)
assert.equal(arc[5], -Math.PI / 2 + Math.PI * 2, 'only ring progress must clamp to one duration')

timer.render({ turnVisible: true, turnSeconds: 5, turnDurationSeconds: 15 })
assert.deepEqual(label.color, new MockColor(255, 126, 105), 'the final five seconds must retain the warning color')

const artworkA = new MockNode('ArtworkA')
timer.setArtwork(artworkA)
assert.equal(artworkA.parent, timerNode)
assert.deepEqual(artworkA.position, new MockVec3(0, 2, -2))
assert.equal(artworkA.siblingIndex, 0)
assert.equal(graphics.commands.length, 0, 'packaged artwork must replace fallback ring drawing')
const artworkB = new MockNode('ArtworkB')
timer.setArtwork(artworkB)
assert.equal(artworkA.isValid, false, 'replacing artwork must destroy the previously owned node')

timer.render({ turnVisible: false, turnSeconds: 0, turnDurationSeconds: 15 })
assert.equal(timerNode.active, false)
const parentB = new MockNode('ParentB')
assert.equal(timer.mount(parentB), timerNode, 'remounting must reuse the timer node')
assert.equal(parentA.children.length, 0)
assert.equal(parentB.children.length, 1)

timer.dispose()
timer.dispose()
assert.equal(timerNode.isValid, false, 'dispose must destroy the complete owned timer subtree once')
assert.equal(parentB.children.length, 0)
const remounted = timer.mount(parentA)
assert.notEqual(remounted, timerNode, 'the view must be reusable after disposal')
timer.dispose()

process.stdout.write('table HUD turn-timer view lifecycle regression checks passed\n')
