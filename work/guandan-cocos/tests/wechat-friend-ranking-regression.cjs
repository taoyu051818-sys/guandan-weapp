const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { loadTypeScript } = require('./support/typescript.cjs')
const ts = loadTypeScript()
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 }, fileName: file,
}).outputText, file)
const root = path.resolve(__dirname, '..')
const { authorizeRanking, rankingAuthorized, rankingCall, WechatFriendScoreSync, FRIEND_SCORE_KEY } = require('../assets/scripts/services/WechatFriendRanking.ts')
const modelModule = { exports: {} }
vm.runInNewContext(fs.readFileSync(path.join(root, 'build-templates/wechatgame/openDataContext/ranking-model.js'), 'utf8'), { module: modelModule })
const { rowsFromFriends, pageCount } = modelModule.exports
const friend = (id, score) => ({ openid: id, nickname: id, KVDataList: [{ key: FRIEND_SCORE_KEY, value: score }] })

async function main () {
  const calls = [], writes = []
  let privacy = false, permission = false
  global.wx = {
    getPrivacySetting: cb => cb.success({ needAuthorization: !privacy }),
    getSetting: cb => cb.success({ authSetting: { 'scope.WxFriendInteraction': permission } }),
    requirePrivacyAuthorize: cb => { calls.push('privacy'); privacy = true; cb.success({}) },
    authorize: cb => { assert.equal(cb.scope, 'scope.WxFriendInteraction'); calls.push('friend'); permission = true; cb.success({}) },
    setUserCloudStorage: cb => { writes.push(cb.KVDataList); cb.success({}) },
  }
  const scores = new WechatFriendScoreSync()
  await scores.publish('account', 1234)
  assert.deepEqual(calls, [], 'silent sync never opens consent')
  assert.equal(writes.length, 0)
  await authorizeRanking(global.wx, () => true)
  assert.deepEqual(calls, ['privacy', 'friend'])
  assert.equal(await rankingAuthorized(global.wx), true)
  await scores.publish('account', 1234.2)
  await scores.publish('account', 1234.2)
  assert.deepEqual(writes, [[{ key: FRIEND_SCORE_KEY, value: '1234' }]], 'deduplicate own score only')
  await scores.publish('account', NaN)
  await scores.publish('account', Infinity)
  await scores.publish('account', 4321, false, () => false)
  assert.equal(writes.length, 1)
  let late
  global.wx.getPrivacySetting = cb => { late = cb }
  const pending = scores.publish('account', 4321)
  await Promise.resolve(); scores.cancel(); late.success({ needAuthorization: false }); await pending
  assert.equal(writes.length, 1, 'cancelled automatic work cannot write after disposal')
  await assert.rejects(rankingCall(() => {}, 1))
  const denied = { ...global.wx, requirePrivacyAuthorize: cb => cb.fail({ errMsg: 'deny' }), authorize: () => assert.fail('must stop after denial') }
  await assert.rejects(authorizeRanking(denied, () => true))
  await authorizeRanking({ ...global.wx, requirePrivacyAuthorize: cb => cb.success({}), getSetting: () => assert.fail('closed modal must stop') }, () => false)

  const rows = rowsFromFriends([friend('A', '20'), friend('B', '100'), friend('C', '100'), friend('A', '999'),
    friend('invalid', ''), friend('NaN', 'NaN'), friend('json', '{"score":100}'), null])
  assert.deepEqual(JSON.parse(JSON.stringify(rows.map(row => [row.nickname, row.score, row.rank]))), [['B', 100, 1], ['C', 100, 1], ['A', 20, 3]])
  assert.equal(rows.some(row => 'openid' in row), false, 'renderer needs no friend identifiers')
  assert.equal(pageCount(Array(11)), 3)
  assert.equal(rowsFromFriends(undefined).length, 0)

  let onMessage, callback
  const views = []
  const source = fs.readFileSync(path.join(root, 'build-templates/wechatgame/openDataContext/index.js'), 'utf8')
  const sandbox = {
    wx: { getSharedCanvas: () => ({}), onMessage: cb => { onMessage = cb },
      getFriendCloudStorage: cb => { assert.deepEqual(Array.from(cb.keyList), [FRIEND_SCORE_KEY]); callback = cb } },
    require: id => id === './ranking-model' ? { SCORE_KEY: FRIEND_SCORE_KEY, rowsFromFriends, pageCount } : {
      createRenderer: () => ({ render: view => views.push(view), clear: () => views.push({ clear: true }) }),
    }, setTimeout, clearTimeout,
  }
  vm.runInNewContext(source, sandbox)
  const send = action => onMessage({ type: 'friend-ranking', action })
  send('open'); const first = callback
  send('close'); first.success({ data: [friend('late', '123')] })
  assert.equal(views.at(-1).clear, true, 'close invalidates pending friend callback and clears private data')
  send('open'); callback.fail({})
  assert.match(views.at(-1).message, /读取失败/)
  send('next'); assert.match(views.at(-1).message, /读取失败/, 'pagination cannot erase an error')
  send('open'); callback.success({ data: [] }); assert.match(views.at(-1).message, /暂无/)
  send('open'); callback.success({ data: Array.from({ length: 12 }, (_, i) => friend(String(i), String(i))) })
  send('next'); assert.equal(views.at(-1).page, 1)
  send('next'); send('next'); assert.equal(views.at(-1).page, 2)
  send('previous'); assert.equal(views.at(-1).page, 1)
  send('close')
  assert.doesNotMatch(source, /postMessage|request\(|setStorage/, 'friend data must remain within the open data domain')
  const rendererModule = { exports: {} }, painted = [], images = []
  const ctx = { clearRect: () => painted.push('clear'), save () {}, restore () {}, scale () {}, fillRect () {},
    fillText: text => painted.push(text), drawImage: () => painted.push('avatar') }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'build-templates/wechatgame/openDataContext/ranking-renderer.js'), 'utf8'), {
    module: rendererModule, require: () => modelModule.exports,
  })
  const renderer = rendererModule.exports.createRenderer({ createImage: () => { const image = {}; images.push(image); return image } },
    { width: 1020, height: 450, getContext: () => ctx })
  renderer.render({ page: 0, rows: [{ nickname: '绘制测试', avatarUrl: 'https://wx.qlogo.cn/test', score: 88, rank: 1 }] })
  assert.ok(painted.includes('绘制测试') && painted.includes('88') && painted.includes('第 1 / 1 页'))
  images[0].onload(); assert.ok(painted.includes('avatar'))
  renderer.clear(); const beforeLate = painted.length; images[0].onload()
  assert.equal(painted.length, beforeLate, 'late avatar must not repaint after privacy canvas cleared')
  delete global.wx
  // Exercise the real modal against a mutating Cocos-style children array.
  class FakeNode {
    children = []; isValid = true; components = new Map()
    constructor (name) { this.name = name }
    set parent (value) { this._parent = value; value.children.push(this) }
    get parent () { return this._parent }
    addComponent (type) { const value = new type(); this.components.set(type, value); return value }
    getComponent (type) { return this.components.get(type) }
    getChildByName (name) { return this.children.find(node => node.name === name) }
    removeFromParent () { if (this._parent) this._parent.children.splice(this._parent.children.indexOf(this), 1); this._parent = null }
    destroy () { this.isValid = false }
    setScale () {}
  }
  class Transform { setContentSize () {} }
  const { loadTs } = require('./support/load-typescript-module.cjs')
  const { FriendRankingModal } = loadTs(path.join(root, 'assets/scripts/scenes/front-pages/FriendRankingModal.ts'), {
    cc: { Node: FakeNode, Color: class {}, BlockInputEvents: class {}, UITransform: Transform,
      Game: { EVENT_HIDE: 'hide' }, game: { on () {}, off () {} }, Tween: { stopAllByTarget () {} } },
    '../../ui/RuntimeUiFactory': { RuntimeUiFactory: class {
      constructor (parent) { this.parent = parent }
      panel (name) { const node = new FakeNode(name); node.parent = this.parent; node.addComponent(Transform); return node }
    } },
    '../../ui/CoastalUi': { coastalText () {}, coastalButton () {} },
    '../../ui/WechatFriendCanvas': { WechatFriendCanvas: class { constructor () { assert.fail('browser cannot mount native shared canvas') } } },
    '../../services/WechatFriendRanking': require('../assets/scripts/services/WechatFriendRanking.ts'),
  })
  const parent = new FakeNode('parent')
  const modal = new FriendRankingModal(parent, { viewport: { width: 1280, height: 720 }, safeSize: () => ({ x: 1280, y: 720 }) }, scores,
    async () => assert.fail('browser cannot request personal score for an unavailable leaderboard'))
  modal.show()
  assert.equal(modal.root.children.length, 2, 'loading → error must leave exactly one shade and one panel')
  await modal.load()
  assert.equal(modal.root.children.length, 2, 'refresh must not accumulate old panels')
  modal.close(); assert.equal(parent.children.length, 0); assert.equal(modal.open, false)
  console.log('WeChat ranking permission, own-score sync, privacy lifetime, sort and pagination passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
