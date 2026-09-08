import assert from 'node:assert/strict'
import { AccountService } from './account-service.js'
import { createEmptyPlatformState, MemoryPlatformStore } from './storage.js'
import { validateProfilePatch } from './profile-avatar.js'

const store = new MemoryPlatformStore(createEmptyPlatformState())
let id = 0
const issuedTokens = []
const accounts = new AccountService({
  store,
  accessTokens: {
    issue (userId) { issuedTokens.push(userId); return { accessToken: `token:${userId}`, expiresAt: 999 } },
    verify (token) { return { sub: token.slice('token:'.length) } },
  },
  now: () => 1234,
  createId: () => `id-${++id}`,
  createAccountId: () => '12345678',
})

const login = await accounts.devLogin({ deviceId: 'stable-device', displayName: ' 玩家 ' })
assert.equal(login.user.accountId, '12345678')
assert.equal(login.user.displayName, '玩家')
assert.equal(typeof login.user.comprehensiveScore, 'number')
assert.ok(login.user.comprehensiveScore > 0)
assert.deepEqual(await accounts.authenticate(login.accessToken), await store.read(state => state.users[login.user.id]))
assert.equal((await store.read(state => state.wallets[login.user.id].balance)), 10_000)
assert.equal((await store.read(state => state.ledgerEntries.length)), 1)

const duplicate = await accounts.devLogin({ deviceId: 'stable-device', displayName: '新名字' })
assert.equal(duplicate.user.id, login.user.id)
assert.equal((await store.read(state => Object.keys(state.users).length)), 1)
const profile = await accounts.updateProfile(login.user.id, { displayName: ' 最终名字 ', avatarUrl: ' https://example/avatar ' })
assert.equal(profile.displayName, '最终名字')
assert.equal(profile.avatarUrl, 'https://example/avatar')
assert.equal(issuedTokens.length, 2)

const emojiBoundary = '名'.repeat(23) + '😀'
validateProfilePatch({ displayName: emojiBoundary })
assert.equal((await accounts.updateProfile(login.user.id, { displayName: emojiBoundary })).displayName, emojiBoundary)
const emojiOnly = '😀'.repeat(24)
validateProfilePatch({ displayName: emojiOnly })
assert.equal((await accounts.updateProfile(login.user.id, { displayName: ` ${emojiOnly} ` })).displayName, emojiOnly)
assert.equal((await accounts.getProfile(login.user.id)).displayName, emojiOnly, 'saved profile round-trips all 24 Unicode characters')
assert.throws(() => validateProfilePatch({ displayName: '😀'.repeat(25) }), error => error.code === 'INVALID_NICKNAME')
const emojiLogin = await accounts.devLogin({ deviceId: 'emoji-device', displayName: `${emojiBoundary}尾巴` })
assert.equal(emojiLogin.user.displayName, emojiBoundary, 'login truncates whole characters rather than splitting a surrogate pair')
const refresh = await accounts.devLogin({ deviceId: 'stable-device', displayName: '不应覆盖已保存昵称' })
assert.equal(refresh.user.displayName, emojiOnly, 'login refresh still preserves customized profiles')

console.log('account service tests passed')
