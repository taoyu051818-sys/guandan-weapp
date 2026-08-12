import assert from 'node:assert/strict'
import { MerchantService } from './merchant-service.js'
import { createEmptyPlatformState, MemoryPlatformStore } from './storage.js'

const state = createEmptyPlatformState()
state.users.owner = { id: 'owner', displayName: '店主' }
state.users.cashier = { id: 'cashier', displayName: '收银员' }
state.users.customer = { id: 'customer', displayName: '牌友' }
state.wallets.owner = { userId: 'owner', balance: 100, currency: 'points', updatedAt: 0 }
state.wallets.cashier = { userId: 'cashier', balance: 100, currency: 'points', updatedAt: 0 }
state.wallets.customer = { userId: 'customer', balance: 100, currency: 'points', updatedAt: 0 }

let sequence = 0
const now = 2_000_000
const store = new MemoryPlatformStore(state)
const merchants = new MerchantService({ store, now: () => now, createId: () => `id-${++sequence}` })

const merchant = await merchants.apply('owner', { name: ' 测试商户 ', contactName: ' 店长 ' })
assert.equal(merchant.name, '测试商户')
assert.equal(merchant.contactName, '店长')
await assert.rejects(() => merchants.createStore('owner', { name: '一号店' }, 'store-1'), error => error.code === 'FORBIDDEN')

await store.transaction(draft => { draft.merchants[merchant.id].status = 'active' })
const firstStore = await merchants.createStore('owner', { name: '一号店', address: '陵水' }, 'store-1')
assert.deepEqual(await merchants.createStore('owner', { name: '一号店', address: '陵水' }, 'store-1'), firstStore)
await merchants.addEmployee('owner', { employeeUserId: 'cashier', role: 'cashier' })

await assert.rejects(
  () => merchants.grantPoints('cashier', { storeId: firstStore.id, recipientUserId: 'owner', amount: 10 }, 'grant-owner'),
  error => error.code === 'FORBIDDEN',
)
const firstGrant = await merchants.grantPoints('cashier', {
  storeId: firstStore.id,
  recipientUserId: 'customer',
  amount: 250,
  note: ' 消费奖励 ',
}, 'grant-1')
assert.equal(firstGrant.duplicate, false)
assert.equal(firstGrant.note, '消费奖励')
assert.equal((await merchants.grantPoints('cashier', {
  storeId: firstStore.id,
  recipientUserId: 'customer',
  amount: 250,
  note: '消费奖励',
}, 'grant-1')).duplicate, true)
await assert.rejects(
  () => merchants.grantPoints('cashier', { storeId: firstStore.id, recipientUserId: 'customer', amount: 251, note: '消费奖励' }, 'grant-1'),
  error => error.code === 'IDEMPOTENCY_CONFLICT',
)

const consoleView = await merchants.getConsole('owner')
assert.equal(consoleView.stores.length, 1)
assert.equal(consoleView.employees.length, 1)
assert.equal(consoleView.grantedPoints, 250)
assert.equal((await store.read(snapshot => snapshot.wallets.customer.balance)), 350)
assert.equal((await store.read(snapshot => snapshot.ledgerEntries.filter(entry => entry.type === 'merchant_grant').length)), 1)

console.log('merchant service tests passed')
