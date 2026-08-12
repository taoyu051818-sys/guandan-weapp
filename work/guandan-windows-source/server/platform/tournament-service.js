import { walletAvailability } from './commerce-service.js'
import { canonicalJsonFingerprint, matchesJsonFingerprint } from './canonical-json.js'
import { badRequest, conflict, forbidden, notFound } from './errors.js'
import {
  checkInFixedTournamentRun,
  createFixedTournamentRun,
  getCurrentTournamentAssignment,
  TournamentOrchestratorError,
} from './tournament-orchestrator.js'

const fixedTournamentFormat = 'fixed16-latin-3'
const fingerprint = canonicalJsonFingerprint

const requireIdempotencyKey = (value) => {
  const key = typeof value === 'string' ? value.trim() : ''
  if (!key || key.length > 128) throw badRequest('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key 必填且不能超过128字符')
  return key
}

const ensureTournamentCollections = (state) => {
  state.tournamentStandings ||= {}
  state.tournamentRoundResults ||= {}
  state.tournamentRuns ||= {}
  state.tournamentPlayerRoundResults ||= {}
}

export const isFixedTournament = (tournament) => tournament?.format === fixedTournamentFormat

export const rankTournamentEntries = (state, tournamentId) => {
  const standings = Object.values(state.tournamentStandings).filter(item => item.tournamentId === tournamentId)
  const pointsByUser = Object.fromEntries(standings.map(item => [item.userId, item.points]))
  standings.sort((left, right) => (
    right.points - left.points ||
    right.opponents.reduce((sum, id) => sum + (pointsByUser[id] || 0), 0) - left.opponents.reduce((sum, id) => sum + (pointsByUser[id] || 0), 0) ||
    right.wins - left.wins ||
    right.firstPlaces - left.firstPlaces ||
    left.userId.localeCompare(right.userId)
  ))
  standings.forEach((standing, index) => {
    standing.rank = index + 1
    standing.opponentPoints = standing.opponents.reduce((sum, id) => sum + (pointsByUser[id] || 0), 0)
  })
  return standings
}

export const qualificationStatus = (tournament, standing, index) => {
  if (tournament.status !== 'finished' || standing.played < Math.max(1, Number(tournament.roundsTotal) || 1)) return 'pending'
  return index < Number(tournament.advanceCount || 0) ? 'qualified' : 'eliminated'
}

export const publicTournamentStanding = (state, tournament, standing, index) => {
  const qualification = qualificationStatus(tournament, standing, index)
  return {
    userId: standing.userId,
    displayName: state.users[standing.userId]?.displayName || '牌友',
    played: standing.played,
    wins: standing.wins,
    firstPlaces: standing.firstPlaces,
    points: standing.points,
    opponentPoints: standing.opponentPoints,
    rank: index + 1,
    advanced: qualification === 'qualified',
    qualificationStatus: qualification,
  }
}

export const tournamentRunError = (error) => {
  if (!(error instanceof TournamentOrchestratorError)) throw error
  throw conflict(error.code, error.message)
}

export const tournamentStateView = (state, tournament, userId, run) => {
  const currentRound = run.rounds.find(round => round.round === run.currentRound) || null
  const ranked = rankTournamentEntries(state, tournament.id)
  const standings = ranked.map((standing, index) => publicTournamentStanding(state, tournament, standing, index))
  const viewerStanding = standings.find(item => item.userId === userId) || null
  const assignment = getCurrentTournamentAssignment(run, userId)
  return {
    tournament: { ...tournament, checkedInCount: run.checkedInUserIds.length },
    phase: run.phase,
    capacity: Number(tournament.capacity || 16),
    checkedInCount: run.checkedInUserIds.length,
    roundNumber: run.currentRound,
    roundsTotal: Number(tournament.roundsTotal || 3),
    tablesTotal: 4,
    tablesSettled: currentRound ? currentRound.assignments.filter(item => item.status === 'completed').length : 0,
    cutoffRank: Number(tournament.advanceCount || 0),
    viewerEntry: {
      enrolled: Boolean(state.enrollments[`${userId}:${tournament.id}`]),
      checkedIn: run.checkedInUserIds.includes(userId),
      rosterLocked: run.phase !== 'check-in',
    },
    assignment: assignment ? {
      assignmentId: assignment.assignmentId,
      roundNumber: assignment.round,
      tableNumber: assignment.table,
      status: assignment.status,
      ...(assignment.matchId ? { matchId: assignment.matchId } : {}),
    } : null,
    viewerStanding,
  }
}

export class TournamentService {
  constructor ({ store, now = () => Date.now(), createId } = {}) {
    if (!store || typeof createId !== 'function') throw new TypeError('TournamentService 缺少 store/createId')
    this.store = store
    this.now = now
    this.createId = createId
  }

  async list (userId = null) {
    return this.store.read(state => {
      ensureTournamentCollections(state)
      return Object.values(state.tournaments).map(tournament => {
        const standing = userId ? state.tournamentStandings[`${tournament.id}:${userId}`] : null
        const run = state.tournamentRuns[tournament.id]
        return {
          ...tournament,
          enrolled: Boolean(userId && state.enrollments[`${userId}:${tournament.id}`]),
          ...(isFixedTournament(tournament) ? { checkedInCount: run?.checkedInUserIds?.length || 0 } : {}),
          ...(standing ? { myStanding: { played: standing.played, points: standing.points, rank: standing.rank || 0, advanced: Boolean(standing.advanced) } } : {}),
        }
      })
    })
  }

  async enroll (userId, tournamentId, idempotencyKey, { expectedEntryPoints } = {}) {
    const key = requireIdempotencyKey(idempotencyKey)
    const normalizedExpectedPoints = expectedEntryPoints === undefined ? null : Number(expectedEntryPoints)
    if (normalizedExpectedPoints !== null && (!Number.isSafeInteger(normalizedExpectedPoints) || normalizedExpectedPoints < 0)) {
      throw badRequest('INVALID_EXPECTED_ENTRY_POINTS', 'expectedEntryPoints 必须是非负整数')
    }
    const now = this.now()
    return this.store.transaction(state => {
      ensureTournamentCollections(state)
      const tournament = state.tournaments[tournamentId]
      if (!tournament) throw notFound('TOURNAMENT_NOT_FOUND', '赛事不存在')
      const idempotencyId = `${userId}:${key}`
      const request = { tournamentId, expectedEntryPoints: normalizedExpectedPoints }
      const requestFingerprint = fingerprint(request)
      const previous = state.enrollmentIdempotency[idempotencyId]
      if (previous) {
        if (!matchesJsonFingerprint(previous.fingerprint, request)) throw conflict('IDEMPOTENCY_CONFLICT', '同一个 Idempotency-Key 不能用于不同报名请求')
        return state.enrollments[previous.enrollmentId]
      }
      if (normalizedExpectedPoints !== null && tournament.entryPoints !== normalizedExpectedPoints) {
        throw conflict('TOURNAMENT_PRICE_CHANGED', '赛事报名费已变更，请刷新后确认', { expected: normalizedExpectedPoints, current: tournament.entryPoints })
      }
      if (tournament.status !== 'open') throw conflict('TOURNAMENT_NOT_OPEN', '赛事尚未开放报名')
      const enrollmentId = `${userId}:${tournamentId}`
      if (state.enrollments[enrollmentId]) {
        state.enrollmentIdempotency[idempotencyId] = { fingerprint: requestFingerprint, enrollmentId }
        return state.enrollments[enrollmentId]
      }
      const wallet = state.wallets[userId]
      if (!wallet) throw notFound('WALLET_NOT_FOUND', '积分账户不存在')
      const availability = walletAvailability(state, userId, wallet)
      if (availability.available < tournament.entryPoints) throw conflict('INSUFFICIENT_POINTS', '可用积分不足', { ...availability, required: tournament.entryPoints })
      wallet.balance -= tournament.entryPoints
      wallet.updatedAt = now
      const enrollment = { enrollmentId, tournamentId, userId, status: 'enrolled', entryPoints: tournament.entryPoints, createdAt: now }
      state.enrollments[enrollmentId] = enrollment
      state.tournamentStandings[`${tournamentId}:${userId}`] ||= {
        tournamentId,
        userId,
        played: 0,
        wins: 0,
        firstPlaces: 0,
        points: 0,
        opponentPoints: 0,
        rank: 0,
        advanced: false,
        opponents: [],
        updatedAt: now,
      }
      state.enrollmentIdempotency[idempotencyId] = { fingerprint: requestFingerprint, enrollmentId }
      if (tournament.entryPoints > 0) {
        state.ledgerEntries.push({
          id: `led_${this.createId()}`,
          userId,
          amount: -tournament.entryPoints,
          balanceAfter: wallet.balance,
          type: 'tournament_entry',
          referenceId: enrollmentId,
          description: `赛事报名：${tournament.name}`,
          createdAt: now,
        })
      }
      return enrollment
    })
  }

  async checkIn (userId, tournamentId) {
    const now = this.now()
    return this.store.transaction(state => {
      ensureTournamentCollections(state)
      const tournament = state.tournaments[tournamentId]
      if (!tournament) throw notFound('TOURNAMENT_NOT_FOUND', '赛事不存在')
      if (!isFixedTournament(tournament)) throw conflict('TOURNAMENT_CHECK_IN_UNAVAILABLE', '该赛事不使用固定16人检录流程')
      if (!state.enrollments[`${userId}:${tournamentId}`]) throw forbidden('请先报名该赛事再检录')
      if (!['open', 'running'].includes(tournament.status)) throw conflict('TOURNAMENT_NOT_PLAYABLE', '赛事当前不能检录')
      let run = state.tournamentRuns[tournamentId] || createFixedTournamentRun(tournament, now)
      try {
        run = checkInFixedTournamentRun(run, userId, now)
      } catch (error) {
        tournamentRunError(error)
      }
      state.tournamentRuns[tournamentId] = run
      tournament.currentRound = run.currentRound
      if (run.phase !== 'check-in') tournament.status = run.phase === 'finished' ? 'finished' : 'running'
      return tournamentStateView(state, tournament, userId, run)
    })
  }

  async getState (userId, tournamentId) {
    const now = this.now()
    return this.store.read(state => {
      ensureTournamentCollections(state)
      const tournament = state.tournaments[tournamentId]
      if (!tournament) throw notFound('TOURNAMENT_NOT_FOUND', '赛事不存在')
      if (!isFixedTournament(tournament)) throw conflict('TOURNAMENT_STATE_UNAVAILABLE', '该赛事不使用固定16人轮次状态')
      const run = state.tournamentRuns[tournamentId] || createFixedTournamentRun(tournament, now)
      return tournamentStateView(state, tournament, userId, run)
    })
  }

  async listStandings (tournamentId, userId = null) {
    return this.store.read(state => {
      ensureTournamentCollections(state)
      const tournament = state.tournaments[tournamentId]
      if (!tournament) throw notFound('TOURNAMENT_NOT_FOUND', '赛事不存在')
      const ranked = rankTournamentEntries(state, tournamentId)
      const standings = ranked.map((standing, index) => publicTournamentStanding(state, tournament, standing, index))
      return {
        tournament: { ...tournament },
        standings,
        provisional: tournament.status !== 'finished',
        cutoffRank: Number(tournament.advanceCount || 0),
        viewerStanding: userId ? standings.find(item => item.userId === userId) || null : null,
      }
    })
  }
}
