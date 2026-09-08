// Execute the delivered System.register modules, not a fresh TypeScript transpilation.
// Cocos rendering/resources are mocked; this is not a substitute for phone testing.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '../..')
const registrations = new Map()
const cache = new Map()
const stages = []
const failures = []
let ready = false
const context = vm.createContext({
  URL: undefined, URLSearchParams: undefined, crypto: undefined, console, setTimeout, clearTimeout,
  System: { register (name, deps, declare) {
    if (Array.isArray(name)) {
      assert.equal(name.length, 0, 'only the dependency-free generated chunk wrapper is expected')
      deps(() => {}, {}).execute()
      return
    }
    registrations.set(name, { deps, declare })
  } },
})
for (const relative of ['src/chunks/bundle.js', 'assets/main/index.js']) {
  const file = path.join(root, 'build/wechatgame', relative)
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file })
}
const config = {
  version: 1, platformEndpoint: 'https://api.yutechhn.cn/guandan', lobbyEndpoint: 'wss://api.yutechhn.cn/guandan/weapp',
  platformAllowDevelopmentLogin: false, platformAllowInsecureEndpoint: false, platformAllowInsecureGameEndpoint: false,
}
context.__GUANDAN_BUILD_TARGET__ = 'wechatgame'
context.__GUANDAN_RUNTIME_CONFIG__ = config
const overrides = {
  cc: {
    cclegacy: { _RF: { push () {}, pop () {} } }, game: { restart: () => Promise.resolve() },
    Component: class {}, _decorator: { ccclass: () => target => target },
  },
  'chunks:///_virtual/StartupLoadingOverlay.ts': { StartupLoadingOverlay: class {
    resize () {} bringToFront () {} fadeOut () { return Promise.resolve() }
    setProgress (progress) { stages.push(progress) }
    showError (message, retry, code) { failures.push(code) }
  } },
  'chunks:///_virtual/GameAssetLoader.ts': { ensureGameAssetBundle: () => Promise.resolve({}) },
  'chunks:///_virtual/ClassicCardFrameStore.ts': { preloadAllClassicCardFrames: () => Promise.resolve(true) },
}
function load (id) {
  if (overrides[id]) return overrides[id]
  if (cache.has(id)) return cache.get(id)
  const entry = registrations.get(id)
  assert.ok(entry, `missing built module ${id}`)
  const result = {}
  cache.set(id, result)
  const body = entry.declare((key, value) => {
    if (typeof key === 'object') { Object.assign(result, key); return key }
    result[key] = value
    return value // SystemJS _export also returns the value used by local assignments.
  }, { id })
  entry.deps.forEach((dep, index) => {
    const target = dep.startsWith('./') ? id.slice(0, id.lastIndexOf('/') + 1) + dep.slice(2) : dep
    const exports = load(target)
    body.setters[index]?.(exports)
  })
  body.execute()
  return result
}
const get = name => load(`chunks:///_virtual/${name}.ts`)
// Exercise the delivered touch adapter too: no design-space conversion is
// allowed before UITransform.hitTest performs its own camera conversion.
const screenPoint = { x: 149, y: 42 }
const touch = get('CardView').CardView.prototype.touchDetail.call({ card: { id: 'build-card' } }, {
  getID: () => 7,
  getLocation: () => ({ clone: () => screenPoint }),
  getUILocation: () => { throw new Error('built CardView must not double-convert touch coordinates') },
})
assert.equal(touch.screenPoint, screenPoint)
assert.equal(touch.cardId, 'build-card')
assert.equal(touch.pointerId, 7)
console.log('Built WeChat CardView passed: touch starts in screen coordinates')
const coordinator = new (get('StartupCoordinator').StartupCoordinator)({
  sceneRoot: { isValid: true }, startupTexture: null, initialViewport: {},
  backdrop: { preload: () => Promise.resolve() }, resizeApplication () {},
  initializeApplication () {
    const parsed = get('RuntimeClientConfig').resolveClientNetworkConfig(config)
    assert.equal(get('validation').normalizeBaseUrl(parsed.platformEndpoint, 'secure-only'), config.platformEndpoint)
    assert.equal(get('competitionDecoders').normalizeGameEndpoint(parsed.lobbyEndpoint, 'secure-only'), config.lobbyEndpoint)
    assert.equal(get('factory').createHttpGateways({ baseUrl: parsed.platformEndpoint, deviceId: 'build-test-device' }).configured, true)
  },
  onReady () { ready = true },
})
coordinator.markSceneStarted()
coordinator.begin()
setImmediate(() => {
  assert.deepEqual(stages, [0, 0.03, 0.88, 0.96, 1])
  assert.deepEqual(failures, [])
  assert.equal(ready, true)
  console.log('Built WeChat startup passed without URL: config, gateways, tickets and 96% -> 100% (Cocos/resource mocks)')
})

async function verifyBuiltRecovery () {
  let nativeCalls = 0
  const manager = { getRandomValues (options) {
    assert.equal(this, manager)
    nativeCalls += 1
    queueMicrotask(() => options.success({ randomValues: new Uint8Array(16).fill(nativeCalls).buffer }))
  } }
  context.wx = { getUserCryptoManager: () => manager }
  const requests = []
  const gateway = get('factory').createHttpGateways({
    baseUrl: config.platformEndpoint, deviceId: 'build-test-device', accessToken: 'build-test-token', gameEndpointPolicy: 'secure-only',
  }, { request: async input => {
    assert.equal(input.url, `${config.platformEndpoint}/api/v1/matches/recover`)
    const id = input.body.recoveryAttemptId
    requests.push(id)
    return { status: 200, body: { ok: true, data: { entry: {
      entryAttemptId: id, recoveryAttemptId: id, matchId: 'built-match', roomId: '123456', seat: 'p1',
      roomKind: 'match', ticketPurpose: 'rejoin', gameEndpoint: config.lobbyEndpoint,
      gameTicket: 'built-ticket', joinToken: 'built-ticket', expiresAt: Date.now() + 60000,
    } }, error: null } }
  } }).matchRecovery
  const [first, duplicate] = await Promise.all([gateway.recover(), gateway.recover()])
  assert.equal(nativeCalls, 1)
  assert.equal(first.recoveryAttemptId, duplicate.recoveryAttemptId)
  assert.equal(requests.length, 2)
  gateway.confirm(first.recoveryAttemptId)
  assert.notEqual((await gateway.recover()).recoveryAttemptId, first.recoveryAttemptId)
  const listeners = new Map()
  let notice = null
  const coordinator = new (get('PlatformMatchRecoveryCoordinator').PlatformMatchRecoveryCoordinator)({
    configured: true, gateway: { recover: async () => { throw vm.runInContext('new Error("built-recovery-failure")', context) } },
    lobby: { snapshot: { roomStatus: 'idle' }, events: { on: (event, fn) => listeners.set(event, fn), off: event => listeners.delete(event) } },
    enterLobby () {}, showRecoveryAvailable () { notice = null },
    showNotice: (title, detail) => { notice = { title, detail } }, isDisposed: () => false,
  })
  coordinator.start()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(notice?.detail, 'built-recovery-failure', 'delivered recovery failure must remain visible after hall rebuild')
  coordinator.dispose()
  console.log('Built WeChat recovery passed without browser crypto: native async randomness, stable retry ID and visible failure (native/network mocks)')
}
verifyBuiltRecovery().catch(error => { console.error(error); process.exitCode = 1 })
