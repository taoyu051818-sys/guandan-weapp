import assert from 'node:assert/strict'
import { AccountService } from './account-service.js'
import { createEmptyPlatformState, MemoryPlatformStore } from './storage.js'

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

console.log('account service tests passed')
