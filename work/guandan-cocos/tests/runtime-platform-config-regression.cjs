const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { loadTypeScript } = require('./support/typescript.cjs')

const projectRoot = path.resolve(__dirname, '..')
const runtimePath = path.join(projectRoot, 'assets/scripts/services/RuntimeClientConfig.ts')
const gameScenePath = path.join(projectRoot, 'assets/scripts/scenes/GameScene.ts')
const buildConfigPath = path.join(projectRoot, 'scripts/runtime-client-config.mjs')
const webFinalizerPath = path.join(projectRoot, 'scripts/finalize-web-build.mjs')
const wechatFinalizerPath = path.join(projectRoot, 'scripts/finalize-wechat-build.mjs')
const wechatVerifierPath = path.join(projectRoot, 'scripts/verify-wechat-build.mjs')
const ts = loadTypeScript()

const loadPureTs = filePath => {
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filePath,
  }).outputText
  const loaded = { exports: {} }
  new Function('exports', 'module', 'require', output)(loaded.exports, loaded, request => {
    if (request.startsWith('.')) return loadPureTs(path.resolve(path.dirname(filePath), `${request}.ts`))
    throw new Error(`unexpected dependency ${request}`)
  })
  return loaded.exports
}

async function main () {
  assert.equal(fs.existsSync(runtimePath), true, 'runtime client config parser is missing')
  assert.equal(fs.existsSync(`${runtimePath}.meta`), true, 'runtime client config parser needs Cocos metadata')
  const { resolveClientNetworkConfig } = loadPureTs(runtimePath)
  const serialized = {
    lobbyEndpoint: '', platformEndpoint: '', platformAllowDevelopmentLogin: false,
    platformAllowInsecureEndpoint: false, platformAllowInsecureGameEndpoint: false,
  }
  assert.deepEqual(resolveClientNetworkConfig(serialized, { location: { hostname: 'release.example' } }), {
    ...serialized, usingLocalBrowserDefaults: false,
  })
  assert.deepEqual(resolveClientNetworkConfig(serialized, { location: { hostname: 'localhost' } }), {
    lobbyEndpoint: 'ws://127.0.0.1:3002/weapp', platformEndpoint: 'http://127.0.0.1:3003',
    platformAllowDevelopmentLogin: true, platformAllowInsecureEndpoint: true,
    platformAllowInsecureGameEndpoint: true, usingLocalBrowserDefaults: true,
  })

  const injected = {
    version: 1,
    lobbyEndpoint: '',
    platformEndpoint: 'https://platform.example',
    platformAllowDevelopmentLogin: false,
    platformAllowInsecureEndpoint: false,
    platformAllowInsecureGameEndpoint: false,
  }
  assert.deepEqual(resolveClientNetworkConfig({ ...serialized, platformEndpoint: 'http://scene.invalid', platformAllowDevelopmentLogin: true }, {
    location: { hostname: 'release.example' }, __GUANDAN_RUNTIME_CONFIG__: injected,
  }), { ...serialized, platformEndpoint: 'https://platform.example', usingLocalBrowserDefaults: false }, 'validated runtime config must override serialized Inspector values')
  assert.throws(() => resolveClientNetworkConfig(serialized, {
    location: { hostname: 'release.example' },
    __GUANDAN_RUNTIME_CONFIG__: { ...injected, platformEndpoint: 'http://platform.example' },
  }), /HTTPS/)
  assert.throws(() => resolveClientNetworkConfig(serialized, {
    location: { hostname: 'release.example' },
    __GUANDAN_RUNTIME_CONFIG__: { ...injected, platformAllowDevelopmentLogin: 'false' },
  }), /布尔值/)
  assert.throws(() => resolveClientNetworkConfig(serialized, {
    location: { hostname: 'release.example' }, __GUANDAN_RUNTIME_CONFIG__: { ...injected, version: 2 },
  }), /版本/)

  const gameScene = fs.readFileSync(gameScenePath, 'utf8')
  assert.match(gameScene, /resolveClientNetworkConfig/)
  assert.match(gameScene, /platformAllowDevelopmentLogin: this\.platformAllowDevelopmentLogin/)
  assert.doesNotMatch(gameScene, /private localBrowserDevelopmentConfig/, 'localhost defaults and runtime overrides must share the tested config boundary')

  assert.equal(fs.existsSync(buildConfigPath), true, 'build-time runtime config helper is missing')
  const buildConfig = await import(`${pathToFileURL(buildConfigPath).href}?t=${Date.now()}`)
  const bareIp = buildConfig.runtimeConfigFromEnv({ GUANDAN_TEST_SERVER_IP: '203.0.113.42' }, { bareIpTest: true })
  assert.deepEqual(bareIp, {
    version: 1,
    lobbyEndpoint: 'ws://203.0.113.42:3002/weapp',
    platformEndpoint: 'http://203.0.113.42:3003',
    platformAllowDevelopmentLogin: true,
    platformAllowInsecureEndpoint: true,
    platformAllowInsecureGameEndpoint: true,
  })
  assert.doesNotThrow(() => buildConfig.verifyBareIpTestRuntimeConfig(bareIp))
  assert.throws(() => buildConfig.runtimeConfigFromEnv({ GUANDAN_TEST_SERVER_IP: 'hk.example' }, { bareIpTest: true }), /IPv4/)
  assert.throws(() => buildConfig.runtimeConfigFromEnv({ GUANDAN_TEST_SERVER_IP: '203.0.113.42' }, { release: true, bareIpTest: true }), /cannot be used/)
  assert.throws(() => buildConfig.runtimeConfigFromEnv({}, { release: true }), /GUANDAN_PLATFORM_ENDPOINT/)
  assert.throws(() => buildConfig.runtimeConfigFromEnv({ GUANDAN_PLATFORM_ENDPOINT: 'http://platform.example' }, { release: true }), /HTTPS/)
  assert.throws(() => buildConfig.runtimeConfigFromEnv({
    GUANDAN_PLATFORM_ENDPOINT: 'https://platform.example', GUANDAN_PLATFORM_ALLOW_DEVELOPMENT_LOGIN: 'true',
  }, { release: true }), /开发开关/)
  const releaseConfig = buildConfig.runtimeConfigFromEnv({ GUANDAN_PLATFORM_ENDPOINT: 'https://platform.example' }, { release: true })
  assert.deepEqual(releaseConfig, injected)
  const web = buildConfig.injectWebRuntimeConfig('<html><body><!-- Polyfills bundle. --></body></html>', releaseConfig)
  assert.deepEqual(buildConfig.extractRuntimeConfig(web), injected)
  const reinjectedWeb = buildConfig.injectWebRuntimeConfig(web, releaseConfig)
  assert.equal((reinjectedWeb.match(/guandan-runtime-config:start/g) ?? []).length, 1, 'web injection must be idempotent')
  const wechat = buildConfig.injectScriptRuntimeConfig('function __initApp () {}', releaseConfig)
  assert.deepEqual(buildConfig.extractRuntimeConfig(wechat), injected)
  assert.doesNotThrow(() => buildConfig.verifyReleaseRuntimeConfig(injected))

  for (const scriptPath of [webFinalizerPath, wechatFinalizerPath, wechatVerifierPath]) assert.equal(fs.existsSync(scriptPath), true, `${path.basename(scriptPath)} is missing`)
  const webFinalizer = fs.readFileSync(webFinalizerPath, 'utf8')
  assert.match(webFinalizer, /runtimeConfigFromEnv[\s\S]*injectWebRuntimeConfig/)
  assert.match(webFinalizer, /verifyBareIpTestRuntimeConfig/)
  assert.match(webFinalizer, /verifyReleaseRuntimeConfig/)
  assert.match(fs.readFileSync(wechatFinalizerPath, 'utf8'), /runtimeConfigFromEnv[\s\S]*injectScriptRuntimeConfig[\s\S]*verifyWechatRuntimeConfig/)
  assert.match(fs.readFileSync(wechatVerifierPath, 'utf8'), /extractRuntimeConfig[\s\S]*verifyWechatRuntimeConfig/, 'all WeChat package verification must reject missing or unsafe config')
  assert.doesNotMatch(fs.readFileSync(wechatVerifierPath, 'utf8'), /if \(!packageOnly\) verify/, 'package-only may not bypass network safety')

  const template = fs.readFileSync(path.join(projectRoot, 'build-templates/wechatgame/game.ejs'), 'utf8')
  const wechatConfig = buildConfig.extractRuntimeConfig(template)
  assert.doesNotThrow(() => buildConfig.verifyWechatRuntimeConfig(wechatConfig))
  assert.ok(template.indexOf('guandan-runtime-config:start') < template.indexOf("require('./web-adapter')"))
  assert.match(template, /__GUANDAN_BUILD_TARGET__ = 'wechatgame'/)
  const wechatHost = { wx: { request () {} }, location: { hostname: 'localhost' } }
  assert.throws(() => resolveClientNetworkConfig(serialized, wechatHost), /禁止回退/, 'WeChat adapter localhost must never activate browser defaults')
  assert.throws(() => resolveClientNetworkConfig(serialized, { __GUANDAN_BUILD_TARGET__: 'wechatgame' }), /缺少正式网络配置/)
  assert.deepEqual(resolveClientNetworkConfig(serialized, { ...wechatHost, __GUANDAN_RUNTIME_CONFIG__: wechatConfig }), {
    ...serialized, platformEndpoint: 'https://api.yutechhn.cn/guandan',
    lobbyEndpoint: 'wss://api.yutechhn.cn/guandan/weapp', usingLocalBrowserDefaults: false,
  })
  for (const flag of ['platformAllowDevelopmentLogin', 'platformAllowInsecureEndpoint', 'platformAllowInsecureGameEndpoint']) {
    const invalid = { ...wechatConfig, [flag]: true }
    assert.throws(() => buildConfig.verifyWechatRuntimeConfig(invalid), /开发开关/)
    assert.throws(() => resolveClientNetworkConfig(serialized, { ...wechatHost, __GUANDAN_RUNTIME_CONFIG__: invalid }), /禁止/)
  }
  const policy = loadPureTs(path.join(projectRoot, 'assets/scripts/services/WechatNetworkPolicy.ts'))
  assert.equal(policy.isWechatRuntime({ wx: { connectSocket () {} } }), true)
  assert.equal(policy.isWechatRuntime({ wx: {} }), false)
  const forbiddenAuthorities = ['localhost', '127.0.0.1', '42.193.229.164', '[::1]', 'api.yuteachhn.cn',
    'unapproved.example', 'api.yutechhn.cn.evil.example', 'user@api.yutechhn.cn', 'api.yutechhn.cn:443', 'api.yutechhn.cn:3003']
  for (const [field, protocol] of [['platformEndpoint', 'https:'], ['lobbyEndpoint', 'wss:']]) {
    const invalidUrls = ['', `${protocol}//api.yutechhn.cn/guandan-other`, `${protocol}//api.yutechhn.cn/guandan#fragment`,
      `${protocol}//api.yutechhn.cn/api/v1/health`, `${protocol === 'https:' ? 'http:' : 'ws:'}//api.yutechhn.cn/guandan`,
      ...forbiddenAuthorities.map(authority => `${protocol}//${authority}/guandan`)]
    for (const url of invalidUrls) {
      const invalid = { ...wechatConfig, [field]: url }
      assert.throws(() => buildConfig.verifyWechatRuntimeConfig(invalid), undefined, `build must reject ${url}`)
      assert.throws(() => resolveClientNetworkConfig(serialized, { ...wechatHost, __GUANDAN_RUNTIME_CONFIG__: invalid }), undefined, `runtime must reject ${url}`)
      assert.throws(() => policy.assertWechatBusinessEndpoint(url, protocol))
    }
  }
  assert.doesNotThrow(() => policy.assertWechatBusinessEndpoint('https://api.yutechhn.cn/guandan/api/v1/profile', 'https:'))
  assert.doesNotThrow(() => policy.assertWechatBusinessEndpoint('wss://api.yutechhn.cn/guandan/weapp?ticket=test', 'wss:'))
  await verifyWechatTransportBoundary()
  process.stdout.write('runtime platform config regression checks passed\n')
}

async function verifyWechatTransportBoundary () {
  const previous = { wx: globalThis.wx, XMLHttpRequest: globalThis.XMLHttpRequest, WebSocket: globalThis.WebSocket }
  const opened = []
  globalThis.wx = { request () {}, connectSocket () {} }
  globalThis.XMLHttpRequest = class {
    open (method, url) { opened.push(url) }
    setRequestHeader () {}
    send () { this.status = 200; this.responseText = '{}'; this.onload() }
  }
  globalThis.WebSocket = class {
    static OPEN = 1
    constructor (url) { opened.push(url); this.readyState = 1; queueMicrotask(() => this.onopen()) }
    close () { this.readyState = 3 }
  }
  try {
    const { XhrTransport } = loadPureTs(path.join(projectRoot, 'assets/scripts/services/platform/client.ts'))
    const { CocosSocketClient } = loadPureTs(path.join(projectRoot, 'assets/scripts/network/CocosSocketClient.ts'))
    const http = new XhrTransport()
    const socket = new CocosSocketClient()
    for (const url of ['http://127.0.0.1:3003', 'https://unapproved.example/guandan']) {
      await assert.rejects(http.request({ method: 'GET', url }), /只允许/)
    }
    for (const url of ['ws://127.0.0.1:3002/weapp', 'wss://unapproved.example/weapp']) {
      await assert.rejects(socket.connect(url), /只允许/)
    }
    assert.deepEqual(opened, [], 'invalid config, backend tickets and recovery URLs must produce zero network opens')
    await http.request({ method: 'GET', url: 'https://api.yutechhn.cn/guandan/api/v1/profile' })
    await socket.connect('wss://api.yutechhn.cn/guandan/weapp')
    assert.equal(opened.length, 2)
    await assert.rejects(socket.connect('wss://unapproved.example/weapp'), /只允许/)
    assert.equal(socket.snapshot.connected, true, 'a rejected replacement must not disconnect the valid socket')
    socket.close()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]
      else globalThis[key] = value
    }
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
