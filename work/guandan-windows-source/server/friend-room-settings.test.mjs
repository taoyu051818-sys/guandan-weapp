import assert from 'node:assert/strict'
import {
  adjustDoubleDownSettlement,
  DEFAULT_FRIEND_ROOM_SETTINGS,
  hasReachedRoundLimit,
  normalizeFriendRoomSettings,
  spectatorPolicyFor,
} from './friend-room-settings.js'

assert.deepEqual(normalizeFriendRoomSettings(undefined, { strict: true }), DEFAULT_FRIEND_ROOM_SETTINGS)

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
  [{ turnSeconds: 30 }, /turnSeconds/],
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

process.stdout.write('friend room settings validation tests passed\n')
