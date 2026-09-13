// Read-only differential audit of build-time versus actual client endpoint policy.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const root = path.resolve(__dirname, '../../../..')
const client = path.join(root, 'work/guandan-cocos')
const ts = require(path.join(client, 'tests/support/typescript.cjs')).loadTypeScript()
function load(file) {
  if (!file.endsWith('.ts')) file += '.ts'
  const module = { exports: {} }
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  Function('module', 'exports', 'require', js)(module, module.exports, name => {
    assert.ok(name.startsWith('.'))
    return load(path.resolve(path.dirname(file), name))
  })
  return module.exports
}
(async () => {
  const build = await import(pathToFileURL(path.join(client, 'scripts/runtime-client-config.mjs')).href)
  const runtime = load(path.join(client, 'assets/scripts/services/RuntimeClientConfig.ts'))
  const base = build.extractRuntimeConfig(fs.readFileSync(path.join(client, 'build-templates/wechatgame/game.ejs'), 'utf8'))
  assert.doesNotThrow(() => build.verifyWechatRuntimeConfig(base))
  assert.doesNotThrow(() => runtime.resolveClientNetworkConfig(base, {
    __GUANDAN_BUILD_TARGET__: 'wechatgame', __GUANDAN_RUNTIME_CONFIG__: base,
  }))
  const failures = []
  for (const [field, value] of [
    ['platformEndpoint', 'https://api.yutechhn.cn/guandan/../other'],
    ['platformEndpoint', 'https://api.yutechhn.cn/guandan/%2e%2e/other'],
    ['lobbyEndpoint', 'wss://api.yutechhn.cn/guandan/%2fweapp'],
  ]) {
    const supplied = { ...base, [field]: value }
    const requested = build.runtimeConfigFromEnv({
      GUANDAN_PLATFORM_ENDPOINT: supplied.platformEndpoint,
      GUANDAN_LOBBY_ENDPOINT: supplied.lobbyEndpoint,
    }, { release: true })
    assert.doesNotThrow(() => build.verifyWechatRuntimeConfig(requested))
    const embedded = build.extractRuntimeConfig(build.injectScriptRuntimeConfig('function __initApp() {}', requested))
    assert.doesNotThrow(() => build.verifyWechatRuntimeConfig(embedded))
    assert.throws(() => runtime.resolveClientNetworkConfig(base, {
      __GUANDAN_BUILD_TARGET__: 'wechatgame', __GUANDAN_RUNTIME_CONFIG__: embedded,
    }), /只允许/)
    failures.push({ field, value, buildAccepted: true, runtimeRejected: true })
  }
  console.log({ currentDefaultsValid: true, failures })
})().catch(error => { console.error(error); process.exitCode = 1 })
