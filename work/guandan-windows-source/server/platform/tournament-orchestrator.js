import {
  FIXED_LATIN_PLAYER_COUNT,
  FIXED_LATIN_ROUND_COUNT,
  FIXED_LATIN_TABLE_COUNT,
  createFixed16LatinPairings,
} from './tournament-pairing.js'

const RUN_PHASES = new Set(['check-in', 'round-active', 'blocked', 'finished'])
const ASSIGNMENT_STATUSES = new Set(['pending', 'matching', 'matched', 'completed', 'blocked'])

export class TournamentOrchestratorError extends Error {
  constructor (code, message) {
    super(message)
    this.name = 'TournamentOrchestratorError'
    this.code = code
  }
}

const fail = (code, message) => { throw new TournamentOrchestratorError(code, message) }
const clone = value => structuredClone(value)

const requireString = (value, field, maximum = 128) => {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > maximum) {
    fail('INVALID_ARGUMENT', `${field} 必须是 1 到 ${maximum} 字符、不含首尾空白的字符串`)
  }
  return value
}

const requireTimestamp = (value, field = 'now') => {
  if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_TIME', `${field} 必须是非负安全整数时间戳`)
  return value
}

const requireTournament = (tournament) => {
  if (!tournament || typeof tournament !== 'object' || Array.isArray(tournament)) {
    fail('INVALID_TOURNAMENT', 'tournament 必须是对象')
  }
  const tournamentId = requireString(tournament.id, 'tournament.id')
  if (tournament.roundsTotal !== undefined && Number(tournament.roundsTotal) !== FIXED_LATIN_ROUND_COUNT) {
    fail('INVALID_TOURNAMENT_FORMAT', `固定 Latin 赛事必须配置 ${FIXED_LATIN_ROUND_COUNT} 轮`)
  }
  return tournamentId
}

const assignmentList = run => run.rounds.flatMap(round => round.assignments)

const validateLockedRun = (run) => {
  if (run.checkedInUserIds.length !== FIXED_LATIN_PLAYER_COUNT || !Number.isSafeInteger(run.rosterLockedAt)) {
    fail('INVALID_RUN', '已锁定赛事必须包含完整签到名单和锁定时间')
  }
  const expected = createFixed16LatinPairings(run.checkedInUserIds)
  if (run.rosterKey !== expected.rosterKey || run.rounds.length !== FIXED_LATIN_ROUND_COUNT) {
    fail('INVALID_RUN', '赛事名单摘要或轮次数无效')
  }
  if (!Number.isInteger(run.currentRound) || run.currentRound < 1 || run.currentRound > FIXED_LATIN_ROUND_COUNT) {
    fail('INVALID_RUN', '已锁定赛事的 currentRound 无效')
  }

  const ids = new Set()
  run.rounds.forEach((round, roundIndex) => {
    const expectedRound = expected.rounds[roundIndex]
    if (!round || round.round !== expectedRound.round || !Array.isArray(round.assignments) || round.assignments.length !== FIXED_LATIN_TABLE_COUNT) {
      fail('INVALID_RUN', `第 ${roundIndex + 1} 轮状态无效`)
    }
    round.assignments.forEach((assignment, tableIndex) => {
      const expectedAssignment = expectedRound.assignments[tableIndex]
      if (!assignment || assignment.assignmentId !== expectedAssignment.assignmentId || assignment.round !== expectedAssignment.round || assignment.table !== expectedAssignment.table) {
        fail('INVALID_RUN', `第 ${roundIndex + 1} 轮第 ${tableIndex + 1} 桌标识无效`)
      }
      if (!Array.isArray(assignment.userIds) || assignment.userIds.length !== 4 || assignment.userIds.some((id, index) => id !== expectedAssignment.userIds[index])) {
        fail('INVALID_RUN', `第 ${roundIndex + 1} 轮第 ${tableIndex + 1} 桌名单无效`)
      }
      if (!ASSIGNMENT_STATUSES.has(assignment.status) || ids.has(assignment.assignmentId)) {
        fail('INVALID_RUN', `第 ${roundIndex + 1} 轮第 ${tableIndex + 1} 桌状态无效`)
      }
      ids.add(assignment.assignmentId)
      if (assignment.matchId !== null && assignment.matchId !== undefined) requireString(assignment.matchId, 'assignment.matchId')
      if (['matched', 'completed', 'blocked'].includes(assignment.status) && !assignment.matchId) {
        fail('INVALID_RUN', `${assignment.assignmentId} 缺少绑定 matchId`)
      }
      if (assignment.status === 'matching' && assignment.matchId) {
        fail('INVALID_RUN', `${assignment.assignmentId} 尚未匹配却已有 matchId`)
      }
    })
  })

  const allAssignments = assignmentList(run)
  const blockedAssignments = allAssignments.filter(assignment => assignment.status === 'blocked')
  if (run.phase === 'blocked') {
    if (blockedAssignments.length !== 1 || run.blockedAssignmentId !== blockedAssignments[0].assignmentId) {
      fail('INVALID_RUN', 'blocked 赛事必须且只能绑定一张受阻牌桌')
    }
  } else if (blockedAssignments.length) {
    fail('INVALID_RUN', '非 blocked 赛事不能包含受阻牌桌')
  }
  if (run.phase === 'finished' && allAssignments.some(assignment => assignment.status !== 'completed')) {
    fail('INVALID_RUN', 'finished 赛事必须完成全部牌桌')
  }
}

const validateRun = (run) => {
  if (!run || typeof run !== 'object' || Array.isArray(run)) fail('INVALID_RUN', 'run 必须是对象')
  requireString(run.tournamentId, 'run.tournamentId')
  requireTimestamp(run.createdAt, 'run.createdAt')
  if (run.format !== 'fixed16-latin-3' || !RUN_PHASES.has(run.phase)) fail('INVALID_RUN', 'run 格式或 phase 无效')
  if (!Array.isArray(run.checkedInUserIds) || run.checkedInUserIds.length > FIXED_LATIN_PLAYER_COUNT || new Set(run.checkedInUserIds).size !== run.checkedInUserIds.length) {
    fail('INVALID_RUN', '签到名单无效')
  }
  run.checkedInUserIds.forEach((userId, index) => requireString(userId, `checkedInUserIds[${index}]`))
  if (!Array.isArray(run.rounds)) fail('INVALID_RUN', 'run.rounds 必须是数组')

  if (run.phase === 'check-in') {
    if (run.checkedInUserIds.length >= FIXED_LATIN_PLAYER_COUNT || run.currentRound !== 0 || run.rounds.length !== 0 || run.rosterKey !== null || run.rosterLockedAt !== null) {
      fail('INVALID_RUN', 'check-in 赛事不能包含已锁定编排')
    }
    return run
  }
  validateLockedRun(run)
  return run
}

const findAssignment = (run, assignmentId) => {
  const safeAssignmentId = requireString(assignmentId, 'assignmentId')
  const assignment = assignmentList(run).find(item => item.assignmentId === safeAssignmentId)
  if (!assignment) fail('ASSIGNMENT_NOT_FOUND', '赛事牌桌 assignment 不存在')
  return assignment
}

const ensureCurrentRound = (run, assignment) => {
  if (assignment.round !== run.currentRound) {
    fail('WRONG_ROUND', `assignment 属于第 ${assignment.round} 轮，当前为第 ${run.currentRound} 轮`)
  }
}

const replaceAssignment = (run, replacement) => ({
  ...run,
  rounds: run.rounds.map(round => round.round !== replacement.round
    ? round
    : { ...round, assignments: round.assignments.map(item => item.assignmentId === replacement.assignmentId ? replacement : item) }),
})

const activateRound = (run, roundNumber, now) => ({
  ...run,
  currentRound: roundNumber,
  rounds: run.rounds.map(round => round.round !== roundNumber
    ? round
    : {
        ...round,
        activatedAt: now,
        assignments: round.assignments.map(assignment => ({ ...assignment, status: 'matching' })),
      }),
})

export const createFixedTournamentRun = (tournament, now) => ({
  format: 'fixed16-latin-3',
  tournamentId: requireTournament(tournament),
  phase: 'check-in',
  createdAt: requireTimestamp(now),
  checkedInUserIds: [],
  rosterKey: null,
  rosterLockedAt: null,
  currentRound: 0,
  rounds: [],
  blockedAssignmentId: null,
  blockedReason: null,
  blockedAt: null,
  finishedAt: null,
})

export const checkInFixedTournamentRun = (run, userId, now) => {
  validateRun(run)
  const safeUserId = requireString(userId, 'userId')
  const timestamp = requireTimestamp(now)
  if (run.checkedInUserIds.includes(safeUserId)) return run
  if (run.phase !== 'check-in') fail('ROSTER_LOCKED', '赛事签到名单已经锁定')

  const next = { ...run, checkedInUserIds: [...run.checkedInUserIds, safeUserId] }
  if (next.checkedInUserIds.length < FIXED_LATIN_PLAYER_COUNT) return next

  const schedule = createFixed16LatinPairings(next.checkedInUserIds)
  const locked = {
    ...next,
    phase: 'round-active',
    rosterKey: schedule.rosterKey,
    rosterLockedAt: timestamp,
    currentRound: 1,
    rounds: schedule.rounds.map(round => ({
      round: round.round,
      activatedAt: round.round === 1 ? timestamp : null,
      completedAt: null,
      assignments: round.assignments.map(assignment => ({
        ...assignment,
        status: round.round === 1 ? 'matching' : 'pending',
        matchId: null,
        matchedAt: null,
        completedAt: null,
        blockedAt: null,
        blockedReason: null,
      })),
    })),
  }
  validateRun(locked)
  return locked
}

export const getCurrentTournamentAssignment = (run, userId) => {
  validateRun(run)
  const safeUserId = requireString(userId, 'userId')
  if (run.phase === 'check-in' || run.phase === 'finished') return null
  const round = run.rounds.find(item => item.round === run.currentRound)
  const assignment = round?.assignments.find(item => item.userIds.includes(safeUserId)) || null
  return assignment ? clone(assignment) : null
}

export const markTournamentAssignmentMatched = (run, assignmentId, matchId, now) => {
  validateRun(run)
  const assignment = findAssignment(run, assignmentId)
  const safeMatchId = requireString(matchId, 'matchId')
  const timestamp = requireTimestamp(now)

  if (assignment.status === 'matched' || assignment.status === 'completed') {
    if (assignment.matchId !== safeMatchId) fail('MATCH_MISMATCH', 'assignment 已绑定其他 matchId')
    return run
  }
  if (assignment.status === 'blocked') {
    if (assignment.matchId !== safeMatchId) fail('MATCH_MISMATCH', 'assignment 已绑定其他 matchId')
    fail('ASSIGNMENT_BLOCKED', '受阻牌桌不能重新标记为 matched')
  }
  if (run.phase !== 'round-active') fail('RUN_NOT_ACTIVE', '赛事当前不能接收匹配结果')
  ensureCurrentRound(run, assignment)
  if (assignment.status !== 'matching') fail('INVALID_ASSIGNMENT_STATE', '只有 matching 牌桌可以绑定比赛')

  const updated = {
    ...assignment,
    status: 'matched',
    matchId: safeMatchId,
    matchedAt: timestamp,
  }
  return replaceAssignment(run, updated)
}

export const completeTournamentAssignment = (run, assignmentId, matchId, now) => {
  validateRun(run)
  const assignment = findAssignment(run, assignmentId)
  const safeMatchId = requireString(matchId, 'matchId')
  const timestamp = requireTimestamp(now)

  if (assignment.status === 'completed') {
    if (assignment.matchId !== safeMatchId) fail('MATCH_MISMATCH', 'assignment 已由其他 matchId 完成')
    return run
  }
  if (run.phase !== 'round-active') fail('RUN_NOT_ACTIVE', '赛事当前不能完成牌桌')
  ensureCurrentRound(run, assignment)
  if (assignment.status !== 'matched') fail('INVALID_ASSIGNMENT_STATE', '只有 matched 牌桌可以完成')
  if (assignment.matchId !== safeMatchId) fail('MATCH_MISMATCH', '完成回调 matchId 与 assignment 绑定不一致')

  let next = replaceAssignment(run, { ...assignment, status: 'completed', completedAt: timestamp })
  const completedRound = next.rounds.find(round => round.round === assignment.round)
  if (completedRound.assignments.some(item => item.status !== 'completed')) return next

  next = {
    ...next,
    rounds: next.rounds.map(round => round.round === assignment.round ? { ...round, completedAt: timestamp } : round),
  }
  if (assignment.round < FIXED_LATIN_ROUND_COUNT) return activateRound(next, assignment.round + 1, timestamp)

  return {
    ...next,
    phase: 'finished',
    finishedAt: timestamp,
  }
}

export const blockTournamentAssignment = (run, assignmentId, matchId, reason, now) => {
  validateRun(run)
  const assignment = findAssignment(run, assignmentId)
  const safeMatchId = requireString(matchId, 'matchId')
  const safeReason = requireString(reason, 'reason', 160)
  const timestamp = requireTimestamp(now)

  if (assignment.status === 'blocked') {
    if (assignment.matchId !== safeMatchId) fail('MATCH_MISMATCH', 'assignment 已绑定其他 matchId')
    if (assignment.blockedReason !== safeReason) fail('BLOCK_REASON_MISMATCH', '重复阻塞请求的 reason 不一致')
    return run
  }
  if (run.phase !== 'round-active') fail('RUN_NOT_ACTIVE', '赛事当前不能阻塞牌桌')
  ensureCurrentRound(run, assignment)
  if (!['matching', 'matched'].includes(assignment.status)) fail('INVALID_ASSIGNMENT_STATE', '只有 matching 或 matched 牌桌可以阻塞')
  if (assignment.matchId && assignment.matchId !== safeMatchId) fail('MATCH_MISMATCH', '阻塞回调 matchId 与 assignment 绑定不一致')

  const blocked = {
    ...assignment,
    status: 'blocked',
    matchId: safeMatchId,
    blockedAt: timestamp,
    blockedReason: safeReason,
  }
  return {
    ...replaceAssignment(run, blocked),
    phase: 'blocked',
    blockedAssignmentId: blocked.assignmentId,
    blockedReason: safeReason,
    blockedAt: timestamp,
  }
}
