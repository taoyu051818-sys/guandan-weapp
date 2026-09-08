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

class MockNode {
  static EventType = { TOUCH_END: 'touch-end' }
  setPosition () {}
  on () {}
}

;(async () => {
  await testAssetTimeoutAndCancellation()
  await testWechatLoginTimeout()
  assert.doesNotMatch(fs.readFileSync(path.join(projectRoot, 'assets/scripts/scenes/front-pages/ShopPageDomain.ts'), 'utf8'), /purchase\s*\(|createOrder\s*\(|dependencies\.(gateways|wallet)/, 'preview has no transaction capability')
  process.stdout.write('service lifecycle regression checks passed\n')
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
