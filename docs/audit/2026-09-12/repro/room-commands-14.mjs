// Audit-only synthetic business lifecycle: no server entry, network, real files or users.
import assert from 'node:assert/strict'
import { FRIEND_SEATS as ids, registerRoomMember, moveRoomMember, memberIsHost, friendMemberMetadata } from '../../../../work/guandan-windows-source/server/friend-room-members.js'
import { canConfigureRoomBots, setFriendBotIdentity } from '../../../../work/guandan-windows-source/server/friend-room-bots.js'
import { createLobbyCommandHandler } from '../../../../work/guandan-windows-source/server/weapp-lobby-command-handler.js'
import { createGameCommandHandler, GAME_COMMAND_TYPES } from '../../../../work/guandan-windows-source/server/weapp-game-command-handler.js'
import { createCommandRouter } from '../../../../work/guandan-windows-source/server/weapp-command-router.js'
import { createCommandGateway } from '../../../../work/guandan-windows-source/server/weapp-command-gateway.js'
import { createAcceptedActionStore } from '../../../../work/guandan-windows-source/server/weapp-accepted-action-store.js'
import { createRuntimePersistence } from '../../../../work/guandan-windows-source/server/weapp-runtime-persistence.js'
import { createRoomExpiry } from '../../../../work/guandan-windows-source/server/weapp-room-expiry.js'
const noop = () => {}, flags = value => Object.fromEntries(ids.map(id => [id, value]))
const copy = value => structuredClone(value)
const permutations = list => list.length ? list.flatMap((x, i) => permutations(list.filter((_, j) => j !== i)).map(rest => [x, ...rest])) : [[]]
const freshRoom = (spectator = 'live') => {
  const room = { roomId: '123456', entryKind: 'friend', ticketBound: true, roomSettings: { spectator, trusteeSeconds: 15, totalTimeMinutes: 0 },
    version: 1, gameVersion: 1, botPlayerIds: [], trustees: flags(null), roundReady: flags(false), consecutiveTimeouts: flags(0),
    ...Object.fromEntries(['seats', 'resumeTokens', 'userIdsBySeat', 'ticketJtisBySeat', 'ticketExpiresAtBySeat', 'lobbyReady'].map(field => [field, flags(null)])) }
  for (const id of ids) {
    room.seats[id] = 'connection-' + id; room.resumeTokens[id] = 'resume-' + id; room.userIdsBySeat[id] = 'user-' + id
    room.ticketJtisBySeat[id] = 'jti-' + id; room.ticketExpiresAtBySeat[id] = 50000
    registerRoomMember(room, id, { name: 'audit-' + id })
  }
  return room
}
let seatPermutations = 0, refusedMoves = 0, botCycles = 0, barrierCases = 0
for (const mode of ['live', 'delay-15', 'delay-30', 'delay-60', 'delayed-round']) for (const order of permutations(ids)) {
  const room = freshRoom(mode), members = [...room.friendMembers]
  const host = members[0]
  members.forEach(member => moveRoomMember(room, member, null))
  assert.ok(ids.every(id => room.seats[id] === null && room.resumeTokens[id] === null && room.userIdsBySeat[id] === null))
  assert.equal(memberIsHost(room, host.connectionId), true)
  members.forEach((member, i) => moveRoomMember(room, member, order[i]))
  for (const member of members) {
    const seat = member.seat; assert.equal(room.userIdsBySeat[seat], member.userId)
    assert.equal(room.resumeTokens[seat], member.resumeToken); assert.equal(room.seats[seat], member.connectionId)
    assert.equal(room.ticketJtisBySeat[seat], member.jti)
    assert.equal(friendMemberMetadata(room, member).isRoomHost, member === host)
    assert.equal(friendMemberMetadata(room, member).hostPlayerId, host.seat)
    const before = copy(room); moveRoomMember(room, member, member.seat); assert.deepEqual(room, before)
    for (const destination of ids.filter(id => id !== member.seat)) {
      assert.throws(() => moveRoomMember(room, member, destination), /已有人/); assert.deepEqual(room, before); refusedMoves++
    }
  }
  assert.equal(room.friendMembers.length, 4); assert.equal(new Set(room.friendMembers.map(m => m.userId)).size, 4)
  for (const field of ['state', 'pendingGameStartEvent']) {
    room[field] = {}; const before = copy(room)
    assert.throws(() => moveRoomMember(room, host, null), /开局后/); assert.deepEqual(room, before); delete room[field]; refusedMoves++
  }
  const before = copy(room); assert.throws(() => moveRoomMember(room, host, 'p9'), /无效/); assert.deepEqual(room, before); refusedMoves++
  seatPermutations++
}
// The actual host lobby handler is used, including standing host identity and bot membership exclusions.
const botIds = new Set()
for (let i = 0; i < 100; i++) {
  const room = freshRoom(), host = room.friendMembers[0], vacant = room.friendMembers[2]
  moveRoomMember(room, vacant, null); moveRoomMember(room, host, null)
  const target = 'p3', rooms = new Map([[room.roomId, room]]), messages = []
  const handler = createLobbyCommandHandler({ ids, rooms, ensureLobbyMetadata: noop, ensureBotMetadata: noop, publishRoomMembers: noop, broadcastRooms: noop })
  const request = (type, connectionId, playerId) => handler({ type, connection: { id: connectionId, roomId: room.roomId }, payload: { playerId },
    reply: (type, payload) => messages.push({ type, payload }), acceptAction: async () => messages.push({ type: 'accepted' }) })
  const tokens = copy(room.resumeTokens)
  await request('addBot', host.connectionId, target)
  const botId = room.botUserIdsBySeat[target]; assert.match(botId, /^friendbot_[a-f0-9]{24}$/); assert.ok(!botIds.has(botId)); botIds.add(botId)
  assert.equal(room.userIdsBySeat[target], botId); assert.deepEqual(room.resumeTokens, tokens); assert.equal(room.lobbyReady[target], true)
  const before = copy(room); const currentMember = room.friendMembers.find(m => m.seat === null && m !== host)
  assert.throws(() => moveRoomMember(room, currentMember, target), /已有人/); assert.deepEqual(room, before)
  await request('removeBot', host.connectionId, target)
  assert.equal(room.botUserIdsBySeat[target], undefined); assert.equal(room.userIdsBySeat[target], null)
  assert.ok(!room.botPlayerIds.includes(target)); assert.equal(room.lobbyReady[target], false)
  const removed = copy(room); await request('addBot', room.friendMembers[1].connectionId, target)
  assert.match(messages.at(-1).payload.message, /只有房主/); assert.deepEqual(room, removed); botCycles++
}
assert.equal(canConfigureRoomBots({ ticketBound: true, entryKind: 'match' }), false)
const legacy = { ticketBound: false, userIdsBySeat: flags(null), resumeTokens: flags(null) }
setFriendBotIdentity(legacy, 'p2', true); assert.equal(legacy.userIdsBySeat.p2, null)
setFriendBotIdentity(legacy, 'p2', false); assert.equal(legacy.userIdsBySeat.p2, null)

for (const [field, value, code] of [
  ['closingReason', 'closing', 'ROOM_CLOSING'], ['pendingRoundFinalization', {}, 'PERSISTENCE_PENDING'],
  ['pendingGameStartEvent', {}, 'GAME_START_CONFIRMING'], ['matchEnded', {}, 'MATCH_ENDED'],
]) for (const type of GAME_COMMAND_TYPES) {
  const room = freshRoom(), sent = []; room[field] = value
  const gateway = createCommandGateway({ rooms: new Map([[room.roomId, room]]), acceptedActions: new Map(), idempotentActionTypes: new Set(GAME_COMMAND_TYPES),
    actionCacheKey: () => 'receipt', actionFingerprint: () => 'fp', validateCommandRequestId: noop, validateExpectedVersion: noop,
    playerIn: () => 'p1', isFriendRoom: () => true, send: (_, type, payload) => sent.push({ type, payload }),
    router: { dispatch: () => { throw Error('barrier allowed mutation') } } })
  await gateway({ roomId: room.roomId, acceptedCacheKeys: new Map() }, { type, requestId: 1 })
  assert.equal(sent.at(-1).payload.code, code); barrierCases++
}

// Extension of existing SP-03-002: vote-approved closure also lacks continuation after
// either durability phase fails. Actual handler/gateway/persistence/expiry functions.
let voteCloseFailureCases = 0, voteCloseControls = 0
const consoleErrors = [], originalError = console.error
console.error = (...args) => consoleErrors.push(args)
try {
  for (const form of ['one-human-three-bots', 'last-human-vote']) for (const failCommit of [0, 1, 2]) {
    const room = freshRoom('off'); room.state = { phase: 'settled' }; room.roundResult = { isGameWon: false }
    room.botPlayerIds = form === 'one-human-three-bots' ? ['p2', 'p3', 'p4'] : []
    const playerId = form === 'one-human-three-bots' ? 'p1' : 'p4'
    const connection = { id: room.seats[playerId], roomId: room.roomId, acceptedCacheKeys: new Map() }
    const type = form === 'one-human-three-bots' ? 'proposeDissolve' : 'dissolveVote'
    const rooms = new Map([[room.roomId, room]]), store = createAcceptedActionStore({ maxEntries: 20 })
    const timers = new Map(), expiryTimers = new Map(), sent = [], effects = [], saved = [], jobs = []
    let saves = 0, finalize = 0
    const scheduleInto = map => (callback, delay) => { const handle = { unref: noop }; map.set(handle, { callback, delay }); return handle }
    const persistence = createRuntimePersistence({ roomStateStore: { configured: true, save: async snapshot => {
      saves++; if (saves === failCommit) throw Error('audit injected write failure'); saved.push(copy(snapshot))
    } }, acceptedActions: store.entries, persistedRuntimeSnapshot: () => ({ rooms: [...rooms.values()], acceptedActions: [...store.entries] }),
      debounceMs: 1, isShuttingDown: () => false, setTimeout: scheduleInto(timers), clearTimeout: t => timers.delete(t) })
    const commit = async () => { persistence.persistRuntimeState(); await persistence.flushRuntimeState({ throwOnError: true }) }
    const expiry = createRoomExpiry({ rooms, seatHasLiveConnection: () => true, hasConnectedHuman: () => true,
      enqueueServerOperation: fn => { const p = Promise.resolve().then(fn); jobs.push(p); return p },
      closeRoomWithoutAck: () => { throw Error('unexpected unrelated close') }, commitRuntimeState: commit,
      publishDissolveVote: (_, reason) => effects.push(reason), emptyRoomTimeoutMs: 100,
      setTimeout: scheduleInto(expiryTimers), clearTimeout: t => expiryTimers.delete(t) })
    const send = (_, messageType, payload) => sent.push({ type: messageType, payload: copy(payload) })
    const d = { ids, rooms, acceptedActions: store.entries, dissolveTimeoutMs: 5000,
      playerIn: (r, id) => ids.find(seat => r.seats[seat] === id), ensureLiveMetadata: noop, isFriendRoom: () => true,
      rememberClosedRoomTombstone: () => effects.push('tombstone'), reportSpectatorClosed: () => effects.push('closed-event'),
      stagePendingSideEffects: () => effects.push('stage'), commitRuntimeState: commit, persistRuntimeState: persistence.persistRuntimeState,
      finalizeRemovedRoom: () => { finalize++; expiry.dispose() }, send,
      scheduleDissolveExpiry: expiry.scheduleDissolveExpiry, clearDissolveTimer: expiry.clearDissolveTimer, publishDissolveVote: noop }
    if (form === 'last-human-vote') {
      room.dissolveVote = { initiator: 'p1', expiresAt: Date.now() + 5000, votes: { p1: 'agree', p2: 'agree', p3: 'agree', p4: 'pending' } }
      expiry.scheduleDissolveExpiry(room)
    }
    const gateway = createCommandGateway({ ...d, idempotentActionTypes: new Set(GAME_COMMAND_TYPES),
      actionCacheKey: (_, c, requestId) => playerId + ':' + requestId, actionFingerprint: (t, p) => JSON.stringify([t, p]),
      validateCommandRequestId: noop, validateExpectedVersion: noop, rememberAccepted: store.remember, reserveAccepted: store.reserve, releaseAccepted: store.release,
      router: createCommandRouter([{ types: GAME_COMMAND_TYPES, handle: createGameCommandHandler(d) }]) })
    const request = () => gateway(connection, { type, requestId: 1, payload: { roomId: room.roomId, agree: true } })
    if (!failCommit) {
      await request(); assert.equal(rooms.size, 0); assert.equal(finalize, 1)
      assert.equal(sent.at(-1).type, 'actionAccepted'); voteCloseControls++
    } else {
      await assert.rejects(request(), /audit injected write failure/)
      assert.equal(rooms.size, 1); assert.equal(room.closingReason, 'vote-approved'); assert.equal(finalize, 0)
      await persistence.flushRuntimeState({ throwOnError: true }) // real disk-retry business boundary; memory disk
      assert.equal(saved.at(-1).rooms[0].closingReason, 'vote-approved'); assert.equal(timers.size, 0)
      if (form === 'last-human-vote') {
        const [handle, timer] = expiryTimers.entries().next().value; expiryTimers.delete(handle); timer.callback(); await Promise.all(jobs)
        assert.equal(room.dissolveVote, null); assert.ok(effects.includes('expired'))
      }
      for (let retry = 0; retry < 3; retry++) { await request(); assert.equal(sent.at(-1).payload.code, 'ROOM_CLOSING') }
      assert.equal(rooms.size, 1); assert.equal(finalize, 0); assert.equal(store.entries.size, 0)
      assert.equal(timers.size, 0); assert.equal(expiryTimers.size, 0)
      voteCloseFailureCases++
    }
    expiry.dispose(); persistence.cancelPendingTimer()
  }
} finally { console.error = originalError }
assert.equal(consoleErrors.length, 4)
console.log(JSON.stringify({ seatPermutations, refusedMoves, botCycles, botIdentitiesUnique: botIds.size, barrierCases,
  voteCloseFailureCases, voteCloseControls,
  linkedFinding: 'SP-03-002 extended: unanimous vote close also remains ROOM_CLOSING after recovered writes',
  newFindingCount: 0, limitations: 'Synthetic state, memory save/scheduling/publication/finalize ports; no real platform effects or live clients.' }, null, 2))

