import assert from 'node:assert/strict'
import {
  FIXED_LATIN_PLAYER_COUNT,
  FIXED_LATIN_PLAYERS_PER_TABLE,
  FIXED_LATIN_ROUND_COUNT,
  FIXED_LATIN_TABLE_COUNT,
  createFixed16LatinPairings,
} from './tournament-pairing.js'

const userIds = Array.from({ length: FIXED_LATIN_PLAYER_COUNT }, (_, index) => `usr_${String(index + 1).padStart(2, '0')}`)
const originalUserIds = [...userIds]
const schedule = createFixed16LatinPairings(userIds)

assert.deepEqual(userIds, originalUserIds, '编排不得修改输入名单')
assert.equal(schedule.format, 'fixed16-latin-3')
assert.match(schedule.rosterKey, /^[a-f0-9]{16}$/)
assert.deepEqual(schedule.userIds, userIds)
assert.equal(schedule.rounds.length, FIXED_LATIN_ROUND_COUNT)

const assignmentIds = new Set()
const encounteredPairs = new Set()
for (const [roundIndex, round] of schedule.rounds.entries()) {
  assert.equal(round.round, roundIndex + 1)
  assert.equal(round.assignments.length, FIXED_LATIN_TABLE_COUNT)

  const usersInRound = []
  for (const [tableIndex, assignment] of round.assignments.entries()) {
    assert.equal(assignment.round, round.round)
    assert.equal(assignment.table, tableIndex + 1)
    assert.equal(assignment.userIds.length, FIXED_LATIN_PLAYERS_PER_TABLE)
    assert.match(assignment.assignmentId, new RegExp(`^tpa_${schedule.rosterKey}_r${round.round}_t${assignment.table}$`))
    assert.equal(assignmentIds.has(assignment.assignmentId), false, '每张桌必须有唯一 assignmentId')
    assignmentIds.add(assignment.assignmentId)
    usersInRound.push(...assignment.userIds)

    for (let left = 0; left < assignment.userIds.length; left += 1) {
      for (let right = left + 1; right < assignment.userIds.length; right += 1) {
        const pair = [assignment.userIds[left], assignment.userIds[right]].sort().join(':')
        assert.equal(encounteredPairs.has(pair), false, `三轮内不得重复同桌：${pair}`)
        encounteredPairs.add(pair)
      }
    }
  }

  assert.equal(usersInRound.length, FIXED_LATIN_PLAYER_COUNT)
  assert.deepEqual([...usersInRound].sort(), [...userIds].sort(), '每名玩家每轮必须恰好出现一次')
}

assert.equal(assignmentIds.size, FIXED_LATIN_ROUND_COUNT * FIXED_LATIN_TABLE_COUNT)
assert.equal(encounteredPairs.size, FIXED_LATIN_ROUND_COUNT * FIXED_LATIN_TABLE_COUNT * 6)
assert.deepEqual(createFixed16LatinPairings([...userIds]), schedule, '相同种子名单必须生成完全稳定的编排')

const reordered = [...userIds]
;[reordered[0], reordered[1]] = [reordered[1], reordered[0]]
const reorderedSchedule = createFixed16LatinPairings(reordered)
assert.notEqual(reorderedSchedule.rosterKey, schedule.rosterKey, '输入顺序是稳定种子的一部分')

assert.throws(() => createFixed16LatinPairings(null), /userIds 数组/)
assert.throws(() => createFixed16LatinPairings(userIds.slice(0, 15)), /恰好包含 16 名玩家/)
assert.throws(() => createFixed16LatinPairings([...userIds, 'usr_17']), /恰好包含 16 名玩家/)
assert.throws(() => createFixed16LatinPairings(userIds.map((id, index) => index === 0 ? '' : id)), /userIds\[0\]/)
assert.throws(() => createFixed16LatinPairings(userIds.map((id, index) => index === 0 ? ' usr_01' : id)), /userIds\[0\]/)
assert.throws(() => createFixed16LatinPairings(userIds.map((id, index) => index === 0 ? 1 : id)), /userIds\[0\]/)
assert.throws(() => createFixed16LatinPairings(userIds.map((id, index) => index === 15 ? userIds[0] : id)), /重复 userId/)

console.log('fixed 16-player Latin tournament pairing tests passed')
