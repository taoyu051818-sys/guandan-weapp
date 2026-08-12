const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTypeScript } = require('./support/typescript.cjs')

const projectRoot = path.resolve(__dirname, '..')
const sourcePath = path.join(projectRoot, 'assets/scripts/scenes/StartupCoordinator.ts')
const ts = loadTypeScript()

const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
const settle = () => new Promise(resolve => setImmediate(resolve))

class MockStartupLoadingOverlay {
  static instances = []

  constructor (root, texture, sourceWidth, sourceHeight) {
    this.root = root
    this.texture = texture
    this.sourceWidth = sourceWidth
    this.sourceHeight = sourceHeight
    this.progress = []
    this.resizes = []
    this.errors = []
    this.bringCount = 0
    this.fadeCount = 0
    this.disposeCount = 0
    MockStartupLoadingOverlay.instances.push(this)
  }

  resize (viewport) { this.resizes.push(viewport) }
  setProgress (progress, status) { this.progress.push({ progress, status }) }
  showError (message, retry) { this.errors.push({ message, retry }) }
  bringToFront () { this.bringCount += 1 }
  fadeOut () { this.fadeCount += 1; return Promise.resolve() }
  dispose () { this.disposeCount += 1 }
}

const bundleRequests = []
const queuedBundles = []
const ensureGameAssetBundle = onProgress => {
  const next = queuedBundles.shift()
  assert.ok(next, 'each startup attempt must have a queued bundle result')
  bundleRequests.push({ onProgress })
  return next.promise
}

const queuedCardSkins = []
let cardSkinPreloadCount = 0
const preloadAllClassicCardFrames = () => {
  cardSkinPreloadCount += 1
  return Promise.resolve(queuedCardSkins.length > 0 ? queuedCardSkins.shift() : true)
}

let restartCount = 0
const cc = {
  game: {
    restart: () => {
      restartCount += 1
      return Promise.resolve()
    },
  },
}

const result = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  fileName: sourcePath,
  reportDiagnostics: true,
})
const errors = (result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
assert.deepEqual(errors, [], 'StartupCoordinator must transpile')
const moduleRecord = { exports: {} }
const localRequire = request => {
  if (request === 'cc') return cc
  if (request === '../services/GameAssetLoader') return { ensureGameAssetBundle }
  if (request === '../ui/ClassicCardFrameStore') return { preloadAllClassicCardFrames }
  if (request === '../ui/StartupLoadingOverlay') return { StartupLoadingOverlay: MockStartupLoadingOverlay }
  throw new Error(`unexpected runtime dependency ${request}`)
}
new Function('exports', 'module', 'require', '__filename', '__dirname', result.outputText)(moduleRecord.exports, moduleRecord, localRequire, sourcePath, path.dirname(sourcePath))
const { StartupCoordinator } = moduleRecord.exports

const viewport = Object.freeze({
  width: 1280,
  height: 720,
  halfWidth: 640,
  halfHeight: 360,
  safeLeft: 0,
  safeRight: 0,
  safeTop: 0,
  safeBottom: 0,
})

const createHarness = initializeApplication => {
  const root = { isValid: true }
  let backdropPreloadCount = 0
  let readyCount = 0
  const applicationResizes = []
  const coordinator = new StartupCoordinator({
    sceneRoot: root,
    startupTexture: { id: 'startup-texture' },
    initialViewport: viewport,
    backdrop: {
      preload: mode => {
        assert.equal(mode, 'lobby')
        backdropPreloadCount += 1
        return Promise.resolve()
      },
    },
    initializeApplication,
    resizeApplication: nextViewport => applicationResizes.push(nextViewport),
    onReady: () => { readyCount += 1 },
  })
  return {
    coordinator,
    root,
    overlay: MockStartupLoadingOverlay.instances.at(-1),
    backdropPreloadCount: () => backdropPreloadCount,
    readyCount: () => readyCount,
    applicationResizes,
  }
}

;(async () => {
  const originalConsoleError = console.error
  console.error = () => {}
  try {
    const successfulBundle = deferred()
    queuedBundles.push(successfulBundle)
    let initializeCount = 0
    const success = createHarness(() => { initializeCount += 1 })
    assert.deepEqual(success.overlay.resizes, [viewport], 'the loading cover must size itself before startup begins')
    assert.deepEqual(success.overlay.progress[0], { progress: 0, status: '正在检查游戏资源...' })

    success.coordinator.begin()
    success.coordinator.begin()
    assert.equal(bundleRequests.length, 1, 'concurrent begin calls must share one startup attempt')
    success.coordinator.resize({ ...viewport, width: 1000, halfWidth: 500 })
    assert.equal(success.applicationResizes.length, 0, 'runtime layout must not run before application initialization')
    bundleRequests[0].onProgress({
      progress: 0.5,
      totalBytesWritten: 1_048_576,
      totalBytesExpectedToWrite: 2_097_152,
    })
    const downloadProgress = success.overlay.progress.at(-1)
    assert.ok(Math.abs(downloadProgress.progress - 0.44) < 0.0001)
    assert.equal(downloadProgress.status, '正在下载游戏资源 1.0 / 2.0 MB')
    successfulBundle.resolve({})
    await settle()

    assert.equal(success.backdropPreloadCount(), 1, 'startup must preload the lobby backdrop once')
    assert.equal(cardSkinPreloadCount, 1, 'startup must preload the complete card skin once')
    assert.equal(initializeCount, 1, 'application initialization must be one-shot')
    assert.equal(success.readyCount(), 0, 'the menu must wait for the Cocos start lifecycle')
    assert.equal(success.overlay.progress.some(entry => entry.progress === 0.88), true, 'artwork preparation must retain its dedicated progress stage')
    assert.equal(success.overlay.bringCount, 1)
    assert.equal(success.overlay.fadeCount, 1)

    success.coordinator.markSceneStarted()
    success.coordinator.markSceneStarted()
    assert.equal(success.readyCount(), 1, 'ready must publish exactly once after both startup gates open')
    const resizedViewport = { ...viewport, width: 960, halfWidth: 480 }
    success.coordinator.resize(resizedViewport)
    assert.deepEqual(success.applicationResizes, [resizedViewport])
    success.coordinator.begin()
    assert.equal(bundleRequests.length, 1, 'completed startup must not initialize a second time')

    const failedBundle = deferred()
    const retryBundle = deferred()
    queuedBundles.push(failedBundle, retryBundle)
    let retryInitializeCount = 0
    const retry = createHarness(() => { retryInitializeCount += 1 })
    retry.coordinator.markSceneStarted()
    retry.coordinator.begin()
    failedBundle.reject(new Error('offline'))
    await settle()
    assert.equal(retry.overlay.errors.at(-1).message, '资源下载失败，请检查网络后重试')
    retry.overlay.errors.at(-1).retry()
    assert.equal(bundleRequests.length, 3, 'resource errors must start a fresh retry attempt')
    retryBundle.resolve({})
    await settle()
    assert.equal(retryInitializeCount, 1, 'a successful retry must initialize exactly once')
    assert.equal(retry.readyCount(), 1)

    const lateBundle = deferred()
    queuedBundles.push(lateBundle)
    let lateInitializeCount = 0
    const disposed = createHarness(() => { lateInitializeCount += 1 })
    const cardPreloadsBeforeDispose = cardSkinPreloadCount
    disposed.coordinator.begin()
    disposed.coordinator.dispose()
    lateBundle.resolve({})
    await settle()
    assert.equal(disposed.overlay.disposeCount, 1)
    assert.equal(disposed.backdropPreloadCount(), 0, 'late bundle completion must not continue scene preload')
    assert.equal(cardSkinPreloadCount, cardPreloadsBeforeDispose)
    assert.equal(lateInitializeCount, 0)
    assert.equal(disposed.readyCount(), 0)

    queuedBundles.push({ promise: Promise.resolve({}) })
    const initializationFailure = createHarness(() => { throw new Error('partial scene mutation') })
    initializationFailure.coordinator.markSceneStarted()
    initializationFailure.coordinator.begin()
    await settle()
    assert.equal(initializationFailure.overlay.errors.at(-1).message, '游戏初始化失败，请重新进入小游戏')
    const requestsBeforeRejectedBegin = bundleRequests.length
    initializationFailure.coordinator.begin()
    assert.equal(bundleRequests.length, requestsBeforeRejectedBegin, 'partial initialization must never be retried in place')
    initializationFailure.overlay.errors.at(-1).retry()
    await settle()
    assert.equal(restartCount, 1, 'partial initialization recovery must restart the application')

    console.log('startup coordinator regression checks passed')
  } finally {
    console.error = originalConsoleError
  }
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
