const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('./support/typescript.cjs').loadTypeScript()
const root = path.resolve(__dirname, '..')

class Vec2 {
  constructor (x = 0, y = 0) { this.x = x; this.y = y }
  clone () { return new Vec2(this.x, this.y) }
}
class Component {
  constructor () { this.scheduled = new Set() }
  scheduleOnce (callback) { this.scheduled.add(callback) }
  unschedule (callback) { this.scheduled.delete(callback) }
}
class UITransform { setContentSize (width, height) { this.contentSize = { width, height } } }
const cc = { Vec2, Component, UITransform, _decorator: { ccclass: () => value => value, property: () => () => {} } }
const cache = new Map()
function load (file) {
  if (cache.has(file)) return cache.get(file).exports
  const module = { exports: {} }
  cache.set(file, module)
  const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
  })
  new Function('exports', 'module', 'require', result.outputText)(module.exports, module, name => {
    if (name === 'cc') return cc
    if (name === './ClassicCardFrameStore') return {}
    const base = path.resolve(path.dirname(file), name)
    return load(fs.existsSync(base + '.ts') ? base + '.ts' : path.join(base, 'index.ts'))
  })
  return module.exports
}
const cardModule = load(path.join(root, 'assets/scripts/ui/CardView.ts'))
const { CardView } = cardModule
const { HandController } = load(path.join(root, 'assets/scripts/ui/HandController.ts'))

// Execute the same overlays used by hand and table CardViews, including rebinding.
cc.Color = class { constructor (...rgba) { this.rgba = rgba } }
cc.Vec3 = class { constructor (x, y, z) { Object.assign(this, { x, y, z }) } }
cc.Graphics = class {
  constructor () { this.commands = [] }
  clear () { this.commands = [] }
  moveTo (...args) { this.commands.push(['move', ...args]) }
  lineTo (...args) { this.commands.push(['line', ...args]) }
  quadraticCurveTo (...args) { this.commands.push(['curve', ...args]) }
  close () { this.commands.push(['close']) }
  roundRect (...args) { this.commands.push(['rect', ...args]) }
  fill () { this.commands.push(['fill']) }
  stroke () { this.commands.push(['stroke']) }
}
cc.LabelOutline = class {}
cc.Label = class { static Overflow = { NONE: 0 }; static HorizontalAlign = { CENTER: 1 }; static VerticalAlign = { CENTER: 1 } }
cc.Node = class {
  constructor (name) { this.name = name; this.children = []; this.components = []; this.isValid = true }
  set parent (node) { node.children.push(this) }
  setPosition (position) { this.position = position }
  addComponent (Type) { const component = new Type(); this.components.push(component); return component }
}
const visual = new CardView()
visual.createLevelBadge(new cc.Node('CardVisual'))
assert.equal(visual.levelBadge.active, false)
const marker = visual.levelBadge.components.find(component => component instanceof cc.Graphics)
assert.deepEqual(marker.commands[0], ['move', 5, 56])
assert.ok(marker.commands.some(command => command.join() === 'line,38,23'))
assert.ok(!marker.commands.some(command => command[0] === 'rect'), 'level marker must not tint the full card')
assert.equal(visual.levelBadge.children[0].components.find(component => component instanceof cc.Label).string, '级')
const badgeText = visual.levelBadge.children[0]
assert.equal(badgeText.components.find(component => component instanceof cc.Label).fontSize, 23)
assert.equal(badgeText.components.find(component => component instanceof cc.Label).isBold, true)
assert.equal(badgeText.components.find(component => component instanceof cc.LabelOutline).width, 1.2)
visual.selectionOverlay = new cc.Graphics()
const fullSelectionWash = [['rect', -38, -56, 76, 112, 8], ['fill']]
const unselectedNeighbour = new CardView()
unselectedNeighbour.selectionOverlay = new cc.Graphics()
unselectedNeighbour.bind({ id: 'neighbour', selected: false, interactive: false })
for (const [step, index, size] of [[0, 0, 1], [40, 0, 4], [40, 1, 4], [40, 3, 4], [24, 1, 6]]) {
  visual.configureStackHitArea(step, index, size)
  const hitHeight = visual.hitAreaHeight
  const hitOffsetY = visual.hitAreaOffsetY
  visual.bind({ id: 'level', levelCard: true, selected: true, interactive: false })
  assert.equal(visual.levelBadge.active, true)
  assert.deepEqual(visual.selectionOverlay.commands, fullSelectionWash, 'flat, top, middle and bottom cards use the same full-face wash')
  assert.deepEqual([visual.hitAreaHeight, visual.hitAreaOffsetY], [hitHeight, hitOffsetY], 'selection must not expand or move the hit area')
  visual.configureStackHitArea(32, 1, 4)
  assert.equal(visual.hitAreaHeight, 32)
  assert.deepEqual(visual.selectionOverlay.commands, fullSelectionWash, 'reflow while selected must not clip the wash to the new exposure')
  assert.deepEqual(unselectedNeighbour.selectionOverlay.commands, [], 'selecting a stacked card must not darken an unselected neighbour')
  visual.bind({ id: 'normal', levelCard: false, selected: false, interactive: false })
  assert.equal(visual.levelBadge.active, false, 'reused card must clear the level corner')
  assert.deepEqual(visual.selectionOverlay.commands, [], 'deselect must clear the dark wash')
}

// UITransform.hitTest expects screen coordinates and invokes camera.screenToWorld.
// Simulate that inverse projection, including viewport offset and display scaling.
function harness (scale, offset, rectangles, selected = []) {
  const handlers = new Map()
  const toggled = []
  const controller = new HandController()
  controller.interactive = true
  controller.selectedCardIds = new Set(selected)
  controller.node = {
    on (name, callback, owner) { handlers.set(name, value => callback.call(owner, value)) },
    off (name) { handlers.delete(name) },
    emit (name, value) {
      if (name === 'guandan:card-toggle') toggled.push(value)
      else handlers.get(name)?.(value)
    },
  }
  controller.onLoad()
  const views = new Map()
  const screen = point => new Vec2(point.x * scale + offset.x, point.y * scale + offset.y)
  rectangles.forEach((rect, index) => {
    const view = new CardView()
    view.card = { id: rect.id, interactive: true }
    const transform = { hitTest (point) {
      const x = (point.x - offset.x) / scale
      const y = (point.y - offset.y) / scale
      return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height
    } }
    const node = {
      isValid: true, activeInHierarchy: true, parent: controller.node,
      getSiblingIndex: () => index,
      getComponent: type => type === CardView ? view : transform,
    }
    view.node = node
    view.hitArea = { activeInHierarchy: true, getComponent: () => transform }
    controller.cards.set(rect.id, node)
    views.set(rect.id, view)
  })
  const event = (point, pointerId = 7) => ({
    getID: () => pointerId,
    getLocation: () => screen(point),
    getUILocation: () => new Vec2(point.x, point.y),
  })
  return { controller, views, toggled, screen, event }
}
const flat = ['a', 'b', 'c', 'd', 'e'].map((id, index) => ({ id, x: 100 + index * 50, y: 30, width: 48, height: 100 }))

for (const [scale, offset] of [[1, { x: 0, y: 0 }], [0.5, { x: 38, y: 12 }], [2, { x: 70, y: 24 }], [3, { x: 132, y: 60 }]]) {
  // Begin toward the right: selecting must not originate from the middle/left.
  const forward = harness(scale, offset, flat)
  const view = forward.views.get('c')
  const start = { x: 222, y: 60 }
  const detail = view.touchDetail(forward.event(start))
  assert.deepEqual(detail.screenPoint, forward.screen(start), `scale ${scale}: preserve actual touch position for hitTest`)
  assert.equal(view.hitTestScreenPoint(detail.screenPoint), true)
  view.handleTouchStart(forward.event(start))
  view.handleTouchMove(forward.event({ x: 322, y: 60 }))
  view.handleTouchEnd(forward.event({ x: 322, y: 60 }))
  assert.deepEqual(forward.toggled, ['c', 'd', 'e'], `scale ${scale}: sweep must start at touched c and cross d/e only`)

  const reverse = harness(scale, offset, flat, ['a', 'b', 'c', 'd', 'e'])
  const reverseView = reverse.views.get('d')
  reverseView.handleTouchStart(reverse.event({ x: 272, y: 60 }))
  reverseView.handleTouchMove(reverse.event({ x: 122, y: 60 }))
  reverseView.handleTouchMove(reverse.event({ x: 272, y: 60 }))
  reverseView.handleTouchEnd(reverse.event({ x: 272, y: 60 }))
  assert.deepEqual(reverse.toggled, ['d', 'c', 'b', 'a'], 'reverse/cross-back must deselect each crossed card exactly once')

  const tap = harness(scale, offset, flat)
  tap.views.get('e').handleTouchStart(tap.event({ x: 322, y: 60 }))
  tap.views.get('e').handleTouchEnd(tap.event({ x: 322, y: 60 }))
  assert.deepEqual(tap.toggled, ['e'], 'ordinary tapping remains an alternative to dragging')

  const held = harness(scale, offset, flat)
  held.views.get('d').handleTouchStart(held.event({ x: 272, y: 60 }))
  held.controller.activateLongPressSelection()
  assert.deepEqual(held.toggled, ['d'], 'stationary long press must hit its starting card, not the centre')
  held.views.get('d').handleTouchEnd(held.event({ x: 272, y: 60 }))
  assert.deepEqual(held.toggled, ['d'])

  const cancelled = harness(scale, offset, flat)
  cancelled.views.get('a').handleTouchStart(cancelled.event({ x: 122, y: 60 }))
  cancelled.views.get('a').handleTouchCancel(cancelled.event({ x: 122, y: 60 }))
  cancelled.views.get('a').handleTouchMove(cancelled.event({ x: 322, y: 60 }))
  cancelled.views.get('e').handleTouchStart(cancelled.event({ x: 322, y: 60 }, 8))
  cancelled.views.get('e').handleTouchEnd(cancelled.event({ x: 322, y: 60 }, 8))
  assert.deepEqual(cancelled.toggled, ['e'], 'cancelled gesture must not leak its starting point into the next gesture')

  const overlap = harness(scale, offset, flat)
  const button = overlap.screen({ x: 272, y: 60 })
  overlap.controller.setTouchExclusionPredicate(point => Math.abs(point.x - button.x) < 24 * scale && Math.abs(point.y - button.y) < 40 * scale)
  overlap.views.get('d').handleTouchStart(overlap.event({ x: 272, y: 60 }))
  overlap.views.get('d').handleTouchEnd(overlap.event({ x: 272, y: 60 }))
  assert.deepEqual(overlap.toggled, [], 'an overlapping HUD control uses the same screen-space exclusion')

  const stacked = harness(scale, offset, [
    { id: 'unrelated', x: 100, y: 30, width: 48, height: 130 },
    { id: 'top', x: 250, y: 110, width: 48, height: 90 },
    { id: 'middle', x: 250, y: 80, width: 48, height: 90 },
    { id: 'bottom', x: 250, y: 30, width: 48, height: 100 },
  ])
  stacked.views.get('top').handleTouchStart(stacked.event({ x: 272, y: 185 }))
  stacked.views.get('top').handleTouchMove(stacked.event({ x: 272, y: 50 }))
  stacked.views.get('top').handleTouchEnd(stacked.event({ x: 272, y: 50 }))
  assert.deepEqual(stacked.toggled, ['top', 'middle', 'bottom'], 'downward stacks must sweep the visible topmost card at each point')
}
console.log('Hand touch coordinates passed: actual CardView -> HandController -> drag policy; scales/offsets, both directions, tap, hold, cancel, HUD and stacks')
