const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTypeScript } = require('./support/typescript.cjs')
const ts = loadTypeScript()
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 }, fileName: file,
}).outputText, file)
const root = path.resolve(__dirname, '..')
const { readWechatCapsule, avoidNativeCapsule } = require(path.join(root, 'assets/scripts/ui/WechatCapsuleLayout.ts'))
const { playedCardPosition } = require(path.join(root, 'assets/scripts/ui/PlayedCardLayout.ts'))
assert.equal(playedCardPosition({ width: 1280, height: 720 }, 2).y - playedCardPosition({ width: 1280, height: 720 }, 0).y, 79,
  'retain the approved 20-unit downward adjustment of the opposite play area')
assert.equal(readWechatCapsule(1280, 720), undefined)
const capsule = readWechatCapsule(1748, 804, {
  getWindowInfo: () => ({ windowWidth: 874, windowHeight: 402 }),
  getMenuButtonBoundingClientRect: () => ({ left: 754, top: 12, width: 108, height: 32 }),
})
assert.deepEqual(capsule, { left: 634, right: 850, top: 378, bottom: 314 })
const moved = avoidNativeCapsule({ x: 650, y: 350 }, 420, 70, capsule, -874)
assert.equal(moved.x + 210, 622)
assert.deepEqual(avoidNativeCapsule(moved, 420, 70, capsule, -874), moved, 'stable reflow without cumulative drift')
const down = avoidNativeCapsule({ x: 10, y: 350 }, 1600, 70, capsule, -874)
assert.equal(down.y + 35, 302, 'narrow layout falls below native chrome instead of off-screen')
const { mountWechatProfileButton } = require(path.join(root, 'assets/scripts/services/WechatProfileProvider.ts'))
let tapped, destroyed = 0, created = 0
const api = { requirePrivacyAuthorize: () => assert.fail('native button must not wait behind privacy callback'), createUserInfoButton: options => {
  created++; assert.equal(options.withCredentials, false); assert.equal(options.style.borderRadius, 6, 'native authorization uses the shared control frame')
  return { onTap: cb => { tapped = cb }, offTap: () => {}, hide: () => {}, destroy: () => { destroyed++ } }
} }
const errors = [], accepted = []
let cancel = mountWechatProfileButton(api, { left: 10, top: 10, width: 200, height: 40 }, p => accepted.push(p), e => errors.push(e))
assert.equal(created, 1, 'native button is mounted immediately')
cancel(); assert.equal(destroyed, 1)
cancel = mountWechatProfileButton(api, { left: 10, top: 10, width: 200, height: 40 }, p => accepted.push(p), e => errors.push(e))
assert.equal(created, 2)
tapped({ errMsg: 'deny' }); assert.equal(errors.length, 1); assert.equal(accepted.length, 0)
tapped({ userInfo: { nickName: '测试昵称', avatarUrl: 'https://thirdwx.qlogo.cn/mmopen/example/132' } })
assert.equal(accepted[0].displayName, '测试昵称')
tapped({ userInfo: { nickName: '重复结果', avatarUrl: 'https://thirdwx.qlogo.cn/mmopen/example/132' } })
assert.equal(accepted.length, 1, 'one authorization may only update the draft once')
cancel(); assert.equal(destroyed, 2)
tapped({ userInfo: { nickName: '迟到回调', avatarUrl: 'https://thirdwx.qlogo.cn/mmopen/example/132' } })
assert.equal(accepted.length, 1)
assert.doesNotThrow(() => mountWechatProfileButton({ requirePrivacyAuthorize: () => { throw new Error('bridge unavailable') } }, {}, () => assert.fail('must not accept'), message => errors.push(message)))
assert.match(errors.at(-1), /不支持资料授权/)
const editor = fs.readFileSync(path.join(root, 'assets/scripts/scenes/front-pages/ProfileEditorModal.ts'), 'utf8')
assert.doesNotMatch(editor, /AvatarChick|AvatarDefault|chooseAvatar|PROFILE_AVATARS/, 'profile editing must not offer game-art avatars')
assert.match(editor, /授权微信昵称和头像/)
assert.match(editor, /Game\.EVENT_HIDE, this\.suspendNative/, 'backgrounding must hide, not destroy, the pending native authorization')
assert.match(editor, /Game\.EVENT_SHOW, this\.resumeNative/, 'foregrounding must restore the same native button')
assert.match(editor, /Tween\.stopAllByTarget\(node\)[\s\S]*node\.setScale\(Vec3\.ONE\)[\s\S]*getBoundingBoxToWorld/, 'native bounds must not capture a partially scaled entrance/press')
const { readWechatProfile } = require(path.join(root, 'assets/scripts/services/WechatProfileResult.ts'))
const rawProfile = { nickName: '微信昵称', avatarUrl: 'https://wx.qlogo.cn/mmopen/test/132' }
assert.equal(readWechatProfile({ errMsg: 'getUserInfo:ok', rawData: JSON.stringify(rawProfile) }).displayName, '微信昵称')
for (const response of [{ rawData: '{' }, { userInfo: { nickName: 7 } }, { rawData: 'null' },
  { errMsg: 'getUserInfo:fail auth deny', userInfo: rawProfile },
  { userInfo: { ...rawProfile, avatarUrl: 'https://wx.qlogo.cn.evil.test/mmopen/test' } }]) assert.throws(() => readWechatProfile(response))
let nativeTap, nativeDestroyed = 0, nativeHidden = 0, nativeShown = 0
const received = [], lookupErrors = []
const nativeApi = { getSetting: () => assert.fail('manual consent does not silently fetch'),
  createUserInfoButton: () => ({ onTap: cb => { nativeTap = cb }, hide: () => { nativeHidden++ }, show: () => { nativeShown++ }, destroy: () => { nativeDestroyed++ } }) }
const rect = { left: 10, top: 10, width: 200, height: 40 }
let control = mountWechatProfileButton(nativeApi, rect, value => received.push(value), value => lookupErrors.push(value))
control.hide(); assert.equal(nativeDestroyed, 0, 'hiding during authorization preserves callback lifetime')
control.show(); assert.equal(nativeShown, 1)
control.hide(); nativeTap({ rawData: JSON.stringify(rawProfile) })
assert.equal(received.length, 1, 'native result may arrive while temporarily backgrounded')
assert.equal(nativeDestroyed, 1, 'success removes the native overlay even for synchronous callbacks')
control(); control(); assert.equal(nativeDestroyed, 1)
control = mountWechatProfileButton(nativeApi, rect, value => received.push(value), value => lookupErrors.push(value))
control.hide(); assert.ok(nativeHidden >= 3)
control(); nativeTap({ userInfo: rawProfile }); assert.equal(received.length, 1)
assert.equal(nativeDestroyed, 2, 'disposed controls cannot accept late results')
assert.deepEqual(lookupErrors, [])
console.log('profile consent lifecycle, capsule exclusion and close play lanes passed')
const { readAuthorizedWechatProfile, WechatProfileSync } = require(path.join(root, 'assets/scripts/services/WechatProfileSync.ts'))
async function syncTests () {
  const authorized = {
    getPrivacySetting: o => o.success({ needAuthorization: false }),
    getSetting: o => o.success({ authSetting: { 'scope.userInfo': true } }),
    getUserInfo: o => { assert.equal(o.withCredentials, false); o.success({ userInfo: rawProfile }) },
    createUserInfoButton: () => assert.fail('silent sync must never create consent UI'),
    requirePrivacyAuthorize: () => assert.fail('silent sync must never prompt privacy'),
  }
  assert.equal((await readAuthorizedWechatProfile(authorized)).displayName, rawProfile.nickName)
  for (const denied of [{ getPrivacySetting: o => o.success({ needAuthorization: true }) },
    { getSetting: o => o.success({ authSetting: {} }) }, { getSetting: o => o.success({ authSetting: { 'scope.userInfo': false } }) }]) {
    assert.equal(await readAuthorizedWechatProfile({ ...authorized, ...denied, getUserInfo: () => assert.fail('not authorized') }), null)
  }
  assert.equal(await readAuthorizedWechatProfile({ ...authorized, getSetting: () => { throw Error('bridge') } }), null)
  let late
  assert.equal(await readAuthorizedWechatProfile({ ...authorized, getPrivacySetting: o => { late = o } }, 5), null)
  late.success({ needAuthorization: false })
  global.wx = authorized
  const writes = [], user = { id: 'a', displayName: 'old', avatarUrl: '' }
  const sync = new WechatProfileSync({ save: async (p, id) => writes.push({ p, id }) }, () => true)
  await sync.run(user); assert.equal(writes.length, 1); assert.equal(writes[0].id, 'a')
  await sync.run(user); assert.equal(writes.length, 1, 'rate limited')
  const suspended = new WechatProfileSync({ save: () => assert.fail('edit cancelled silent refresh') }, () => true)
  global.wx = { ...authorized, getUserInfo: o => { late = o } }
  const pending = suspended.run(user); suspended.cancel(); late.success({ userInfo: rawProfile }); await pending
  global.wx = authorized
  await new WechatProfileSync({ save: () => assert.fail('unchanged profile') }, () => true).run({ ...user, displayName: rawProfile.nickName, avatarUrl: rawProfile.avatarUrl })
  for (const profileSource of ['generated', 'saved']) await new WechatProfileSync({ save: () => assert.fail('must not overwrite generated or edited identity') }, () => true).run({ ...user, profileSource })
  delete global.wx
  console.log('Wechat authorized startup sync: privacy, scope, timeout, cancellation and deduplication passed')
}
syncTests().catch(error => { console.error(error); process.exitCode = 1 })
