const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('./support/typescript.cjs').loadTypeScript()
const root = path.resolve(__dirname, '..')
const config = Object.freeze({
  version: 1, platformEndpoint: 'https://api.yutechhn.cn/guandan',
  lobbyEndpoint: 'wss://api.yutechhn.cn/guandan/weapp',
  platformAllowDevelopmentLogin: false, platformAllowInsecureEndpoint: false,
  platformAllowInsecureGameEndpoint: false,
})

function runtime (urlGlobal, mocks = {}) {
  const opened = []
  const context = vm.createContext({
    URL: urlGlobal, URLSearchParams: undefined, console, setTimeout, clearTimeout, queueMicrotask,
    __GUANDAN_BUILD_TARGET__: 'wechatgame', __GUANDAN_RUNTIME_CONFIG__: config,
    XMLHttpRequest: class {
      open (method, url) { opened.push(url) }
      setRequestHeader () {}
      send () { this.status = 200; this.responseText = '{}'; this.onload() }
    },
    WebSocket: class {
      static OPEN = 1
      constructor (url) { opened.push(url); this.readyState = 1; queueMicrotask(() => this.onopen()) }
      close () { this.readyState = 3 }
    },
  })
  const cache = new Map()
  const load = relative => {
    let file = path.resolve(root, relative)
    if (!fs.existsSync(file)) file += '.ts'
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.ts')
    if (cache.has(file)) return cache.get(file).exports
    const module = { exports: {} }
    cache.set(file, module)
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText
    const execute = vm.runInContext(`(function(exports,module,require){${output}\n})`, context, { filename: file })
    execute(module.exports, module, name => {
      if (Object.prototype.hasOwnProperty.call(mocks, name)) return mocks[name]
      assert.ok(name.startsWith('.'), `unexpected dependency ${name}`)
      return load(path.resolve(path.dirname(file), name))
    })
    return module.exports
  }
  return { load, opened }
}

async function verify () {
  for (const urlGlobal of [undefined, class BrokenURL { constructor () { throw new Error('URL unavailable') } }, URL]) {
    const stages = []; const errors = []; let ready = false
    const sandbox = runtime(urlGlobal, {
      cc: { game: { restart: () => Promise.resolve() } },
      '../services/GameAssetLoader': { ensureGameAssetBundle: () => Promise.resolve({}) },
      '../ui/ClassicCardFrameStore': { preloadAllClassicCardFrames: () => Promise.resolve(true) },
      '../ui/StartupLoadingOverlay': { StartupLoadingOverlay: class {
        resize () {} bringToFront () {} fadeOut () { return Promise.resolve() }
        setProgress (progress) { stages.push(progress) }
        showError (message, retry, code) { errors.push({ message, code }) }
      } },
    })
    const { load, opened } = sandbox
    const { resolveClientNetworkConfig } = load('assets/scripts/services/RuntimeClientConfig.ts')
    const { createHttpGateways } = load('assets/scripts/services/platform/factory.ts')
    const { StartupCoordinator } = load('assets/scripts/scenes/StartupCoordinator.ts')
    const coordinator = new StartupCoordinator({
      sceneRoot: { isValid: true }, startupTexture: null, initialViewport: {},
      backdrop: { preload: () => Promise.resolve() }, resizeApplication () {},
      initializeApplication () {
        const resolved = resolveClientNetworkConfig(config)
        const gateways = createHttpGateways({ baseUrl: resolved.platformEndpoint, deviceId: 'test-device' })
        assert.equal(gateways.configured, true)
      },
      onReady () { ready = true },
    })
    coordinator.markSceneStarted(); coordinator.begin()
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(stages, [0, 0.03, 0.88, 0.96, 1], 'the previously failing config/gateway initialization must pass 96%')
    assert.deepEqual(errors, [])
    assert.equal(ready, true)

    const { parseNetworkEndpoint } = load('assets/scripts/services/NetworkEndpoint.ts')
    for (const value of [config.platformEndpoint, config.lobbyEndpoint, 'http://localhost:3003',
      'ws://127.0.0.1:3002/weapp', 'ws://[::1]:3002/weapp', 'https://[2001:db8::1]/x?y=1',
      'https://example.com:8443/a%20b?q=hello%20world#section']) {
      const actual = parseNetworkEndpoint(value); const expected = new URL(value)
      for (const field of ['protocol', 'hostname', 'port', 'pathname', 'search', 'hash']) {
        assert.equal(actual[field], expected[field], `${value}: ${field}`)
      }
    }
    for (const value of ['', '/guandan', '//api.yutechhn.cn', 'javascript:alert(1)', 'https:/api.yutechhn.cn',
      'https://user:pass@example.com', 'https://example.com:65536', 'https://example.com:',
      'https://example.com\\@evil.example', 'https://exa\nmple.com', 'https://%61pi.yutechhn.cn',
      'https://example.com/%GG', 'https://127.0.0.999', 'https://[:::1]', 'https://[1:2:3]',
      'https://[1:2:3:4:5:6:7:8:9]', 'https://[1::2::3]']) {
      assert.throws(() => parseNetworkEndpoint(value), undefined, value)
    }
    const validation = load('assets/scripts/services/platform/validation.ts')
    assert.equal(validation.normalizeBaseUrl(config.platformEndpoint, 'secure-only'), config.platformEndpoint)
    assert.equal(validation.normalizeBaseUrl('http://[::1]:3003', 'allow-localhost-insecure'), 'http://[::1]:3003')
    assert.throws(() => validation.normalizeBaseUrl('http://remote.example', 'allow-localhost-insecure'))
    const { normalizeGameEndpoint } = load('assets/scripts/services/platform/competitionDecoders.ts')
    assert.equal(normalizeGameEndpoint(config.lobbyEndpoint, 'secure-only'), config.lobbyEndpoint)
    assert.throws(() => normalizeGameEndpoint('ws://127.0.0.1:3002', 'secure-only'))

    const { LobbyResumeSessionStore } = load('assets/scripts/network/LobbyResumeSession.ts')
    const data = new Map()
    const store = new LobbyResumeSessionStore({ getItem: key => data.get(key), setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) })
    assert.equal(store.save({ version: 1, endpoint: config.lobbyEndpoint, roomId: '123456', seat: 'p1', resumeToken: 'test-only-resume' }), true)
    assert.equal(store.restore().endpoint, config.lobbyEndpoint, 'missing URL must not silently delete recovery identity')

    const { XhrTransport } = load('assets/scripts/services/platform/client.ts')
    const { CocosSocketClient } = load('assets/scripts/network/CocosSocketClient.ts')
    const http = new XhrTransport(); const socket = new CocosSocketClient()
    const policy = load('assets/scripts/services/WechatNetworkPolicy.ts')
    const invalidAuthorities = ['localhost', '127.0.0.1', '42.193.229.164', '[::1]', 'api.yuteachhn.cn',
      'api.yutechhn.cn.evil.example', 'user@api.yutechhn.cn', 'api.yutechhn.cn:443', 'api.yutechhn.cn:3003']
    const invalidPaths = ['/guandan-other', '/guandan#', '/guandan/../other', '/guandan/%2e%2e/other',
      '/guandan/%252e%252e/other', '/guandan/%2fother', '/guandan/%5cother', '/guandan/%00other']
    for (const [protocol, field] of [['https:', 'platformEndpoint'], ['wss:', 'lobbyEndpoint']]) {
      const urls = [...invalidAuthorities.map(authority => `${protocol}//${authority}/guandan`),
        ...invalidPaths.map(route => `${protocol}//api.yutechhn.cn${route}`),
        `${protocol === 'https:' ? 'http:' : 'ws:'}//api.yutechhn.cn/guandan`]
      for (const url of urls) {
        assert.throws(() => resolveClientNetworkConfig(config, { __GUANDAN_BUILD_TARGET__: 'wechatgame', __GUANDAN_RUNTIME_CONFIG__: { ...config, [field]: url } }))
        assert.throws(() => policy.assertWechatBusinessEndpoint(url, protocol))
        if (protocol === 'https:') await assert.rejects(http.request({ method: 'GET', url }))
        else await assert.rejects(socket.connect(url))
      }
    }
    assert.deepEqual(opened, [], 'rejected endpoints must never reach either network constructor')
    await http.request({ method: 'GET', url: config.platformEndpoint + '/api/v1/profile' })
    await socket.connect(config.lobbyEndpoint)
    assert.equal(opened.length, 2)
    await assert.rejects(socket.connect('wss://unapproved.example/weapp'))
    assert.equal(socket.snapshot.connected, true)
    socket.close()
  }

  // Exercise the actual overlay method without changing layout or requiring a renderer.
  const { StartupLoadingOverlay } = runtime(undefined, { cc: {}, './RuntimeUiFactory': {} }).load('assets/scripts/ui/StartupLoadingOverlay.ts')
  const overlay = Object.create(StartupLoadingOverlay.prototype)
  Object.assign(overlay, { titleLabel: {}, statusLabel: {}, retryLabel: {}, retryNode: {}, percentLabel: { string: '96%' }, bringToFront () {} })
  for (const [code, title, action] of [
    ['GD-S01', '资源下载失败', '重试加载'], ['GD-S02', '画面准备失败', '重试加载'],
    ['GD-S03', '游戏初始化失败', '重新进入'], ['GD-S04', '重新进入失败', '重新进入'],
  ]) {
    const retry = () => {}
    overlay.showError('下一步说明', retry, code)
    assert.equal(overlay.titleLabel.string, `${title}（${code}）`)
    assert.equal(overlay.retryLabel.string, action)
    assert.equal(overlay.retryCallback, retry)
    assert.equal(overlay.percentLabel.string, '96%')
  }
  const sourceFiles = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? sourceFiles(path.join(directory, entry.name)) : entry.name.endsWith('.ts') ? [path.join(directory, entry.name)] : [])
  for (const file of sourceFiles(path.join(root, 'assets/scripts'))) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /new\s+URL\s*\(/, `browser-only URL constructor reintroduced in ${file}`)
  }
  console.log('WeChat runtime compatibility passed: absent/broken/native URL; startup, gateways, tickets, resume, transport and stage errors')
}

module.exports = verify
if (require.main === module) verify().catch(error => { console.error(error); process.exitCode = 1 })
