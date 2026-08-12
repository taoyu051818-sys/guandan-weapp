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
  new Function('exports', 'module', 'require', output)(loaded.exports, loaded, request => { throw new Error(`unexpected dependency ${request}`) })
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
  assert.match(fs.readFileSync(webFinalizerPath, 'utf8'), /runtimeConfigFromEnv[\s\S]*injectWebRuntimeConfig[\s\S]*verifyReleaseRuntimeConfig/)
  assert.match(fs.readFileSync(wechatFinalizerPath, 'utf8'), /runtimeConfigFromEnv[\s\S]*injectScriptRuntimeConfig[\s\S]*verifyReleaseRuntimeConfig/)
  assert.match(fs.readFileSync(wechatVerifierPath, 'utf8'), /extractRuntimeConfig[\s\S]*verifyReleaseRuntimeConfig/, 'WeChat production verification must reject missing or unsafe injected config')
  process.stdout.write('runtime platform config regression checks passed\n')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
