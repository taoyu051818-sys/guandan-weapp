import assert from 'node:assert/strict'
import {
  blockTournamentAssignment,
  checkInFixedTournamentRun,
  completeTournamentAssignment,
  createFixedTournamentRun,
  getCurrentTournamentAssignment,
  markTournamentAssignmentMatched,
} from './tournament-orchestrator.js'

const tournament = { id: 'weekend-fixed-16', roundsTotal: 3 }
const userIds = Array.from({ length: 16 }, (_, index) => `usr_${String(index + 1).padStart(2, '0')}`)

const createCheckedInRun = () => {
  let run = createFixedTournamentRun(tournament, 1_000)
  userIds.forEach((userId, index) => {
    run = checkInFixedTournamentRun(run, userId, 1_100 + index)
  })
  return run
}

const matchRound = (run, round, baseTime) => {
  let next = run
  for (const assignment of next.rounds[round - 1].assignments) {
    next = markTournamentAssignmentMatched(next, assignment.assignmentId, `match-r${round}-t${assignment.table}`, baseTime + assignment.table)
  }
  return next
}

const completeRound = (run, round, baseTime) => {
  let next = matchRound(run, round, baseTime)
  for (const assignment of next.rounds[round - 1].assignments) {
    next = completeTournamentAssignment(next, assignment.assignmentId, `match-r${round}-t${assignment.table}`, baseTime + 10 + assignment.table)
  }
  return next
}

let run = createFixedTournamentRun(tournament, 1_000)
const pristine = structuredClone(run)
run = checkInFixedTournamentRun(run, userIds[0], 1_100)
assert.deepEqual(pristine.checkedInUserIds, [], '状态操作不得修改输入 run')
assert.strictEqual(checkInFixedTournamentRun(run, userIds[0], 1_101), run, '重复签到必须幂等')
for (let index = 1; index < userIds.length; index += 1) {
  run = checkInFixedTournamentRun(run, userIds[index], 1_100 + index)
}

assert.equal(run.phase, 'round-active')
assert.equal(run.currentRound, 1)
assert.equal(run.checkedInUserIds.length, 16)
assert.equal(run.rounds.length, 3)
assert.ok(run.rounds[0].assignments.every(item => item.status === 'matching'))
assert.ok(run.rounds.slice(1).flatMap(round => round.assignments).every(item => item.status === 'pending'))
assert.deepEqual(getCurrentTournamentAssignment(run, userIds[0]).userIds.includes(userIds[0]), true)
assert.throws(() => checkInFixedTournamentRun(run, 'usr_17', 2_000), error => error.code === 'ROSTER_LOCKED')
assert.throws(
  () => markTournamentAssignmentMatched(run, 'missing-assignment', 'missing-match', 2_001),
  error => error.code === 'ASSIGNMENT_NOT_FOUND',
)
assert.throws(
  () => markTournamentAssignmentMatched(run, run.rounds[1].assignments[0].assignmentId, 'future-match', 2_002),
  error => error.code === 'WRONG_ROUND',
)

run = matchRound(run, 1, 2_000)
const firstRound = run.rounds[0].assignments
assert.strictEqual(markTournamentAssignmentMatched(run, firstRound[0].assignmentId, 'match-r1-t1', 2_100), run, '重复匹配绑定必须幂等')
assert.throws(
  () => completeTournamentAssignment(run, firstRound[0].assignmentId, 'wrong-match', 2_110),
  error => error.code === 'MATCH_MISMATCH',
)

run = completeTournamentAssignment(run, firstRound[0].assignmentId, 'match-r1-t1', 2_111)
run = completeTournamentAssignment(run, firstRound[1].assignmentId, 'match-r1-t2', 2_112)
run = completeTournamentAssignment(run, firstRound[2].assignmentId, 'match-r1-t3', 2_113)
assert.equal(run.currentRound, 1, '第 3 桌完成时不得推进轮次')
assert.ok(run.rounds[1].assignments.every(item => item.status === 'pending'))

run = completeTournamentAssignment(run, firstRound[3].assignmentId, 'match-r1-t4', 2_114)
assert.equal(run.currentRound, 2, '第 4 桌完成时必须推进到下一轮')
assert.ok(run.rounds[1].assignments.every(item => item.status === 'matching'))
const afterRoundOne = run
run = completeTournamentAssignment(run, firstRound[3].assignmentId, 'match-r1-t4', 2_115)
assert.strictEqual(run, afterRoundOne, '重复完成最后一桌不得重复推进')
assert.throws(
  () => completeTournamentAssignment(run, firstRound[3].assignmentId, 'other-match', 2_116),
  error => error.code === 'MATCH_MISMATCH',
)

run = completeRound(run, 2, 3_000)
assert.equal(run.currentRound, 3)
assert.equal(run.phase, 'round-active')
run = completeRound(run, 3, 4_000)
assert.equal(run.phase, 'finished')
assert.equal(run.currentRound, 3)
assert.equal(run.finishedAt, 4_014)
assert.ok(run.rounds.flatMap(round => round.assignments).every(item => item.status === 'completed'))
assert.equal(getCurrentTournamentAssignment(run, userIds[0]), null)

let blockedRun = createCheckedInRun()
const blockedAssignment = blockedRun.rounds[0].assignments[0]
blockedRun = markTournamentAssignmentMatched(blockedRun, blockedAssignment.assignmentId, 'match-blocked', 5_000)
blockedRun = blockTournamentAssignment(blockedRun, blockedAssignment.assignmentId, 'match-blocked', '牌局服不可恢复', 5_100)
assert.equal(blockedRun.phase, 'blocked')
assert.equal(blockedRun.blockedAssignmentId, blockedAssignment.assignmentId)
assert.equal(getCurrentTournamentAssignment(blockedRun, blockedAssignment.userIds[0]).status, 'blocked')
assert.strictEqual(
  blockTournamentAssignment(blockedRun, blockedAssignment.assignmentId, 'match-blocked', '牌局服不可恢复', 5_101),
  blockedRun,
  '重复阻塞必须幂等',
)
assert.throws(
  () => blockTournamentAssignment(blockedRun, blockedAssignment.assignmentId, 'other-match', '牌局服不可恢复', 5_102),
  error => error.code === 'MATCH_MISMATCH',
)
assert.throws(
  () => completeTournamentAssignment(blockedRun, blockedAssignment.assignmentId, 'match-blocked', 5_103),
  error => error.code === 'RUN_NOT_ACTIVE',
)

assert.throws(() => createFixedTournamentRun({ id: 'five-rounds', roundsTotal: 5 }, 0), error => error.code === 'INVALID_TOURNAMENT_FORMAT')
assert.throws(() => createFixedTournamentRun(tournament, -1), error => error.code === 'INVALID_TIME')

console.log('fixed tournament orchestrator tests passed')
