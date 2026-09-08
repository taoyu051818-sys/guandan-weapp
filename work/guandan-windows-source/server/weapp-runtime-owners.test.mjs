import assert from 'node:assert/strict'
import './weapp-room-expiry.test.mjs'
import { readFileSync } from 'node:fs'
import { createRuntimePersistence } from './weapp-runtime-persistence.js'
import { createRoomExpiry } from './weapp-room-expiry.js'
import { createRoomMetadata } from './weapp-room-metadata.js'

const fakeTimers = () => {
  const pending = new Map()
  return {
    pending,
    setTimeout: (callback, delay) => { const token = { unref () {} }; pending.set(token, { callback, delay }); return token },
    clearTimeout: token => pending.delete(token),
    fire: () => { const [token, timer] = pending.entries().next().value; pending.delete(token); timer.callback(); return timer.delay },
  }
}
const settle = () => new Promise(resolve => setImmediate(resolve))

// Debounce, concurrent acceptance replacement, retry and shutdown final flush.
{
  const timers = fakeTimers()
  const original = { pendingDurability: true }
  const acceptedActions = new Map([['request', original]])
  let saveCount = 0
  let resolveSave
  let fail = false
  let stopped = false
  const persistence = createRuntimePersistence({
    ...timers, acceptedActions, debounceMs: 20, isShuttingDown: () => stopped,
    persistedRuntimeSnapshot: () => ({ acceptedActions: [...acceptedActions] }),
    roomStateStore: { configured: true, save: async () => {
      saveCount++
      if (fail) throw new Error('injected write failure')
      if (saveCount === 1) await new Promise(resolve => { resolveSave = resolve })
    } },
  })
  persistence.persistRuntimeState()
  persistence.persistRuntimeState()
  assert.equal(timers.pending.size, 1)
  assert.equal(timers.pending.values().next().value.delay, 20)
  const first = persistence.flushRuntimeState({ throwOnError: true })
  const replacement = { pendingDurability: true }
  acceptedActions.set('request', replacement)
  persistence.persistRuntimeState()
  resolveSave()
  await first
  assert.equal(acceptedActions.get('request'), replacement, 'old write cannot mark a newer acceptance durable')
  await persistence.flushRuntimeState({ throwOnError: true })
  assert.equal(acceptedActions.get('request').pendingDurability, false)
  assert.equal(saveCount, 2)
  await persistence.flushRuntimeState()
  assert.equal(saveCount, 2, 'clean state does not write again')
  fail = true
  persistence.persistRuntimeState()
  const log = console.error
  try {
    console.error = () => {}
    await assert.rejects(persistence.flushRuntimeState({ throwOnError: true }), /injected write failure/)
  } finally { console.error = log }
  assert.equal(timers.pending.values().next().value.delay, 100)
  fail = false
  timers.fire()
  await settle()
  assert.equal(saveCount, 4)
  assert.equal(timers.pending.size, 0)
  stopped = true
  fail = true
  persistence.persistRuntimeState()
  persistence.cancelPendingTimer()
  persistence.cancelPendingTimer()
  try { console.error = () => {}; await persistence.flushRuntimeState() } finally { console.error = log }
  assert.equal(timers.pending.size, 0, 'shutdown failure must not arm a retry')
  fail = false
  await persistence.flushRuntimeState({ throwOnError: true })
}
{
  const acceptedActions = new Map([['request', { pendingDurability: true }]])
  const persistence = createRuntimePersistence({
    acceptedActions, roomStateStore: { configured: false },
    persistedRuntimeSnapshot: () => assert.fail('disabled store must not snapshot'),
    debounceMs: 20, isShuttingDown: () => false,
  })
  persistence.persistRuntimeState()
  await persistence.flushRuntimeState()
  assert.equal(acceptedActions.get('request').pendingDurability, false)
}

// Room expiry owns timers; operations retain room serialization and commit-before-publish.
{
  const timers = fakeTimers()
  const room = { roomId: '111111', state: {}, version: 0, dissolveVote: null }
  const rooms = new Map([[room.roomId, room]])
  const events = []
  const queued = []
  let live = false
  const expiry = createRoomExpiry({
    ...timers, rooms, emptyRoomTimeoutMs: 123,
    hasConnectedHuman: () => live, seatHasLiveConnection: () => live,
    enqueueServerOperation: (operation, _label, roomId) => { assert.equal(roomId, room.roomId); queued.push(operation); return Promise.resolve() },
    closeRoomWithoutAck: (_room, reason) => events.push(reason),
    commitRuntimeState: async () => events.push('commit'),
    publishDissolveVote: (_room, reason) => events.push(reason),
  })
  expiry.scheduleEmptyRoomExpiry(room)
  assert.equal(timers.fire(), 123)
  await queued.shift()()
  assert.deepEqual(events, ['empty-timeout'])
  live = true
  expiry.scheduleEmptyRoomExpiry(room)
  assert.equal(timers.pending.size, 0)
  expiry.scheduleHostExpiry(room.roomId)
  timers.fire()
  await queued.shift()()
  assert.deepEqual(events, ['empty-timeout'], 'reconnected host must not be closed')
  live = false
  expiry.scheduleHostExpiry(room.roomId)
  expiry.clearHostExpiry(room.roomId)
  assert.equal(timers.pending.size, 0)
  expiry.scheduleHostExpiry(room.roomId, 1)
  timers.fire()
  await queued.shift()()
  assert.equal(events.at(-1), 'host-left')
  room.dissolveVote = { expiresAt: Date.now() + 20 }
  expiry.scheduleDissolveExpiry(room)
  timers.fire()
  room.dissolveVote = { expiresAt: Date.now() + 1000 }
  await queued.shift()()
  assert.equal(room.version, 0, 'stale timer cannot expire a replacement vote')
  expiry.scheduleDissolveExpiry(room)
  timers.fire()
  await queued.shift()()
  assert.equal(room.dissolveVote, null)
  assert.equal(room.version, 1)
  assert.deepEqual(events.slice(-2), ['commit', 'expired'])
  expiry.scheduleHostExpiry(room.roomId)
  expiry.scheduleEmptyRoomExpiry(room)
  room.dissolveVote = { expiresAt: Date.now() + 1000 }
  expiry.scheduleDissolveExpiry(room)
  expiry.dispose()
  expiry.dispose()
  assert.equal(timers.pending.size, 0)
}

// Per-room state has no shared mutable defaults; migration normalization is idempotent.
{
  let token = 0
  const metadata = createRoomMetadata({
    playerIds: ['p1', 'p2', 'p3', 'p4'], createResumeToken: () => `token-${++token}`,
    createBotSeed: () => 123, entryKindForClaims: () => 'friend', entryDeadlineForClaims: () => 999,
  })
  const first = metadata.createRoomRecord({ roomId: '111111', hostConnectionId: 'one' })
  const second = metadata.createRoomRecord({ roomId: '222222', hostConnectionId: 'two' })
  assert.notEqual(first.resumeTokens.p1, second.resumeTokens.p1)
  first.roundReady.p2 = true
  first.pendingSpectatorEvents.push({ eventId: 'one' })
  assert.equal(second.roundReady.p2, false)
  assert.equal(second.pendingSpectatorEvents.length, 0)
  const legacy = { ...second, botPlayerIds: ['p2'], revokedFriendUserIds: ['a', 'a', null],
    revokedTicketJtis: [{ jti: 'old', exp: 1 }, { jti: 'live', exp: Math.floor(Date.now() / 1000) + 1000 }] }
  metadata.ensureLobbyMetadata(legacy)
  metadata.ensureLiveMetadata(legacy)
  assert.equal(legacy.lobbyReady.p2, true)
  assert.deepEqual(legacy.revokedFriendUserIds, ['a'])
  assert.deepEqual(legacy.revokedTicketJtis.map(item => item.jti), ['live'])
  const normalized = JSON.stringify(legacy)
  metadata.ensureLiveMetadata(legacy)
  assert.equal(JSON.stringify(legacy), normalized)
}

const composition = readFileSync(new URL('./weapp-ws.js', import.meta.url), 'utf8')
assert.doesNotMatch(composition, /let runtimeDirty|let persistTimer|const (hostExpiryTimers|emptyRoomExpiryTimers|dissolveTimers) =|const ensureLiveMetadata =|const createRoomRecord =/)
assert.match(composition, /roomExpiry\.dispose\(\)/)
assert.match(composition, /runtimePersistence\.cancelPendingTimer\(\)/)
console.log('Runtime owner tests passed: durability, retries, room metadata and expiry lifecycle')
