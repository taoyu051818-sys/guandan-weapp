import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SpectatorEventService } from './spectator-event-service.js'
import { createEmptyPlatformState, MemoryPlatformStore } from './storage.js'

const now = 2_000_000
const facadeSource = readFileSync(new URL('./service.js', import.meta.url), 'utf8')
assert.match(facadeSource, /return this\.spectatorEvents\.accept\(eventId, rawEvent\)/)
assert.doesNotMatch(facadeSource, /normalizeSpectatorEvent|SPECTATOR_EVENT_ID_CONFLICT|SPECTATOR_EVENT_OUT_OF_ORDER/, 'event transaction rules must not return to the composition facade')
const event = { eventId: 'spectate:match-1:1', matchId: 'match-1', roomId: '123456', sequence: 1, roundSequence: 1, at: 1_200_000, type: 'game-start' }
const fixture = (overrides = {}) => {
  const state = createEmptyPlatformState()
  state.matches[event.matchId] = { id: event.matchId, roomId: event.roomId, mode: 'quick', status: 'matched', createdAt: 1_000_000, matchedAt: 1_100_000, participants: [] }
  state.spectatorFeeds[event.matchId] = { matchId: event.matchId, events: [] }
  const store = new MemoryPlatformStore(state)
  const service = new SpectatorEventService({
    store, now: () => now,
    markMatchPlaying: (_state, match, at) => { match.status = 'playing'; match.startedAt ||= at },
    cancelExpiredFriendRoom: () => false, cancelExpiredUnstartedMatch: () => false,
    activeFriendTickets: () => [], ...overrides,
  })
  return { store, service }
}
const { service, store } = fixture()
const accepted = await service.accept(event.eventId, event)
assert.equal(accepted.duplicate, false)
assert.deepEqual(accepted.lifecycleClaim, { accepted: true, status: 'playing', startedAt: event.at })
const duplicate = await service.accept(event.eventId, event)
assert.equal(duplicate.duplicate, true)
assert.equal((await store.read(s => s.spectatorFeeds[event.matchId].events)).length, 1)
const committed = await store.read(s => s)
await assert.rejects(service.accept(event.eventId, { ...event, at: event.at + 1 }), error => error.code === 'SPECTATOR_EVENT_ID_CONFLICT')
await assert.rejects(service.accept('spectate:match-1:3', { ...event, eventId: 'spectate:match-1:3', sequence: 3 }), error => error.code === 'SPECTATOR_EVENT_OUT_OF_ORDER')
await assert.rejects(service.accept('spectate:match-1:2', { ...event, eventId: 'spectate:match-1:2', sequence: 2, roomId: '999999' }), /观战事件与已分配匹配不一致/)
await assert.rejects(service.accept('spectate:match-1:2', { ...event, eventId: 'spectate:match-1:2', sequence: 2, privateCards: [] }), /不允许字段/)
assert.deepEqual(await store.read(s => s), committed, 'rejected events leave no receipts, feed changes or status changes')

const expired = fixture({ cancelExpiredFriendRoom: (_state, match) => { match.status = 'cancelled'; return true } })
await assert.rejects(expired.service.accept(event.eventId, event), error => error.code === 'MATCH_ENTRY_EXPIRED')
assert.equal(await expired.store.read(s => s.matches[event.matchId].status), 'cancelled', 'expiry cancellation commits before the external error')
assert.deepEqual(await expired.store.read(s => s.spectatorFeeds[event.matchId].events), [])

const failed = fixture({ markMatchPlaying: () => { throw new Error('injected lifecycle failure') } })
await assert.rejects(failed.service.accept(event.eventId, event), /injected lifecycle failure/)
assert.equal(await failed.store.read(s => s.matches[event.matchId].status), 'matched')
assert.deepEqual(await failed.store.read(s => s.spectatorFeeds[event.matchId].events), [], 'feed append and lifecycle update stay inside the same transaction')
assert.deepEqual(await failed.store.read(s => s.spectatorEventReceipts), {})
console.log('spectator event service tests passed: isolated dependencies, idempotency, rejection and atomic rollback')

const friend = fixture()
await friend.store.transaction(state => {
  Object.assign(state.matches[event.matchId], { kind: 'friend-room', hostUserId: 'u0', roomSettings: { spectator: 'delay-30' },
    participants: ['p1', 'p2', 'p3', 'p4', 'observer'].map((seat, index) => ({ userId: `u${index}`, seat, status: 'matched' })) })
})
const roster = { p1: 'u1', p2: 'u4', p3: 'u2', p4: 'u3' }
await friend.service.accept(event.eventId, { ...event, friendRoster: roster })
const rosterState = await friend.store.read(state => state)
assert.equal(rosterState.matches[event.matchId].participants.find(p => p.userId === 'u0').seat, 'observer')
assert.equal(rosterState.matches[event.matchId].participants.find(p => p.userId === 'u4').seat, 'p2')
assert.equal(rosterState.spectatorFeeds[event.matchId].events[0].friendRoster, undefined, 'private membership IDs must not enter the public event feed')
await friend.service.accept(event.eventId, { ...event, friendRoster: roster })
await assert.rejects(friend.service.accept(event.eventId, { ...event, friendRoster: { ...roster, p1: 'u0' } }), error => error.code === 'SPECTATOR_EVENT_ID_CONFLICT')
console.log('Friend observer roster admission is atomic, idempotent and absent from public feeds')
