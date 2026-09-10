// Execute the delivered System.register modules, not a fresh TypeScript transpilation.
// Cocos rendering/resources are mocked; this is not a substitute for phone testing.
const vm = require('node:vm')
const assert = require('node:assert/strict')
const { createBuiltRuntime } = require('./cocos-built-runtime.cjs')
const stages = []
const failures = []
let ready = false
const config = {
  version: 1, platformEndpoint: 'https://api.yutechhn.cn/guandan', lobbyEndpoint: 'wss://api.yutechhn.cn/guandan/weapp',
  platformAllowDevelopmentLogin: false, platformAllowInsecureEndpoint: false, platformAllowInsecureGameEndpoint: false,
}
const overrides = {
  'chunks:///_virtual/StartupLoadingOverlay.ts': { StartupLoadingOverlay: class {
    resize () {} bringToFront () {} fadeOut () { return Promise.resolve() }
    setProgress (progress) { stages.push(progress) }
    showError (message, retry, code) { failures.push(code) }
  } },
  'chunks:///_virtual/GameAssetLoader.ts': { ensureGameAssetBundle: () => Promise.resolve({}) },
  'chunks:///_virtual/ClassicCardFrameStore.ts': { preloadAllClassicCardFrames: () => Promise.resolve(true) },
}
const { get, context } = createBuiltRuntime('wechatgame', overrides)
context.__GUANDAN_BUILD_TARGET__ = 'wechatgame'
context.__GUANDAN_RUNTIME_CONFIG__ = config
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
