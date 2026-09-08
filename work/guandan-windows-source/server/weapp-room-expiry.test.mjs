import assert from 'node:assert/strict'
import { createRoomExpiry } from './weapp-room-expiry.js'

const fixture = () => {
  const room = { roomId: 'r', state: {}, version: 4, dissolveVote: { expiresAt: Date.now() - 1 } }
  const rooms = new Map([['r', room]])
  const pending = new Map()
  const queued = []
  const events = []
  let live = false
  let fail = false
  const expiry = createRoomExpiry({
    rooms, emptyRoomTimeoutMs: 100,
    setTimeout: (callback, delay) => { const token = {}; pending.set(token, { callback, delay }); return token },
    clearTimeout: token => pending.delete(token),
    seatHasLiveConnection: () => live, hasConnectedHuman: () => live,
    enqueueServerOperation: operation => { queued.push(operation); return Promise.resolve() },
    closeRoomWithoutAck: (target, reason) => events.push({ target, reason }),
    commitRuntimeState: async () => { if (fail) throw Error('disk failure'); events.push('committed') },
    publishDissolveVote: (target, reason) => events.push({ target, reason }),
  })
  return {
    room, rooms, queued, events, pending, expiry,
    connect: value => { live = value },
    fail: value => { fail = value },
    fire: () => { const [token, timer] = pending.entries().next().value; pending.delete(token); timer.callback() },
    run: () => queued.shift()(),
  }
}

// Fire while disconnected, reconnect while the operation waits in the room queue.
for (const kind of ['host', 'empty']) {
  const f = fixture()
  const arm = () => kind === 'host' ? f.expiry.scheduleHostExpiry('r') : f.expiry.scheduleEmptyRoomExpiry(f.room)
  arm(); f.fire(); f.connect(true); await f.run()
  assert.deepEqual(f.events, [], kind + ': liveness must be checked at execution')
  f.connect(false); arm(); f.fire()
  if (kind === 'host') f.expiry.clearHostExpiry('r')
  else f.expiry.clearEmptyRoomExpiry('r')
  await f.run()
  assert.deepEqual(f.events, [], kind + ': cancellation must invalidate an already queued operation')
  arm(); f.fire(); arm()
  await f.run()
  assert.deepEqual(f.events, [], kind + ': a replacement timer invalidates the old generation')
  f.fire(); await f.run()
  assert.equal(f.events.length, 1)
}

// Same room ID is insufficient: removed/recreated rooms must not inherit queued work.
for (const kind of ['host', 'empty', 'dissolve']) {
  const f = fixture()
  if (kind === 'host') f.expiry.scheduleHostExpiry('r')
  else if (kind === 'empty') f.expiry.scheduleEmptyRoomExpiry(f.room)
  else f.expiry.scheduleDissolveExpiry(f.room)
  f.fire()
  f.rooms.set('r', { ...f.room })
  await f.run()
  assert.equal(f.events.length, 0)
  assert.equal(f.room.version, 4)
}

// Failed durability rolls back vote + version, retries once per second and publishes only on success.
{
  const f = fixture()
  const vote = f.room.dissolveVote
  f.fail(true)
  f.expiry.scheduleDissolveExpiry(f.room)
  for (let attempt = 0; attempt < 3; attempt++) {
    f.fire()
    await assert.rejects(f.run(), /disk failure/)
    assert.equal(f.room.dissolveVote, vote)
    assert.equal(f.room.version, 4)
    assert.deepEqual(f.events, [])
    assert.equal(f.pending.size, 1)
    assert.equal([...f.pending.values()][0].delay, 1000)
  }
  f.fail(false); f.fire(); await f.run()
  assert.equal(f.room.dissolveVote, null)
  assert.equal(f.room.version, 5)
  assert.equal(f.pending.size, 0)
  assert.equal(f.events[0], 'committed')
  assert.equal(f.events[1].reason, 'expired')
  f.expiry.scheduleDissolveExpiry(f.room)
  assert.equal(f.pending.size, 0, 'completed expiry is idempotent')
}

// A rejected/replaced vote or shutdown cancels the retry and any queued work.
for (const action of ['reject', 'replace', 'dispose']) {
  const f = fixture()
  f.fail(true); f.expiry.scheduleDissolveExpiry(f.room); f.fire()
  await assert.rejects(f.run(), /disk failure/)
  f.fail(false); f.fire()
  if (action === 'reject') { f.room.dissolveVote = null; f.expiry.clearDissolveTimer('r') }
  if (action === 'replace') f.room.dissolveVote = { expiresAt: f.room.dissolveVote.expiresAt }
  if (action === 'dispose') f.expiry.dispose()
  await f.run()
  assert.equal(f.events.length, 0)
  assert.equal(f.room.version, 4)
  assert.equal(f.pending.size, 0)
}
{
  const f = fixture()
  f.expiry.scheduleHostExpiry('r'); f.fire(); f.expiry.dispose()
  await f.run()
  f.expiry.scheduleHostExpiry('r')
  assert.equal(f.pending.size, 0)
  assert.equal(f.events.length, 0)
}
console.log('Room expiry regressions passed: queue races, identity, generations, rollback and retry')
