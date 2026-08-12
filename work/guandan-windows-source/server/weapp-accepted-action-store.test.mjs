import assert from 'node:assert/strict'
import { createAcceptedActionStore } from './weapp-accepted-action-store.js'

const store = createAcceptedActionStore({ maxEntries: 3 })
for (const key of ['a', 'b', 'c']) {
  assert.equal(store.reserve(key), true)
  assert.equal(store.remember(key, `fp-${key}`, { requestId: key }), true)
}
assert.equal(store.entries.size, 3)
assert.equal(store.reserve('d'), false, 'all-pending capacity must reject before mutating state')
assert.equal(store.remember('d', 'fp-d', { requestId: 'd' }), false)
assert.equal(store.entries.size, 3, 'pending acceptances must never grow beyond the durable bound')

store.entries.set('a', { ...store.entries.get('a'), pendingDurability: false })
assert.equal(store.reserve('d'), true)
assert.equal(store.remember('d', 'fp-d', { requestId: 'd' }), true)
assert.equal(store.entries.has('a'), false, 'oldest durable acceptance is the safe eviction candidate')
assert.equal(store.entries.size, 3)

const room = { pendingGameStartRequest: { cacheKey: 'old:42' } }
store.entries.clear()
store.entries.set('old:1', { pendingDurability: true })
store.entries.set('old:2', { pendingDurability: false })
store.rotateToken('old', 'new', room)
assert.deepEqual([...store.entries.keys()], ['new:1', 'new:2'])
assert.equal(store.entries.size, 2, 'rotation replaces rather than duplicates old token keys')
assert.equal(room.pendingGameStartRequest.cacheKey, 'new:42')
store.deleteToken('new')
assert.equal(store.entries.size, 0, 'retiring a resume token deletes all of its replay identities')

console.log('weapp accepted action store tests passed')
