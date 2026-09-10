import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createWeAppMatchLifecycle } from './weapp-match-lifecycle.js'
import { formatForNewRoom } from './match-format-policy.js'
import './bot-turn-pacing.test.mjs'

const playerIds = ['p1', 'p2', 'p3', 'p4']
let clock = 10_000
let nextTimerId = 1
const timers = new Map()
const cancelled = []
const published = []
const rooms = new Map()
const scheduleTimeout = (callback, delay) => {
  const timer = { id: nextTimerId++, unref () {} }
  timers.set(timer, { callback, delay })
  return timer
}
const cancelTimeout = timer => {
  cancelled.push(timer.id)
  timers.delete(timer)
}
const ensureLiveMetadata = room => {
  room.trustees ||= Object.fromEntries(playerIds.map(id => [id, null]))
  room.consecutiveTimeouts ||= Object.fromEntries(playerIds.map(id => [id, 0]))
}

const lifecycle = createWeAppMatchLifecycle({
  playerIds,
  rooms,
  connections: new Map(),
  turnTimeoutMs: 20_000,
  friendSecondMs: 1_000,
  totalMinuteMs: 60_000,
  isShuttingDown: () => false,
  enqueueServerOperation: operation => Promise.resolve().then(operation),
  ensureLiveMetadata,
  isFriendRoom: () => true,
  isMatchRoom: () => false,
  isBotPlayer: () => false,
  botPolicyForRoom: () => { throw new Error('not used') },
  existingBotPolicyForRoom: () => null,
  dispatchMatchIntentImpl: state => ({
    ok: true,
    state: { ...state, phase: 'settled', revision: (state.revision ?? 0) + 1, settlement: nextSettlement },
    events: [{ type: 'ROUND_SETTLED', settlement: nextSettlement }],
  }),
  shuffleRandom: Math.random,
  persistRuntimeState: () => {},
  commitRuntimeState: async () => {},
  stagePendingSideEffects: () => {},
  broadcast: () => {},
  send: () => {},
  phaseFor: () => 'playing',
  liveMetadataFor: () => ({}),
  publishTurnStatus: () => published.push('turn'),
  publishState: () => {},
  publishTribute: () => {},
  publishRoundEnded: () => {},
  recordRoomAction: () => {},
  reportSpectatorEvent: () => {},
  reportSpectatorAction: () => {},
  reportSpectatorRoundEnd: () => {},
  reportCompletedGame: () => {},
  now: () => clock,
  scheduleTimeout,
  cancelTimeout,
})

const room = {
  roomId: '123456',
  state: { phase: 'playing', currentTurn: 'p2' },
  roomSettings: { rounds: 4, turnSeconds: 40, trusteeSeconds: 15, totalTimeMinutes: 20 },
  matchStartedAt: null,
  totalDeadlineAt: null,
  matchEnded: null,
  roundSequence: 0,
  scores: { teamA: 0, teamB: 0 },
  seats: { p1: null, p2: null, p3: null, p4: null },
}
rooms.set(room.roomId, room)

lifecycle.armTurnDeadline(room)
assert.equal(room.turnDeadlineAt, clock + 40_000)
assert.equal(room.deadlinePlayerId, 'p2')
assert.equal(room.deadlineAction, 'play')
assert.equal([...timers.values()][0].delay, 40_000)
assert.deepEqual(published, ['turn'])

const authoritativeDeadline = room.turnDeadlineAt
clock += 1_250
lifecycle.restoreTurnDeadline(room)
assert.equal(room.turnDeadlineAt, authoritativeDeadline, 'restart must preserve the persisted deadline')
assert.equal([...timers.values()][0].delay, 38_750)

lifecycle.armMatchDuration(room)
const matchDeadline = room.totalDeadlineAt
assert.equal(matchDeadline, clock + 20 * 60_000)
clock += 5_000
lifecycle.armMatchDuration(room)
assert.equal(room.totalDeadlineAt, matchDeadline, 'rearming must preserve the absolute match deadline')
assert.equal([...timers.values()].some(timer => timer.delay === matchDeadline - clock), true)

lifecycle.removeRoom(room.roomId)
assert.equal(timers.size, 0, 'removing a room must clear every owned timer')
assert.equal(cancelled.length >= 4, true)

let nextSettlement
const settleThroughAction = (target, result) => {
  nextSettlement = result
  ensureLiveMetadata(target)
  target.version ??= 1
  target.state = {
    ...target.state, scores: target.scores, lastRoundRank: [],
    teamLevels: { teamA: 2, teamB: 2 }, aFailStreaks: { teamA: 0, teamB: 0 },
  }
  lifecycle.applyPlayerAction(target, { type: 'PASS', playerId: 'p1' })
}
room.roundSequence = 3
room.scores = { teamA: 8, teamB: 3 }
room.matchEnded = null
settleThroughAction(room, { isGameWon: false, winnerTeam: 'teamA' })
assert.equal(room.roundSequence, 4)
assert.deepEqual(room.matchEnded, {
  reason: 'round-limit',
  endedAt: clock,
  roundsPlayed: 4,
  configuredRounds: 4,
  scores: { teamA: 8, teamB: 3 },
  winnerTeam: 'teamA',
})
assert.deepEqual(room.roundReady, { p1: false, p2: false, p3: false, p4: false })
const quickRoom = { ...room, roomId: '345678', entryKind: 'match', matchEnded: null, roundSequence: 0,
  state: { matchFormat: { kind: 'independent' } }, scores: { teamA: 0, teamB: 1 } }
settleThroughAction(quickRoom, { isGameWon: false, winnerTeam: 'teamB' })
assert.equal(quickRoom.matchEnded.reason, 'single-round')
assert.equal(quickRoom.matchEnded.configuredRounds, 1)
assert.equal(quickRoom.matchEnded.winnerTeam, 'teamB')
assert.equal(quickRoom.turnDeadlineAt, null)
assert.deepEqual(quickRoom.roundReady, { p1: false, p2: false, p3: false, p4: false })
const tournamentRoom = { ...quickRoom, roomId: '654321', matchMode: 'lingshui_16_cup', matchEnded: null, roundSequence: 0 }
tournamentRoom.state = { matchFormat: formatForNewRoom(tournamentRoom) }
settleThroughAction(tournamentRoom, { isGameWon: false, winnerTeam: 'teamA' })
assert.equal(tournamentRoom.matchEnded.reason, 'single-round', '赛事每桌一副结束，不等待过 A')
assert.equal(tournamentRoom.matchEnded.roundsPlayed, 1)
assert.equal(tournamentRoom.matchEnded.configuredRounds, 1)
const upgradeRoom = { ...room, roomId: '456789', roomSettings: { ...room.roomSettings, format: 'upgrade', totalTimeMinutes: 0 }, totalDeadlineAt: null, matchEnded: null, roundSequence: 32 }
settleThroughAction(upgradeRoom, { isGameWon: false, winnerTeam: 'teamA' })
assert.equal(upgradeRoom.matchEnded, null, '升级房第33局仍不触发定局终局')
lifecycle.dispose()

const runDeadlineFailureCase = async ({ bot = false, trustee = false, dispatchMatchIntentImpl, persistFailures = 0 } = {}) => {
  const persistenceCase = persistFailures > 0
  let failureCalls = 0
  const caseTimers = new Map()
  const closed = []
  const errors = []
  const broadcasts = []
  const caseRooms = new Map()
  const failingLifecycle = createWeAppMatchLifecycle({
    playerIds,
    rooms: caseRooms,
    connections: new Map(),
    turnTimeoutMs: 20_000,
    friendSecondMs: 1_000,
    totalMinuteMs: 60_000,
    automatedDeadlineMaxAttempts: 2,
    automatedDeadlineRetryBaseMs: 10,
    automatedDeadlineRetryMaxMs: 20,
    isShuttingDown: () => false,
    enqueueServerOperation: operation => Promise.resolve().then(operation).catch(error => {
      if (!/injected persistence failure/.test(error.message)) throw error
    }),
    ensureLiveMetadata,
    isFriendRoom: () => true,
    isMatchRoom: () => false,
    isBotPlayer: () => bot,
    botPolicyForRoom: () => ({ chooseCards: () => { failureCalls += 1; throw new Error('injected bot policy failure') } }),
    existingBotPolicyForRoom: () => null,
    dispatchMatchIntentImpl: dispatchMatchIntentImpl && ((...args) => { failureCalls += 1; return dispatchMatchIntentImpl(...args) }),
    shuffleRandom: Math.random,
    persistRuntimeState: () => {},
    commitRuntimeState: async () => {
      if (persistFailures > 0) { persistFailures -= 1; throw new Error('injected persistence failure') }
    },
    stagePendingSideEffects: () => {},
    broadcast: (target, type) => broadcasts.push(type),
    send: () => {},
    phaseFor: () => 'playing',
    liveMetadataFor: () => ({}),
    publishTurnStatus: () => {},
    publishState: () => {},
    publishTribute: () => {},
    publishRoundEnded: () => {},
    recordRoomAction: () => {},
    reportSpectatorEvent: () => {},
    reportSpectatorAction: () => {},
    reportSpectatorRoundEnd: () => {},
    reportCompletedGame: () => {},
    closeRoomWithoutAck: async (target, ...reasons) => { closed.push(reasons); caseRooms.delete(target.roomId) },
    log: { error: (...args) => errors.push(args) },
    now: () => clock,
    scheduleTimeout: (callback, delay) => { const timer = { unref () {} }; caseTimers.set(timer, { callback, delay }); return timer },
    cancelTimeout: timer => caseTimers.delete(timer),
  })
  const caseRoom = {
    roomId: bot ? '222222' : '333333',
    state: {
      phase: 'playing', currentTurn: 'p1', lastValidPlay: { type: 'Single' },
      players: Object.fromEntries(playerIds.map(id => [id, { hand: [{ id: `${id}-card` }] }])),
    },
    roomSettings: { rounds: 4, turnSeconds: 40, trusteeSeconds: 15, totalTimeMinutes: 0 },
    botPlayerIds: bot ? ['p1'] : [],
    trustees: Object.fromEntries(playerIds.map(id => [id, trustee && id === 'p1' ? { reason: 'manual', since: clock } : null])),
    consecutiveTimeouts: Object.fromEntries(playerIds.map(id => [id, 0])),
    seats: Object.fromEntries(playerIds.map(id => [id, null])),
    teamLevels: { teamA: 2, teamB: 2 },
    version: 1,
  }
  caseRooms.set(caseRoom.roomId, caseRoom)
  failingLifecycle.armTurnDeadline(caseRoom)
  const deadline = caseRoom.turnDeadlineAt
  try { await [...caseTimers.values()][0].callback() } catch (error) {
    if (!/persistence failure/.test(error.message)) throw error
  }
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(caseRoom.turnDeadlineAt, deadline, '首次异常必须保留同一权威 deadline')
  assert.equal([...caseTimers.values()][0].delay, 10, '首次异常必须按退避基数重试')
  await [...caseTimers.values()][0].callback()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(failureCalls, 2)
  if (!persistenceCase) {
    assert.deepEqual(closed, [['automated-deadline-failed', 'roomDissolved', 'dissolved']], '内部隔离原因与平台协议原因必须明确分离')
    assert.equal(caseRooms.has(caseRoom.roomId), false)
    assert.equal(errors.length, 2)
  }
  failingLifecycle.dispose()
  return { broadcasts, closed, failureCalls }
}

await runDeadlineFailureCase({ bot: true })
await runDeadlineFailureCase({ trustee: true }) // A trustee must use the bot policy, never the default PASS branch.
await runDeadlineFailureCase({ dispatchMatchIntentImpl: () => { throw new Error('injected rule failure') } })
const durableRetry = await runDeadlineFailureCase({
  dispatchMatchIntentImpl: state => ({
    ok: true,
    state: { ...state, revision: 2, currentTurn: 'p2', teamLevels: { teamA: 2, teamB: 2 }, aFailStreaks: { teamA: 0, teamB: 0 }, scores: { teamA: 0, teamB: 0 }, lastRoundRank: [], settlement: null },
    events: [],
  }),
  persistFailures: 1,
})
assert.deepEqual(durableRetry.closed, [], '持久化异常不得消耗动作异常预算或关闭房间')
assert.equal(durableRetry.failureCalls, 2, '持久化失败后必须从同一 deadline 重试动作')
assert.deepEqual(durableRetry.broadcasts, ['turnTimedOut'], '安全落盘前不得广播自动动作')

const rootSource = readFileSync(new URL('./weapp-ws.js', import.meta.url), 'utf8')
assert.doesNotMatch(rootSource, /const turnTimers = new Map/)
assert.doesNotMatch(rootSource, /const matchDurationTimers = new Map/)
assert.doesNotMatch(rootSource, /const roundFinalizationTimers = new Map/)

console.log('weapp match lifecycle tests passed')
