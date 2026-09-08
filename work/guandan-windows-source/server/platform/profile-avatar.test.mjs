import assert from 'node:assert/strict'
import { readProfileAvatar, validateProfilePatch } from './profile-avatar.js'
for (const url of ['http://127.0.0.1/avatar', 'https://thirdwx.qlogo.cn.evil.test/mmopen/a', 'https://wx.qlogo.cn:8443/mmopen/a', 'file:///etc/passwd', 'https://wx.qlogo.cn/other', 'https://x@wx.qlogo.cn/mmopen/a']) {
  assert.throws(() => validateProfilePatch({ avatarUrl: url }))
}
for (const name of ['', ' '.repeat(3), 'x'.repeat(25), 'a\nb']) assert.throws(() => validateProfilePatch({ displayName: name }))
validateProfilePatch({ displayName: '陵水牌友', avatarUrl: 'asset:ui/lobby/shop-float-chick/texture' })
assert.equal(await readProfileAvatar(''), null)
let calls = 0
await assert.rejects(readProfileAvatar('https://localhost/mmopen/a', async () => { calls++ }))
assert.equal(calls, 0)
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ1UAAAAASUVORK5CYII=', 'base64')
const data = await readProfileAvatar('https://thirdwx.qlogo.cn/mmopen/test/132', async (_, options) => {
  assert.equal(options.redirect, 'error')
  return new Response(png, { headers: { 'content-type': 'image/png' } })
})
assert.equal(data, `data:image/png;base64,${png.toString('base64')}`)
await assert.rejects(readProfileAvatar('https://thirdwx.qlogo.cn/mmopen/test/132', async () => new Response('<html>wrong content</html>')))
await assert.rejects(readProfileAvatar('https://thirdwx.qlogo.cn/mmopen/test/132', async () => new Response(Buffer.alloc(513 * 1024))))
console.log('profile avatar allowlist, payload limits, image signatures and safe proxy passed')
