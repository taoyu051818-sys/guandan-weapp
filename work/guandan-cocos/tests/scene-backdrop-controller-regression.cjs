const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTypeScript } = require('./support/typescript.cjs')

const projectRoot = path.resolve(__dirname, '..')
const sourcePath = path.join(projectRoot, 'assets/scripts/scenes/SceneBackdropController.ts')
const ts = loadTypeScript()

class MockUITransform {
  setContentSize (width, height) { this.contentSize = { width, height } }
}

class MockSprite {
  static SizeMode = { CUSTOM: 'custom' }
  constructor () { this.isValid = true; this.spriteFrame = null; this.color = null }
}

class MockSpriteFrame {
  constructor () { this.texture = null; this.isValid = true; this.destroyCount = 0 }
  destroy () { this.destroyCount += 1; this.isValid = false }
}

class MockTexture2D {}

class MockUIOpacity {
  constructor () { this.isValid = true; this.opacity = 255 }
}

class MockVec3 {
  static ZERO = new MockVec3(0, 0, 0)
  constructor (x, y, z) { this.x = x; this.y = y; this.z = z }
}

class MockNode {
  constructor (name) {
    this.name = name
    this.children = []
    this.components = new Map()
    this.isValid = true
    this.position = null
    this.siblingIndex = -1
  }

  set parent (parent) {
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
  setSiblingIndex (index) { this.siblingIndex = index }
  setPosition (position) { this.position = position }
  destroy () { this.isValid = false }
}

const pendingAssets = []
const loadGameAssetAsync = assetPath => new Promise((resolve, reject) => {
  pendingAssets.push({ assetPath, resolve, reject })
})
const takePending = assetPath => {
  const index = pendingAssets.findIndex(item => item.assetPath === assetPath)
  assert.notEqual(index, -1, `expected pending asset ${assetPath}`)
  return pendingAssets.splice(index, 1)[0]
}

const tweenRuns = []
class MockTween {
  constructor (target) { this.target = target; this.steps = [] }
  to (duration, properties) { this.steps.push({ kind: 'to', duration, properties }); return this }
  call (callback) { this.steps.push({ kind: 'call', callback }); return this }
  start () {
    tweenRuns.push(this.steps.filter(step => step.kind === 'to').map(step => step.duration))
    this.steps.forEach(step => {
      if (step.kind === 'to') Object.assign(this.target, step.properties)
      else step.callback()
    })
    return this
  }
}
const stoppedTweenTargets = []
const cc = {
  Color: { WHITE: Object.freeze({ white: true }) },
  Node: MockNode,
  Sprite: MockSprite,
  SpriteFrame: MockSpriteFrame,
  Texture2D: MockTexture2D,
  Tween: { stopAllByTarget: target => stoppedTweenTargets.push(target) },
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
assert.deepEqual(errors, [], 'SceneBackdropController must transpile')
const moduleRecord = { exports: {} }
const localRequire = request => {
  if (request === 'cc') return cc
  if (request === '../services/GameAssetLoader') return { loadGameAssetAsync }
  throw new Error(`unexpected runtime dependency ${request}`)
}
new Function('exports', 'module', 'require', '__filename', '__dirname', result.outputText)(moduleRecord.exports, moduleRecord, localRequire, sourcePath, path.dirname(sourcePath))
const { SceneBackdropController, SCENE_BACKDROP_ASSETS } = moduleRecord.exports

const closeTo = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.001, `${message}: expected ${expected}, got ${actual}`)
const flush = async () => { await Promise.resolve(); await Promise.resolve() }

;(async () => {
  assert.equal(SCENE_BACKDROP_ASSETS.lobby.path, 'backgrounds/lobby-lingshui-coast-v1/texture')
  assert.equal(SCENE_BACKDROP_ASSETS.table.path, 'backgrounds/table-perspective-blue-v2/texture')

  const root = new MockNode('GameRoot')
  const viewport = { width: 1280, height: 720, halfWidth: 640, halfHeight: 360, safeLeft: 0, safeRight: 0, safeTop: 0, safeBottom: 0 }
  const controller = new SceneBackdropController(root, () => viewport)
  const firstLobbyLoad = controller.preload('lobby')
  assert.equal(controller.preload('lobby'), firstLobbyLoad, 'concurrent preloads must share one request')
  const lobbyTexture = Object.assign(new MockTexture2D(), { width: 1600, height: 719 })
  takePending(SCENE_BACKDROP_ASSETS.lobby.path).resolve(lobbyTexture)
  await firstLobbyLoad
  assert.equal(root.children.length, 0, 'startup preload must not mount UI before scene initialization')

  controller.mount()
  const backdrop = root.children.find(node => node.name === 'TableBackdrop')
  assert.ok(backdrop)
  assert.equal(backdrop.siblingIndex, 0)
  const sprite = backdrop.getComponent(MockSprite)
  const opacity = backdrop.getComponent(MockUIOpacity)
  const transform = backdrop.getComponent(MockUITransform)
  assert.equal(sprite.spriteFrame.texture, lobbyTexture)
  const lobbyFrame = sprite.spriteFrame
  assert.deepEqual(tweenRuns.at(-1), [0.2], 'the first available frame must retain the initial fade-in')
  assert.equal(opacity.opacity, 255)
  const lobbyCover = Math.max(viewport.width / lobbyTexture.width, viewport.height / lobbyTexture.height)
  closeTo(transform.contentSize.width, lobbyTexture.width * lobbyCover, 'lobby cover width')
  closeTo(transform.contentSize.height, lobbyTexture.height * lobbyCover, 'lobby cover height')

  controller.setMode('table')
  assert.equal(sprite.spriteFrame.texture, lobbyTexture, 'mode switches must keep the old frame until the requested texture arrives')
  const tableLoad = controller.preload('table')
  const tableTexture = Object.assign(new MockTexture2D(), { width: 1280, height: 720 })
  takePending(SCENE_BACKDROP_ASSETS.table.path).resolve(tableTexture)
  await tableLoad
  assert.equal(sprite.spriteFrame.texture, tableTexture)
  const tableFrame = sprite.spriteFrame
  assert.deepEqual(tweenRuns.at(-1), [0.1, 0.18], 'loaded mode switches must preserve the fade-out/fade-in transition')

  const squareViewport = { ...viewport, width: 1000, height: 1000, halfWidth: 500, halfHeight: 500 }
  controller.resize(squareViewport)
  const tableCover = Math.max(squareViewport.width / tableTexture.width, squareViewport.height / tableTexture.height)
  closeTo(transform.contentSize.width, tableTexture.width * tableCover, 'table cover width')
  closeTo(transform.contentSize.height, tableTexture.height * tableCover, 'table cover height')
  assert.deepEqual(backdrop.position, MockVec3.ZERO)

  controller.dispose()
  assert.equal(backdrop.isValid, false)
  assert.equal(sprite.spriteFrame, null, 'dispose must detach the dynamically created frame from the Sprite')
  assert.equal(lobbyFrame.destroyCount, 1, 'dispose must release the cached lobby SpriteFrame exactly once')
  assert.equal(tableFrame.destroyCount, 1, 'dispose must release the cached table SpriteFrame exactly once')
  const tweenCountAfterDispose = tweenRuns.length
  controller.setMode('lobby')
  controller.resize(viewport)
  assert.equal(tweenRuns.length, tweenCountAfterDispose, 'disposed controllers must ignore later presentation changes')
  assert.ok(stoppedTweenTargets.includes(opacity), 'dispose must stop an active opacity transition')

  const lateRoot = new MockNode('LateRoot')
  const lateController = new SceneBackdropController(lateRoot, () => viewport)
  lateController.mount()
  const lateLobby = takePending(SCENE_BACKDROP_ASSETS.lobby.path)
  const lateTable = takePending(SCENE_BACKDROP_ASSETS.table.path)
  lateController.dispose()
  lateLobby.resolve(lobbyTexture)
  lateTable.resolve(tableTexture)
  await flush()
  assert.equal(lateRoot.children[0].isValid, false, 'late asset completions must not revive a disposed backdrop')

  console.log('scene backdrop controller regression checks passed')
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
