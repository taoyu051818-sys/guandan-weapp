import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { PlatformService } from '../../../../work/guandan-windows-source/server/platform/service.js'
import { MemoryPlatformStore, createEmptyPlatformState } from '../../../../work/guandan-windows-source/server/platform/storage.js'
import { AccessTokenService, GameTicketService, GameTicketVerifier } from '../../../../work/guandan-windows-source/server/platform/crypto.js'
import { createFriendRoomObserverRuntime } from '../../../../work/guandan-windows-source/server/friend-room-observer-runtime.js'
import { createRoomExit } from '../../../../work/guandan-windows-source/server/weapp-room-exit.js'
import { buildGameResultEvent } from '../../../../work/guandan-windows-source/server/game-stats.js'
import { SpectatorEventReporter } from '../../../../work/guandan-windows-source/server/platform/spectator-event-reporter.js'
import { JsonSpectatorOutboxStore } from '../../../../work/guandan-windows-source/server/platform/spectator-outbox-store.js'
const core = createRequire(import.meta.url)('../../../../shared-core/dist')

const secret = 'audit08-synthetic-secret-not-production'
const baseTime = 1_800_000_000_000
const rows = []
for (const scenario of ['ordinary', 'reuse', 'observer-at-boundary', 'observer-after-boundary']) {
  const reuseSeat = scenario === 'reuse'
  let now = baseTime, nextId = 0, requestId = 0, nextToken = 0
  const seed = createEmptyPlatformState()
  for (let i = 0; i < 5; i++) {
    const id = `u${i}`
    seed.users[id] = { id, displayName: id }
    seed.wallets[id] = { userId: id, balance: 1000, currency: 'points' }
  }
  const store = new MemoryPlatformStore(seed)
  const tickets = new GameTicketService({ secret, now: () => now, gameEndpoint: 'ws://127.0.0.1:1/not-connected' })
  const verifier = new GameTicketVerifier({ secret, required: true, now: () => now })
  const platform = new PlatformService({ store, gameTickets: tickets,
    accessTokens: new AccessTokenService({ secret, now: () => now }), now: () => now,
    createId: () => `audit08-${++nextId}`, createRoomId: () => '345678', createInviteCode: () => 'R'.repeat(24) })
  const host = await platform.createFriendRoom('u0', {
    entryAttemptId: 'audit08-host-attempt-00001',
    roomSettings: { format: 'upgrade', upgradeTarget: 6, spectator: 'live' },
  })
  const claims = tickets.inspect(host.gameTicket)
  const blank = () => Object.fromEntries(['p1', 'p2', 'p3', 'p4'].map(id => [id, null]))
  const room = { roomId: host.roomId, matchId: host.matchId, entryKind: 'friend', ticketBound: true,
    roomSettings: claims.roomSettings, friendHostUserId: 'u0', botSeed: 'audit08', version: 0,
    seats: blank(), resumeTokens: blank(), userIdsBySeat: blank(), ticketJtisBySeat: blank(),
    ticketExpiresAtBySeat: blank(), lobbyReady: blank(), revokedTicketJtis: [], friendMembers: [], pendingSpectatorEvents: [],
    spectatorSequence: 0, roundSequence: 0 }
  const rooms = new Map([[room.roomId, room]]), connections = new Map(), acceptedActions = new Map()
  const deps = {
    rooms, connections, acceptedActions,
    entryPayloadFor: () => ({ state: null, phase: 'lobby', version: room.version }),
    inspectEntryTicket: (p, expected) => verifier.inspectWithConsumptionStatus(p.gameTicket, expected),
    ticketBlockedByClosedRoom: () => false,
    ticketMatchesRoom: (r, c) => r.matchId === c.matchId && r.roomId === c.roomId && JSON.stringify(r.roomSettings) === JSON.stringify(c.roomSettings),
    entryConflictFor: () => false, actionFingerprint: (type, p) => JSON.stringify([type, p]),
    reserveAccepted: () => true, releaseAccepted() {}, gameTicketVerifier: verifier,
    createResumeToken: () => `audit08-resume-${++nextToken}`, rotateAcceptedActionIdentity() {},
    clearEmptyRoomExpiry() {}, clearHostExpiry() {}, publishRoomMembers() {},
    rememberAccepted (key, fingerprint, response, responseType, completion) { acceptedActions.set(key, { fingerprint, response, responseType, completion }) },
    async commitRuntimeState() {}, send (c, type, payload) { if (type !== 'roomView') c.last = { type, payload } },
  }
  const observer = createFriendRoomObserverRuntime(deps)
  const enqueuePublic = detail => {
    now++
    const sequence = ++room.spectatorSequence
    const event = { eventId: `spectate:${room.matchId}:${sequence}`, matchId: room.matchId, roomId: room.roomId,
      sequence, at: now, roundSequence: 1, ...detail }
    room.pendingSpectatorEvents.push(event)
    return event
  }
  const flushPublic = async () => {
    for (const event of room.pendingSpectatorEvents.slice()) {
      await platform.acceptSpectatorEvent(event.eventId, event)
      room.pendingSpectatorEvents = room.pendingSpectatorEvents.filter(e => e.eventId !== event.eventId)
    }
  }
  const exit = createRoomExit({ ...deps,
    playerIn: (r, id) => Object.keys(r.seats).find(s => r.seats[s] === id),
    ensureLobbyMetadata() {}, deleteAcceptedActionIdentity() {}, persistRuntimeState() {},
    reportSpectatorEvent: (_r, e) => enqueuePublic(e), stagePendingSideEffects() {},
    syncConnectionRoomId: c => { c.roomId = null }, publishCurrentRoom() {}, broadcastRooms() {}, scheduleEmptyRoomExpiry() {},
    enqueueServerOperation: (_key, op) => op(),
  })
  const enter = async (index, entry) => {
    const c = { id: `c${index}-${++requestId}`, acceptedCacheKeys: new Map() }
    connections.set(c.id, c)
    await observer.enter({ type: 'joinRoom', requestId: ++requestId, connection: c,
      payload: { roomId: entry.roomId, gameTicket: entry.gameTicket, entryAttemptId: entry.entryAttemptId },
      reply: (type, payload) => { c.last = { type, payload } } })
    assert.equal(c.last?.type, 'roomJoined', JSON.stringify(c.last))
    return c
  }
  const join = async (index, attempt = 1) => enter(index, await platform.joinFriendRoom(`u${index}`, {
    roomId: host.roomId, inviteCode: host.inviteCode, entryAttemptId: `audit08-guest-${index}-attempt-${attempt}-00000`,
  }))
  const leave = async (c, flush = true) => {
    await exit.handle({ connection: c, payload: { roomId: room.roomId }, requestId: ++requestId,
      cacheKey: `leave-${requestId}`, requestFingerprint: `leave-${requestId}`, reply: () => assert.fail('unexpected exit rejection') })
    if (flush) await flushPublic()
  }
  try {
    await enter(0, host)
    const original = await join(1)
    if (reuseSeat) {
      await leave(original)
      const replacement = await join(4)
      assert.equal(room.userIdsBySeat.p2, 'u4')
      await leave(replacement)
      await join(1, 2)
    }
    await join(2); await join(3)
    const observingConnection = scenario.startsWith('observer-') ? await join(4) : null
    const roster = structuredClone(room.userIdsBySeat)
    assert.deepEqual(roster, { p1: 'u0', p2: 'u1', p3: 'u2', p4: 'u3' })
    enqueuePublic({ type: 'game-start', friendRoster: roster }); await flushPublic()
    const started = await store.read(s => s.matches[room.matchId])
    assert.equal(started.status, 'playing')
    assert.equal(started.participants.find(p => p.userId === 'u1').status, 'playing')
    if (reuseSeat) assert.equal(started.participants.find(p => p.userId === 'u4').status, 'cancelled')

    // Legal terminal fixture at the configured target, not a complete random deal played from 2.
    const players = Object.fromEntries(['p1', 'p2', 'p3', 'p4'].map((id, i) => [id, {
      id, name: id, team: i % 2 === 0 ? 'teamA' : 'teamB',
      hand: [{ id: `card-${id}`, rank: [8, 9, 10, 'J'][i], suit: 'spade', value: 8 + i, isLevelCard: false }],
    }]))
    let game = core.createMatchState({ players, ruleProfile: core.getRuleProfile('classic'),
      currentLevel: 6, levelTeam: 'teamA', dealerId: 'p1', teamLevels: { teamA: 6, teamB: 6 },
      matchFormat: { kind: 'upgrade', upgradeTarget: 6, levelMode: 'fixed', levelRank: 2, tributeEnabled: true, doubleDown: 3 } })
    if (observingConnection) {
      room.state = game
      assert.equal(room.friendMembers.find(m => m.userId === 'u4').seat, null)
      assert.equal(started.participants.find(p => p.userId === 'u4').seat, 'observer')
      assert.equal(started.participants.find(p => p.userId === 'u4').status, 'playing')
      const afterBoundary = scenario === 'observer-after-boundary'
      now = host.roomExpiresAt + 300_000 - 1 + (afterBoundary ? 1 : 0)
      assert.equal(platform.friendRoomHasExpired(started, now), false, 'lobby lease cannot expire an already-playing match')
      await leave(observingConnection, false)
      assert.equal(room.friendMembers.some(m => m.userId === 'u4'), false, 'actual room exit removed observer')
      const left = room.pendingSpectatorEvents[0]
      const next = core.transition(game, { type: 'PLAY_CARDS', playerId: 'p1', cardIds: ['card-p1'], roundId: game.roundId, expectedRevision: game.revision })
      assert.equal(next.ok, true); room.state = next.state
      enqueuePublic({ type: 'play', playerId: 'p1', cards: [{ rank: 8, suit: 'spade' }], playType: 'Single', automatic: false })
      const outbox = new JsonSpectatorOutboxStore() // memory only; no file path
      const sent = [], rejectedCodes = []
      let secondAttempt
      const retried = new Promise(resolve => { secondAttempt = resolve })
      const delivery = new SpectatorEventReporter({ endpoint: 'https://audit.invalid/no-network', secret,
        lifecycleSecret: secret, outbox, maxAttempts: 1, retryBaseMs: 1, retryMaxMs: 1,
        fetchImpl: async (_url, options) => {
          const e = JSON.parse(options.body); sent.push({ eventId: e.eventId, type: e.type })
          if (afterBoundary && sent.length === 2) { secondAttempt(); return new Promise(() => {}) }
          try {
            const ack = await platform.acceptSpectatorEvent(e.eventId, e)
            return { ok: true, status: 200, json: async () => ({ ok: true, data: { event: ack } }) }
          } catch (error) {
            rejectedCodes.push(error.code)
            return { ok: false, status: error.status || 409, json: async () => ({ ok: false, error: { code: error.code, message: error.message } }) }
          }
        } })
      const watchdog = setTimeout(() => { throw new Error('observer lease probe timeout') }, 3000)
      const pending = room.pendingSpectatorEvents.map(e => delivery.stage(e))
      const settled = Promise.allSettled(pending)
      try {
        if (afterBoundary) {
          await retried
          assert.deepEqual(rejectedCodes, ['FRIEND_SEAT_EVENT_AFTER_LEASE'])
          assert.deepEqual(sent.map(e => e.type), ['seat-left', 'seat-left'])
          const current = await store.read(s => s)
          assert.equal(current.matches[room.matchId].status, 'playing')
          assert.equal(current.matches[room.matchId].participants.find(p => p.userId === 'u4').status, 'playing')
          assert.equal(current.activeMatchByUser.u4, room.matchId)
          assert.deepEqual(current.spectatorFeeds[room.matchId].events.map(e => e.type), ['game-start'])
          assert.equal(outbox.pending().length, 2)
          delivery.stop(room.matchId, new Error('audit stop'))
          assert.ok((await settled).every(r => r.status === 'rejected'))
          rows.push({ scenario, issue: 'PS-08-001', lobbyLeaseMs: host.roomExpiresAt - baseTime,
            leftOffsetFromLeaseMs: left.at - host.roomExpiresAt, runtimeObserverRemoved: true,
            platformObserverRetained: true, nextPlayDeliveryBlocked: true, rejection: rejectedCodes[0] })
        } else {
          assert.ok((await settled).every(r => r.status === 'fulfilled'))
          assert.deepEqual(sent.map(e => e.type), ['seat-left', 'play'])
          assert.equal(await store.read(s => s.matches[room.matchId].participants.find(p => p.userId === 'u4').status), 'cancelled')
          assert.deepEqual(outbox.pending(), [])
          rows.push({ scenario, leftOffsetFromLeaseMs: left.at - host.roomExpiresAt, bothEventsAccepted: true })
        }
      } finally { clearTimeout(watchdog); delivery.stop(room.matchId, new Error('audit stop')); await settled }
      continue
    }
    let transition
    for (const id of ['p1', 'p2', 'p3']) {
      transition = core.transition(game, { type: 'PLAY_CARDS', playerId: id, cardIds: [`card-${id}`], roundId: game.roundId, expectedRevision: game.revision })
      assert.equal(transition.ok, true, transition.reason); game = transition.state
    }
    const result = game.settlement
    assert.ok(result?.isGameWon, 'actual core terminal fixture must finish upgrade target')
    enqueuePublic({ type: 'round-end', ranking: result.fullRank, winnerTeam: result.winnerTeam, isGameWon: true }); await flushPublic()
    room.roundSequence = 1
    const report = buildGameResultEvent(room, result, now)
    const before = await store.read(s => s)
    if (reuseSeat) {
      for (let retry = 0; retry < 2; retry++) await assert.rejects(platform.acceptGameResult(report.eventId, report), /结算席位用户与匹配分配不一致/)
      assert.deepEqual(await store.read(s => s), before, 'rejected result must not partially credit anyone')
      const collision = started.participants.filter(p => p.seat === 'p2').map(p => ({ userId: p.userId, status: p.status }))
      assert.deepEqual(collision, [{ userId: 'u1', status: 'playing' }, { userId: 'u4', status: 'cancelled' }])
      // Counterfactual in isolated memory only: exclude history and replay the exact same report.
      await store.transaction(s => { s.matches[room.matchId].participants = s.matches[room.matchId].participants.filter(p => p.status === 'playing') })
      assert.equal((await platform.acceptGameResult(report.eventId, report)).accepted, true)
      assert.equal((await platform.acceptGameResult(report.eventId, report)).duplicate, true)
      rows.push({ reuseSeat, issue: 'PR-08-001', actualP2: roster.p2, staleCollision: collision, rejectedRetries: 2, activeOnlyCounterfactualAccepted: true })
    } else {
      assert.equal((await platform.acceptGameResult(report.eventId, report)).accepted, true)
      rows.push({ reuseSeat, ordinaryControlAccepted: true })
    }
    const after = await store.read(s => s)
    for (const userId of Object.values(roster)) assert.equal(after.userStats[userId].gamesPlayed, 1)
    assert.equal(after.userStats.u4?.gamesPlayed || 0, 0)
  } finally { exit.dispose(); observer.dispose() }
}
console.log(JSON.stringify({ resultRoster08: rows }, null, 2))
