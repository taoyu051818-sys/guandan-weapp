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
assert.equal(playedCardPosition({ width: 1280, height: 720 }, 2).y - playedCardPosition({ width: 1280, height: 720 }, 0).y, 99)
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
let consent, tapped, destroyed = 0, created = 0
const api = { requirePrivacyAuthorize: options => { consent = options }, createUserInfoButton: options => {
  created++; assert.equal(options.withCredentials, false)
  return { onTap: cb => { tapped = cb }, offTap: () => {}, hide: () => {}, destroy: () => { destroyed++ } }
} }
const errors = [], accepted = []
let cancel = mountWechatProfileButton(api, { left: 10, top: 10, width: 200, height: 40 }, p => accepted.push(p), e => errors.push(e))
assert.equal(created, 0)
cancel(); consent.success(); assert.equal(created, 0, 'late privacy callback cannot recreate a dismissed native button')
cancel = mountWechatProfileButton(api, {}, p => accepted.push(p), e => errors.push(e))
consent.success(); assert.equal(created, 1)
consent.success(); assert.equal(created, 1, 'duplicate privacy completion does not leak another native button')
tapped({ errMsg: 'deny' }); assert.equal(errors.length, 1); assert.equal(accepted.length, 0)
tapped({ userInfo: { nickName: '测试昵称', avatarUrl: 'https://thirdwx.qlogo.cn/mmopen/example/132' } })
assert.equal(accepted[0].displayName, '测试昵称')
tapped({ userInfo: { nickName: '重复结果', avatarUrl: 'https://thirdwx.qlogo.cn/mmopen/example/132' } })
assert.equal(accepted.length, 1, 'one authorization may only update the draft once')
cancel(); assert.equal(destroyed, 1)
tapped({ userInfo: { nickName: '迟到回调', avatarUrl: 'https://thirdwx.qlogo.cn/mmopen/example/132' } })
assert.equal(accepted.length, 1)
assert.doesNotThrow(() => mountWechatProfileButton({ requirePrivacyAuthorize: () => { throw new Error('bridge unavailable') } }, {}, () => assert.fail('must not accept'), message => errors.push(message)))
assert.match(errors.at(-1), /隐私授权暂不可用/)
const editor = fs.readFileSync(path.join(root, 'assets/scripts/scenes/front-pages/ProfileEditorModal.ts'), 'utf8')
assert.doesNotMatch(editor, /AvatarChick|AvatarDefault|chooseAvatar|PROFILE_AVATARS/, 'profile editing must not offer game-art avatars')
assert.match(editor, /授权微信昵称和头像/)
console.log('profile consent lifecycle, capsule exclusion and close play lanes passed')
