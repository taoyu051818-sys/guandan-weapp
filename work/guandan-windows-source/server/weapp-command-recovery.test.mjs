import assert from 'node:assert/strict'
import { createAcceptedActionStore } from './weapp-accepted-action-store.js'
import { createCommandGateway } from './weapp-command-gateway.js'
import { createGameCommandHandler, GAME_COMMAND_TYPES } from './weapp-game-command-handler.js'
import { createCommandRouter } from './weapp-command-router.js'
import { createRoomExit, EXIT_COMMAND_TYPES } from './weapp-room-exit.js'
import { createRoomPublisher } from './weapp-room-publisher.js'
import { createCommandPublication } from './weapp-command-publication.js'

const ids = ['p1', 'p2', 'p3', 'p4']
const flags = value => Object.fromEntries(ids.map(id => [id, value]))
const noop = () => {}
const fixture = ({ phase = null, host = false } = {}) => {
  const playerId = host ? 'p1' : 'p2'
  const connection = { id: 'viewer', roomId: '123456', acceptedCacheKeys: new Map() }
  const peer = { id: 'peer', roomId: '123456', acceptedCacheKeys: new Map() }
  const room = {
    roomId: '123456', botSeed: 'unique-room-seed', matchId: 'audit-match', version: 1, gameVersion: 1,
    state: phase ? { phase, currentLevel: 2, players: Object.fromEntries(ids.map(id => [id, { id, team: ['p1', 'p3'].includes(id) ? 'teamA' : 'teamB', hand: [{ id: `card-${id}`, rank: '3', suit: 'club', value: 3 }] }])) } : null,
    seats: { ...flags(null), [playerId]: connection.id, p3: peer.id }, resumeTokens: { ...flags(null), [playerId]: 'viewer-resume' },
    entryKind: 'friend', ticketBound: false, botPlayerIds: [], roomSettings: {},
    trustees: flags(null), consecutiveTimeouts: flags(0), lobbyReady: flags(false), roundReady: flags(false),
    userIdsBySeat: { ...flags(null), [playerId]: 'user' }, ticketJtisBySeat: { ...flags(null), [playerId]: 'ticket' },
    ticketExpiresAtBySeat: { ...flags(null), [playerId]: 9999999999 }, revokedTicketJtis: [],
    roundResult: phase === 'settled' ? { isGameWon: false, currentLevel: 3 } : null,
    deadlinePlayerId: 'p4', dissolveVote: null,
  }
  const rooms = new Map([[room.roomId, room]])
  const connections = new Map([[connection.id, connection], [peer.id, peer]])
  const store = createAcceptedActionStore({ maxEntries: 100 })
  const sent = [], timers = new Map(), jobs = [], mutations = []
  let commits = 0
  const failures = new Set()
  const playerIn = (target, id) => ids.find(seat => target.seats[seat] === id)
  const send = (target, type, payload) => sent.push({ id: target.id, type, payload: structuredClone(payload) })
  const publisher = createRoomPublisher({
    playerIds: ids, connections, send, broadcast: (target, type, payload) => ids.forEach(id => { const c = connections.get(target.seats[id]); if (c) send(c, type, payload) }),
    ensureLobbyMetadata: noop, ensureLiveMetadata: noop, isFriendRoom: () => true, seatIsOccupied: (target, id) => Boolean(target.seats[id]),
  })
  const publishCurrentRoom = createCommandPublication(publisher)
  const prepareNextRound = target => { mutations.push('prepare'); target.roundResult = null; target.state.phase = 'tribute'; target.gameVersion++ }
  const dependencies = {
    ids, rooms, connections, ...publisher, acceptedActions: store.entries, playerIn, ensureLobbyMetadata: noop, ensureLiveMetadata: noop,
    isFriendRoom: () => true, armTurnDeadline: noop, prepareNextRound, publishCurrentRoom,
    markOfflineReady: target => { if (target.roundResult) prepareNextRound(target) },
    deleteAcceptedActionIdentity: store.deleteToken, rememberAccepted: store.remember,
    rememberClosedRoomTombstone: () => mutations.push('tombstone'), reportSpectatorClosed: () => mutations.push('closed-event'),
    reportSpectatorEvent: (_, event) => mutations.push(event.type), stagePendingSideEffects: noop, persistRuntimeState: noop,
    commitRuntimeState: async () => {
      commits++
      if (failures.has(commits)) throw new Error('injected persistence failure')
      for (const [key, accepted] of store.entries) store.entries.set(key, { ...accepted, pendingDurability: false })
    },
    finalizeRemovedRoom: (target, _reason, _event, keepKey) => { mutations.push('finalize'); for (const token of Object.values(target.resumeTokens)) store.deleteToken(token, keepKey) },
    syncConnectionRoomId: target => { target.roomId = [...rooms.values()].find(r => playerIn(r, target.id))?.roomId || null },
    send, broadcastRooms: noop, scheduleEmptyRoomExpiry: noop,
    enqueueServerOperation: operation => { const job = Promise.resolve().then(operation); jobs.push(job); void job.catch(noop); return job },
    setTimeout: callback => { const id = {}; timers.set(id, callback); return id }, clearTimeout: id => timers.delete(id),
  }
  const exit = createRoomExit(dependencies)
  const gateway = createCommandGateway({
    ...dependencies, completeRoomExit: exit.complete, idempotentActionTypes: new Set([...GAME_COMMAND_TYPES, ...EXIT_COMMAND_TYPES]),
    actionCacheKey: (target, c, id) => { const seat = target && playerIn(target, c.id); return seat && target.resumeTokens[seat] ? `${target.resumeTokens[seat]}:${id}` : null },
    actionFingerprint: (type, payload) => JSON.stringify({ type, payload }),
    validateCommandRequestId: noop, validateExpectedVersion: noop, reserveAccepted: store.reserve, releaseAccepted: store.release,
    router: createCommandRouter([{ types: GAME_COMMAND_TYPES, handle: createGameCommandHandler(dependencies) }, { types: EXIT_COMMAND_TYPES, handle: exit.handle }]),
  })
  return {
    room, rooms, connection, store, sent, timers, failures, mutations, playerId, dispose: exit.dispose,
    request: type => gateway(connection, { type, requestId: 7, payload: { roomId: room.roomId } }),
    retryAutomatically: async () => { const [key, callback] = timers.entries().next().value; timers.delete(key); callback(); await Promise.allSettled(jobs) },
  }
}

// The server commits a command exactly once, and a durable replay reconciles its state.
for (const [phase, type, expected] of [['playing', 'setTrustee', 'trusteeUpdated'], ['settled', 'readyNextRound', 'roundReadyUpdated']]) {
  const h = fixture({ phase })
  h.failures.add(1)
  await assert.rejects(h.request(type), /injected persistence failure/)
  assert.equal(h.sent.length, 0, 'no success or state publication before durable commit')
  const version = h.room.version
  await h.request(type)
  assert.equal(h.room.version, version, 'retry must not re-run state mutation')
  assert.ok(h.sent.some(message => message.type === 'actionAccepted'))
  assert.ok(h.sent.some(message => message.type === expected), 'successful retry must publish actual current state')
  const peerState = h.sent.find(message => message.id === 'peer' && message.type === 'gameState')
  assert.ok(peerState.payload.state.players.p2.hand[0].id.startsWith('hidden-'), 'recovery publication still redacts other players')
  h.dispose()
}

// Guest release, live trustee exit and last-ready exit survive a failed write.
{
  const h = fixture({ phase: 'settled' })
  h.room.roundReady = { ...flags(true), p2: false }
  h.failures.add(1)
  await assert.rejects(h.request('readyNextRound'))
  await h.request('readyNextRound')
  assert.equal(h.mutations.filter(item => item === 'prepare').length, 1, 'last-ready retry cannot deal another hand')
  assert.ok(h.sent.some(message => message.type === 'tributeUpdated'), 'new-round state must be recoverable after lost publication')
  h.dispose()
}
for (const phase of [null, 'playing', 'settled']) {
  const h = fixture({ phase })
  h.failures.add(1)
  await assert.rejects(h.request('safeExit'), /injected persistence failure/)
  assert.equal(h.room.seats.p2, null)
  assert.equal(h.store.entries.has('viewer-resume:7'), true, 'exit keeps its receipt even after clearing the seat identity')
  assert.equal(h.sent.length, 0)
  const version = h.room.version
  await h.request('safeExit')
  assert.equal(h.room.version, version)
  assert.equal(h.sent.find(message => message.id === 'viewer').type, 'roomLeft')
  assert.equal(h.connection.roomId, null)
  assert.equal(h.timers.size, 0, 'explicit success cancels automatic completion')
  if (phase === null) assert.equal(h.mutations.filter(item => item === 'seat-left').length, 1)
  if (phase === 'settled') {
    assert.equal(h.mutations.filter(item => item === 'prepare').length, 1)
    assert.ok(h.sent.some(message => message.id === 'peer' && message.type === 'tributeUpdated'))
  }
  await h.request('safeExit')
  assert.equal(h.room.version, version, 'duplicate exit does not mutate membership again')
  h.dispose()
}

// Both host-close commits must be retryable; tombstones/events are not duplicated.
for (const failedCommit of [1, 2]) {
  const h = fixture({ host: true })
  h.failures.add(failedCommit)
  await assert.rejects(h.request('leaveRoom'), /injected persistence failure/)
  assert.equal(h.rooms.has(h.room.roomId), true)
  assert.equal(h.store.entries.has('viewer-resume:7'), true)
  await h.request('leaveRoom')
  assert.equal(h.rooms.has(h.room.roomId), false)
  assert.equal(h.mutations.filter(item => item === 'tombstone').length, 1)
  assert.equal(h.mutations.filter(item => item === 'closed-event').length, 1)
  await h.request('leaveRoom')
  assert.equal(h.mutations.filter(item => item === 'finalize').length, 1)
  assert.equal(h.sent.filter(message => message.type === 'roomLeft').length, 2)
  h.dispose()
}

// An optimistic client may never retry. Server completion must not depend on it.
{
  const h = fixture()
  h.failures.add(1); h.failures.add(2)
  await assert.rejects(h.request('safeExit'))
  await h.retryAutomatically()
  assert.equal(h.timers.size, 1, 'continued failure retains a bounded retry job')
  await h.retryAutomatically()
  assert.ok(h.sent.some(message => message.type === 'roomLeft'))
  assert.equal(h.timers.size, 0)
  h.dispose()
}
{
  const h = fixture()
  h.failures.add(1)
  await assert.rejects(h.request('safeExit'))
  h.dispose()
  assert.equal(h.timers.size, 0, 'shutdown clears pending retries')
}
{
  const h = fixture()
  h.failures.add(1)
  await assert.rejects(h.request('safeExit'))
  h.rooms.set(h.room.roomId, { ...h.room, botSeed: 'replacement' })
  await h.retryAutomatically()
  assert.equal(h.sent.length, 0, 'old queued completion cannot publish into a replacement room')
  h.dispose()
}
console.log('command recovery: exit durability, publication, privacy and automatic completion passed')
