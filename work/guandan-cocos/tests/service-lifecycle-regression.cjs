const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTypeScript } = require('./support/typescript.cjs')

const projectRoot = path.resolve(__dirname, '..')
const ts = loadTypeScript()

const loadTs = (relativePath, dependencies) => {
  const filename = path.join(projectRoot, relativePath)
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
    reportDiagnostics: true,
  })
  const errors = (result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
  assert.deepEqual(errors, [], `${relativePath} must transpile`)
  const moduleRecord = { exports: {} }
  const localRequire = request => {
    if (Object.prototype.hasOwnProperty.call(dependencies, request)) return dependencies[request]
    throw new Error(`unexpected runtime dependency ${request} from ${relativePath}`)
  }
  new Function('exports', 'module', 'require', '__filename', '__dirname', result.outputText)(
    moduleRecord.exports,
    moduleRecord,
    localRequire,
    filename,
    path.dirname(filename),
  )
  return moduleRecord.exports
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

const testAssetTimeoutAndCancellation = async () => {
  const requests = []
  class MockAsset {}
  const bundle = {
    load: (assetPath, type, callback) => requests.push({ assetPath, type, callback }),
  }
  const loader = loadTs('assets/scripts/services/GameAssetLoader.ts', {
    cc: { assetManager: { getBundle: () => bundle } },
  })

  const timeoutResults = []
  loader.loadGameAsset('effects/hung/texture', MockAsset, (error, asset) => timeoutResults.push({ error, asset }), { timeoutMs: 5 })
  await wait(15)
  assert.equal(timeoutResults.length, 1, 'a hung bundle.load must settle its callback once')
  assert.equal(timeoutResults[0].error.code, 'ASSET_LOAD_TIMEOUT')
  assert.equal(timeoutResults[0].asset, null)
  requests[0].callback(null, { id: 'late-texture' })
  assert.equal(timeoutResults.length, 1, 'a callback arriving after timeout must be ignored')

  const cancelledResults = []
  const cancel = loader.loadGameAsset('effects/cancelled/texture', MockAsset, (error, asset) => cancelledResults.push({ error, asset }), { timeoutMs: 100 })
  assert.equal(typeof cancel, 'function', 'callback loads must return an explicit cancellation function')
  await Promise.resolve()
  cancel()
  assert.equal(cancelledResults.length, 1)
  assert.equal(cancelledResults[0].error.code, 'ASSET_LOAD_CANCELLED')
  requests[1].callback(null, { id: 'late-cancelled-texture' })
  assert.equal(cancelledResults.length, 1, 'a callback arriving after cancellation must be ignored')

  const recovered = loader.loadGameAssetAsync('effects/recovered/texture', MockAsset, { timeoutMs: 100 })
  await Promise.resolve()
  requests[2].callback(null, { id: 'recovered-texture' })
  assert.deepEqual(await recovered, { id: 'recovered-texture' }, 'a timed-out request must not poison later asset loads')
}

const testWechatLoginTimeout = async () => {
  class MockPlatformApiError extends Error {
    constructor (message, options = {}) {
      super(message)
      this.code = options.code
      this.retryable = options.retryable
    }
  }
  let callbacks
  const provider = loadTs('assets/scripts/services/WechatLoginProvider.ts', {
    './platform/contracts': { PlatformApiError: MockPlatformApiError },
  })
  const pending = provider.requestWechatLoginCredential({ login: options => { callbacks = options } }, 5)
  await assert.rejects(pending, error => error.code === 'WX_LOGIN_TIMEOUT' && error.retryable)
  callbacks.success({ code: 'late-code' })

  const ready = provider.requestWechatLoginCredential({ login: options => options.success({ code: ' wx-code ' }) }, 50)
  assert.deepEqual(await ready, { kind: 'wechat', code: 'wx-code' })
}

const testEffectLabGenerationCancellation = async () => {
  let driver
  let resolveAudit
  const scheduled = []
  const previews = []
  const notices = []
  class MockVec3 {
    static ZERO = new MockVec3(0, 0, 0)
    constructor (x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z }
    clone () { return new MockVec3(this.x, this.y, this.z) }
  }
  class MockUiTransform {}
  const cocosRuntime = { Node: class {}, UITransform: MockUiTransform, Vec3: MockVec3 }
  const previewRunnerModule = loadTs('assets/scripts/development/EffectLabPreviewRunner.ts', {
    cc: cocosRuntime,
  })
  const hostModule = loadTs('assets/scripts/development/EffectLabSceneHost.ts', {
    './EffectLabPreviewRunner': previewRunnerModule,
    './EffectLab': {
      createEffectLab: nextDriver => {
        driver = nextDriver
        return {
          list: () => [],
          inspect: () => null,
          trigger: id => {
            if (id === 'sequence') driver.playSequence({ mode: 'seat-matrix', steps: [{ fixtureId: 'bomb', delayMs: 100 }] })
            if (id === 'diagnostic') driver.runDiagnostic({ check: 'runtime-assets' })
            return { fixture: { id } }
          },
        }
      },
    },
  })
  const effects = {
    resetForRecovery: () => {},
    previewAction: action => previews.push(action),
    skipAll: () => {},
    auditRuntimeAssets: () => new Promise(resolve => { resolveAudit = resolve }),
    diagnostics: () => ({ registeredRendererKeys: [] }),
  }
  const host = new hostModule.EffectLabSceneHost({
    effects,
    audio: null,
    flightRoot: { active: false },
    topEffectRoot: { active: false, getComponent: () => null },
    getEffectQuality: () => 'full',
    hasLiveTableSnapshot: () => false,
    openEffectLabTable: () => {},
    startFixedMatch: () => {},
    scheduleOnce: (callback, delaySeconds) => scheduled.push({ callback, delaySeconds }),
    showNotice: (title, detail) => notices.push({ title, detail }),
  })

  host.trigger('sequence')
  const staleStep = scheduled[0]
  host.trigger('replacement')
  staleStep.callback()
  assert.deepEqual(previews, [], 'a delayed sequence step from an older preview generation must be inert')

  host.trigger('diagnostic')
  host.trigger('replacement')
  resolveAudit({ loaded: 1, bundled: 1, migrationCandidates: 0, rejected: 0, missing: [] })
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(notices, [], 'a diagnostic result from an older preview generation must not reopen UI')
}

const testEffectLabTableHandoffCancellation = () => {
  let domain
  let scheduled
  let mounted = 0
  const page = loadTs('assets/scripts/scenes/front-pages/EffectLabPageDomain.ts', {
    cc: { BlockInputEvents: class {}, Color: class {}, Node: MockNode, Vec3: class {} },
  })
  const dependencies = {
    router: { current: 'more' },
    screen: {},
    isDisposed: () => false,
    listFixtures: () => [{ id: 'match-opening' }],
    previewFixture: () => domain.handleShellHidden(),
    scheduleOnce: callback => { scheduled = callback },
    showMenu: () => {},
    showNotice: () => {},
  }
  domain = new page.EffectLabPageDomain(dependencies)
  domain.show = () => { mounted += 1 }

  domain.openTable()
  scheduled()
  assert.equal(mounted, 1, 'the fixed-match hide must hand off to the delayed EffectLab drawer')

  domain.openTable()
  domain.handleShellHidden()
  scheduled()
  assert.equal(mounted, 1, 'a later shell hide must cancel the pending drawer generation')
}

class MockNode {
  static EventType = { TOUCH_END: 'touch-end' }
  setPosition () {}
  on () {}
}

const testCommittedShopOrderRefreshFailure = async () => {
  const notices = []
  const opened = []
  let route = 'product'
  let invalidations = 0
  const ui = {
    menuLabel: () => ({}),
    button: () => new MockNode(),
  }
  const router = {
    get current () { return route },
    open: next => { route = next; opened.push(next); return ui },
  }
  const product = { id: 'rice', name: '大米', description: '5kg', category: '粮油', pointsPrice: 3200, stock: 2 }
  const shop = loadTs('assets/scripts/scenes/front-pages/ShopPageDomain.ts', {
    cc: { Node: MockNode, Vec3: class Vec3 {} },
    '../../services/DevelopmentApis': { SAMPLE_PRODUCTS: [] },
  })
  const domain = new shop.ShopPageDomain({
    router,
    screen: { safeSize: () => ({ x: 1280 }) },
    gateways: {
      configured: true,
      shop: {
        createOrder: async () => ({ orderId: 'order-1', productId: product.id, quantity: 1, totalPoints: 3200, status: 'paid' }),
        listProducts: async () => [{ ...product, stock: 1 }],
      },
      wallet: { getWallet: async () => { throw new Error('wallet refresh unavailable') } },
    },
    wallet: {
      fresh: true,
      value: { points: 5000, diamonds: 0 },
      update: () => assert.fail('a failed wallet refresh must not install invented balances'),
      invalidate: () => { invalidations += 1 },
    },
    isDisposed: () => false,
    issuePageRequest: () => 1,
    currentPageRequest: () => 1,
    setTableVisible: () => {},
    showMenu: () => {},
    showNotice: (title, detail) => notices.push({ title, detail }),
  })

  await domain.purchase(product)
  assert.equal(route, 'shop', 'a committed order must leave the stale product action instead of inviting a duplicate tap')
  assert.equal(opened.at(-1), 'shop')
  assert.equal(invalidations, 1)
  assert.match(notices.at(-1).title, /兑换成功/)
  assert.doesNotMatch(notices.at(-1).title, /失败/)
  assert.match(notices.at(-1).detail, /订单.*成功|订单.*提交/)
}

;(async () => {
  await testAssetTimeoutAndCancellation()
  await testWechatLoginTimeout()
  await testEffectLabGenerationCancellation()
  testEffectLabTableHandoffCancellation()
  await testCommittedShopOrderRefreshFailure()
  process.stdout.write('service lifecycle regression checks passed\n')
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
