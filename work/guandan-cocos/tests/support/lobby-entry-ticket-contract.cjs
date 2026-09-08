const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

/** Shared fixture run by lobby-entry-regression: real client/server ticket retry contract. */
module.exports = async ({ loadPureTs, projectRoot }) => {
  const server = name => import(pathToFileURL(path.resolve(projectRoot, '../guandan-windows-source/server', name)).href)
  const { createEntryCommandHandler } = await server('weapp-entry-command-handler.js')
  const { createRoomMetadata } = await server('weapp-room-metadata.js')
  const { createAcceptedActionStore } = await server('weapp-accepted-action-store.js')
  const { createRoomPublisher } = await server('weapp-room-publisher.js')
  const load = name => loadPureTs(path.join(projectRoot, 'assets/scripts/network', name))
  const { LobbyEntryRequest } = load('LobbyEntryRequest.ts')
  const { LobbyMatchedEntryCoordinator } = load('LobbyMatchedEntryCoordinator.ts')
  const networkEndpoint = loadPureTs(path.join(projectRoot, 'assets/scripts/services/NetworkEndpoint.ts'))
  const { CocosSocketClient } = loadPureTs(path.join(projectRoot, 'assets/scripts/network/CocosSocketClient.ts'), {
    '../services/WechatNetworkPolicy': loadPureTs(path.join(projectRoot, 'assets/scripts/services/WechatNetworkPolicy.ts'), { './NetworkEndpoint': networkEndpoint }),
  })
  const originalWebSocket = globalThis.WebSocket
  class MemorySocket {
    static OPEN = 1
    constructor () { this.readyState = 1; this.sent = []; queueMicrotask(() => this.onopen?.()) }
    send (body) { this.sent.push(JSON.parse(body)) }
    close () { this.readyState = 3 }
  }
  globalThis.WebSocket = MemorySocket
  try {
    for (const seat of ['p1', 'p2']) {
      const client = new CocosSocketClient()
      await client.connect('wss://game.example/weapp')
      const request = new LobbyEntryRequest(), scheduled = []
      const entry = { roomId: '123456', seat, gameTicket: 'fixture-ticket', entryAttemptId: 'ticketContract_12345678901234', gameEndpoint: 'wss://game.example/weapp', expiresAt: Date.now() + 90_000 }
      const coordinator = new LobbyMatchedEntryCoordinator({
        connected: () => true, connect: () => Promise.resolve(),
        begin: (type, _response, _roomId, payload) => request.send(type, payload, true, (t, p, id) => client.send(t, p, id)),
        pendingRoom: () => entry.roomId, patch () {}, close () {}, resetTransport () {}, reportError () {}, requestRecovery () { assert.fail('valid retry must not rotate platform recovery') },
        schedule: (callback, delay) => scheduled.push({ callback, delay }),
      })
      coordinator.start(entry)
      await Promise.resolve()
      const first = client.socket.sent[0]
      scheduled.find(item => item.delay === 6).callback()
      scheduled.find(item => item.delay === 0.5).callback()
      const retry = client.socket.sent[1]
      assert.deepEqual(retry, first, 'watchdog must retransmit the identical wire request')

      const ids = ['p1', 'p2', 'p3', 'p4'], noop = () => {}
      const claims = { jti: `ticket-${seat}`, seat, sub: `user-${seat}`, purpose: 'entry', entryAttemptId: entry.entryAttemptId, roomKind: 'match', matchId: 'fixture-match', exp: 9999999999 }
      const metadata = createRoomMetadata({ playerIds: ids, createResumeToken: () => 'fixture-resume', createBotSeed: () => 'fixture-seed', entryKindForClaims: () => 'match', entryDeadlineForClaims: () => Date.now() + 60_000 })
      const room = metadata.createRoomRecord({ roomId: entry.roomId })
      room.ticketBound = true
      const connection = { id: 'fixture-connection', acceptedCacheKeys: new Map() }
      const store = createAcceptedActionStore({ maxEntries: 100 })
      const publisher = createRoomPublisher({ playerIds: ids, connections: new Map(), send: noop, broadcast: noop, ...metadata, isFriendRoom: () => false, seatIsOccupied: (r, id) => Boolean(r.seats[id]) })
      const replies = []
      let consumed = false, consumes = 0
      const handler = createEntryCommandHandler({
        ...metadata, ...publisher, ids, rooms: new Map([[room.roomId, room]]), acceptedActions: store.entries, maxRooms: 10,
        inspectEntryTicket: () => ({ claims, consumed }), gameTicketVerifier: { consume: () => { assert.equal(consumed, false); consumed = true; consumes++ } },
        ticketBlockedByClosedRoom: () => false, normalizeEntryAttemptId: x => x, pendingSeatReleaseFor: () => null, entryConflictFor: () => null,
        actionFingerprint: (type, payload) => JSON.stringify({ type, payload }), sameToken: (a, b) => a === b,
        ticketMatchesRoom: () => true, ensureTicketBindings: noop, seatHasAnotherActiveConnection: () => false,
        clearEmptyRoomExpiry: noop, clearHostExpiry: noop, restoreOfflineDissolveVote: () => false,
        commitRuntimeState: async () => { for (const [key, accepted] of store.entries) store.entries.set(key, { ...accepted, pendingDurability: false }) },
        stagePendingSideEffects: noop, send: (_, type, payload) => replies.push({ type, payload: structuredClone(payload) }),
        scheduleEntryDeadline: noop, scheduleGameStartClaim: noop, rememberAccepted: store.remember,
        reserveAccepted: store.reserve, releaseAccepted: store.release,
        createResumeToken: () => 'fixture-resume', entryKindForClaims: () => 'match', entryDeadlineForClaims: () => Date.now() + 60_000,
        revokePreviousSeatTicket: noop, autoStartMatchedRoom: noop, broadcastRooms: noop,
        playerIn: (r, id) => ids.find(p => r.seats[p] === id),
      })
      for (const wire of [first, retry]) await handler({ ...wire, connection, reply: (type, payload) => replies.push({ type, payload }) })
      assert.equal(consumes, 1, 'a lost response cannot consume the entry ticket twice')
      assert.equal(replies[0].type, seat === 'p1' ? 'roomCreated' : 'roomJoined')
      assert.deepEqual(replies[1], replies[0], 'the repeated request must recover the original accepted response')
      coordinator.complete(); request.clear(); client.close()
    }
  } finally { globalThis.WebSocket = originalWebSocket }
}
