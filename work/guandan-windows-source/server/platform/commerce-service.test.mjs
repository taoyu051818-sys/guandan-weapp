import assert from 'node:assert/strict'
import { CommerceService } from './commerce-service.js'
import { createEmptyPlatformState, MemoryPlatformStore } from './storage.js'

const state = createEmptyPlatformState()
state.users.user = { id: 'user' }
state.wallets.user = { userId: 'user', balance: 1000, currency: 'points', updatedAt: 0 }
state.products.soap = { id: 'soap', name: '香皂', pointsPrice: 200, stock: 10 }
state.matches.match = { id: 'match', mode: 'classic_300', status: 'matched', participants: [{ userId: 'user', status: 'matched' }] }
state.activeMatchByUser.user = 'match'
const store = new MemoryPlatformStore(state)
let id = 0
const commerce = new CommerceService({ store, now: () => 2000, createId: () => `id-${++id}` })

assert.deepEqual((await commerce.getWallet('user')).wallet, {
  userId: 'user', balance: 1000, currency: 'points', updatedAt: 0, reserved: 300, available: 700,
})
await assert.rejects(
  () => commerce.redeem('user', { productId: 'soap', quantity: 4, expectedPointsPrice: 200 }, 'redeem-1'),
  error => error.code === 'INSUFFICIENT_POINTS',
)
await store.transaction(draft => { delete draft.activeMatchByUser.user })
const order = await commerce.redeem('user', { productId: 'soap', quantity: 4, expectedPointsPrice: 200 }, 'redeem-1')
assert.equal(order.totalPoints, 800)
assert.deepEqual(await commerce.redeem('user', { productId: 'soap', quantity: 4, expectedPointsPrice: 200 }, 'redeem-1'), order)
await assert.rejects(
  () => commerce.redeem('user', { productId: 'soap', quantity: 3, expectedPointsPrice: 200 }, 'redeem-1'),
  error => error.code === 'IDEMPOTENCY_CONFLICT',
)
assert.equal((await store.read(snapshot => snapshot.wallets.user.balance)), 200)
assert.equal((await store.read(snapshot => snapshot.products.soap.stock)), 6)
assert.equal((await store.read(snapshot => snapshot.ledgerEntries.length)), 1)

// Reject inherited keys before reading fields; an invalid request cannot poison the next purchase.
const beforeInvalid = await store.read(snapshot => snapshot)
const prototypeStock = Object.getOwnPropertyDescriptor(Object.prototype, 'stock')
for (const productId of ['toString', '__proto__', 'constructor', 'hasOwnProperty', 'absent']) {
  await assert.rejects(commerce.redeem('user', { productId }, `invalid-${productId}`), error => error.code === 'PRODUCT_NOT_FOUND')
}
assert.deepEqual(Object.getOwnPropertyDescriptor(Object.prototype, 'stock'), prototypeStock)
assert.deepEqual(await store.read(snapshot => snapshot), beforeInvalid, 'invalid IDs change neither balances, stock nor receipts')
await assert.rejects(commerce.redeem('user', { productId: 'soap', quantity: 5 }, 'after-invalid'), error => error.code === 'INSUFFICIENT_POINTS')
assert.deepEqual(await store.read(snapshot => snapshot), beforeInvalid)

// Corrupted persisted numbers must fail closed; never guess or repair a player's balance here.
const rejectsWithoutMutation = async (mutate, code, quantity = 1) => {
  const isolated = new MemoryPlatformStore(state)
  await isolated.transaction(mutate)
  const before = await isolated.read(snapshot => snapshot)
  const service = new CommerceService({ store: isolated, createId: () => 'guard-test' })
  await assert.rejects(service.redeem('user', { productId: 'soap', quantity }, 'guard-request'), error => error.code === code)
  assert.deepEqual(await isolated.read(snapshot => snapshot), before)
}
for (const value of [NaN, Infinity, null, '200', -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
  await rejectsWithoutMutation(draft => { draft.products.soap.pointsPrice = value }, 'INVALID_PRODUCT_STATE')
  await rejectsWithoutMutation(draft => { draft.products.soap.stock = value }, 'INVALID_PRODUCT_STATE')
  await rejectsWithoutMutation(draft => { draft.wallets.user.balance = value }, 'INVALID_WALLET_STATE')
}
for (const value of [null, [], 'soap', { id: 'another-product', stock: 10, pointsPrice: 200 }]) {
  await rejectsWithoutMutation(draft => { draft.products.soap = value }, 'PRODUCT_NOT_FOUND')
}
await rejectsWithoutMutation(draft => { draft.products.soap.pointsPrice = Number.MAX_SAFE_INTEGER }, 'INVALID_ORDER_TOTAL', 2)
await rejectsWithoutMutation(draft => { draft.wallets.user.userId = 'another-user' }, 'WALLET_NOT_FOUND')
await rejectsWithoutMutation(draft => { delete draft.wallets.user }, 'WALLET_NOT_FOUND')
await store.transaction(draft => { draft.products.soap.pointsPrice = 0; draft.wallets.user.balance = 0 })
assert.equal((await commerce.redeem('user', { productId: 'soap' }, 'free-product')).totalPoints, 0, 'legitimate zero-price products remain supported')

console.log('commerce service tests passed')
