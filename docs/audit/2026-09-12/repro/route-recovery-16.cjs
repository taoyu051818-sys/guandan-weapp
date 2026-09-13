// Audit-only synthetic ports. No HTTP/socket connection, real user, rendering,
// engine restart, file generation or product mutation.
const assert = require('node:assert/strict')
const path = require('node:path')
const root = path.resolve(__dirname, '../../../..')
const app = path.join(root, 'work/guandan-cocos')
const { loadTs } = require(path.join(app, 'tests/support/load-typescript-module.cjs'))
const load = (p, dependencies = {}) => loadTs(path.join(app, 'assets/scripts', p), dependencies)
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const noop = () => {}
const permutations = values => values.length ? values.flatMap((v, i) => permutations(values.filter((_, j) => i !== j)).map(rest => [v, ...rest])) : [[]]
const { FriendRoomReservationCleanup } = load('scenes/front-pages/FriendRoomReservationCleanup.ts')
const { FriendRoomPlatformFlow } = load('scenes/front-pages/FriendRoomPlatformFlow.ts', { './FriendRoomReservationCleanup': { FriendRoomReservationCleanup } })
const attempts = load('network/LobbyEntryAttempt.ts')
const { MatchRecoveryAttemptTracker } = load('services/platform/MatchRecoveryAttempt.ts', { '../../network/LobbyEntryAttempt': attempts })
const { PlatformMatchRecoveryCoordinator } = load('scenes/PlatformMatchRecoveryCoordinator.ts')
const contracts = load('services/platform/contracts.ts')
const endpoint = load('services/NetworkEndpoint.ts')
const validation = load('services/platform/validation.ts', { './contracts': contracts, '../NetworkEndpoint': endpoint })
// Only the quick queue is used below; catalogue membership is supplied explicitly,
// while every decoder branch and endpoint validator uses unmodified product code.
const decoders = load('services/platform/competitionDecoders.ts', {
  '../FrontPageGatewayContracts': { MATCH_QUEUE_IDS: ['quick'] }, '../../network/LobbyEntryAttempt': attempts,
  '../NetworkEndpoint': endpoint, './validation': validation,
})
const errorPresentation = load('services/MatchmakingErrorPresentation.ts', { './PlatformApi': contracts })
const waitPresentation = load('services/MatchWaitingPresentation.ts')
const { MatchmakingPageDomain } = load('scenes/front-pages/MatchmakingPageDomain.ts', {
  '../../services/MatchmakingErrorPresentation': errorPresentation, '../../services/MatchWaitingPresentation': waitPresentation,
  './MatchmakingPageView': { renderMatchmakingPage: () => ({ string: '' }) },
  '../../core/generated/lib/classicModes': { isPublicClassicQueue: queue => queue === 'quick' },
})
const id = 'auditRecovery_0123456789ABCDE'
const roomEntry = (matchId = 'audit-room') => ({ entryAttemptId: id, recoveryAttemptId: id, matchId, roomId: '123456', seat: 'p2',
  roomKind: 'match', ticketPurpose: 'rejoin', gameEndpoint: 'wss://game.invalid/weapp', gameTicket: 'synthetic-ticket', joinToken: 'synthetic-ticket', expiresAt: Date.now() + 60000 })
class Events {
  constructor () { this.handlers = new Map() }
  on (name, fn) { if (!this.handlers.has(name)) this.handlers.set(name, new Set()); this.handlers.get(name).add(fn) }
  off (name, fn) { this.handlers.get(name)?.delete(fn) }
  emit (name, value) { for (const fn of [...this.handlers.get(name) || []]) fn(value) }
  count () { return [...this.handlers.values()].reduce((n, s) => n + s.size, 0) }
}
async function main () {
  let reservationCases = 0
  for (const order of permutations([0, 1, 2, 3])) for (const adoption of ['same', 'different', 'last-fails', 'destroyed']) {
    const responses = Array.from({ length: 4 }, deferred), cancellations = [], entered = []; let requests = 0
    const flow = new FriendRoomPlatformFlow({ gateway: {
      create: () => responses[requests++].promise, cancel: async matchId => cancellations.push(matchId),
    }, isDisposed: () => false, enterMatchedRoom: e => entered.push(e), showNotice: noop, onChanged: noop })
    const tasks = []
    for (let i = 0; i < 4; i++) { tasks.push(flow.create({})); if (i < 3) flow.leave() }
    assert.equal(requests, 4)
    if (adoption === 'destroyed') flow.destroy()
    for (const i of order) {
      if (i === 3 && adoption === 'last-fails') responses[i].reject(Error('synthetic admission failure'))
      else responses[i].resolve(roomEntry(adoption === 'same' ? 'same-room' : `room-${i}`))
      await tasks[i]
    }
    await flush()
    const shouldEnter = adoption === 'same' || adoption === 'different'
    assert.equal(entered.length, shouldEnter ? 1 : 0)
    if (shouldEnter) { flow.handoffReservation(); flow.leave() }
    flow.destroy(); await flush()
    const expected = adoption === 'same' ? [] : adoption === 'destroyed' ? ['room-0', 'room-1', 'room-2', 'room-3'] : ['room-0', 'room-1', 'room-2']
    assert.deepEqual(cancellations.sort(), expected); assert.equal(new Set(cancellations).size, cancellations.length)
    reservationCases++
  }
  // A synchronous UI entry failure must release exactly its acquired reservation.
  {
    const cancelled = [], notices = []
    const flow = new FriendRoomPlatformFlow({ gateway: { create: async () => roomEntry(), cancel: async x => cancelled.push(x) },
      isDisposed: () => false, enterMatchedRoom: () => { throw Error('entry rejected') }, showNotice: (...x) => notices.push(x), onChanged: noop })
    await flow.create({}); await flush(); assert.deepEqual(cancelled, ['audit-room']); assert.equal(flow.snapshot.entry, null)
    assert.equal(notices.at(-1)[0], '进入好友房失败'); flow.destroy(); reservationCases++
  }
  let trackerCases = 0
  {
    const random = deferred(); let calls = 0
    const tracker = new MatchRecoveryAttemptTracker(() => { calls++; return random.promise })
    const ids = Array.from({ length: 32 }, () => tracker.current())
    await flush(); assert.equal(calls, 1); random.resolve(id)
    assert.deepEqual(await Promise.all(ids), Array(32).fill(id)); assert.equal(await tracker.current(), id)
    assert.equal(tracker.complete('wrong-but-valid-0123456789'), false)
    assert.equal(await tracker.current(), id); assert.equal(tracker.complete(id), true)
    assert.equal(tracker.abandon(id), false); trackerCases++
  }
  for (const bad of ['', 'short', 'x'.repeat(129), 'x'.repeat(22) + '!']) {
    let count = 0; const tracker = new MatchRecoveryAttemptTracker(() => ++count === 1 ? bad : id)
    await assert.rejects(tracker.current(), /格式无效/); assert.equal(await tracker.current(), id); assert.equal(count, 2); trackerCases++
  }
  let recoveryCases = 0
  for (const result of ['success', 'empty', 'failure']) for (const disposed of [false, true]) {
    const pending = deferred(), events = new Events(), entered = [], notices = [], pendingStates = []; let calls = 0
    const c = new PlatformMatchRecoveryCoordinator({ configured: true, gateway: { recover: () => { calls++; return pending.promise }, confirm: noop, abandon: noop },
      lobby: { snapshot: { roomStatus: 'idle' }, events, enterMatchedRoom: e => entered.push(e) }, enterLobby: noop,
      showRecoveryAvailable: noop, onPendingChanged: x => pendingStates.push(x), showNotice: (...x) => notices.push(x), isDisposed: () => false })
    c.start(); assert.equal(calls, 1); assert.deepEqual(pendingStates, [true])
    if (disposed) c.dispose()
    if (result === 'failure') pending.reject(Error('synthetic failure')); else pending.resolve(result === 'empty' ? null : roomEntry())
    await flush(); assert.equal(entered.length, !disposed && result === 'success' ? 1 : 0)
    assert.equal(notices.length, !disposed && result === 'failure' ? 1 : 0)
    assert.deepEqual(pendingStates, disposed ? [true] : [true, false])
    c.dispose(); assert.equal(events.count(), 0); events.emit('guandan:platform-recovery-required', { manual: true }); assert.equal(calls, 1); recoveryCases++
  }
  // Reentrant WebSocket failure inside a fulfilled HTTP callback must not lose
  // the queued recovery, and three automatic tickets remain the total budget.
  {
    const events = new Events(), entered = [], abandoned = [], notices = []; let calls = 0
    const c = new PlatformMatchRecoveryCoordinator({ configured: true, gateway: {
      recover: async () => { calls++; const rid = `${id}${calls}`; return { ...roomEntry(), entryAttemptId: rid, recoveryAttemptId: rid } },
      confirm: noop, abandon: x => abandoned.push(x),
    }, lobby: { snapshot: { roomStatus: 'idle' }, events, enterMatchedRoom: e => { entered.push(e); events.emit('guandan:platform-recovery-required', { abandonAttemptId: e.recoveryAttemptId }) } },
      enterLobby: noop, showRecoveryAvailable: noop, showNotice: (...x) => notices.push(x), isDisposed: () => false })
    c.start(); await flush(); await flush(); assert.equal(calls, 3); assert.equal(entered.length, 3); assert.equal(abandoned.length, 3)
    assert.equal(notices.at(-1)[0], '牌局恢复已暂停'); c.dispose(); recoveryCases++
  }
  const { HttpMatchRecoveryGateway } = load('services/platform/matchRecoveryGateway.ts', {
    '../../network/LobbyEntryAttempt': attempts, './competitionDecoders': decoders, './validation': validation,
    './MatchRecoveryAttempt': { MatchRecoveryAttemptTracker: class extends MatchRecoveryAttemptTracker { constructor () { super(() => id) } } },
    './friendRoomGateway': { normalizeRecoveredFriendRoomEntry: () => assert.fail('friend decoder is outside this probe') },
  })
  let gatewayCases = 0
  for (const mutate of [x => x, x => ({ ...x, seat: 'observer' }), x => ({ ...x, roomId: '12345' }),
    x => ({ ...x, expiresAt: Date.now() - 1 }), x => ({ ...x, gameEndpoint: 'ws://game.invalid/weapp' }),
    x => ({ ...x, joinToken: 'different' }), x => ({ ...x, entryAttemptId: id + 'wrong' }),
    x => ({ ...x, inviteText: 'not-allowed' }), x => ({ ...x, ticketPurpose: 'unknown' })]) {
    const client = { request: async (route, method, body) => {
      assert.equal(route, '/api/v1/matches/recover'); assert.equal(method, 'POST'); assert.deepEqual(body, { recoveryAttemptId: id })
      return { entry: mutate(roomEntry()) }
    } }
    const gateway = new HttpMatchRecoveryGateway(client, 'secure-only')
    if (!gatewayCases) { assert.equal((await gateway.recover()).roomId, '123456'); gateway.confirm(id) }
    else await assert.rejects(gateway.recover(), e => e.code === 'MALFORMED_RESPONSE')
    gatewayCases++
  }
  const validTicket = { ticketId: 't1', queueId: 'quick', status: 'matched', entryAttemptId: id, roomId: '123456', seat: 'p2',
    joinToken: 'synthetic', gameEndpoint: 'wss://game.invalid/weapp', expiresAt: Date.now() + 60000, humanPlayerCount: 1, botCount: 3 }
  let decoderCases = 0
  for (const status of ['matching', 'matched', 'playing', 'completed', 'aborted', 'cancelled']) for (const seat of ['p1', 'p2', 'p3', 'p4']) {
    const input = { ...validTicket, status, seat }, before = structuredClone(input)
    assert.deepEqual(decoders.normalizeTicket(input, 'secure-only'), input); assert.deepEqual(input, before); decoderCases++
  }
  for (const patch of [{ status: 'bogus' }, { seat: 'observer' }, { roomId: '12345' }, { entryAttemptId: 'short' },
    { expiresAt: 0 }, { expiresAt: NaN }, { botCount: 4 }, { humanPlayerCount: 5 }, { humanPlayerCount: 2 },
    { botFillAt: -1 }, { joinToken: '' }, { gameEndpoint: 'https://game.invalid' }]) {
    assert.throws(() => decoders.normalizeTicket({ ...validTicket, ...patch }, 'secure-only'), e => e.code === 'MALFORMED_RESPONSE'); decoderCases++
  }
  for (const response of [{ status: 200, body: { ok: true } }, { status: 200, body: { ok: false, error: { code: 'NO', message: 'refused' } } },
    { status: 401, body: {} }, { status: 503, body: { message: 'unavailable' } }]) assert.throws(() => validation.unwrap(response), contracts.PlatformApiError)
  assert.equal(validation.unwrap({ status: 200, body: { data: 0 } }), 0)
  let matchingCases = 0
  function matchingHarness (gateway) {
    const scheduled = [], entered = [], returned = [], notices = [], router = { current: 'menu', open: () => { router.current = 'matching'; return {} } }
    const d = new MatchmakingPageDomain({ router, gateways: { matchmaking: gateway }, animationsEnabled: () => false, isDisposed: () => false,
      scheduleOnce: (callback, delay) => scheduled.push({ callback, delay }), showNotice: (...x) => notices.push(x), enterMatchedGame: x => entered.push(x),
      showMenu: () => { router.current = 'menu'; returned.push('menu') }, showOnlinePlay: noop, showClassicRooms: noop })
    const dispatch = () => scheduled.find(x => x.delay === 0).callback()
    return { d, scheduled, entered, returned, notices, router, dispatch }
  }
  for (const phase of ['before-dispatch', 'join-pending', 'queued', 'assigned', 'lost-cancel']) {
    const join = deferred(), cancel = deferred(); let joins = 0, cancels = 0
    const h = matchingHarness({ joinQueue: () => { joins++; return join.promise }, cancel: () => { cancels++; return cancel.promise },
      getStatus: async () => { if (phase === 'lost-cancel') throw Error('offline'); return validTicket } })
    h.d.begin('quick', '快速', 'menu'); h.d.begin('quick', '快速', 'menu')
    assert.equal(h.scheduled.filter(x => x.delay === 0).length, 1)
    if (phase === 'before-dispatch') { await h.d.cancelMatch(); h.dispatch(); await flush(); assert.equal(joins, 0) }
    else {
      h.dispatch(); await flush()
      if (phase !== 'join-pending') { join.resolve({ ticketId: 't1', status: 'matching' }); await flush() }
      const cancelTask = h.d.cancelMatch(); await h.d.cancelMatch()
      if (phase === 'join-pending') { assert.equal(cancels, 0); join.resolve({ ticketId: 't1', status: 'matching' }); await flush() }
      assert.equal(cancels, 1)
      if (phase === 'assigned' || phase === 'lost-cancel') cancel.reject(Error('cancel not accepted')); else cancel.resolve()
      await cancelTask; await flush()
      if (phase === 'assigned') { assert.equal(h.entered.length, 1); assert.equal(h.returned.length, 0) }
      else if (phase === 'lost-cancel') { assert.equal(h.d.matchingStage, 'cancel-uncertain'); h.d.deferUncertainMatch(); assert.ok(h.d.uncertainMatchIds.has('t1')) }
      else assert.equal(h.returned.length, 1)
    }
    h.d.destroy(); await flush(); matchingCases++
  }
  // Router ownership and tween teardown, including delayed native destruction.
  let routeCases = 0
  class Transform { setContentSize (width, height) { this.width = width; this.height = height } }
  class Node {
    constructor (name) { this.name = name; this.children = []; this.isValid = true; this.active = true; this.components = new Map() }
    set parent (parent) { this._parent = parent; parent.children.push(this) }
    addComponent (T) { const c = new T(); this.components.set(T, c); return c }
    getComponent (T) { return this.components.get(T) }
    destroy () { this.destroyRequested = true }
  }
  const stopped = [], changes = []
  const { PageRouter } = load('scenes/PageRouter.ts', { cc: { Node, UITransform: Transform, Tween: { stopAllByTarget: n => stopped.push(n) } },
    '../ui/RuntimeUiFactory': { RuntimeUiFactory: class { constructor (parent) { this.parent = parent } } } })
  const rootNode = new Node('root'), router = new PageRouter(rootNode, (a, b) => changes.push([a, b]))
  for (let i = 0; i < 100; i++) {
    const route = i % 2 ? 'matching' : 'menu', ui = router.open(route), child = new Node('child'); child.parent = ui.parent
    router.resize(874, 402); assert.equal(ui.parent.getComponent(Transform).width, 874)
    const repeat = router.open(route); assert.equal(ui.parent.active, false); assert.equal(ui.parent.destroyRequested, true)
    assert.ok(stopped.includes(child)); assert.equal(router.current, route)
    router.clear(); assert.equal(repeat.parent.active, false); assert.equal(router.current, null); routeCases++
  }
  assert.equal(changes.length, 200); router.destroy(); assert.equal(rootNode.children[0].destroyRequested, true)
  console.log(JSON.stringify({ reservationCases, trackerCases, recoveryCases, gatewayCases, decoderCases, matchingCases, routeCases,
    newFindings: 0, boundary: 'synthetic port composition, not production HTTP/WeChat/rendering or complete client integration' }, null, 2))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
