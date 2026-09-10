const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTypeScript } = require('./support/typescript.cjs')

const projectRoot = path.resolve(__dirname, '..')
const sourcePath = path.join(projectRoot, 'assets/scripts/scenes/TableOverlayController.ts')
const scenePath = path.join(projectRoot, 'assets/scripts/scenes/GameScene.ts')
const ts = loadTypeScript()

const sceneSource = fs.readFileSync(scenePath, 'utf8')
;[
  /private\s+(?:readonly\s+)?applyNetworkChat\b/,
  /private\s+(?:readonly\s+)?applyNetworkDissolveVote\b/,
  /private\s+toggleChatPanel\b/,
  /private\s+showFinishToast\b/,
  /private\s+showDissolveVoteDialog\b/,
  /private\s+requestLeaveTable\b/,
].forEach(pattern => assert.doesNotMatch(sceneSource, pattern, `${pattern} must stay extracted from GameScene`))
assert.doesNotMatch(sceneSource, /lobby\.events\.on\('guandan:(?:chat|dissolve-vote)'/, 'GameScene must not duplicate overlay network listeners')
assert.match(sceneSource, /this\.tableOverlays\?\.dispose\(\)/, 'GameScene must dispose its overlay controller')

class MockEventTarget {
  constructor () { this.listeners = new Map() }
  on (event, callback, target) {
    const listeners = this.listeners.get(event) ?? []
    listeners.push({ callback, target })
    this.listeners.set(event, listeners)
  }
  off (event, callback, target) {
    this.listeners.set(event, (this.listeners.get(event) ?? []).filter(listener => listener.callback !== callback || listener.target !== target))
  }
  emit (event, payload) {
    ;[...(this.listeners.get(event) ?? [])].forEach(listener => listener.callback.call(listener.target, payload))
  }
  count (event) { return (this.listeners.get(event) ?? []).length }
}

class MockUITransform {
  setContentSize (width, height) {
    this.contentSize = typeof width === 'object' ? width : { width, height }
  }
}
class MockGraphics {
  rect (...args) { this.lastRect = args }
  roundRect (...args) { this.lastRoundRect = args }
  fill () {}
  stroke () {}
}
class MockBlockInputEvents {}
class MockUIOpacity { constructor () { this.opacity = 255 } }
class MockLabel {
  static Overflow = { SHRINK: 'shrink' }
  static VerticalAlign = { CENTER: 'center' }
  constructor () { this.string = ''; this.node = null }
}
class MockColor { constructor (...channels) { this.channels = channels } }
class MockVec3 {
  static ONE = new MockVec3(1, 1, 1)
  constructor (x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z }
}

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
    this.scale = MockVec3.ONE
  }
  set parent (nextParent) {
    if (this._parent) this._parent.children = this._parent.children.filter(child => child !== this)
    this._parent = nextParent
    if (nextParent) nextParent.children.push(this)
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
  setScale (scale) { this.scale = scale }
  setSiblingIndex (index) { this.siblingIndex = index }
  on (event, callback, target) {
    const handlers = this.handlers.get(event) ?? []
    handlers.push({ callback, target })
    this.handlers.set(event, handlers)
  }
  emit (event) {
    ;[...(this.handlers.get(event) ?? [])].forEach(handler => handler.callback.call(handler.target))
  }
  destroy () {
    if (!this.isValid) return
    this.isValid = false
    this.children.slice().forEach(child => child.destroy())
    if (this._parent) this._parent.children = this._parent.children.filter(child => child !== this)
    this._parent = null
  }
}

class MockTween {
  constructor (target) { this.target = target; this.steps = [] }
  to (_duration, properties) { this.steps.push(() => Object.assign(this.target, properties)); return this }
  call (callback) { this.steps.push(callback); return this }
  start () { this.steps.forEach(step => step()); return this }
}

const cc = {
  BlockInputEvents: MockBlockInputEvents,
  Color: MockColor,
  Graphics: MockGraphics,
  Label: MockLabel,
  Node: MockNode,
  Tween: { stopAllByTarget: () => {} },
  UIOpacity: MockUIOpacity,
  UITransform: MockUITransform,
  Vec3: MockVec3,
  tween: target => new MockTween(target),
}


const result = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  fileName: sourcePath,
  reportDiagnostics: true,
})
const errors = (result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
assert.deepEqual(errors, [], 'TableOverlayController must transpile')
const moduleRecord = { exports: {} }
const localRequire = request => {
  if (request === '../ui/UiFrameStyle') return require('./support/load-typescript-module.cjs').loadTs(path.join(projectRoot, 'assets/scripts/ui/UiFrameStyle.ts'))
  if (request === 'cc') return cc
  if (request === '../ui/TableButtonMetrics') return require('./support/load-typescript-module.cjs').loadTs(path.join(projectRoot, 'assets/scripts/ui/TableButtonMetrics.ts'))
  throw new Error(`unexpected runtime dependency ${request}`)
}
new Function('exports', 'module', 'require', '__filename', '__dirname', result.outputText)(moduleRecord.exports, moduleRecord, localRequire, sourcePath, path.dirname(sourcePath))
const { TableOverlayController } = moduleRecord.exports

const descendants = root => root.children.flatMap(child => [child, ...descendants(child)])
const findNode = (root, name) => descendants(root).find(node => node.name === name)

const root = new MockNode('GameRoot')
const labels = []
const buttons = []
const ui = {
  label: (name, x, y, fontSize) => {
    const node = new MockNode(name)
    node.parent = root
    node.setPosition(new MockVec3(x, y, 0))
    node.addComponent(MockUITransform)
    const label = node.addComponent(MockLabel)
    label.fontSize = fontSize
    labels.push(label)
    return label
  },
  button: (name, text, x, width = 244, height = 56, fontSize = 25) => {
    const node = new MockNode(name)
    node.parent = root
    node.buttonText = text
    node.setPosition(new MockVec3(x, 0, 0))
    node.addComponent(MockUITransform).setContentSize(width, height)
    node.fontSize = fontSize
    buttons.push(node)
    return node
  },
}

const lobbyEvents = new MockEventTarget()
const lobbyCalls = []
const lobby = {
  events: lobbyEvents,
  snapshot: { dissolveVote: null },
  proposeDissolve: () => { lobbyCalls.push(['propose']); return 2 },
  voteDissolve: agree => { lobbyCalls.push(['vote', agree]); return 3 },
}

const viewport = Object.freeze({ width: 1280, height: 720, halfWidth: 640, halfHeight: 360, safeLeft: 0, safeRight: 0, safeTop: 0, safeBottom: 0 })
const state = { multiplayer: false, interactionDisabled: false, leaveImmediately: false }
const voices = []
const pulses = []
const schedules = []
const scheduledOnce = []
const unscheduled = []
let leaveCount = 0
let refreshCount = 0

const controller = new TableOverlayController({
  root,
  ui,
  lobby,
  initialViewport: viewport,
  getHumanId: () => 'p1',
  isMultiplayer: () => state.multiplayer,
  shouldLeaveImmediately: () => state.leaveImmediately,
  playerName: playerId => ({ p1: '我', p2: '东家', p3: '对家', p4: '西家' })[playerId],
  leaveTable: () => { leaveCount += 1 },
  schedule: (callback, seconds) => schedules.push({ callback, seconds }),
  scheduleOnce: (callback, seconds) => scheduledOnce.push({ callback, seconds }),
  unschedule: callback => unscheduled.push(callback),
})

assert.equal(lobbyEvents.count('guandan:chat'), 0)
assert.equal(lobbyEvents.count('guandan:dissolve-vote'), 1)
assert.equal(schedules.length, 1, 'the dissolve countdown must have one owned interval')
const finishToast = findNode(root, 'FinishToast')
assert.ok(finishToast)
assert.equal(finishToast.active, false)

controller.setTableVisible(true)
controller.showToast('牌局提示')
assert.equal(finishToast.getComponent(MockLabel).string, '牌局提示')
assert.equal(finishToast.active, true)
assert.equal(scheduledOnce.at(-1).seconds, 1.6)
scheduledOnce.at(-1).callback()
assert.equal(finishToast.active, false)

state.multiplayer = false
controller.requestLeave()
const localExit = findNode(root, 'ExitTableDialog')
assert.ok(localExit)
assert.equal(findNode(localExit, 'ExitTitle').getComponent(MockLabel).string, '返回大厅？')
controller.requestLeave()
assert.equal(descendants(root).filter(node => node.name === 'ExitTableDialog').length, 1, 'only one ordinary modal may be open')
findNode(localExit, 'StayButton').emit(MockNode.EventType.TOUCH_END)
assert.equal(localExit.isValid, false)

state.multiplayer = true
controller.requestLeave()
const multiplayerExit = findNode(root, 'ExitTableDialog')
assert.equal(findNode(multiplayerExit, 'ExitTitle').getComponent(MockLabel).string, '退出联机牌局？')
findNode(multiplayerExit, 'DissolveButton').emit(MockNode.EventType.TOUCH_END)
assert.deepEqual(lobbyCalls.at(-1), ['propose'])
assert.equal(finishToast.getComponent(MockLabel).string, '已发起解散，等待其他玩家表决')

state.leaveImmediately = true
controller.requestLeave()
assert.equal(leaveCount, 1)
state.leaveImmediately = false

controller.showNotice('提示标题', '提示详情')
const notice = findNode(root, 'DevelopmentDialog')
assert.equal(findNode(notice, 'DevelopmentTitle').getComponent(MockLabel).string, '提示标题')
controller.showNotice('不应覆盖')
assert.equal(descendants(root).filter(node => node.name === 'DevelopmentDialog').length, 1)
controller.clearModal()

const expiresAt = Date.now() + 5000
lobby.snapshot.dissolveVote = { initiator: 'p3', expiresAt, votes: { p1: 'pending', p2: 'agree', p3: 'agree', p4: 'pending' } }
lobbyEvents.emit('guandan:dissolve-vote', { vote: lobby.snapshot.dissolveVote, outcome: null })
const dissolveDialog = findNode(root, 'DissolveVoteDialog')
assert.ok(dissolveDialog)
assert.equal(findNode(dissolveDialog, 'DissolveVoteTitle').getComponent(MockLabel).string, '对家 申请解散牌局')
assert.match(findNode(dissolveDialog, 'DissolveVoteCountdown').getComponent(MockLabel).string, /^剩余 [45] 秒$/)
findNode(dissolveDialog, 'DissolveRefuse').emit(MockNode.EventType.TOUCH_END)
assert.deepEqual(lobbyCalls.at(-1), ['vote', false])
assert.equal(dissolveDialog.isValid, false)
lobbyEvents.emit('guandan:dissolve-vote', { vote: null, outcome: 'expired' })
assert.equal(finishToast.getComponent(MockLabel).string, '解散投票已超时，牌局继续')

controller.requestLeave()
const retainedLeaveNode = findNode(root, 'LeaveButton')
const retainedLeaveHandler = retainedLeaveNode.handlers.get(MockNode.EventType.TOUCH_END)[0]
const retainedDissolveVote = lobbyEvents.listeners.get('guandan:dissolve-vote')[0]
const rootChildrenBeforeDispose = root.children.length
controller.dispose()
assert.equal(lobbyEvents.count('guandan:chat'), 0)
assert.equal(lobbyEvents.count('guandan:dissolve-vote'), 0)
assert.equal(finishToast.isValid, false)
assert.ok(unscheduled.includes(schedules[0].callback), 'dispose must unschedule the owned dissolve interval')
assert.ok(unscheduled.includes(scheduledOnce.at(-1).callback), 'dispose must unschedule the owned toast timeout')

const postDisposeCounts = {
  lobby: lobbyCalls.length,
  leave: leaveCount,
  children: root.children.length,
}
const toastActiveAfterDispose = finishToast.active
retainedLeaveHandler.callback.call(retainedLeaveHandler.target)
retainedDissolveVote.callback.call(retainedDissolveVote.target, {
  vote: { initiator: 'p3', expiresAt: Date.now() + 5000, votes: { p1: 'pending', p2: 'agree', p3: 'agree', p4: 'pending' } },
  outcome: null,
})
schedules[0].callback()
scheduledOnce.at(-1).callback()
controller.showToast('不应复活')
controller.showNotice('不应复活')
controller.requestLeave()
lobbyEvents.emit('guandan:chat', { playerId: 'p2', text: '谢谢' })
assert.deepEqual({
  lobby: lobbyCalls.length,
  leave: leaveCount,
  children: root.children.length,
}, postDisposeCounts, 'every retained event, node, and scheduler callback must be inert after disposal')
assert.equal(finishToast.active, toastActiveAfterDispose, 'a retained toast timeout must not mutate its destroyed node')
assert.ok(postDisposeCounts.children < rootChildrenBeforeDispose, 'dispose must remove every controller-owned overlay node')
;['FinishToast', 'ExitTableDialog', 'DissolveVoteDialog', 'DevelopmentDialog'].forEach(name => {
  assert.equal(findNode(root, name), undefined, `${name} must not survive controller disposal`)
})

console.log('table overlay controller regression checks passed')
