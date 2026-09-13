// Isolated audit assertions: current TypeScript sources, memory-only platform adapters.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../../../..')
const client = path.join(root, 'work/guandan-cocos')
const ts = require(path.join(client, 'tests/support/typescript.cjs')).loadTypeScript()
const cache = new Map()
function load(relative) {
  let file = path.resolve(client, relative)
  if (!fs.existsSync(file)) file += '.ts'
  if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.ts')
  if (cache.has(file)) return cache.get(file).exports
  const module = { exports: {} }
  cache.set(file, module)
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  Function('module', 'exports', 'require', output)(module, module.exports, name => {
    if (!name.startsWith('.')) throw Error('Unexpected external dependency: ' + name)
    return load(path.resolve(path.dirname(file), name))
  })
  return module.exports
}

async function main() {
  const { snapshotData, copyData } = load('assets/scripts/services/DataSnapshot.ts')
  const source = { players: [{ hand: [{ id: 'physical-1' }] }], flag: null }
  const snapshot = snapshotData(source)
  source.players[0].hand[0].id = 'changed'
  assert.equal(snapshot.players[0].hand[0].id, 'physical-1')
  assert.ok(Object.isFrozen(snapshot.players[0].hand[0]))
  assert.ok(Object.isFrozen(snapshot.players))
  const copy = copyData(snapshot)
  copy.players[0].hand.push({ id: 'physical-2' })
  assert.equal(snapshot.players[0].hand.length, 1)

  const { restoreSessionSnapshot } = load('assets/scripts/session/GameSessionModel.ts')
  for (const input of [null, undefined, [], 'invalid', 5, {}, {
    status: 'playing', roomId: '123456', myPlayerId: 'p3', isObserver: true,
    settings: { volume: -1, bgmVolume: 2, voicePack: 'male', rulePreset: 'unknown', soundEnabled: 'yes' },
    playerStats: { gamesPlayed: -2, wins: NaN, elo: Infinity },
  }]) {
    const session = restoreSessionSnapshot(input)
    assert.equal(session.status, 'menu')
    assert.equal(session.roomId, null)
    assert.equal(session.myPlayerId, 'p1')
    assert.equal(session.isMultiplayer, false)
    assert.equal(session.settings.voicePack, 'female')
    assert.ok(session.settings.volume >= 0 && session.settings.volume <= 1)
    assert.ok(session.settings.bgmVolume >= 0 && session.settings.bgmVolume <= 1)
    assert.ok(Object.values(session.playerStats).every(value => Number.isFinite(value) && value >= 0))
  }

  const { assertWechatBusinessEndpoint } = load('assets/scripts/services/WechatNetworkPolicy.ts')
  const allowed = 'https://api.yutechhn.cn/guandan'
  for (const suffix of ['', '/', '/api/v1/profile', '?v=1']) assert.doesNotThrow(() => assertWechatBusinessEndpoint(allowed + suffix, 'https:'))
  for (const suffix of ['/..', '/%2E%2e/other', '/%252e/other', '/%2fother', '/%5Cother', '/%00', '-other', '#fragment']) {
    assert.throws(() => assertWechatBusinessEndpoint(allowed + suffix, 'https:'))
  }
  const { requestWechatLoginCredential: login } = load('assets/scripts/services/WechatLoginProvider.ts')
  await assert.rejects(login(undefined, 5), error => error.code === 'WX_LOGIN_UNAVAILABLE')
  await assert.rejects(login({ login() { throw Error('sync failure') } }, 5), error => error.code === 'WX_LOGIN_FAILED')
  await assert.rejects(login({ login(options) { options.success({ code: ' ' }) } }, 5), error => error.code === 'WX_LOGIN_INVALID_CODE')
  await assert.rejects(login({ login(options) { options.fail({ errMsg: 'failure' }) } }, 5), error => error.code === 'WX_LOGIN_FAILED')
  let late
  await assert.rejects(login({ login(options) { late = options } }, 5), error => error.code === 'WX_LOGIN_TIMEOUT')
  late.success({ code: 'late-code' })
  late.fail({ errMsg: 'late-failure' })
  assert.deepEqual(await login({ login(options) { options.success({ code: ' valid ' }); options.fail({}); options.success({ code: 'duplicate' }) } }, 5), { kind: 'wechat', code: 'valid' })
  console.log('Client foundations passed: immutable DTO, cache whitelist, endpoint boundaries, login settlement/late callbacks')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
