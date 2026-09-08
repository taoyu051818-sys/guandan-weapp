import { CLASSIC_STAKES, classicStakeForMode } from './classic-stakes.js'
import { badRequest, conflict, forbidden, notFound } from './errors.js'
import { friendRoomKind } from './friend-room-service.js'
import { MatchBotFill, MATCH_BOT_FILL_DELAY_MS } from './match-bot-fill.js'
import { calculateComprehensiveScore } from './rating.js'
import { selectRatingMatch } from './rating-matchmaking.js'
import { getCurrentTournamentAssignment, markTournamentAssignmentMatched } from './tournament-orchestrator.js'
import { isFixedTournament, tournamentRunError } from './tournament-service.js'

const seats = ['p1', 'p2', 'p3', 'p4']
const allowedMatchModes = new Set([
  'quick',
  ...Object.keys(CLASSIC_STAKES),
  'rookie_cup', 'weekend_cup', 'master_cup', 'lingshui_16_cup',
])

const normalizeText = (value, fallback, maxLength) => {
  const text = typeof value === 'string' ? value.trim() : ''
  return (text || fallback).slice(0, maxLength)
}

const ensureMatchCollections = (state) => {
  state.matchQueues ||= {}
  state.spectatorFeeds ||= {}
}

export class MatchmakingService {
  constructor ({
    store,
    gameTickets,
    now = () => Date.now(),
    createId,
    createEntryAttemptId,
    createRoomId,
    ensurePlayerRating,
    ensureParticipantEntryAttemptId,
    friendRooms,
    botFillDelayMs = MATCH_BOT_FILL_DELAY_MS,
  } = {}) {
    if (!store || !gameTickets || typeof createId !== 'function' || typeof ensurePlayerRating !== 'function' || !friendRooms) {
      throw new TypeError('MatchmakingService 缺少 store/gameTickets/createId/ensurePlayerRating/friendRooms')
    }
    this.store = store
    this.gameTickets = gameTickets
    this.now = now
    this.createId = createId
    this.createEntryAttemptId = createEntryAttemptId
    this.createRoomId = createRoomId
    this.ensurePlayerRating = ensurePlayerRating
    this.ensureParticipantEntryAttemptId = ensureParticipantEntryAttemptId
    this.friendRooms = friendRooms
    this.botFill = new MatchBotFill({
      gameTickets,
      createEntryAttemptId,
      createRoomId,
      ensurePlayerRating,
      ensureParticipantEntryAttemptId,
      removeOpenQueueMatch: (state, mode, matchId) => this.removeOpenQueueMatch(state, mode, matchId),
      delayMs: botFillDelayMs,
    })
  }

  openQueueMatches (state, mode) {
    const stored = state.matchQueues[mode]
    const ids = Array.isArray(stored) ? stored : (typeof stored === 'string' && stored ? [stored] : [])
    const matches = [...new Set(ids)]
      .map(matchId => state.matches[matchId])
      .filter(match => match?.mode === mode && match.status === 'matching' && match.participants.some(item => item.status === 'matching'))
    state.matchQueues[mode] = matches.map(match => match.id)
    return matches
  }

  useGameTickets (gameTickets) {
    this.gameTickets = gameTickets
    this.botFill.gameTickets = gameTickets
  }

  removeOpenQueueMatch (state, mode, matchId) {
    const ids = Array.isArray(state.matchQueues[mode]) ? state.matchQueues[mode] : []
    const remaining = ids.filter(id => id !== matchId)
    if (remaining.length) state.matchQueues[mode] = remaining
    else delete state.matchQueues[mode]
  }

  unstartedHasExpired (_state, match, now) {
    if (match.status !== 'matched' || match.kind === friendRoomKind) return false
    // Fixed assignments own their table for the round. Credential expiry only
    // requires reissuing the ticket, not cancelling the assignment.
    if (match.tournamentId && match.assignmentId) return false
    const deadline = Number(match.entryDeadlineAt) || Math.min(
      ...match.participants.filter(participant => participant.status === 'matched').map(participant => Number(participant.expiresAt)).filter(Number.isFinite),
    )
    return Number.isFinite(deadline) && deadline <= now
  }

  cancelExpired (state, match, now) {
    if (!this.unstartedHasExpired(state, match, now)) return false
    match.status = 'cancelled'
    match.cancelledAt = now
    match.cancelReason = 'entry-expired'
    match.participants.forEach(participant => {
      if (participant.status !== 'matched') return
      participant.status = 'cancelled'
      participant.cancelledAt = now
      if (state.activeMatchByUser[participant.userId] === match.id) delete state.activeMatchByUser[participant.userId]
    })
    const feed = state.spectatorFeeds[match.id]
    if (feed && !feed.finishedAt && !feed.abortedAt) {
      feed.abortedAt = now
      feed.abortReason = 'entry-timeout'
      feed.finalSpectatorSequence = 0
    }
    return true
  }

  expireAll (state, now) {
    Object.values(state.matches).forEach(match => {
      this.friendRooms.cancelExpired(state, match, now)
      this.cancelExpired(state, match, now)
    })
  }

  async expireIfNeeded (now) {
    const needsSweep = await this.store.read(state => Object.values(state.matches).some(match => (
      this.friendRooms.hasExpired(match, now) || this.unstartedHasExpired(state, match, now)
    )))
    if (!needsSweep) return false
    return this.store.transaction(state => {
      ensureMatchCollections(state)
      this.expireAll(state, now)
      return true
    })
  }

  markPlaying (_state, match, startedAt) {
    if (match.status !== 'matched') return false
    match.status = 'playing'
    match.startedAt = startedAt
    match.participants.forEach(participant => {
      if (participant.status !== 'matched') return
      participant.status = 'playing'
      participant.startedAt = startedAt
    })
    return true
  }

  view (match, userId) {
    const participant = match.participants.find(item => item.userId === userId)
    if (!participant) throw forbidden('该匹配记录不属于当前用户')
    const stableEntryAttemptId = typeof participant.entryAttemptId === 'string' && /^[A-Za-z0-9_-]{22,128}$/.test(participant.entryAttemptId)
      ? participant.entryAttemptId
      : null
    if (!stableEntryAttemptId) throw conflict('MATCH_ENTRY_IDENTITY_MISSING', '匹配入桌身份尚未完成迁移，请稍后重试')
    const ticketEntryAttemptId = participant.status === 'matched' && participant.gameTicket
      ? (participant.claims?.entryAttemptId || stableEntryAttemptId)
      : stableEntryAttemptId
    const base = {
      ticketId: match.id,
      matchId: match.id,
      queueId: match.mode,
      mode: match.mode,
      status: participant.status,
      joinedAt: participant.joinedAt,
      entryAttemptId: ticketEntryAttemptId,
      humanPlayerCount: match.participants.filter(item => !item.isBot && ['matching', 'matched', 'playing'].includes(item.status)).length,
      botCount: match.participants.filter(item => item.isBot && ['matched', 'playing'].includes(item.status)).length,
      ...(match.status === 'matching' && this.botFill.enabledFor(match) ? { botFillAt: this.botFill.deadlineFor(match) } : {}),
      ...(match.tournamentId ? { tournamentId: match.tournamentId, assignmentId: match.assignmentId, roundNumber: match.roundNumber, tableNumber: match.tableNumber } : {}),
    }
    if (participant.status !== 'matched') return base
    return { ...base, roomId: match.roomId, seat: participant.seat, gameEndpoint: participant.gameEndpoint, gameTicket: participant.gameTicket, joinToken: participant.gameTicket, expiresAt: participant.expiresAt }
  }

  joinFixedTournamentMatch (state, userId, tournament, assignmentId, now) {
    const run = state.tournamentRuns[tournament.id]
    if (!run) throw conflict('TOURNAMENT_CHECK_IN_REQUIRED', '请先完成赛事检录')
    if (run.phase === 'blocked') throw conflict('TOURNAMENT_ROUND_BLOCKED', '本轮存在异常牌桌，赛事已暂停推进')
    if (run.phase === 'finished') throw conflict('TOURNAMENT_ROUNDS_COMPLETE', '赛事已完成，请查看晋级结果')
    if (run.phase !== 'round-active') throw conflict('TOURNAMENT_NOT_READY', '赛事尚未满员，暂不能入桌')
    let assignment
    try { assignment = getCurrentTournamentAssignment(run, userId) } catch (error) { tournamentRunError(error) }
    if (!assignment || assignment.assignmentId !== assignmentId) throw conflict('TOURNAMENT_ASSIGNMENT_MISMATCH', '只能进入平台分配的当前轮牌桌')
    if (!['matching', 'matched'].includes(assignment.status)) throw conflict('TOURNAMENT_ASSIGNMENT_NOT_JOINABLE', '当前赛事牌桌不能进入')
    let match = assignment.matchId ? state.matches[assignment.matchId] : Object.values(state.matches).find(item => item.tournamentId === tournament.id && item.assignmentId === assignment.assignmentId && item.status === 'matching')
    if (assignment.status === 'matched') {
      if (!match || match.id !== assignment.matchId) throw conflict('TOURNAMENT_ASSIGNMENT_CORRUPT', '赛事牌桌绑定状态不完整')
      const participant = match.participants.find(item => item.userId === userId)
      const expectedSeat = seats[assignment.userIds.indexOf(userId)]
      if (!participant || !expectedSeat || participant.seat !== expectedSeat || !match.roomId) throw conflict('TOURNAMENT_ASSIGNMENT_CORRUPT', '赛事牌桌席位绑定状态不完整')
      if (match.status === 'playing') { state.activeMatchByUser[userId] = match.id; return this.view(match, userId) }
      if (match.status !== 'matched') throw conflict('TOURNAMENT_ASSIGNMENT_CORRUPT', '赛事牌桌生命周期状态不一致')
      if (participant.status !== 'matched' || participant.expiresAt <= now) {
        const issued = this.gameTickets.issue({ userId, matchId: match.id, roomId: match.roomId, seat: expectedSeat, entryAttemptId: this.ensureParticipantEntryAttemptId(participant) })
        Object.assign(participant, { status: 'matched', ...issued, reissuedAt: now })
        delete participant.cancelledAt
        match.entryDeadlineAt = Math.min(...match.participants.map(item => Number(item.expiresAt)).filter(Number.isFinite))
      }
      state.activeMatchByUser[userId] = match.id
      return this.view(match, userId)
    }
    if (!match) {
      match = { id: `mat_${this.createId()}`, mode: tournament.queueId, status: 'matching', tournamentId: tournament.id, assignmentId: assignment.assignmentId, roundNumber: assignment.round, tableNumber: assignment.table, participants: [], createdAt: now }
      state.matches[match.id] = match
    }
    let participant = match.participants.find(item => item.userId === userId)
    if (participant?.status === 'cancelled') {
      participant.status = 'matching'; participant.joinedAt = now; delete participant.cancelledAt
    } else if (!participant) {
      participant = { userId, status: 'matching', entryAttemptId: String(this.createEntryAttemptId()), joinedAt: now }
      this.ensureParticipantEntryAttemptId(participant)
      match.participants.push(participant)
    }
    state.activeMatchByUser[userId] = match.id
    const waiting = match.participants.filter(item => item.status === 'matching')
    if (waiting.length === 4) {
      const waitingIds = new Set(waiting.map(item => item.userId))
      if (assignment.userIds.some(id => !waitingIds.has(id))) throw conflict('TOURNAMENT_ASSIGNMENT_MISMATCH', '赛事牌桌玩家与分配名单不一致')
      match.status = 'matched'; match.matchedAt = now; match.roomId = this.createRoomId(state)
      assignment.userIds.forEach((assignedUserId, index) => {
        const assignedParticipant = match.participants.find(item => item.userId === assignedUserId)
        const issued = this.gameTickets.issue({ userId: assignedUserId, matchId: match.id, roomId: match.roomId, seat: seats[index], entryAttemptId: this.ensureParticipantEntryAttemptId(assignedParticipant) })
        Object.assign(assignedParticipant, { status: 'matched', seat: seats[index], ...issued })
      })
      match.entryDeadlineAt = Math.min(...match.participants.map(item => item.expiresAt))
      try { state.tournamentRuns[tournament.id] = markTournamentAssignmentMatched(run, assignment.assignmentId, match.id, now) } catch (error) { tournamentRunError(error) }
      state.spectatorFeeds[match.id] = { matchId: match.id, mode: match.mode, startedAt: now, finishedAt: null, events: [] }
    }
    return this.view(match, userId)
  }

  async join (userId, { mode = 'quick', tournamentId = '', assignmentId = '' } = {}) {
    const safeMode = normalizeText(mode, 'quick', 40)
    const safeTournamentId = normalizeText(tournamentId, '', 128)
    const safeAssignmentId = normalizeText(assignmentId, '', 128)
    if (!allowedMatchModes.has(safeMode)) throw badRequest('INVALID_MATCH_MODE', '不支持的匹配模式')
    const now = this.now()
    return this.store.transaction(state => {
      ensureMatchCollections(state)
      this.botFill.fillExpired(state, now)
      const tournament = Object.values(state.tournaments).find(item => item.queueId === safeMode)
      if (tournament) {
        if (!state.enrollments[`${userId}:${tournament.id}`]) throw forbidden('请先报名该赛事再进入匹配')
        if (!['open', 'running'].includes(tournament.status)) throw conflict('TOURNAMENT_NOT_PLAYABLE', '赛事当前不可进入匹配')
        if (isFixedTournament(tournament)) {
          if (!safeTournamentId || !safeAssignmentId) throw conflict('TOURNAMENT_ASSIGNMENT_REQUIRED', '固定16人赛事必须携带平台分配的牌桌凭证')
          if (safeTournamentId !== tournament.id) throw conflict('TOURNAMENT_ASSIGNMENT_MISMATCH', '赛事与牌桌分配不一致')
        } else {
          if (safeTournamentId || safeAssignmentId) throw badRequest('UNEXPECTED_TOURNAMENT_ASSIGNMENT', '普通匹配不能携带赛事牌桌分配')
          const standing = state.tournamentStandings[`${tournament.id}:${userId}`]
          const roundsTotal = Math.max(1, Number(tournament.roundsTotal) || 1)
          if (standing && standing.played >= roundsTotal) throw conflict('TOURNAMENT_ROUNDS_COMPLETE', '已完成该赛事全部轮次，请等待晋级结果')
        }
      } else if (safeTournamentId || safeAssignmentId) throw badRequest('UNEXPECTED_TOURNAMENT_ASSIGNMENT', '该匹配队列不接受赛事牌桌分配')
      const activeId = state.activeMatchByUser[userId]
      if (activeId) {
        const active = state.matches[activeId]
        if (active) {
          if (tournament && isFixedTournament(tournament) && active.tournamentId === safeTournamentId && active.assignmentId === safeAssignmentId) return this.joinFixedTournamentMatch(state, userId, tournament, safeAssignmentId, now)
          const friendRoomExpired = this.friendRooms.cancelExpired(state, active, now)
          if (!friendRoomExpired && !this.cancelExpired(state, active, now)) {
            if (active.mode !== safeMode) throw conflict('ALREADY_MATCHING', '请先取消当前匹配')
            if (tournament && isFixedTournament(tournament) && (active.tournamentId !== safeTournamentId || active.assignmentId !== safeAssignmentId)) throw conflict('TOURNAMENT_ASSIGNMENT_MISMATCH', '当前匹配不属于请求的赛事牌桌')
            return this.view(active, userId)
          }
        }
        delete state.activeMatchByUser[userId]
      }
      if (tournament && isFixedTournament(tournament)) return this.joinFixedTournamentMatch(state, userId, tournament, safeAssignmentId, now)
      const classicStake = classicStakeForMode(safeMode)
      if (classicStake) {
        const wallet = state.wallets[userId]
        if (!wallet) throw notFound('WALLET_NOT_FOUND', '积分账户不存在')
        if (wallet.balance < classicStake) throw conflict('INSUFFICIENT_CLASSIC_STAKE', '积分不足，无法进入该经典场', { balance: wallet.balance, required: classicStake, mode: safeMode })
      }
      const joiningScore = calculateComprehensiveScore(this.ensurePlayerRating(state, userId))
      const openMatches = this.openQueueMatches(state, safeMode)
      openMatches.forEach(openMatch => openMatch.participants.filter(item => item.status === 'matching').forEach(participant => {
        if (!Number.isFinite(participant.comprehensiveScoreAtJoin)) participant.comprehensiveScoreAtJoin = calculateComprehensiveScore(this.ensurePlayerRating(state, participant.userId))
      }))
      let match = selectRatingMatch({ queueId: safeMode, matches: openMatches, joiningScore, now })
      if (!match) {
        match = { id: `mat_${this.createId()}`, mode: safeMode, status: 'matching', participants: [], createdAt: now }
        state.matches[match.id] = match
        state.matchQueues[safeMode] = [...(state.matchQueues[safeMode] || []), match.id]
      }
      const returningParticipant = match.participants.find(item => item.userId === userId && item.status === 'cancelled')
      if (returningParticipant) {
        this.ensureParticipantEntryAttemptId(returningParticipant); returningParticipant.status = 'matching'; returningParticipant.joinedAt = now; returningParticipant.comprehensiveScoreAtJoin = joiningScore; delete returningParticipant.cancelledAt
      } else {
        const joiningParticipant = { userId, status: 'matching', entryAttemptId: String(this.createEntryAttemptId()), joinedAt: now, comprehensiveScoreAtJoin: joiningScore }
        this.ensureParticipantEntryAttemptId(joiningParticipant); match.participants.push(joiningParticipant)
      }
      state.activeMatchByUser[userId] = match.id
      const waiting = match.participants.filter(item => item.status === 'matching')
      if (waiting.length === 4) this.botFill.complete(state, match, now)
      return this.view(match, userId)
    })
  }

  async getStatus (userId, matchId) {
    const now = this.now()
    return this.store.transaction(state => {
      ensureMatchCollections(state)
      this.expireAll(state, now)
      this.botFill.fillExpired(state, now)
      const match = state.matches[matchId]
      if (!match) throw notFound('MATCH_NOT_FOUND', '匹配记录不存在')
      return this.view(match, userId)
    })
  }

  async cancel (userId, matchId) {
    const now = this.now()
    return this.store.transaction(state => {
      ensureMatchCollections(state)
      this.botFill.fillExpired(state, now)
      const match = state.matches[matchId]
      if (!match) throw notFound('MATCH_NOT_FOUND', '匹配记录不存在')
      const participant = match.participants.find(item => item.userId === userId)
      if (!participant) throw forbidden('该匹配记录不属于当前用户')
      if (match.kind === friendRoomKind) {
        if (['cancelled', 'aborted'].includes(participant.status)) { if (state.activeMatchByUser[userId] === match.id) delete state.activeMatchByUser[userId]; return this.view(match, userId) }
        if (state.activeMatchByUser[userId] !== match.id) throw conflict('MATCH_NOT_ACTIVE', '只能取消当前进行中的匹配')
        if (!['matching', 'matched'].includes(match.status) || !['matching', 'matched'].includes(participant.status)) throw conflict('MATCH_NOT_CANCELLABLE', '该好友房已经开始或结束，不能取消')
        if (match.hostUserId === userId) { this.friendRooms.cancelByHost(state, match, now); return this.view(match, userId) }
        participant.status = 'cancelled'; participant.cancelledAt = now; participant.leaveReason = 'left'; participant.cancellationRequestedAt = now; delete state.activeMatchByUser[userId]
        if (match.status === 'matched') { match.status = 'matching'; delete match.matchedAt }
        return this.view(match, userId)
      }
      if (state.activeMatchByUser[userId] !== match.id) throw conflict('MATCH_NOT_ACTIVE', '只能取消当前进行中的匹配')
      if (match.tournamentId && match.assignmentId && match.status === 'matched') throw conflict('MATCH_ALREADY_ASSIGNED', '赛事牌桌已固定分配；入桌票据过期后请重新进入以换取新票')
      if (this.cancelExpired(state, match, now)) return this.view(match, userId)
      if (!['matching', 'matched'].includes(match.status) || !['matching', 'matched'].includes(participant.status)) throw conflict('MATCH_NOT_CANCELLABLE', '该匹配已经结束，不能取消')
      if (participant.status === 'matched' && participant.expiresAt > now) throw conflict('MATCH_ALREADY_ASSIGNED', '已经分配牌桌，不能取消匹配')
      participant.status = 'cancelled'; participant.cancelledAt = now
      if (state.activeMatchByUser[userId] === match.id) delete state.activeMatchByUser[userId]
      if (!match.participants.some(item => item.status === 'matching')) { match.status = 'cancelled'; this.removeOpenQueueMatch(state, match.mode, match.id) }
      return this.view(match, userId)
    })
  }
}
