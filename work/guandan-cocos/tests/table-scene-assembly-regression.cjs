const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('./support/typescript.cjs').loadTypeScript()
const root = path.resolve(__dirname, '..')
let created = 0
class Vec3 {
  constructor (x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }) }
  static ZERO = new Vec3()
}
class UITransform {
  setContentSize (width, height) { this.width = width; this.height = height }
}
class Node {
  constructor (name) { this.name = name; this.active = true; this.components = new Map(); created++ }
  setPosition (position) { this.position = position }
  addComponent (Type) { const value = new Type(); value.node = this; this.components.set(Type, value); return value }
  getComponent (Type) { return this.components.get(Type) }
  on () { assert.fail('node builder must not register listeners') }
}
class Label {
  static Overflow = { SHRINK: 'shrink' }
  static VerticalAlign = { CENTER: 'center' }
  static HorizontalAlign = { LEFT: 'left' }
}
class HandController {}
class PlayAreaController { layout (viewport) { this.viewport = viewport } }
class PlayerSeatController { setChatBubbleAbove (above) { this.above = above } }
const mocks = {
  cc: { Node, Vec3, Label, UITransform },
  '../ui/HandController': { HandController },
  '../ui/PlayAreaController': { PlayAreaController },
  '../ui/PlayerSeatController': { PlayerSeatController },
  '../ui/TableHudLayoutPolicy': { TABLE_HUD_TURN_OPERATION_ANCHORS: { bottom: { y: -44 } } },
}
function load (relative) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', output)(id => {
    assert.ok(mocks[id], `unexpected runtime dependency: ${id}`)
    return mocks[id]
  }, module, module.exports)
  return module.exports
}
const { buildTableSceneNodes } = load('assets/scripts/scenes/TableSceneNodes.ts')
const { layoutTableNodes, layoutTableSeats } = load('assets/scripts/scenes/TableSceneLayout.ts')
const scene = new Node('scene')
const ui = {
  label (name, x, y, fontSize) {
    assert.equal(this, ui)
    const node = new Node(name); node.parent = scene
    node.setPosition(new Vec3(x, y)); node.addComponent(UITransform)
    const label = node.addComponent(Label); label.fontSize = fontSize; return label
  },
  button (name, text, x, width = 244, height = 56, fontSize = 25) {
    assert.equal(this, ui)
    const node = new Node(name); node.parent = scene
    node.addComponent(UITransform).setContentSize(width, height)
    Object.assign(node, { text, fontSize }); node.setPosition(new Vec3(x, 0)); return node
  },
}
const bindings = { playerSeats: new Map(), hintButton: ui.button('InspectorHint', '提示', -62, 112, 54, 28) }
const originalHint = bindings.hintButton
const nodes = buildTableSceneNodes(scene, ui, bindings)
assert.ok(Object.values(nodes).every(value => value != null), 'assembled output has no nullable bindings')
assert.equal(nodes.hintButton, originalHint, 'Inspector binding must be retained')
assert.equal(nodes.playerSeats.size, 4)
const allocationCount = created
buildTableSceneNodes(scene, ui, nodes)
assert.equal(created, allocationCount, 'repeated initialization must not duplicate nodes')
assert.equal(nodes.playButton.fontSize, 28)
assert.equal(nodes.passButton.fontSize, 28)
assert.equal(nodes.playButton.getComponent(UITransform).width, 128)
assert.equal(nodes.passButton.getComponent(UITransform).width, 112)
assert.equal(nodes.skipEffectButton.active, false)

for (const viewport of [
  { width: 1280, height: 720, safeLeft: 0, safeRight: 0, safeTop: 0, safeBottom: 0 },
  { width: 1565, height: 720, safeLeft: 55, safeRight: 88, safeTop: 8, safeBottom: 14 },
  { width: 874, height: 402, safeLeft: 24, safeRight: 24, safeTop: 0, safeBottom: 0 },
]) {
  const screen = {
    safeBottomY: offset => -viewport.height / 2 + viewport.safeBottom + offset,
    safeTopY: offset => viewport.height / 2 - viewport.safeTop - offset,
    safeLeftX: offset => -viewport.width / 2 + viewport.safeLeft + offset,
    safeRightX: offset => viewport.width / 2 - viewport.safeRight - offset,
  }
  const effectRoot = new Node('effects'); effectRoot.addComponent(UITransform)
  layoutTableNodes(viewport, screen, nodes, [effectRoot, null], false)
  assert.equal(nodes.hand.node.position.y, screen.safeBottomY(112))
  assert.equal(nodes.hand.node.getComponent(UITransform).width, Math.max(300, viewport.width - viewport.safeLeft - viewport.safeRight - 380))
  assert.equal(nodes.playArea.viewport, viewport)
  assert.deepEqual([nodes.hintButton.position.x, nodes.passButton.position.x, nodes.playButton.position.x], [-126, 0, 126])
  assert.equal(effectRoot.getComponent(UITransform).height, viewport.height)
  nodes.playButton.setPosition(new Vec3(555, 44))
  layoutTableNodes(viewport, screen, nodes, [], true)
  assert.equal(nodes.playButton.position.x, 555, 'mounted HUD retains ownership of action layout')
  for (const humanId of ['p1', 'p2', 'p3', 'p4']) {
    layoutTableSeats(humanId, screen, nodes.playerSeats)
    assert.equal(nodes.playerSeats.get(humanId).node.position.y, screen.safeBottomY(90))
    const teammateId = ['p1', 'p2', 'p3', 'p4'][(['p1', 'p2', 'p3', 'p4'].indexOf(humanId) + 2) % 4]
    assert.equal(nodes.playerSeats.get(teammateId).node.position.x, -220)
    assert.equal(nodes.playerSeats.get(teammateId).above, false)
  }
}
const sceneSource = fs.readFileSync(path.join(root, 'assets/scripts/scenes/GameScene.ts'), 'utf8')
assert.doesNotMatch(sceneSource, /Object\.assign\(this, nodes\)/, 'scene binding must remain explicit and type checked')
assert.match(sceneSource, /buildTableSceneNodes\(this.node, this.ui, this.tableNodeBindings\(\)\)/)
assert.match(sceneSource, /layoutTableNodes\(viewport/)
assert.doesNotMatch(sceneSource, /new Node\('HumanHand'\)|safeWidth - 380|private makeButton|private makeLabel/)
for (const file of ['FrontPageController.ts', 'front-pages/ShopPageDomain.ts', 'front-pages/ReplayPageDomain.ts']) {
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'assets/scripts/scenes', file), 'utf8'), /DevelopmentApis|SAMPLE_PRODUCTS|SAMPLE_TOURNAMENTS|SAMPLE_DASHBOARD/)
}
console.log('Scene assembly regression passed: Inspector reuse, idempotent construction, unchanged geometry and injected previews')
