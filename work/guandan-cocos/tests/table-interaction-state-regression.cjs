const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const ts = require('./support/typescript.cjs').loadTypeScript()
const sourceRoot = path.resolve(__dirname, '../assets/scripts'), cache = new Map(), overrides = new Map()
class Vec3 {
  constructor (x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }) }
  static ZERO = new Vec3(); static ONE = new Vec3(1, 1, 1)
}
class Color { constructor (r, g, b, a = 255) { Object.assign(this, { r, g, b, a }) } }
class UITransform { setContentSize (width, height) { this.contentSize = { width, height } } }
class Graphics {
  clear () { this.paths = [] }
  roundRect (...args) { (this.paths ??= []).push(args) }
  rect (...args) { (this.paths ??= []).push(args) }
  fill () { this.finalFill = this.fillColor }
  stroke () {}
}
class Label { static Overflow = { SHRINK: 1 }; static HorizontalAlign = { CENTER: 1 }; static VerticalAlign = { CENTER: 1 } }
class Node {
  static EventType = { TOUCH_START: 'start', TOUCH_MOVE: 'move', TOUCH_END: 'end', TOUCH_CANCEL: 'cancel' }
  constructor (name) { this.name = name; this.children = []; this.components = new Map(); this.events = new Map(); this.isValid = true; this.active = true; this.scale = Vec3.ONE; this.position = Vec3.ZERO }
  get parent () { return this._parent }
  set parent (parent) { if (this._parent) this._parent.children = this._parent.children.filter(n => n !== this); this._parent = parent; if (parent) parent.children.push(this) }
  get activeInHierarchy () { return this.isValid && this.active && (!this.parent || this.parent.activeInHierarchy) }
  addChild (node) { node.parent = this }
  addComponent (Type) { const component = new Type(); component.node = this; this.components.set(Type, component); return component }
  getComponent (Type) { return this.components.get(Type) ?? null }
  getChildByName (name) { return this.children.find(n => n.isValid && n.name === name) ?? null }
  setPosition (position) { this.position = position }
  setScale (scale) { this.scale = scale }
  setSiblingIndex () {}
  on (type, callback) { const listeners = this.events.get(type) ?? []; listeners.push(callback); this.events.set(type, listeners) }
  emit (type) { if (this.activeInHierarchy) for (const callback of this.events.get(type) ?? []) callback() }
  destroy () { this.isValid = false; for (const child of [...this.children]) child.destroy(); this.parent = null }
}
class RuntimeUiFactory {
  constructor (parent) { this.parent = parent }
  button (name, title, x, width, height) {
    const node = new Node(name); this.parent.addChild(node); node.addComponent(UITransform).setContentSize(width, height); node.title = title; return node
  }
  outlinedLabel (title) { const node = new Node('Label'); this.parent.addChild(node); node.title = title; return node }
}
// Mock only engine surfaces and unrelated view/art services; all policies under test run unmodified.
class Owner { node = null; render () {} layout () {} getContentSize () { return { width: 280, height: 100 } } dispose () {} }
const override = (name, exports) => overrides.set(path.join(sourceRoot, name + '.ts'), exports)
override('ui/RuntimeUiFactory', { RuntimeUiFactory, applyForegroundTextStyle: label => label })
override('ui/TableTributeInfoView', { TableTributeInfoView: Owner, tributeInfoText: () => '' })
override('ui/TableHudSeatViewGroup', { TableHudSeatViewGroup: Owner, createDefaultTableHudSeats: () => [] })
override('ui/TableHandViewStatus', { TableHandViewStatus: Owner })
override('ui/TableHudTurnTimerView', { TableHudTurnTimerView: Owner })
override('ui/TableHudDynamicRenderer', { renderTableHudCounter () {}, renderTableHudSuits () {} })
override('services/GameAssetLoader', {})
override('services/DefaultProfileFrames', { defaultProfileFrame: () => null })
override('ui/ClassicCardFrameStore', {})
override('scenes/front-pages/FriendRoomRulesModal', {})
const cc = { Node, Vec3, Vec2: Vec3, Color, Graphics, Label, UITransform, Tween: { stopAllByTarget () {} } }
function load (file) {
  file = file.startsWith(sourceRoot) ? file : path.join(sourceRoot, file + '.ts')
  if (overrides.has(file)) return overrides.get(file)
  if (cache.has(file)) return cache.get(file).exports
  const module = { exports: {} }; cache.set(file, module)
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } })
  Function('require', 'module', 'exports', out.outputText)(request => {
    if (request === 'cc') return cc
    assert.ok(request.startsWith('.'), `unexpected external dependency: ${request}`)
    return load(path.resolve(path.dirname(file), request) + '.ts')
  }, module, module.exports)
  return module.exports
}
const duplicate = {
  phase: 'playing', mySeat: 'p1', watching: null, configuredRounds: 2, scores: { red: 37, blue: 19 }, history: [{}, {}],
  slots: [{ seat: 'p1', table: 'A', team: 'red' }, { seat: 'p5', table: 'B', team: 'blue' }], tables: { A: 'settled', B: 'playing' },
}
// FR-21-001: the actual HUD projection must apply the room policy to both formats, while retaining result truth.
const { TableHudPresenter } = load('scenes/TableHudPresenter')
const { duplicateFinalPresentation } = load('scenes/DuplicateTablePresentation')
const players = Object.fromEntries(['p1', 'p2', 'p3', 'p4'].map((id, index) => [id, { name: id, team: index % 2 ? 'teamB' : 'teamA', hand: [] }]))
for (const kind of ['duplicate', 'rotating']) for (const visibility of ['hidden', 'live']) for (const phase of ['playing', 'settlement']) {
  let rendered
  const snapshot = { phase, teamLevels: { teamA: 2, teamB: 3 }, state: { players, turnOrder: Object.keys(players), currentTurn: 'p1',
    currentLevel: 2, finishedPlayers: [], playArea: [], ruleProfile: { allowA2345Straight: true },
    matchFormat: { kind: kind === 'duplicate' ? 'independent' : kind, rotatingScoring: 3 }, playerScores: { p1: 37 } } }
  const lobby = { roomId: 'synthetic-room', members: Object.keys(players), roomSettings: { scoreVisibility: visibility }, duplicate: kind === 'duplicate' ? duplicate : null }
  const before = JSON.stringify([snapshot, lobby])
  const presenter = new TableHudPresenter({ root: new Node('root'), actions: {}, lobbySnapshot: () => lobby, isMultiplayer: () => true, turnClock: () => null })
  presenter.tableHud = { render: value => { rendered = value } }
  presenter.render(snapshot, 'p1', { availableSuits: [], selectedSuit: null, lockDecision: { kind: 'unavailable' } })
  assert.equal(/37/.test(rendered.levelLabel), visibility !== 'hidden' || phase !== 'playing', `${kind}/${visibility}/${phase} score policy`)
  assert.ok(rendered.levelLabel.includes(kind === 'duplicate' ? '复式 A桌' : '转蛋'), 'mode identity remains visible')
  assert.equal(JSON.stringify([snapshot, lobby]), before, 'HUD privacy is a projection, never a mutation of authoritative scores')
}
assert.match(duplicateFinalPresentation(duplicate).detail, /红队 37 · 蓝队 19/)

// FR-21-002: unchanged summary still reflows for dimensions or any safe inset; only one live button sends one intent.
const { renderDuplicateTableStatus } = load('scenes/DuplicateTableStatusView')
for (const mySeat of ['p1', 'p5', null]) {
  const parent = new Node('root'), intents = []
  const snapshot = { duplicate: { ...duplicate, mySeat, tables: { A: 'settled', B: 'settled' } } }
  const screen = { viewport: {}, safeRightX (padding) { return this.viewport.width / 2 - this.viewport.safeRight - padding },
    safeBottomY (padding) { return -this.viewport.height / 2 + this.viewport.safeBottom + padding }, safeTopY (padding) { return this.viewport.height / 2 - this.viewport.safeTop - padding } }
  const lobby = { sendRoomIntent: (...args) => intents.push(args) }
  for (const [width, height, safeRight, safeBottom] of [[1792, 828, 0, 0], [960, 540, 36, 24], [960, 540, 56, 34], [1280, 720, 0, 0]]) {
    screen.viewport = { width, height, safeLeft: 24, safeRight, safeTop: 16, safeBottom }
    renderDuplicateTableStatus(parent, screen, lobby, snapshot)
    const root = parent.getChildByName('DuplicateTableStatus'), button = root.getChildByName('DuplicateButton')
    assert.deepEqual(button.position, new Vec3(width / 2 - safeRight - 140, -height / 2 + safeBottom + 144, 0))
    assert.ok(button.position.x + button.getComponent(UITransform).contentSize.width / 2 < width / 2 - safeRight)
    renderDuplicateTableStatus(parent, screen, lobby, snapshot)
    assert.equal(parent.getChildByName('DuplicateTableStatus'), root, 'same state and geometry are idempotent')
    const previousCount = intents.length; button.emit(Node.EventType.TOUCH_END)
    assert.equal(intents.length, previousCount + 1)
    assert.deepEqual(intents.at(-1), ['watchTable', { table: mySeat === 'p5' ? 'A' : 'B' }])
    assert.equal(parent.children.length, 1)
  }
  parent.getChildByName('DuplicateTableStatus').destroy(); renderDuplicateTableStatus(parent, screen, lobby, snapshot)
  assert.ok(parent.getChildByName('DuplicateTableStatus')?.isValid, 'destroyed cached root is rebuilt')
  snapshot.duplicate = { ...snapshot.duplicate, watching: 'B' }
  renderDuplicateTableStatus(parent, screen, lobby, snapshot)
  parent.getChildByName('DuplicateTableStatus').getChildByName('DuplicateButton').emit(Node.EventType.TOUCH_END)
  assert.deepEqual(intents.at(-1), ['watchTable', { table: null }])
  snapshot.duplicate = { ...snapshot.duplicate, phase: 'waiting' }
  renderDuplicateTableStatus(parent, screen, lobby, snapshot); assert.equal(parent.children.length, 0)
}

// UI-25-002: inspect final paint commands/metrics after the actual render/update/layout chain.
const { TableGameHud } = load('ui/TableGameHud'), { freshTableGameHudState } = load('ui/TableGameHudFoundation')
const { tableButtonWidth } = load('ui/TableButtonMetrics')
let clicks = 0
const hud = new TableGameHud({ onHandLockAction: () => { clicks++ } })
hud.root = new Node('root'); hud.createToolbar(hud.root)
for (const kind of ['lock', 'unlock', 'unavailable']) for (const restore of [false, true]) {
  hud.render({ ...freshTableGameHudState(), lockDecision: { kind }, arrangeRestoreAvailable: restore })
  for (const operation of [() => hud.update({ trusteeVisible: true, trusteeActive: true }), () => hud.layout({ width: 960, height: 540, safeRight: 32 }), () => hud.applyExpandedHudMetrics()]) {
    operation()
    assert.deepEqual(hud.lockButton.graphics.finalFill, kind === 'unavailable' ? new Color(17, 57, 69, 240) : new Color(159, 112, 25, 246), 'relayout must retain authoritative active color')
    assert.equal(hud.lockButton.label.string, kind === 'unlock' ? '恢复' : '锁牌')
    assert.equal(hud.arrangeButton.node.getComponent(UITransform).contentSize.width, tableButtonWidth(restore ? '复原' : '一键理牌'))
    assert.equal(hud.trusteeButton.node.getComponent(UITransform).contentSize.width, tableButtonWidth('取消托管'))
  }
  hud.lockButton.node.emit(Node.EventType.TOUCH_START)
  assert.deepEqual(hud.lockButton.graphics.finalFill, new Color(24, 82, 85, 250))
  hud.lockButton.node.emit(Node.EventType.TOUCH_CANCEL)
  assert.deepEqual(hud.lockButton.graphics.finalFill, kind === 'unavailable' ? new Color(17, 57, 69, 240) : new Color(159, 112, 25, 246))
  hud.lockButton.node.emit(Node.EventType.TOUCH_END)
}
assert.equal(clicks, 6, 'one native end event invokes the existing action once')
hud.dispose()
console.log('FR-21-001/002 and UI-25-002 passed: score privacy, duplicate reflow/recreation, final toolbar state and metrics')
