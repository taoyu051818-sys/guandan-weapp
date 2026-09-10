const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTs } = require('./support/load-typescript-module.cjs')
const root = path.resolve(__dirname, '..')
const scriptRoot = path.join(root, 'assets/scripts')
const frame = loadTs(path.join(scriptRoot, 'ui/UiFrameStyle.ts'))
const { UI_FRAME_CORNERS, uiFrameRadius, drawUiFrame } = frame

assert.ok(Object.isFrozen(UI_FRAME_CORNERS))
assert.deepEqual(UI_FRAME_CORNERS, { panel: 8, control: 6, tag: 3, progress: 2, square: 0 })
const commands = []
const pen = { rect: (...args) => commands.push(['rect', ...args]), roundRect: (...args) => commands.push(['roundRect', ...args]) }
for (const kind of Object.keys(UI_FRAME_CORNERS)) for (const [width, height] of [[244, 56], [650, 450], [64, 24], [1, 8], [42, 42]]) {
  const radius = uiFrameRadius(width, height, kind)
  assert.ok(radius <= Math.min(width, height) * .2, 'no frame size may resolve to a capsule')
  commands.length = 0
  drawUiFrame(pen, -width / 2, -height / 2, width, height, kind)
  assert.deepEqual(commands[0].slice(1, 5), [-width / 2, -height / 2, width, height], 'corners do not change layout bounds')
  assert.equal(commands[0][0], kind === 'square' ? 'rect' : 'roundRect')
}
assert.equal(uiFrameRadius(488, 112, 'control', 2), 12, 'scaled lobby uses the same geometry')
assert.equal(uiFrameRadius(244, 56, 'control', NaN), 6)
assert.equal(uiFrameRadius(244, 56, 'control', 0), 6)
commands.length = 0
for (const width of [0, -1, NaN, Infinity]) drawUiFrame(pen, 0, 0, width, 8, 'progress')
drawUiFrame(pen, NaN, 0, 244, 56)
assert.equal(commands.length, 0, 'empty/invalid progress creates no invalid Graphics path')

// Exercise the actual shared factory, including press/cancel/disabled state.
class Color { constructor(...values) { this.values = values } }
class Vec3 { static ONE = new Vec3(1, 1, 1); constructor(x, y, z) { Object.assign(this, { x, y, z }) } }
class Graphics {
  clear() { this.commands = [] }
  rect(...args) { (this.commands ??= []).push(['rect', ...args]) }
  roundRect(...args) { (this.commands ??= []).push(['roundRect', ...args]) }
  fill() {}
  stroke() {}
}
class UITransform { setContentSize(width, height) { this.contentSize = { width, height } } }
class Label { static Overflow = { SHRINK: 1 }; static HorizontalAlign = { CENTER: 1 }; static VerticalAlign = { CENTER: 1 } }
class Node {
  static EventType = { TOUCH_START: 'start', TOUCH_END: 'end', TOUCH_CANCEL: 'cancel' }
  constructor(name) { this.name = name; this.children = []; this.components = new Map(); this.handlers = new Map() }
  set parent(value) { this.owner = value; value.children.push(this) }
  get parent() { return this.owner }
  addComponent(Type) { const c = new Type(); c.node = this; this.components.set(Type, c); return c }
  getComponent(Type) { return this.components.get(Type) }
  setPosition(value) { this.position = value }
  setScale(value) { this.scale = value }
  on(event, callback) { this.handlers.set(event, callback) }
  emit(event) { this.handlers.get(event)?.() }
}
const tween = target => ({ stop() { return this }, to(_time, values) { Object.assign(target, values); return this }, start() { return this } })
const cc = { Color, Vec3, Graphics, UITransform, Label, Node, UIOpacity: class {}, tween }
const { RuntimeUiFactory } = loadTs(path.join(scriptRoot, 'ui/RuntimeUiFactory.ts'), {
  cc, './UiFrameStyle': frame, '../services/GameAssetLoader': { loadGameAsset() {} },
})
const parent = new Node('root')
parent.addComponent(UITransform).setContentSize(1280, 720)
const ui = new RuntimeUiFactory(parent)
const button = ui.button('Play', '出牌', 70, 128, 58, 28)
const graphic = button.getComponent(Graphics)
const normal = [...graphic.commands[0]]
const fill = graphic.fillColor
assert.deepEqual(normal, ['roundRect', -64, -29, 128, 58, 6])
button.emit('start')
assert.notDeepEqual(graphic.fillColor, fill, 'press feedback remains visible')
assert.deepEqual(graphic.commands[0], normal)
for (const event of ['cancel', 'end']) {
  button.emit(event)
  assert.deepEqual(graphic.fillColor, fill)
  assert.deepEqual(graphic.commands[0], normal)
}
assert.deepEqual(button.getComponent(UITransform).contentSize, { width: 128, height: 58 })
const disabled = ui.button('Disabled', '准备', 0, 244, 56, 25, { disabled: true })
assert.equal(disabled.handlers.size, 0)
assert.equal(disabled.getComponent(Graphics).commands[0][5], 6)
const shade = ui.panel('Shade', 0, 0, 1280, 720, { frame: 'square' })
assert.equal(shade.getComponent(Graphics).commands[0][0], 'rect')
const scaled = ui.panel('Scaled', 0, 0, 420, 92, { frame: 'control', frameScale: 2 })
assert.equal(scaled.getComponent(Graphics).commands[0][5], 12)
assert.equal(ui.quickChatButton, undefined, 'retired shortcut factory must not remain')
ui.menuLabel('本局打 2\n我方 / 对方', 0, 0, 20)
assert.equal(parent.children.find(node => node.name === 'MenuLabelBacking').getComponent(Graphics).commands[0][5], 3)

// Raw rounded paths are artwork/card contours, not an alternative UI framework.
// Counted exemptions prevent silently adding another view-local capsule painter.
const rawArtworkPaths = new Map([
  ['ui/CardView.ts', 5], // physical card contours, persistent lock/selection overlays; no draft overlay
  ['ui/CoastalUi.ts', 4], // bag/book/cards icon strokes
  ['ui/TableHudSeatViewGroup.ts', 1], // unchanged avatar border
  ['scenes/front-pages/CoastalPreviewPages.ts', 5], // product illustrations
  ['scenes/front-pages/MatchmakingPageView.ts', 2], // shuffled cards
  ['ui/UiFrameStyle.ts', 1], // sole frame painter
])
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)])
const ts = require('./support/typescript.cjs').loadTypeScript()
for (const file of walk(scriptRoot).filter(file => file.endsWith('.ts'))) {
  const source = fs.readFileSync(file, 'utf8')
  const local = path.relative(scriptRoot, file)
  const count = (source.match(/\.roundRect\(/g) || []).length
  assert.equal(count, rawArtworkPaths.get(local) ?? 0, local + ': use drawUiFrame for UI frames')
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const visit = node => {
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'radius') assert.fail(local + ': numeric frame override bypasses theme')
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'borderRadius') {
      assert.match(node.initializer.getText(ast), /^uiFrameRadius\(/, local + ': native button must share theme')
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  rawArtworkPaths.delete(local)
}
assert.equal(rawArtworkPaths.size, 0, 'remove obsolete artwork exemptions with retired source')
console.log('UI frames: shared geometry, scaling, compact shapes, factory visual states, hit bounds and no capsule bypasses passed')
