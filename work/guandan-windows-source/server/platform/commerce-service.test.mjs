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

console.log('commerce service tests passed')
