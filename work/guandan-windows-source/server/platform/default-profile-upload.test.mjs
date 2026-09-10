import assert from 'node:assert/strict'
import { AccountService } from './account-service.js'
import { MemoryPlatformStore, createEmptyPlatformState } from './storage.js'
import { DEFAULT_PROFILES, defaultAvatarImage } from '../default-profiles.js'
import { validateAvatarUpload } from './profile-upload.js'
import { validateProfilePatch } from './profile-avatar.js'
import { createServer } from 'node:http'
import { createPlatformHttpHandler } from './http.js'
import { unauthorized } from './errors.js'

assert.ok(DEFAULT_PROFILES.length >= 8 && DEFAULT_PROFILES.length <= 50)
for (const p of DEFAULT_PROFILES) {
  validateProfilePatch({ displayName: p.displayName, avatarUrl: p.avatarUrl })
  assert.match(defaultAvatarImage(p.avatarUrl), /^data:image\/(png|jpeg|gif);base64,/)
}
assert.equal(defaultAvatarImage('profile:../../secret'), null)
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ1UAAAAASUVORK5CYII='
const upload = validateAvatarUpload(png)
assert.match(upload.avatarUrl, /^upload:[a-f0-9]{64}$/)
for (const invalid of ['', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,aaaa', png + '!', png.replace('png', 'jpeg')]) assert.throws(() => validateAvatarUpload(invalid))
const giant = Buffer.from(png.split(',')[1], 'base64'); giant.writeUInt32BE(10000, 16)
assert.throws(() => validateAvatarUpload(`data:image/png;base64,${giant.toString('base64')}`))
assert.throws(() => validateAvatarUpload(`data:image/png;base64,${Buffer.alloc(65537).toString('base64')}`))

let next = 0
const store = new MemoryPlatformStore(createEmptyPlatformState())
const accounts = new AccountService({ store, accessTokens: { issue: () => ({ accessToken: 'test' }) }, createId: () => String(++next) })
const login = await accounts.devLogin({ deviceId: 'new', displayName: '陵水玩家' })
assert.ok(DEFAULT_PROFILES.some(p => p.displayName === login.user.displayName && p.avatarUrl === login.user.avatarUrl))
assert.deepEqual((await accounts.devLogin({ deviceId: 'new' })).user, login.user, 'defaults persist across re-login')
const saved = await accounts.updateProfile(login.user.id, { displayName: '我的名字', avatarDataUri: png })
assert.equal(saved.avatarUrl, upload.avatarUrl)
assert.equal(saved.avatarImageData, undefined, 'raw image never leaks into public account payloads')
assert.equal(await accounts.getUploadedAvatarImage(saved.avatarUrl), png)
assert.deepEqual((await accounts.devLogin({ deviceId: 'new', displayName: '旧客户端默认名' })).user, saved)
const other = await accounts.devLogin({ deviceId: 'other' })
await assert.rejects(accounts.updateProfile(other.user.id, { avatarUrl: saved.avatarUrl }))
await assert.rejects(accounts.updateProfile(login.user.id, { displayName: '失败草稿', avatarDataUri: 'invalid' }))
assert.equal((await accounts.getProfile(login.user.id)).displayName, '我的名字')
await accounts.updateProfile(login.user.id, { avatarUrl: DEFAULT_PROFILES[0].avatarUrl })
assert.equal(await accounts.getUploadedAvatarImage(upload.avatarUrl), null, 'replacing an upload drops obsolete bytes')
console.log('Default catalog, stable initial identities, uploads, dimensions, atomic save and public payload tests passed')

const server = createServer(createPlatformHttpHandler({ service: {
  authenticate: async token => { if (token !== 'test') throw unauthorized('login required'); return { id: login.user.id } },
  getProfile: id => accounts.getProfile(id), updateProfile: (id, patch) => accounts.updateProfile(id, patch),
  getUploadedAvatarImage: url => accounts.getUploadedAvatarImage(url),
} }))
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/api/v1/profile`
try {
  assert.equal((await fetch(base, { method: 'POST', body: JSON.stringify({ avatarDataUri: png }) })).status, 401)
  const response = await fetch(base, { method: 'POST', headers: { authorization: 'Bearer test', 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'HTTP保存', avatarDataUri: png }) })
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.data.user.avatarUrl, upload.avatarUrl)
  assert.equal(result.data.user.profileSource, 'saved')
  const pixels = await fetch(`${base}/avatar`, { headers: { authorization: 'Bearer test' } })
  assert.equal((await pixels.json()).data.dataUri, png)
  assert.equal((await fetch(base, { method: 'POST', headers: { authorization: 'Bearer test' }, body: JSON.stringify({ avatarDataUri: 'data:image/svg+xml;base64,AAAA' }) })).status, 400)
} finally { await new Promise(resolve => server.close(resolve)) }
console.log('Authenticated HTTP avatar upload and retrieval passed')
