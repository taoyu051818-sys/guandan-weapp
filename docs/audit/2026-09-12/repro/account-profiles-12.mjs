import assert from 'node:assert/strict'
import { AccountService } from '../../../../work/guandan-windows-source/server/platform/account-service.js'
import { MemoryPlatformStore, createEmptyPlatformState } from '../../../../work/guandan-windows-source/server/platform/storage.js'
import { readProfileAvatar, validateProfilePatch } from '../../../../work/guandan-windows-source/server/platform/profile-avatar.js'
import { validateAvatarUpload } from '../../../../work/guandan-windows-source/server/platform/profile-upload.js'
import { DEFAULT_PROFILES, stableDefaultProfile } from '../../../../work/guandan-windows-source/server/default-profiles.js'
import { roomPlayerNicknames, generatedPlayerAvatar } from '../../../../work/guandan-windows-source/server/player-nicknames.js'
import { MerchantService } from '../../../../work/guandan-windows-source/server/platform/merchant-service.js'

// Only bundled display assets and synthetic memory state. Never calls QQ/WeChat.
// Transport and clock are substituted inside this isolated Node process only.
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ1UAAAAASUVORK5CYII='
const pngBytes = Buffer.from(png.split(',')[1], 'base64')
class FaultStore extends MemoryPlatformStore {
  async persist () { if (this.failNext) { this.failNext = false; throw new Error('audit12 persistence failure') } }
}
const state = createEmptyPlatformState(), store = new FaultStore(state)
let id = 0, accountAttempts = 0, tokenFailure = false
const accounts = new AccountService({ store, now: () => 1_800_000_000_000, createId: () => `audit12-${++id}`,
  createAccountId: () => { accountAttempts++; return '12345678' },
  accessTokens: { issue: userId => { if (tokenFailure) { tokenFailure = false; throw new Error('audit12 issue failure') } return { accessToken: `synthetic:${userId}` } } } })
store.failNext = true
await assert.rejects(accounts.devLogin({ deviceId: 'failed-create' }), /audit12 persistence failure/)
assert.equal(await store.read(s => Object.keys(s.users).length), 0)
tokenFailure = true
await assert.rejects(accounts.devLogin({ deviceId: 'post-commit-retry' }), /audit12 issue failure/)
const createdBeforeToken = await store.read(s => s)
assert.equal(Object.keys(createdBeforeToken.users).length, 1)
assert.equal(createdBeforeToken.ledgerEntries.length, 1)
const same = await Promise.all(Array.from({ length: 40 }, () => accounts.devLogin({ deviceId: 'post-commit-retry' })))
assert.equal(new Set(same.map(x => x.user.id)).size, 1)
assert.equal(await store.read(s => s.ledgerEntries.length), 1)
const distinct = await Promise.all(Array.from({ length: 80 }, (_, i) => accounts.devLogin({ deviceId: `distinct-${i}`, displayName: `合成玩家${i}` })))
assert.equal(new Set([same[0], ...distinct].map(x => x.user.accountId)).size, 81)
assert.equal(await store.read(s => Object.keys(s.userByAccountId).length), 81)
assert.equal(await store.read(s => s.ledgerEntries.length), 81)
assert.ok(accountAttempts >= 80 * 128, 'constant allocator reaches deterministic collision fallback')
const userId = same[0].user.id, avatar = validateAvatarUpload(png)
const prior = await store.read(s => s); store.failNext = true
await assert.rejects(accounts.updateProfile(userId, { displayName: '不应半保存', avatarDataUri: png }), /audit12 persistence failure/)
assert.deepEqual(await store.read(s => s), prior)
const saved = await accounts.updateProfile(userId, { displayName: '😀'.repeat(24), avatarDataUri: png })
assert.equal(saved.avatarUrl, avatar.avatarUrl); assert.equal(saved.avatarImageData, undefined)
assert.equal(await accounts.getUploadedAvatarImage(saved.avatarUrl), png)
const refreshed = await accounts.devLogin({ deviceId: 'post-commit-retry', displayName: '过时资料', avatarUrl: '' })
assert.deepEqual(refreshed.user, saved)
const beforeDraft = await store.read(s => s)
await assert.rejects(accounts.updateProfile(userId, { displayName: '另一个草稿', avatarDataUri: 'bad' }), e => e.code === 'INVALID_AVATAR_UPLOAD')
assert.deepEqual(await store.read(s => s), beforeDraft)
// Shared identical content remains while a different user still owns the same bytes.
await accounts.updateProfile(distinct[0].user.id, { avatarDataUri: png })
await accounts.updateProfile(userId, { avatarUrl: DEFAULT_PROFILES[0].avatarUrl })
assert.equal(await accounts.getUploadedAvatarImage(avatar.avatarUrl), png)
await accounts.updateProfile(distinct[0].user.id, { avatarUrl: '' })
assert.equal(await accounts.getUploadedAvatarImage(avatar.avatarUrl), null)
assert.equal(await store.read(s => Object.values(s.users).filter(u => u.avatarImageData).length), 0)
for (const sample of ['海风', '😀', '名😀', '𠮷']) {
  const name = Array.from(sample.repeat(24)).slice(0, 24).join('')
  validateProfilePatch({ displayName: name })
  assert.equal((await accounts.updateProfile(userId, { displayName: name })).displayName, name)
  assert.throws(() => validateProfilePatch({ displayName: name + 'X' }), e => e.code === 'INVALID_NICKNAME')
}
for (let i = 0; i < 500; i++) {
  const room = { roomId: String(100000 + i), matchId: `audit12-match-${i}`, botDisplayNames: { p1: 'obsolete-name', p2: 'obsolete-name' } }
  const names = roomPlayerNicknames(room), replay = roomPlayerNicknames(structuredClone(room))
  assert.equal(new Set(Object.values(names)).size, 4); assert.deepEqual(replay, names)
  assert.ok(Object.values(names).every(n => generatedPlayerAvatar(n).startsWith('profile:')))
  assert.strictEqual(stableDefaultProfile(`audit12-${i}`), stableDefaultProfile(`audit12-${i}`))
}
const originalFetch = globalThis.fetch, originalNow = Date.now
let now = 1_800_000_000_000, requests = 0
try {
  Date.now = () => now
  globalThis.fetch = async (_url, options) => {
    requests++
    assert.equal(options.redirect, 'error'); assert.equal(options.headers.accept, 'image/png,image/jpeg')
    assert.equal('credentials' in options, false)
    return new Response(pngBytes)
  }
  const url = 'https://thirdwx.qlogo.cn/mmopen/audit12-cache'
  assert.equal(await readProfileAvatar(url), png); assert.equal(await readProfileAvatar(url), png)
  assert.equal(requests, 1)
  now += 599999; await readProfileAvatar(url); assert.equal(requests, 1)
  now++; await readProfileAvatar(url); assert.equal(requests, 2)
  for (let i = 0; i < 20; i++) await readProfileAvatar(`https://wx.qlogo.cn/mmopen/audit12-${i}`)
  const before = requests; await readProfileAvatar(url); assert.equal(requests, before + 1)
  const failing = 'https://wx.qlogo.cn/mmopen/audit12-retry'
  globalThis.fetch = async () => { requests++; throw new Error('synthetic transient image failure') }
  await assert.rejects(readProfileAvatar(failing), e => e.code === 'AVATAR_UNAVAILABLE')
  globalThis.fetch = async () => { requests++; return new Response(pngBytes) }
  assert.equal(await readProfileAvatar(failing), png)
} finally { globalThis.fetch = originalFetch; Date.now = originalNow }
let responseCases = 0
for (const size of [512 * 1024, 512 * 1024 + 1]) {
  const bytes = Buffer.alloc(size); pngBytes.copy(bytes)
  const read = () => readProfileAvatar('https://wx.qlogo.cn/mmopen/audit12-size', async () => new Response(bytes))
  if (size === 512 * 1024) assert.match(await read(), /^data:image\/png;base64,/)
  else await assert.rejects(read(), e => e.code === 'AVATAR_UNAVAILABLE')
  responseCases++
}
for (const response of [() => new Response(pngBytes, { status: 503 }), () => new Response(pngBytes, { headers: { 'content-length': '524289' } }), () => new Response('<html>not an image</html>')]) {
  await assert.rejects(readProfileAvatar('https://wx.qlogo.cn/mmopen/audit12-response', async () => response()), e => e.code === 'AVATAR_UNAVAILABLE')
  responseCases++
}
// These inspect header bounds only, not PNG CRC/JPEG decoding.
let uploadDimensionCases = 0
for (const width of [0, 1, 255, 256, 257]) for (const height of [0, 1, 255, 256, 257]) {
  const bytes = Buffer.from(pngBytes); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20)
  const input = `data:image/png;base64,${bytes.toString('base64')}`
  if (width >= 1 && width <= 256 && height >= 1 && height <= 256) assert.match(validateAvatarUpload(input).avatarUrl, /^upload:/)
  else assert.throws(() => validateAvatarUpload(input), e => e.code === 'INVALID_AVATAR_UPLOAD')
  uploadDimensionCases++
}
const merchantState = createEmptyPlatformState()
for (const user of ['owner', 'cashier', 'customer']) {
  merchantState.users[user] = { id: user, displayName: user }
  merchantState.wallets[user] = { userId: user, balance: 1000, currency: 'points' }
}
const merchantStore = new FaultStore(merchantState)
let merchantId = 0
const merchants = new MerchantService({ store: merchantStore, now: () => 1_800_000_000_000, createId: () => `audit12-${++merchantId}` })
const merchant = await merchants.apply('owner', { name: '合成商户' })
await assert.rejects(merchants.createStore('owner', { name: '一店' }, 'store'), e => e.code === 'FORBIDDEN')
await merchantStore.transaction(s => { s.merchants[merchant.id].status = 'active' })
const location = await merchants.createStore('owner', { name: '一店' }, 'store')
await merchants.addEmployee('owner', { employeeUserId: 'cashier' })
const grantRequest = { storeId: location.id, recipientUserId: 'customer', amount: 1000 }
const beforeGrant = await merchantStore.read(s => s); merchantStore.failNext = true
await assert.rejects(merchants.grantPoints('cashier', grantRequest, 'same-grant'), /audit12 persistence failure/)
assert.deepEqual(await merchantStore.read(s => s), beforeGrant)
const grants = await Promise.all(Array.from({ length: 20 }, () => merchants.grantPoints('cashier', grantRequest, 'same-grant')))
assert.equal(grants.filter(g => !g.duplicate).length, 1)
const capacity = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => merchants.grantPoints('cashier', grantRequest, `another-${i}`)))
assert.equal(capacity.filter(r => r.status === 'fulfilled').length, 4)
assert.ok(capacity.filter(r => r.status === 'rejected').every(r => r.reason.code === 'MERCHANT_DAILY_LIMIT'))
const grantFinal = await merchantStore.read(s => s)
assert.equal(grantFinal.wallets.customer.balance, 6000); assert.equal(grantFinal.ledgerEntries.length, 5)
console.log(JSON.stringify({ accountProfiles12: { sameIdentityLogins: 40, distinctIdentities: 80,
  accountIds: 81, initialLedgers: 81, atomicCreateAndProfileFailures: true,
  postCommitTokenRetry: true, unicodeBoundaries: 4, roomNameFixtures: 500,
  proxyCacheTtlAndCapacity: true, proxyResponseCases: responseCases, uploadDimensionCases,
  merchantRepeatedGrants: 20, merchantConcurrentDailyLimit: 5000, merchantPersistenceRollback: true } }, null, 2))
