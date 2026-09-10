import assert from 'node:assert/strict'
import { createTurnClock } from './weapp-turn-clock.js'
import { createRoomOpeningState, formatForNewRoom, isSingleRoundMatch } from './match-format-policy.js'
import { createRequire } from 'node:module'
const { getRuleProfile } = createRequire(import.meta.url)('../../../shared-core/dist')
import {
  adjustDoubleDownSettlement,
  DEFAULT_FRIEND_ROOM_SETTINGS,
  hasReachedRoundLimit,
  normalizeFriendRoomSettings,
  spectatorPolicyFor,
} from './friend-room-settings.js'

assert.deepEqual(normalizeFriendRoomSettings(undefined, { strict: true }), DEFAULT_FRIEND_ROOM_SETTINGS)
assert.equal(DEFAULT_FRIEND_ROOM_SETTINGS.turnSeconds, 20, 'new rooms default to a 20-second first turn')
assert.equal(normalizeFriendRoomSettings({ turnSeconds: 40 }, { strict: true }).turnSeconds, 40, 'existing explicit settings remain valid')
for (const turnSeconds of [15, 30]) assert.equal(normalizeFriendRoomSettings({ turnSeconds }, { strict: true }).turnSeconds, turnSeconds)
assert.equal(normalizeFriendRoomSettings({ counterEnabled: false }, { strict: true }).counterEnabled, false)
assert.equal(normalizeFriendRoomSettings({ disableVoice: true }, { strict: true }).disableVoice, true)
assert.equal(normalizeFriendRoomSettings({ format: 'upgrade', upgradeTarget: 6 }, { strict: true }).upgradeTarget, 6)
assert.throws(() => normalizeFriendRoomSettings({ format: 'rounds', upgradeTarget: 6 }, { strict: true }), /升级目标/)

// Actual scheduler policy: no-trustee must not execute even one automatic human move.
{
  let scheduled = 0
  let duration = 0
  let bot = false
  const timers = new Map()
  const room = { roomId: 'clock-test', roomSettings: { trusteeSeconds: 0 }, trustees: {} }
  const clock = createTurnClock({
    clearTurnTimer: id => timers.delete(id), turnTimers: timers, ensureLiveMetadata: () => {},
    deadlineStepFor: () => ({ playerId: 'p1', action: 'play' }), isBotPlayer: () => bot,
    isMatchRoom: () => false, botActionDelayMs: 1000, friendSecondMs: 1000,
    trusteeActionDelayMs: 1000, turnTimeoutMs: 20000, now: () => 100,
    scheduleTimeout: (_callback, delay) => { scheduled++; duration = delay; return scheduled },
    enqueueServerOperation: callback => callback(), automatedDeadline: () => {}, publishTurnStatus: () => {},
  })
  clock.armTurnDeadline(room)
  assert.equal(room.turnDeadlineAt, null)
  assert.equal(room.deadlinePlayerId, 'p1', 'manual tribute/start permission still needs the action owner')
  clock.restoreTurnDeadline(room)
  assert.equal(scheduled, 0, 'recovery must not revive an automatic move')
  bot = true
  clock.armTurnDeadline(room)
  assert.equal(scheduled, 1, 'robot seats still play')
  bot = false
  room.roomSettings = { trusteeSeconds: 15, turnSeconds: 30 }
  clock.armTurnDeadline(room)
  assert.equal(duration, 30000)
  assert.equal(room.turnDeadlineAt, 30100)
}

const canonical = normalizeFriendRoomSettings({
  mode: 'classic',
  rounds: 12,
  scoring: 'double-4',
  scoreVisibility: 'hidden',
  turnSeconds: 60,
  trusteeSeconds: 0,
  totalTimeMinutes: 20,
  spectator: 'delayed-round',
  autoSort: false,
  disableInteraction: true,
  sortOrder: 'asc',
  authoritativeValidation: true,
}, { strict: true })
assert.deepEqual(canonical, {
  mode: 'classic',
  rounds: 12,
  scoring: 'double-4',
  scoreVisibility: 'hidden',
  turnSeconds: 60,
  trusteeSeconds: 0,
  totalTimeMinutes: 20,
  spectator: 'delayed-round',
  autoSort: false,
  disableInteraction: true,
  sortOrder: 'asc',
  authoritativeValidation: true,
})
assert.equal(normalizeFriendRoomSettings({ rounds: 20 }, { strict: true }).rounds, 20)
assert.equal(normalizeFriendRoomSettings({ rounds: 32 }, { strict: true }).rounds, 32)
assert.equal(hasReachedRoundLimit(3, normalizeFriendRoomSettings({ rounds: 4 })), false)
assert.equal(hasReachedRoundLimit(4, normalizeFriendRoomSettings({ rounds: 4 })), true)
assert.deepEqual(spectatorPolicyFor(canonical), { mode: 'delayed-round', allowed: true, delayRounds: 1 })

const legacy = normalizeFriendRoomSettings({
  mode: 'classic',
  rounds: 'custom',
  customRoundCount: 16,
  doubleDownPoints: 4,
  scoreVisible: false,
  firstPlaySeconds: 20,
  trusteeSeconds: 'none',
  totalDurationMinutes: null,
  spectator: 'realtime',
  oneClickSort: true,
  disableChat: true,
  sortOrder: 'desc',
  authoritativeValidation: true,
}, { strict: true })
assert.deepEqual(legacy, {
  mode: 'classic',
  rounds: 16,
  scoring: 'double-4',
  scoreVisibility: 'hidden',
  turnSeconds: 20,
  trusteeSeconds: 0,
  totalTimeMinutes: 0,
  spectator: 'live',
  autoSort: true,
  disableInteraction: true,
  sortOrder: 'desc',
  authoritativeValidation: true,
}, '旧字段只应作为输入别名，归一化后不得继续广播')

for (const [patch, pattern] of [
  [{ mode: 'dou-dizhu' }, /mode/],
  [{ rounds: 0 }, /rounds/],
  [{ rounds: 5 }, /rounds/],
  [{ rounds: 36 }, /rounds/],
  [{ rounds: '12' }, /rounds/],
  [{ scoring: 'double-2' }, /scoring/],
  [{ scoring: 4 }, /scoring/],
  [{ scoreVisibility: 'realtime' }, /scoreVisibility/],
  [{ turnSeconds: 25 }, /turnSeconds/],
  [{ counterEnabled: 'false' }, /counterEnabled/],
  [{ disableVoice: 1 }, /disableVoice/],
  [{ trusteeSeconds: 10 }, /trusteeSeconds/],
  [{ totalTimeMinutes: 5 }, /totalTimeMinutes/],
  [{ totalTimeMinutes: null }, /totalTimeMinutes/],
  [{ totalTimeMinutes: 120 }, /totalTimeMinutes/],
  [{ spectator: 'public' }, /spectator/],
  [{ autoSort: 'yes' }, /autoSort/],
  [{ disableInteraction: 1 }, /disableInteraction/],
  [{ sortOrder: 'random' }, /sortOrder/],
  [{ authoritativeValidation: false }, /authoritativeValidation/],
  [{ injectedSetting: true }, /不支持字段/],
]) {
  assert.throws(() => normalizeFriendRoomSettings(patch, { strict: true }), pattern)
}

const state = {
  players: {
    p1: { team: 'teamA' },
    p2: { team: 'teamB' },
    p3: { team: 'teamA' },
    p4: { team: 'teamB' },
  },
}
const originalResult = {
  winnerTeam: 'teamA',
  levelUp: 3,
  currentLevel: 5,
  teamLevels: { teamA: 5, teamB: 2 },
  aFailStreaks: { teamA: 0, teamB: 0 },
  fullRank: ['p1', 'p3', 'p2', 'p4'],
  isGameWon: false,
  message: '本局升级 3 级。',
}
const fourPointResult = adjustDoubleDownSettlement({
  result: originalResult,
  state,
  previousTeamLevels: { teamA: 2, teamB: 2 },
  roomSettings: canonical,
})
assert.equal(fourPointResult.levelUp, 4)
assert.equal(fourPointResult.currentLevel, 6)
assert.equal(fourPointResult.teamLevels.teamA, 6)
assert.equal(originalResult.levelUp, 3, '设置修正不能原地污染共享规则核返回值')

for (const rounds of [1, 4, 8, 12, 5, 32]) {
  const settings = normalizeFriendRoomSettings({ format: 'rounds', rounds }, { strict: true })
  assert.equal(settings.rounds, rounds)
  assert.equal(settings.levelMode, 'random')
  assert.equal(settings.tributeEnabled, false)
  assert.equal(hasReachedRoundLimit(rounds, settings), true)
}
const upgrade = normalizeFriendRoomSettings({ format: 'upgrade', tributeEnabled: false }, { strict: true })
assert.equal(hasReachedRoundLimit(50, upgrade), false, '传统升级不受隐藏局数上限影响')
assert.equal(formatForNewRoom({ entryKind: 'friend', roomSettings: upgrade }).kind, 'upgrade')
for (const patch of [{ format: 'rounds', tributeEnabled: true }, { format: 'upgrade', levelMode: 'random' }, { format: 'rounds', levelRank: 'joker' }]) {
  assert.throws(() => normalizeFriendRoomSettings(patch, { strict: true }))
}
for (const mode of ['quick', 'classic_50', 'classic_300', 'classic_2000', 'classic_10000', 'lingshui_16_cup']) {
  const opening = createRoomOpeningState({ entryKind: 'match', matchMode: mode }, getRuleProfile('classic'), () => 0.99, () => false)
  assert.equal(opening.currentLevel, 'A')
  assert.deepEqual(opening.teamLevels, { teamA: 'A', teamB: 'A' })
  assert.equal(isSingleRoundMatch({ entryKind: 'match', state: opening }), true)
  assert.equal(Object.values(opening.players).flatMap(player => player.hand).length, 108)
  assert.deepEqual(JSON.parse(JSON.stringify(opening)).matchFormat, opening.matchFormat, '房间快照保存已经确定的赛制和级牌')
}
for (const mode of [undefined, 'tournament']) assert.equal(formatForNewRoom({ entryKind: 'match', matchMode: mode }), undefined)
const fixed = normalizeFriendRoomSettings({ format: 'rounds', rounds: 1, levelMode: 'fixed', levelRank: 'K' }, { strict: true })
assert.equal(createRoomOpeningState({ entryKind: 'friend', roomSettings: fixed }, getRuleProfile('classic'), Math.random, () => false).currentLevel, 'K')

process.stdout.write('friend room settings validation tests passed\n')
