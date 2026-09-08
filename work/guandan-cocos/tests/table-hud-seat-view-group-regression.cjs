const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTypeScript } = require('./support/typescript.cjs')

const projectRoot = path.resolve(__dirname, '..')
const sourcePath = path.join(projectRoot, 'assets/scripts/ui/TableHudSeatViewGroup.ts')
const metaPath = `${sourcePath}.meta`
const ts = loadTypeScript()

assert.equal(fs.existsSync(sourcePath), true)
assert.equal(fs.existsSync(metaPath), true)

class MockColor {
  constructor (r = 0, g = 0, b = 0, a = 255) { this.r = r; this.g = g; this.b = b; this.a = a }
}
class MockVec3 {
  constructor (x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z }
}
class MockUITransform {
  setContentSize (width, height) { this.contentSize = typeof width === 'object' ? width : { width, height } }
}
class MockGraphics {
  constructor () { this.commands = [] }
  clear () { this.commands = [] }
  roundRect (...values) { this.commands.push(['roundRect', ...values]) }
  fill () { this.commands.push(['fill']) }
  stroke () { this.commands.push(['stroke']) }
}
class MockLabel {
  static Overflow = { SHRINK: 'shrink' }
  static HorizontalAlign = { CENTER: 'center' }
  static VerticalAlign = { CENTER: 'center' }
  constructor () { this.string = ''; this.node = null }
}
class MockSprite {
  static SizeMode = { CUSTOM: 'custom' }
  constructor () { this.node = null; this.spriteFrame = null }
}
class MockSpriteFrame {}
class MockNode {
  static EventType = { TOUCH_END: 'touch-end' }
  constructor (name) {
    this.name = name
    this.children = []
    this.components = new Map()
    this.handlers = new Map()
    this.active = true
    this.isValid = true
    this.position = new MockVec3()
    this.scale = new MockVec3(1, 1, 1)
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
  on (event, callback) { this.handlers.set(event, callback) }
  emit (event) { this.handlers.get(event)?.() }
  setPosition (position) { this.position = position }
  setScale (scale) { this.scale = scale }
  destroy () {
    if (!this.isValid) return
    this.isValid = false
    this.children.slice().forEach(child => child.destroy())
    this.parent = null
  }
}

const cc = {
  Color: MockColor,
  Graphics: MockGraphics,
  Label: MockLabel,
  Node: MockNode,
  Sprite: MockSprite,
  SpriteFrame: MockSpriteFrame,
  UITransform: MockUITransform,
  Vec3: MockVec3,
}
const layoutPolicy = {
  TABLE_HUD_SEAT_PLACES: Object.freeze(['bottom', 'right', 'top', 'left']),
}

const result = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  fileName: sourcePath,
  reportDiagnostics: true,
})
const errors = (result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
assert.deepEqual(errors, [], 'TableHudSeatViewGroup must transpile')
const moduleRecord = { exports: {} }
const localRequire = request => {
  if (request === 'cc') return cc
  if (request === './RuntimeUiFactory') return { applyForegroundTextStyle: label => label }
  if (request === './TableHudLayoutPolicy') return layoutPolicy
  throw new Error(`unexpected dependency ${request}`)
}
new Function('exports', 'module', 'require', '__filename', '__dirname', result.outputText)(moduleRecord.exports, moduleRecord, localRequire, sourcePath, path.dirname(sourcePath))
const { TableHudSeatViewGroup, createDefaultTableHudSeats } = moduleRecord.exports
assert.ok(createDefaultTableHudSeats().every(seat => seat.status === ''), 'initial placeholders must not flash a made-up count')

const descendants = root => root.children.flatMap(child => [child, ...descendants(child)])
const findNode = (root, name) => descendants(root).find(node => node.name === name)

const parentA = new MockNode('ParentA')
const group = new TableHudSeatViewGroup()
const avatarFrame = new MockSpriteFrame()
group.setDefaultAvatarFrame(avatarFrame)
group.render([
  { place: 'bottom', name: '超长玩家名称甲乙', status: '已离线', offline: true },
  { place: 'top', name: '队友', status: '剩10张', active: true },
])
group.mount(parentA)
for (const place of ['left', 'right']) {
  const seat = findNode(parentA, `Seat-${place}`)
  const avatar = findNode(seat, 'DefaultAvatar')
  const name = findNode(seat, 'PlayerName')
  const rank = findNode(seat, 'PlayerRank')
  assert.equal(name.position.x, avatar.position.x, 'side names must be centered under their avatar')
  assert.ok(name.position.y < avatar.position.y - 36, 'name must clear the lower edge of the avatar')
  assert.ok(rank.position.y < name.position.y, 'remaining-card status belongs below the name')
  assert.equal(name.getComponent(MockLabel).fontSize, 22, 'seat names use the smaller reviewed font')
}

assert.deepEqual(parentA.children.map(node => node.name), ['Seat-bottom', 'Seat-right', 'Seat-top', 'Seat-left'])
assert.deepEqual(group.getContentSize(), { width: 280, height: 100 })
const bottom = parentA.children[0]
const right = parentA.children[1]
const top = parentA.children[2]
assert.equal(findNode(bottom, 'PlayerName').getComponent(MockLabel).string, '超长玩家名…', 'long player names must preserve the existing six-character presentation limit')
assert.equal(findNode(right, 'PlayerName').getComponent(MockLabel).string, '下家', 'missing seat snapshots must use their viewer-relative fallback')
assert.equal(findNode(top, 'PlayerRank').getComponent(MockLabel).string, '剩10张')
assert.equal(findNode(right, 'PlayerRank').active, false, 'an empty status must hide its label')
assert.equal(right.getComponent(MockGraphics).commands.filter(command => command[0] === 'roundRect').length, 1,
  'an empty status must not leave an empty pill behind the name')
assert.equal(findNode(bottom, 'DefaultAvatar').getComponent(MockSprite).spriteFrame, avatarFrame)
assert.equal(findNode(bottom, 'DefaultAvatar').active, true)
assert.deepEqual(findNode(bottom, 'DefaultAvatar').getComponent(MockSprite).color, new MockColor(150, 156, 154), 'offline avatar tint must remain local to the seat view')
assert.equal(bottom.getComponent(MockGraphics).lineWidth, 1.5)
assert.equal(top.getComponent(MockGraphics).lineWidth, 2.5, 'the active seat must retain the emphasized outline')

const topNamePosition = findNode(top, 'PlayerName').position
const watched = []
group.onSeatAvatar = playerId => watched.push(playerId)
group.render([{ place: 'top', playerId: 'p3', name: '队友', status: '' }])
findNode(top, 'DefaultAvatar').emit(MockNode.EventType.TOUCH_END)
group.render([{ place: 'top', playerId: 'p2', name: '上家', status: '' }])
findNode(top, 'DefaultAvatar').emit(MockNode.EventType.TOUCH_END)
assert.deepEqual(watched, ['p3', 'p2'], 'avatar taps must use the current viewpoint mapping, not the mount-time seat')
for (const status of ['', '剩10张', '剩9张', '剩1张', '头游', '']) {
  group.render([{ place: 'top', name: '队友', status }])
  const label = findNode(top, 'PlayerRank')
  assert.equal(label.getComponent(MockLabel).string, status)
  assert.equal(label.active, Boolean(status), 'status visibility must reset on every snapshot')
  assert.equal(top.getComponent(MockGraphics).commands.filter(command => command[0] === 'roundRect').length, status ? 2 : 1)
  assert.deepEqual(findNode(top, 'PlayerName').position, topNamePosition, 'count visibility must not move the name or avatar')
}

const placements = {
  bottom: { x: -430, y: -250, scale: 0.9, visible: true },
  right: { x: 430, y: 10, scale: 0.9, visible: true },
  top: { x: -210, y: 218, scale: 0.9, visible: true },
  left: { x: -430, y: 10, scale: 0.9, visible: true },
}
group.layout(placements)
assert.deepEqual(bottom.position, new MockVec3(-430, -250, 10))
assert.deepEqual(top.scale, new MockVec3(0.9, 0.9, 1))

const parentB = new MockNode('ParentB')
group.mount(parentB)
assert.equal(parentA.children.length, 0, 'remounting must reparent instead of duplicating seat nodes')
assert.equal(parentB.children.length, 4)
const ownedNodes = parentB.children.slice()
group.dispose()
group.dispose()
assert.equal(parentB.children.length, 0)
assert.equal(ownedNodes.every(node => !node.isValid), true, 'dispose must destroy every owned seat exactly once')

group.mount(parentA)
assert.equal(parentA.children.length, 4, 'the lifecycle owner must be reusable after an idempotent dispose')
assert.equal(findNode(parentA.children[0], 'DefaultAvatar').getComponent(MockSprite).spriteFrame, avatarFrame)
group.dispose()

process.stdout.write('table HUD seat view group lifecycle regression checks passed\n')
