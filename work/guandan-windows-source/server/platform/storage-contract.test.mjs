import assert from 'node:assert/strict'
import { createEmptyPlatformState, MemoryPlatformStore, RedisPlatformStorePrototype, normalizeAccountId, findAvailableAccountId } from './storage.js'
import { upgradeLoadedState, normalizeAccountId as migratedAccountId, findAvailableAccountId as migratedAvailableId } from './state-migrations.js'

assert.equal(normalizeAccountId, migratedAccountId, 'storage keeps its existing public account-helper exports')
assert.equal(findAvailableAccountId, migratedAvailableId)
const fallback = createEmptyPlatformState()
fallback.products = { seeded: { id: 'seeded', name: 'system' }, new: { id: 'new' } }
const legacy = {
  schemaVersion: 1,
  users: { u1: { id: 'u1', accountId: '12345678', createdAt: 1 }, u2: { id: 'u2', accountId: '12345678', createdAt: 2 } },
  wallets: { u1: { userId: 'u1', balance: 88 } },
  products: { seeded: { id: 'seeded', name: 'custom' } },
  matchQueues: { quick: 'm1' },
  matches: { m1: { status: 'matched', participants: [{ userId: 'u1', seat: 'p1', status: 'matched' }] } },
  extension: { preserved: true },
}
const before = structuredClone({ legacy, fallback })
const upgraded = upgradeLoadedState(legacy, fallback)
assert.equal(upgraded.changed, true)
assert.deepEqual({ legacy, fallback }, before, 'migration owns a clone and must not mutate loaded or fallback input')
assert.equal(upgraded.state.schemaVersion, 9)
assert.equal(upgraded.state.users.u1.accountId, '12345678')
assert.notEqual(upgraded.state.users.u2.accountId, '12345678')
assert.deepEqual(upgraded.state.activeMatchByUser, { u1: 'm1' })
assert.deepEqual(upgraded.state.matchQueues, { quick: ['m1'] })
assert.equal(upgraded.state.wallets.u1.balance, 88)
assert.equal(upgraded.state.wallets.u2.balance, 10000)
assert.equal(upgraded.state.products.seeded.name, 'custom')
assert.deepEqual(upgraded.state.products.new, { id: 'new' })
assert.deepEqual(upgraded.state.extension, { preserved: true })
const repeated = upgradeLoadedState(upgraded.state, fallback)
assert.equal(repeated.changed, false)
assert.deepEqual(repeated.state, upgraded.state, 'migration is deterministic and does not duplicate welcome ledgers')
assert.notEqual(repeated.state.users, upgraded.state.users)
assert.throws(() => upgradeLoadedState([], fallback), /根节点必须是对象/)

class FailingStore extends MemoryPlatformStore {
  async persist () { if (this.failNext) { this.failNext = false; throw new Error('persist failed') } }
}
const store = new FailingStore()
const order = []
let releaseFirst
const gate = new Promise(resolve => { releaseFirst = resolve })
const first = store.transaction(async state => {
  order.push('first')
  await gate
  state.extension = { count: 1 }
  return state.extension
})
const second = store.transaction(state => { order.push('second'); state.extension.count += 1; return state.extension })
const readAfter = store.read(state => state.extension)
await Promise.resolve()
assert.deepEqual(order, ['first'], 'transactions and readers wait for the existing write queue')
releaseFirst()
const [firstResult, secondResult, readResult] = await Promise.all([first, second, readAfter])
assert.deepEqual(order, ['first', 'second'])
assert.equal(firstResult.count, 1)
assert.equal(secondResult.count, 2)
assert.equal(readResult.count, 2)
firstResult.count = secondResult.count = readResult.count = 99
await store.read(state => { state.extension.count = 88 })
assert.equal(await store.read(state => state.extension.count), 2, 'readers and returned results cannot mutate committed state')
store.failNext = true
await assert.rejects(store.transaction(state => { state.extension.count = 10 }), /persist failed/)
assert.equal(await store.read(state => state.extension.count), 2)
await store.transaction(state => { state.extension.count = 3 })
assert.equal(await store.read(state => state.extension.count), 3, 'persistence rejection must not poison the transaction queue')
await assert.rejects(store.transaction(state => { state.extension.count = 20; throw new Error('mutator failed') }), /mutator failed/)
assert.equal(await store.read(state => state.extension.count), 3)

let serialized = JSON.stringify(legacy)
let writes = 0
const redis = new RedisPlatformStorePrototype({
  client: { get: async () => serialized, set: async (_, value) => { serialized = value; writes += 1 } },
  fallbackState: fallback,
})
assert.deepEqual(await redis.read(state => state), upgraded.state)
assert.equal(writes, 1, 'prototype migration still persists once')
await redis.read(state => state)
assert.equal(writes, 1)
console.log('storage migration compatibility, serialization, isolation and rollback contracts passed')
