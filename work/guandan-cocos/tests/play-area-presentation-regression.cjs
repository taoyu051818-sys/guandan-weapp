const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('./support/typescript.cjs').loadTypeScript()
const loadPureUi = name => {
  const file = path.resolve(__dirname, '../assets/scripts/ui', name + '.ts')
  const module = { exports: {} }
  new Function('module', 'exports', 'require', ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText)(module, module.exports, dependency => loadPureUi(dependency))
  return module.exports
}
const playedLayout = loadPureUi('PlayedCardLayout')
class Vec3 {
  constructor (x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }) }
  clone () { return new Vec3(this.x, this.y, this.z) }
  add (v) { this.x += v.x; this.y += v.y; this.z += v.z; return this }
  static ONE = new Vec3(1, 1, 1)
}
class Component { getComponent (kind) { return this.node.getComponent(kind) } }
class Node {
  constructor (name) { this.name = name; this.children = []; this.components = new Map(); this.isValid = true; this.active = true; this.scale = Vec3.ONE.clone(); this.position = new Vec3(); this.worldPosition = new Vec3() }
  set parent (node) { this._parent = node; node?.children.push(this) }
  get parent () { return this._parent }
  get activeInHierarchy () { return this.active && this.isValid && (!this.parent || this.parent.activeInHierarchy) }
  addComponent (kind) { const component = new kind(); component.node = this; this.components.set(kind, component); return component }
  getComponent (kind) { return this.components.get(kind) }
  getChildByName (name) { return this.children.find(child => child.name === name && child.isValid) }
  setPosition (position) { this.position = position.clone() }
  setScale (scale) { this.scale = scale.clone() }
  setRotationFromEuler () {}
  destroy () { this.isValid = false }
}
class UITransform { setContentSize (width, height) { this.width = width; this.height = height } convertToWorldSpaceAR (p) { return p.clone() } convertToNodeSpaceAR (p) { return p.clone() } }
class CardView { bind (card) { this.card = card } }
class Label { static HorizontalAlign = { CENTER: 0 }; static VerticalAlign = { CENTER: 0 } }
let tweens = []
const tween = target => {
  const steps = []
  const instance = { to (duration, props) { steps.push({ duration, props }); return instance }, delay () { return instance }, update (duration, fn) { steps.push({ duration, fn }); return instance }, call (end) { steps.push({ end }); return instance }, start () { tweens.push({ target, steps }); return instance } }
  return instance
}
const cc = { _decorator: { ccclass: () => target => target }, Component, Node, UITransform, Vec3, Label, Color: class {}, UIOpacity: class {},
  tween, Tween: { stopAllByTarget: target => { tweens = tweens.filter(item => item.target !== target) } } }
const filename = path.resolve(__dirname, '../assets/scripts/ui/PlayAreaController.ts')
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true } }).outputText
const record = { exports: {} }
const dependencies = {
  cc, './CardView': { CardView }, './CardPresentationMapper': { mapCardToPresentation: card => card },
  './RuntimeUiFactory': { applyForegroundTextStyle: value => value },
  '../effects/CardFlightController': { PLAYED_CARD_FINAL_SCALE: .8, resolvePlayedCardSpacing: count => Math.min(42, 210 / Math.max(1, count - 1)) },
  './PlayedCardLayout': playedLayout,
}
new Function('module', 'exports', 'require', compiled)(record, record.exports, name => { assert.ok(dependencies[name], name); return dependencies[name] })
const area = new Node('PlayArea').addComponent(record.exports.PlayAreaController)
area.node.addComponent(UITransform)
const action = { playerId: 'p1', type: 'Pair', cards: [{ id: 'a' }, { id: 'b' }] }
area.layout({ width: 1280, height: 720, safeLeft: 80, safeRight: 24, safeTop: 0, safeBottom: 0 })
const own = area.getActionWorldPosition('p1')
const top = area.getActionWorldPosition('p3')
assert.equal(own.x, top.x)
assert.equal(top.y - own.y, 99, 'self and teammate fans stay close with a small visible gap')
assert.ok(top.y - own.y > 118 * .8, 'settled teammate/local card fans leave a visible vertical gap')
assert.ok(area.getActionWorldPosition('p2').x > 340, 'single card sits closer to the right avatar')
assert.ok(area.getActionWorldPosition('p4').x < -284, 'single card sits closer to the left avatar')
assert.deepEqual(area.getActionWorldPosition('p2', 'p2'), own, 'viewer-relative player rotation must preserve the local lane')
area.resetPresentation(1)
area.render([action])
let group = area.node.getChildByName('play-p1')
assert.equal(group.scale.x, .8, 'recovered cards must immediately use their final size')
assert.equal(tweens.length, 0, 'snapshot recovery must not replay landing or shrinking')
area.clearPresentation()
const ticket = area.deferAction(action, 0)
area.render([action])
area.beginAction(action, 0, ticket)
group = area.node.getChildByName('play-p1')
assert.equal(group.scale.x, .8, 'hidden table cards must already have the landing size')
assert.equal(group.getChildByName('played-a').active, false)
area.revealCard(action, 0, 'a', ticket)
assert.equal(group.getChildByName('played-a').active, true)
assert.equal(tweens.length, 0, 'a revealed card must not resize after arrival')
area.revealCard(action, 0, 'b', ticket)
assert.equal(tweens.length, 0, 'shrinking finishes before landing, not after the last card arrives')
area.revealAction(action, 0, ticket)
area.render([action])
assert.equal(tweens.length, 0, 'duplicate updates and final reveal must not animate landed cards')
assert.equal(group.scale.x, .8)
area.resetPresentation(1)
assert.equal(tweens.length, 0, 'recovery must use final size with no replay')
area.revealCard(action, 0, 'a', ticket)
assert.equal(tweens.length, 0, 'an old flight callback cannot revive a reset animation')
area.clearPresentation()
const fallback = area.deferAction(action, 0)
area.render([action])
area.beginAction(action, 0, fallback)
area.revealAction(action, 0, fallback)
assert.equal(tweens.length, 0, 'missing-flight fallback and reduced effects land directly at final size')
area.clearPresentation()
assert.equal(tweens.length, 0, 'destroying a played group must stop its animation')
process.stdout.write('play area layout and landing-size regression checks passed\n')

async function verifyPreLandingShrink () {
  class Handle {
    isActive = true
    onFinish () {}
    complete () { this.isActive = false }
  }
  const flightFile = path.resolve(__dirname, '../assets/scripts/effects/CardFlightController.ts')
  const flightCode = ts.transpileModule(fs.readFileSync(flightFile, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const module = { exports: {} }
  const deps = { cc, '../ui/PlayedCardLayout': playedLayout, './EffectHandle': { EffectHandle: Handle }, './VfxCardSnapshot': { preloadVfxCardFrames: async () => true } }
  new Function('module', 'exports', 'require', flightCode)(module, module.exports, name => { assert.ok(deps[name], name); return deps[name] })
  const flightRoot = new Node('Flights')
  flightRoot.addComponent(UITransform)
  const landed = []
  const pool = { acquireCard: card => new Node(card.id), releaseCard: () => {} }
  const flight = new module.exports.CardFlightController(flightRoot, pool)
  flight.play(action.cards, [new Vec3(0, -248)], new Vec3(72, 78), 300, undefined, card => landed.push(card.id))
  await Promise.resolve()
  assert.equal(tweens.length, 2)
  for (const [index, entry] of tweens.entries()) {
    const update = entry.steps.find(step => step.fn).fn
    update(entry.target, 0)
    assert.equal(entry.target.scale.x, 1)
    update(entry.target, .5)
    assert.ok(entry.target.scale.x < 1 && entry.target.scale.x > .8)
    update(entry.target, .85)
    assert.equal(entry.target.scale.x, .8, 'shrink must finish before arrival')
    assert.equal(landed.length, index, 'the pre-landing shrink must not fabricate a card arrival')
    update(entry.target, 1)
    assert.equal(entry.target.scale.x, .8)
    assert.equal(entry.target.position.x, 72 + (index - .5) * 42 * .8, 'flight and static card fan positions must match exactly')
    assert.equal(entry.target.position.y, 78)
    entry.steps.find(step => step.end).end()
  }
  assert.deepEqual(landed, ['a', 'b'])
  process.stdout.write('card flight pre-landing 80% scale and exact handoff regression checks passed\n')
}
verifyPreLandingShrink().catch(error => { console.error(error); process.exitCode = 1 })

for (const viewport of [
  { width: 1280, height: 720, safeLeft: 0, safeRight: 0 },
  { width: 1565, height: 720, safeLeft: 32, safeRight: 48 },
  { width: 1792, height: 720, safeLeft: 96, safeRight: 24 },
  { width: 874, height: 402, safeLeft: 44, safeRight: 8, safeTop: 0, safeBottom: 12 },
]) {
  const hudLayout = loadPureUi('TableHudLayoutPolicy')
  const bounds = hudLayout.resolveTableHudBounds(viewport)
  for (const side of [1, 3]) {
    const single = playedLayout.playedCardPosition(viewport, side, 1)
    const timer = playedLayout.turnTimerPosition(viewport, side === 1 ? 'right' : 'left')
    assert.deepEqual(timer, single, 'side clock occupies the corresponding avatar-side played card slot')
    assert.deepEqual(hudLayout.clampTableHudOverlayPosition(timer, { width: 112, height: 112 }, bounds), timer, 'normal landscape safe areas must not shift the clock out of the played-card slot')
    for (const count of [2, 5, 6, 8, 10, 12]) {
      const fan = playedLayout.playedCardPosition(viewport, side, count)
      const spread = (count - 1) * playedLayout.playedCardSpacing(count) * .8 / 2
      assert.ok(Math.abs((fan.x + (side === 1 ? spread : -spread)) - single.x) < 1e-8, 'avatar-side edge stays anchored, not fan centre')
      assert.equal(fan.y - 118 * .8 / 2, single.y - 118 * .8 / 2, 'all combinations share the same bottom')
    }
  }
  assert.deepEqual(playedLayout.turnTimerPosition(viewport, 'top'), { x: 0, y: 218 }, 'teammate timer is unchanged')
  assert.deepEqual(playedLayout.turnTimerPosition(viewport, 'bottom'), { x: 0, y: 44 }, 'local operation row is unchanged')
}
const orderTableLayers = loadPureUi('TableLayerOrder').orderTableLayers
const layerRoot = { children: [] }
const layer = name => { const node = { name, parent: layerRoot, isValid: true, setSiblingIndex () {
  layerRoot.children.splice(layerRoot.children.indexOf(node), 1); layerRoot.children.push(node)
} }; layerRoot.children.push(node); return node }
const handLayer = layer('hand'), playLayer = layer('plays'), flightLayer = layer('flight'), fxLayer = layer('fx'), hudLayer = layer('hud')
orderTableLayers(layerRoot, [handLayer, flightLayer, fxLayer, hudLayer])
assert.deepEqual(layerRoot.children.map(n => n.name), ['plays', 'hand', 'flight', 'fx', 'hud'])
assert.equal(handLayer.parent, layerRoot, 'raising hand must not change its coordinate space')
