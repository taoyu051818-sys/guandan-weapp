import assert from 'node:assert/strict'
import { createRoomCloseCoordinator } from './weapp-room-close-coordinator.js'
import { createRoomExpiry } from './weapp-room-expiry.js'
import { createGameCommandHandler } from './weapp-game-command-handler.js'
import { createAcceptedActionStore } from './weapp-accepted-action-store.js'

const ids = ['p1', 'p2', 'p3', 'p4'], noop = () => {}
for (const origin of ['empty', 'host', 'vote', 'bots']) for (const failAt of [0, 1, 2]) {
  const room = { roomId: '123456', version: 1, gameVersion: 1, state: { phase: 'settled' },
    botPlayerIds: origin === 'bots' ? ['p2', 'p3', 'p4'] : [],
    dissolveVote: origin === 'vote' ? { votes: { p1: 'pending', p2: 'agree', p3: 'agree', p4: 'agree' } } : null }
  const rooms = new Map([[room.roomId, room]]), timers = new Map(), operations = [], events = []
  const receipts = createAcceptedActionStore({ maxEntries: 20 })
  const connection = { id: 'host', acceptedCacheKeys: new Map() }
  let commits = 0
  const d = { rooms, hasConnectedHuman: () => false, seatHasLiveConnection: () => false,
    rememberClosedRoomTombstone: () => events.push('tombstone'),
    reportSpectatorClosed: () => events.push('closed-event'),
    commitRuntimeState: async () => { if (++commits === failAt) throw Error('one-shot disk failure') },
    stagePendingSideEffects: () => events.push('stage'), persistRuntimeState: noop,
    finalizeRemovedRoom: (_room, _reason, _event, keep) => { events.push('finalize'); assert.equal(rooms.has(room.roomId), false); if (origin === 'vote' || origin === 'bots') assert.equal(keep, 'host:1') },
    enqueueServerOperation: fn => { const promise = Promise.resolve().then(fn); operations.push(promise); promise.catch(noop); return promise },
    setTimeout: fn => { const token = {}; timers.set(token, fn); return token }, clearTimeout: token => timers.delete(token) }
  const closer = createRoomCloseCoordinator(d)
  const expiry = createRoomExpiry({ ...d, emptyRoomTimeoutMs: 5, closeRoomWithoutAck: closer.close, publishDissolveVote: noop })
  const fire = async () => { const [key, fn] = timers.entries().next().value; timers.delete(key); fn(); return operations.shift() }
  const handler = createGameCommandHandler({ ...d, ids, closeRoomWithoutAck: closer.close, playerIn: () => 'p1', ensureLiveMetadata: noop,
    dissolveTimeoutMs: 1000, send: (_connection, type) => events.push(type) })
  try {
    let first
    if (origin === 'empty' || origin === 'host') {
      if (origin === 'empty') expiry.scheduleEmptyRoomExpiry(room)
      else expiry.scheduleHostExpiry(room.roomId)
      first = fire()
    } else first = handler({ type: origin === 'bots' ? 'proposeDissolve' : 'dissolveVote', payload: { roomId: room.roomId, agree: true },
      connection, requestId: 1, cacheKey: 'host:1', reply: () => { throw Error('unexpected reply') },
      rememberActionAcceptance: target => { const response = { requestId: 1, roomId: target.roomId }; receipts.remember('host:1', 'vote', response); return response } })
    if (failAt) {
      await assert.rejects(first, /one-shot/)
      assert.equal(rooms.get(room.roomId), room)
      assert.equal(events.includes('finalize'), false)
      assert.equal(events.includes('actionAccepted'), false)
      assert.equal(timers.size, 1, 'the business transaction, not just a disk save, must be retried')
      await fire()
    } else await first
    assert.equal(rooms.size, 0)
    assert.equal(timers.size, 0)
    assert.equal(events.filter(e => e === 'closed-event').length, 1)
    assert.equal(events.filter(e => e === 'finalize').length, 1)
    assert.equal(events.filter(e => e === 'actionAccepted').length, ['vote', 'bots'].includes(origin) ? 1 : 0)
    await closer.close(room, 'vote-approved')
    assert.equal(events.filter(e => e === 'finalize').length, 1)
  } finally { closer.dispose(); expiry.dispose() }
}

// An old failed closure cannot remove a new room that reuses the public room number.
{
  const old = { roomId: '123456', version: 1 }, rooms = new Map([[old.roomId, old]]), timers = new Map(), jobs = []
  const closer = createRoomCloseCoordinator({ rooms, hasConnectedHuman: () => false, rememberClosedRoomTombstone: noop,
    reportSpectatorClosed: noop, commitRuntimeState: async () => { throw Error('disk') }, stagePendingSideEffects: noop,
    persistRuntimeState: noop, finalizeRemovedRoom: () => { throw Error('stale close') },
    enqueueServerOperation: fn => { const job = Promise.resolve().then(fn); jobs.push(job); return job },
    setTimeout: fn => { const token = {}; timers.set(token, fn); return token }, clearTimeout: token => timers.delete(token) })
  await assert.rejects(closer.close(old, 'host-left'), /disk/)
  const replacement = { roomId: old.roomId, version: 1 }; rooms.set(old.roomId, replacement)
  timers.values().next().value(); await Promise.all(jobs)
  assert.equal(rooms.get(old.roomId), replacement)
  closer.dispose()
}
console.log('SP-03-002: timer and unanimous close transactions recover at both persistence boundaries')
