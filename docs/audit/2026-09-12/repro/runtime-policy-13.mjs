// Audit only: synthetic states, injected clocks/persistence; no sockets or live data.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createRoomOpeningState, formatForNewRoom, isSingleRoundMatch } from '../../../../work/guandan-windows-source/server/match-format-policy.js'
import { createRoomBotPolicy } from '../../../../work/guandan-windows-source/server/master-bot-policy.js'
import { dispatchMatchIntent, migrateLegacyMatchState } from '../../../../work/guandan-windows-source/server/game-session.js'
import { normalizeFriendRoomSettings, hasReachedRoundLimit } from '../../../../work/guandan-windows-source/server/friend-room-settings.js'
import { decisionDelayMs, prepareBotPlay } from '../../../../work/guandan-windows-source/server/bot-turn-pacing.js'
import { createTurnClock } from '../../../../work/guandan-windows-source/server/weapp-turn-clock.js'
import { createWeAppMatchLifecycle } from '../../../../work/guandan-windows-source/server/weapp-match-lifecycle.js'
const { CLASSIC_QUEUES, MATCH_LEVELS, getRuleProfile, settleMatchState } = createRequire(import.meta.url)('../../../../shared-core/dist')
const ids = ['p1', 'p2', 'p3', 'p4'], profile = getRuleProfile('classic')
const rng = seed => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32)
const noop = () => {}, copy = value => JSON.parse(JSON.stringify(value))
const friend = (settings = {}) => ({ roomId: '135790', entryKind: 'friend', roundSequence: 0, gameVersion: 0,
  roomSettings: normalizeFriendRoomSettings({ format: 'rounds', ...settings }, { strict: true }), version: 1 })
const opening = (room, seed = 1) => createRoomOpeningState(room, profile, rng(seed), () => false)
const conserve = state => {
  const cards = ids.flatMap(id => state.players[id].hand)
  assert.equal(cards.length, 108); assert.equal(new Set(cards.map(card => card.id)).size, 108)
  assert.ok(ids.every(id => state.players[id].hand.length === 27))
  assert.equal(new Set(state.turnOrder).size, 4)
  state.turnOrder.forEach((id, index) => assert.equal(state.players[id].team, index % 2 ? 'teamB' : 'teamA'))
}
let publicOpenings = 0, friendSettings = 0, clocks = 0, timingCases = 0, hiddenViews = 0
for (const mode of ['quick', ...CLASSIC_QUEUES.map(q => q.id), 'lingshui_16_cup']) {
  for (let i = 0; i < MATCH_LEVELS.length; i++) {
    const room = { roomId: '123450', entryKind: 'match', matchMode: mode }
    const random = rng(i + 1); let first = true
    const state = createRoomOpeningState(room, profile, () => { if (first) { first = false; return (i + 0.5) / 13 }; return random() }, () => true)
    conserve(state); const upgrade = mode.startsWith('consecutive_')
    assert.equal(state.currentLevel, upgrade ? 2 : MATCH_LEVELS[i])
    assert.equal(isSingleRoundMatch({ ...room, state }), !upgrade)
    assert.equal(state.matchFormat.tributeEnabled, upgrade)
    assert.equal(state.matchFormat.dealMode === 'no-shuffle', mode.startsWith('no-shuffle_'))
    assert.equal(Boolean(state.matchFormat.individualRanking), mode === 'lingshui_16_cup')
    publicOpenings++
  }
}
for (const format of ['rounds', 'upgrade', 'rotating', 'duplicate']) for (const dealMode of ['random', 'no-shuffle']) {
  for (const rounds of [1, 4, 5, 8, 12, 32]) for (const turnSeconds of [15, 20, 30, 40, 60]) {
    const room = friend({ format, dealMode, rounds, turnSeconds })
    assert.deepEqual(normalizeFriendRoomSettings(room.roomSettings, { strict: true }), room.roomSettings)
    assert.equal(hasReachedRoundLimit(rounds, room.roomSettings), format !== 'upgrade')
    assert.equal(hasReachedRoundLimit(rounds - 1, room.roomSettings), false)
    assert.equal(formatForNewRoom(room).dealMode, dealMode); friendSettings++
  }
}
for (const cost of [0, 1, 10, 11, 59, 60, 61, 1000]) {
  assert.equal(Array.from({ length: 100 }, (_, i) => decisionDelayMs(cost, () => i / 100))
    .filter(v => v === Math.round(Math.min(3000, Math.max(500, cost * 50)) * 3)).length, 10)
  for (const rare of [false, true]) for (const budget of [100, 1500, 20000]) {
    let now = 10000, measured = 0, choices = 0
    const room = { state: { roundId: 1, revision: 1, players: { p1: { hand: [{ id: 'only' }] } } }, turnDeadlineAt: now + budget }
    const policy = { chooseCards: () => { choices++; now += cost; measured += cost; return room.state.players.p1.hand } }
    const result = prepareBotPlay(room, 'p1', policy, { now: () => now, measure: () => measured, random: () => rare ? 0 : 0.5 })
    const delay = decisionDelayMs(cost, () => rare ? 0 : 0.5)
    assert.equal(result.waitMs, Math.max(0, Math.min(budget, delay) - cost))
    const restored = copy(room); now += 55
    const reused = prepareBotPlay(restored, 'p1', { chooseCards: () => { throw Error('rerolled') } }, { now: () => now, random: () => { throw Error('resampled') } })
    assert.equal(reused.waitMs, Math.max(0, Math.min(budget, delay) - cost - 55)); assert.equal(choices, 1)
    assert.equal(reused.cards[0], restored.state.players.p1.hand[0]); timingCases++
  }
}
for (const match of [false, true]) for (const actor of ['human', 'bot', 'trustee']) for (const noTrustee of [false, true]) {
  for (const action of ['play', 'tribute', 'returnTribute', 'finishTribute']) {
    let time = 1000, timer = null
    const room = { roomId: '123456', state: { phase: 'playing' }, trustees: { p1: actor === 'trustee' ? {} : null },
      roomSettings: { turnSeconds: 30, trusteeSeconds: noTrustee ? 0 : 15 } }
    const clock = createTurnClock({ clearTurnTimer: () => { timer = null }, turnTimers: new Map(), ensureLiveMetadata: noop,
      deadlineStepFor: r => r.state.phase === 'playing' ? { playerId: 'p1', action } : null,
      isBotPlayer: () => actor === 'bot', isMatchRoom: () => match, friendSecondMs: 1000, turnTimeoutMs: 20000,
      now: () => time, scheduleTimeout: (callback, delay) => (timer = { callback, delay }), enqueueServerOperation: fn => fn(), automatedDeadline: noop, publishTurnStatus: noop })
    clock.armTurnDeadline(room)
    const disabled = !match && actor === 'human' && noTrustee
    if (disabled) { assert.equal(timer, null); assert.equal(room.turnDeadlineAt, null) }
    else {
      const budget = match ? 20000 : 30000; assert.equal(room.turnDeadlineAt, time + budget)
      if (actor === 'human') assert.equal(timer.delay, budget)
      else if (action === 'play') assert.equal(timer.delay, 0)
      else assert.ok([500, 1500].includes(timer.delay)) // current special-phase cosmetic RNG
      room.pendingBotPlay = { at: time + 2500 }; time += 500; clock.restoreTurnDeadline(room)
      assert.equal(timer.delay, actor === 'human' ? budget - 500 : 2000)
      assert.equal(room.turnDeadlineAt, 1000 + budget)
    }
    room.state.phase = 'settled'; clock.restoreTurnDeadline(room)
    assert.equal(timer, null); assert.equal(room.turnDeadlineAt, null); assert.equal(room.pendingBotPlay, null); clocks++
  }
}
// Public information adapter: opponents' actual faces are not read. Small legal fixtures,
// not full 27-card games, and unchanged fixed partnerships form the control.
for (const viewer of ids) for (const count of [1, 5, 10]) {
  const state = opening(friend(), 71); state.currentTurn = viewer
  ids.forEach(id => { state.players[id].hand = state.players[id].hand.slice(0, count) })
  const saved = copy(state), baseline = createRoomBotPolicy({ seed: 31 })
  const expected = baseline.chooseCards({ state, playerId: viewer })
  const concealed = copy(saved)
  ids.filter(id => id !== viewer).forEach(id => { concealed.players[id].hand = new Proxy(concealed.players[id].hand, {
    get(target, key) { assert.equal(key, 'length'); return target.length },
  }) })
  const observed = createRoomBotPolicy({ seed: 31 }).chooseCards({ state: concealed, playerId: viewer })
  assert.deepEqual(observed?.map(c => c.id), expected?.map(c => c.id)); assert.deepEqual(state, saved)
  const outcome = dispatchMatchIntent(saved, { type: 'PLAY_CARDS', playerId: viewer, cardIds: expected.map(c => c.id) })
  assert.equal(outcome.ok, true); hiddenViews++
}
// Real shuffled opening producer, not manually corrupted teams.
let changedDrawTables = 0, rejectedSeats = 0
let changedOpening
for (let seed = 1; seed <= 52; seed++) {
  const state = opening(friend({ format: 'rotating', levelMode: 'fixed', levelRank: 2, teamRotation: 'draw' }), seed)
  conserve(state)
  const changed = ids.some((id, i) => state.players[id].team !== (i % 2 ? 'teamB' : 'teamA'))
  if (!changed) continue
  changedDrawTables++; changedOpening ||= state
  for (const playerId of ids) {
    assert.throws(() => createRoomBotPolicy({ seed: 1 }).chooseCards({ state, playerId }), /队伍数据无效/)
    rejectedSeats++
  }
}
assert.ok(changedDrawTables > 0)
// Actual lifecycle / adapter / state transition; external persistence/publication and
// clocks are inert ports. No fake exception injected into bot or core decision code.
const lifecycleHarness = (state, actor, settings) => {
  let time = 10000, queue = Promise.resolve()
  const timers = new Map(), rooms = new Map(), closed = [], errors = []
  const room = { ...friend(settings), state: copy(state), teamLevels: copy(state.teamLevels), seats: Object.fromEntries(ids.map(id => [id, null])),
    roundSequence: state.roundId - 1, botPlayerIds: actor === 'bot' ? [state.currentTurn] : [],
    trustees: Object.fromEntries(ids.map(id => [id, actor === 'trustee' && id === state.currentTurn ? { reason: 'manual' } : null])),
    consecutiveTimeouts: Object.fromEntries(ids.map(id => [id, 0])) }
  rooms.set(room.roomId, room)
  const policy = createRoomBotPolicy({ seed: 19 })
  const lifecycle = createWeAppMatchLifecycle({ playerIds: ids, rooms, connections: new Map(), turnTimeoutMs: 20000, friendSecondMs: 1000,
    totalMinuteMs: 60000, isShuttingDown: () => false,
    enqueueServerOperation: fn => (queue = queue.then(fn)), ensureLiveMetadata: noop,
    isFriendRoom: () => true, isMatchRoom: () => false, isBotPlayer: (r, id) => r.botPlayerIds.includes(id),
    botPolicyForRoom: () => policy, existingBotPolicyForRoom: () => null, shuffleRandom: rng(13),
    persistRuntimeState: noop, commitRuntimeState: async () => {}, stagePendingSideEffects: noop, broadcast: noop, send: noop,
    phaseFor: () => 'playing', liveMetadataFor: () => ({}), publishTurnStatus: noop, publishState: noop, publishTribute: noop,
    publishRoundEnded: noop, recordRoomAction: noop, reportSpectatorEvent: noop, reportSpectatorAction: noop,
    reportSpectatorRoundEnd: noop, reportCompletedGame: noop,
    closeRoomWithoutAck: async (r, ...reasons) => { closed.push(reasons); rooms.delete(r.roomId) },
    log: { error: (...args) => errors.push(args) }, now: () => time,
    scheduleTimeout: (callback, delay) => { const handle = { unref() {} }; timers.set(handle, { callback, at: time + delay }); return handle },
    cancelTimeout: handle => timers.delete(handle),
  })
  return { room, lifecycle, closed, errors, rooms, async tick() {
    const entry = [...timers].sort((a, b) => a[1].at - b[1].at)[0]; assert.ok(entry, 'expected scheduled work')
    timers.delete(entry[0]); time = entry[1].at; entry[1].callback(); await queue
  } }
}
// Clockwise: first round uses original teams. The real next-round lifecycle produces
// different teams after an explicit synthetic settlement (not a played full round).
const clockwiseSettings = { format: 'rotating', teamRotation: 'clockwise', levelMode: 'fixed', levelRank: 2 }
const clockwise = lifecycleHarness(opening(friend(clockwiseSettings), 1), 'bot', clockwiseSettings)
const first = copy(clockwise.room.state); first.finishedPlayers = ['p1', 'p3']
clockwise.room.state = settleMatchState(first).state
clockwise.room.roundResult = clockwise.room.state.settlement; clockwise.room.roundSequence = 1
clockwise.lifecycle.prepareNextRound(clockwise.room); const second = copy(clockwise.room.state)
assert.equal(second.roundId, 2); assert.deepEqual(second.turnOrder, ['p3', 'p2', 'p4', 'p1']); conserve(second)
clockwise.lifecycle.dispose()
let failedLifecycleCases = 0, controlLifecycleCases = 0
for (const state of [changedOpening, second]) for (const actor of ['bot', 'trustee']) {
  for (const cold of [false, true]) {
    const canonical = cold ? migrateLegacyMatchState({ state: copy(state), ruleProfile: profile }) : state
    const h = lifecycleHarness(canonical, actor, { format: 'rotating', teamRotation: state.matchFormat.teamRotation })
    h.lifecycle.armTurnDeadline(h.room); const revision = h.room.state.revision
    await h.tick(); await h.tick(); await h.tick()
    assert.equal(h.room.state.revision, revision); assert.equal(h.errors.length, 3)
    assert.ok(h.errors.every(args => /队伍数据无效/.test(String(args.at(-1)))))
    assert.deepEqual(h.closed, [['automated-deadline-failed', 'roomDissolved', 'dissolved']])
    assert.equal(h.rooms.size, 0); h.lifecycle.dispose(); failedLifecycleCases++
  }
}
for (const settings of [{ format: 'rounds' }, clockwiseSettings]) for (const actor of ['bot', 'trustee']) {
  const h = lifecycleHarness(opening(friend(settings), 2), actor, settings)
  const revision = h.room.state.revision; h.lifecycle.armTurnDeadline(h.room)
  for (let n = 0; n < 3 && h.room.state.revision === revision; n++) await h.tick()
  assert.ok(h.room.state.revision > revision); assert.equal(h.errors.length, 0); assert.deepEqual(h.closed, [])
  h.lifecycle.dispose(); controlLifecycleCases++
}
console.log(JSON.stringify({ publicOpenings, friendSettings, clocks, timingCases, hiddenViews,
  drawSeeds: 52, changedDrawTables, rejectedSeats, failedLifecycleCases, controlLifecycleCases,
  finding: 'RP-13-001: valid rotated teams rejected by fixed-ID bot adapter; default three retries close room',
  limitations: 'Synthetic ports, no real WS/deployment; clockwise settlement manually supplied; seed counts are not population incidence.' }, null, 2))
