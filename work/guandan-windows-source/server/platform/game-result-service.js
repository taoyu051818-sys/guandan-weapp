import { emptyStats } from './account-service.js'
import { canonicalJsonFingerprint } from './canonical-json.js'
import { classicStakeForMode, settleClassicStake } from './classic-stakes.js'
import { badRequest, conflict, forbidden } from './errors.js'
import { friendRoomKind } from './friend-room-service.js'
import { applyMatchRating } from './rating.js'
import { sanitizeSpectatorTimeline } from './spectator-domain.js'
import { completeTournamentAssignment } from './tournament-orchestrator.js'
import { isFixedTournament, qualificationStatus, rankTournamentEntries, tournamentRunError } from './tournament-service.js'

const seats = ['p1', 'p2', 'p3', 'p4']
const rewards = [100, 60, 30, 10]
const tournamentPoints = [3, 2, 1, 0]
const fingerprint = canonicalJsonFingerprint
const businessDayKey = timestamp => new Date(Number(timestamp) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
const isSeasonActive = (season, now) => Boolean(
  season && season.status === 'active' &&
  (!Number.isFinite(Number(season.startsAt)) || Number(season.startsAt) <= now) &&
  (!Number.isFinite(Number(season.endsAt)) || Number(season.endsAt) >= now),
)

const ensureResultCollections = state => {
  const mapCollections = [
    'gameResults', 'gameResultByMatch', 'userStats', 'playerRatings', 'dailyStats', 'matchHistoryByUser',
    'seasons', 'seasonProgress', 'tournaments', 'tournamentStandings', 'tournamentRoundResults',
    'tournamentRuns', 'tournamentPlayerRoundResults', 'replays', 'spectatorFeeds', 'matches', 'activeMatchByUser',
  ]
  mapCollections.forEach(key => { state[key] ||= {} })
  state.ledgerEntries ||= []
}

export class GameResultService {
  constructor ({ store, now = () => Date.now(), createId, ensurePlayerRating } = {}) {
    if (!store || typeof createId !== 'function' || typeof ensurePlayerRating !== 'function') {
      throw new TypeError('GameResultService 缺少 store/createId/ensurePlayerRating')
    }
    this.store = store
    this.now = now
    this.createId = createId
    this.ensurePlayerRating = ensurePlayerRating
  }

  validate (eventId, event) {
    if (!event || typeof event !== 'object') throw badRequest('INVALID_GAME_RESULT', '结算事件内容无效')
    if (!eventId || event.eventId !== eventId) throw badRequest('EVENT_ID_MISMATCH', '事件ID请求头与正文不一致')
    if (!/^\d{6}$/.test(String(event.roomId || ''))) throw badRequest('INVALID_ROOM_ID', '结算事件 roomId 无效')
    if (!Array.isArray(event.ranking) || event.ranking.length !== 4 || new Set(event.ranking).size !== 4 || !event.ranking.every(seat => seats.includes(seat))) {
      throw badRequest('INVALID_RANKING', '结算名次必须包含不重复的 p1 到 p4')
    }
    const usersBySeat = event.userIdsBySeat
    const now = this.now()
    if (!usersBySeat || !seats.every(seat => typeof usersBySeat[seat] === 'string' && usersBySeat[seat].trim())) throw badRequest('INVALID_PARTICIPANTS', '结算事件缺少席位用户')
    if (new Set(seats.map(seat => usersBySeat[seat])).size !== 4) throw badRequest('DUPLICATE_PARTICIPANTS', '四个席位必须对应四个不同用户')
    if (!['teamA', 'teamB'].includes(event.winnerTeam)) throw badRequest('INVALID_WINNER_TEAM', 'winnerTeam 必须是 teamA 或 teamB')
    const firstTeam = ['p1', 'p3'].includes(event.ranking[0]) ? 'teamA' : 'teamB'
    if (event.winnerTeam !== firstTeam) throw badRequest('WINNER_RANKING_MISMATCH', '胜方与头游席位不一致')
    const finishedAt = Number(event.finishedAt)
    if (!Number.isSafeInteger(finishedAt) || finishedAt < now - 30 * 24 * 60 * 60 * 1000 || finishedAt > now + 5 * 60 * 1000) {
      throw badRequest('INVALID_FINISHED_AT', '结算时间无效或超出允许窗口')
    }
    const finalSequence = event.finalSpectatorSequence
    if (finalSequence !== undefined && (!Number.isSafeInteger(finalSequence) || finalSequence < 0 || finalSequence > 100_000)) {
      throw badRequest('INVALID_FINAL_SPECTATOR_SEQUENCE', 'finalSpectatorSequence 必须是 0 到 100000 的整数')
    }
    seats.forEach(seat => {
      const bombs = event.statsBySeat?.[seat]?.bombsPlayed
      if (bombs !== undefined && (!Number.isSafeInteger(bombs) || bombs < 0 || bombs > 99)) throw badRequest('INVALID_GAME_STATS', `${seat} 的炸弹数必须是 0 到 99 的整数`)
    })
    return { now, finishedAt, finalSequence }
  }

  resolveMatch (state, eventId, event) {
    if (!event.matchId) return null
    const match = state.matches[event.matchId]
    if (!match || match.roomId !== String(event.roomId)) throw forbidden('结算事件与已分配匹配不一致')
    if (match.kind === friendRoomKind && match.friendMatchEnd) throw conflict('FRIEND_MATCH_ALREADY_ENDED', '好友房已按配置终局，不能再提交排名结算')
    const participantsBySeat = Object.fromEntries(match.participants.filter(item => item.seat).map(item => [item.seat, item.userId]))
    if (!seats.every(seat => participantsBySeat[seat] === event.userIdsBySeat[seat])) throw forbidden('结算席位用户与匹配分配不一致')
    const settledEventId = state.gameResultByMatch[event.matchId]
    if (settledEventId && settledEventId !== eventId) throw conflict('MATCH_ALREADY_SETTLED', '该匹配已经完成结算')
    return match
  }

  resolveTimeline (state, event, finishedAt, finalSequence) {
    const reported = sanitizeSpectatorTimeline(event.publicTimeline, finishedAt)
    const streamed = event.matchId && Array.isArray(state.spectatorFeeds[event.matchId]?.events)
      ? state.spectatorFeeds[event.matchId].events.map(item => structuredClone(item))
      : []
    if (Number.isSafeInteger(finalSequence)) {
      const lastSequence = streamed.at(-1)?.sequence || 0
      if (lastSequence > finalSequence) {
        throw conflict('FINAL_SPECTATOR_SEQUENCE_BEHIND', '结算声明的最终观战序号早于平台已接收事件', { finalSpectatorSequence: finalSequence, lastStreamedSequence: lastSequence })
      }
      const finalEvent = streamed.find(item => item.sequence === finalSequence)
      if (finalSequence > 0 && finalEvent && (finalEvent.type !== 'round-end' || finalEvent.isGameWon !== true)) {
        throw conflict('INVALID_FINAL_SPECTATOR_EVENT', '结算声明的最终观战事件必须是获胜局 round-end')
      }
    }
    const publicTimeline = streamed.length ? streamed : reported
    if (!publicTimeline.length) publicTimeline.push({ sequence: 1, at: finishedAt, type: 'settlement', text: `本局第1名：${event.ranking[0]}` })
    return { reported, streamed, publicTimeline }
  }

  resolveTournament (state, match, usersBySeat) {
    const tournament = match
      ? (match.tournamentId ? state.tournaments[match.tournamentId] : Object.values(state.tournaments).find(item => item.queueId === match.mode))
      : null
    const fixedRun = tournament && isFixedTournament(tournament) ? state.tournamentRuns[tournament.id] : null
    if (tournament && isFixedTournament(tournament)) {
      if (!fixedRun || !match.assignmentId || !match.roundNumber || !match.tableNumber) throw conflict('TOURNAMENT_ASSIGNMENT_CORRUPT', '赛事结算缺少服务端牌桌分配')
      const duplicate = Object.values(usersBySeat).some(userId => state.tournamentPlayerRoundResults[`${tournament.id}:${match.roundNumber}:${userId}`])
      if (duplicate) throw conflict('TOURNAMENT_PLAYER_ROUND_SETTLED', '玩家本轮赛事结果已经结算')
    }
    return { tournament, fixedRun }
  }

  settlePlayer ({ state, eventId, event, tournament, replayId, ratingByUser, classicSettlement, seat, index, now, finishedAt }) {
    const userId = event.userIdsBySeat[seat]
    const wallet = state.wallets[userId]
    const walletDelta = classicSettlement ? classicSettlement.deltasByUser[userId] : rewards[index]
    wallet.balance += walletDelta
    if (wallet.balance < 0) throw new Error('牌局结算不得产生负积分余额')
    wallet.updatedAt = now
    if (walletDelta !== 0) {
      state.ledgerEntries.push({
        id: `led_${this.createId()}`,
        userId,
        amount: walletDelta,
        balanceAfter: wallet.balance,
        type: classicSettlement ? (walletDelta > 0 ? 'classic_stake_win' : 'classic_stake_loss') : 'game_reward',
        referenceId: eventId,
        description: classicSettlement ? `经典场底分${classicSettlement.baseStake}胜负结算` : `牌局结算第${index + 1}名`,
        createdAt: now,
      })
    }
    const stats = state.userStats[userId] ||= emptyStats(userId)
    const team = seat === 'p1' || seat === 'p3' ? 'teamA' : 'teamB'
    const won = event.winnerTeam === team
    const bombCount = Math.max(0, Math.min(99, Number(event.statsBySeat?.[seat]?.bombsPlayed) || 0))
    stats.gamesPlayed += 1
    if (won) stats.wins += 1
    if (index === 0) stats.firstPlaceFinishes += 1
    stats.bombsPlayed += bombCount
    stats.updatedAt = now
    state.playerRatings[userId] = { ...ratingByUser[userId], updatedAt: now }
    const dayKey = businessDayKey(now)
    const daily = state.dailyStats[`${dayKey}:${userId}`] ||= { ...emptyStats(userId), dayKey }
    daily.gamesPlayed += 1
    if (won) daily.wins += 1
    if (index === 0) daily.firstPlaceFinishes += 1
    daily.bombsPlayed += bombCount
    daily.updatedAt = now
    const history = state.matchHistoryByUser[userId] ||= []
    history.push({ eventId, replayId, matchId: event.matchId || '', roomId: String(event.roomId), place: index + 1, won, winnerTeam: event.winnerTeam, tournamentId: tournament?.id || null, finishedAt })
    if (history.length > 100) history.splice(0, history.length - 100)
    const season = Object.values(state.seasons).find(item => isSeasonActive(item, now))
    if (season) {
      const progress = state.seasonProgress[`${season.id}:${userId}`] ||= { seasonId: season.id, userId, score: 0, gamesPlayed: 0, wins: 0, updatedAt: now }
      progress.gamesPlayed += 1
      if (won) progress.wins += 1
      progress.score += Math.max(1, 4 - index)
      progress.updatedAt = now
    }
    if (tournament) {
      const standing = state.tournamentStandings[`${tournament.id}:${userId}`] ||= { tournamentId: tournament.id, userId, played: 0, wins: 0, firstPlaces: 0, points: 0, opponentPoints: 0, rank: 0, advanced: false, opponents: [], updatedAt: now }
      standing.played += 1
      standing.points += tournamentPoints[index]
      if (won) standing.wins += 1
      if (index === 0) standing.firstPlaces += 1
      standing.opponents.push(...Object.values(event.userIdsBySeat).filter(id => id !== userId))
      standing.updatedAt = now
    }
  }

  settleTournament (state, tournament, fixedRun, match, eventId, event, now) {
    if (!tournament) return
    const resultId = `${tournament.id}:${eventId}`
    const roundsTotal = Math.max(1, Number(tournament.roundsTotal) || 1)
    const resultRound = isFixedTournament(tournament) ? match.roundNumber : Number(event.tournamentRound) || Math.max(1, Number(tournament.currentRound) || 1)
    state.tournamentRoundResults[resultId] = {
      id: resultId,
      tournamentId: tournament.id,
      eventId,
      matchId: event.matchId,
      ...(match?.assignmentId ? { assignmentId: match.assignmentId, tableNumber: match.tableNumber } : {}),
      ranking: [...event.ranking],
      usersBySeat: structuredClone(event.userIdsBySeat),
      round: resultRound,
      createdAt: now,
    }
    if (isFixedTournament(tournament)) {
      let nextRun
      try { nextRun = completeTournamentAssignment(fixedRun, match.assignmentId, match.id, now) } catch (error) { tournamentRunError(error) }
      state.tournamentRuns[tournament.id] = nextRun
      Object.values(event.userIdsBySeat).forEach(userId => {
        const id = `${tournament.id}:${resultRound}:${userId}`
        state.tournamentPlayerRoundResults[id] = { id, tournamentId: tournament.id, round: resultRound, userId, assignmentId: match.assignmentId, matchId: match.id, eventId, createdAt: now }
      })
      tournament.currentRound = nextRun.currentRound
      tournament.status = nextRun.phase === 'finished' ? 'finished' : 'running'
    }
    const standings = rankTournamentEntries(state, tournament.id)
    if (!isFixedTournament(tournament)) {
      tournament.currentRound = Math.min(roundsTotal, Math.max(...standings.map(item => item.played), 1))
      tournament.status = standings.length >= 4 && standings.every(item => item.played >= roundsTotal) ? 'finished' : 'running'
    }
    standings.forEach((standing, index) => { standing.advanced = qualificationStatus(tournament, standing, index) === 'qualified' })
  }

  finalizeMatch (state, match, tournament, eventId, event, timeline, finishedAt, finalSequence, now) {
    const participantNames = Object.fromEntries(seats.map(seat => [seat, state.users[event.userIdsBySeat[seat]]?.displayName || '牌友']))
    state.replays[`rpl_${eventId}`] = {
      id: `rpl_${eventId}`,
      eventId,
      matchId: event.matchId || '',
      roomId: String(event.roomId),
      userIds: Object.values(event.userIdsBySeat),
      participants: participantNames,
      ranking: [...event.ranking],
      winnerTeam: event.winnerTeam,
      tournamentId: tournament?.id || null,
      finishedAt,
      events: timeline.publicTimeline,
    }
    if (!event.matchId) return
    const existingFeed = state.spectatorFeeds[event.matchId]
    state.spectatorFeeds[event.matchId] = {
      matchId: event.matchId,
      mode: match?.mode || existingFeed?.mode || 'quick',
      startedAt: existingFeed?.startedAt || match?.matchedAt || finishedAt,
      ...(existingFeed?.gameStartedAt ? { gameStartedAt: existingFeed.gameStartedAt } : {}),
      events: timeline.streamed.length ? timeline.streamed : (Number.isSafeInteger(finalSequence) ? [] : timeline.reported),
      finishedAt,
      abortedAt: null,
      abortReason: null,
      finalSpectatorSequence: Number.isSafeInteger(finalSequence) ? finalSequence : null,
    }
    match.status = 'completed'
    match.completedAt = now
    delete match.abortedAt
    delete match.abortReason
    match.participants.forEach(participant => {
      participant.status = 'completed'
      participant.completedAt = now
      delete participant.abortedAt
      delete participant.cancelledAt
    })
    Object.values(event.userIdsBySeat).forEach(userId => {
      if (state.activeMatchByUser[userId] === event.matchId) delete state.activeMatchByUser[userId]
    })
    state.gameResultByMatch[event.matchId] = eventId
  }

  async accept (eventId, event) {
    const { now, finishedAt, finalSequence } = this.validate(eventId, event)
    return this.store.transaction(state => {
      ensureResultCollections(state)
      const previous = state.gameResults[eventId]
      if (previous) {
        if (fingerprint(previous.event) !== fingerprint(event)) throw conflict('EVENT_ID_CONFLICT', '同一个结算事件ID不能对应不同内容')
        return { eventId, accepted: true, duplicate: true, processedAt: previous.processedAt }
      }
      const match = this.resolveMatch(state, eventId, event)
      const timeline = this.resolveTimeline(state, event, finishedAt, finalSequence)
      const { tournament, fixedRun } = this.resolveTournament(state, match, event.userIdsBySeat)
      seats.forEach(seat => {
        const userId = event.userIdsBySeat[seat]
        if (!state.wallets[userId] || !state.users[userId]) throw badRequest('UNKNOWN_RESULT_USER', `结算用户不存在：${seat}`)
      })
      const ratingResult = applyMatchRating(
        ['p1', 'p3'].map(seat => this.ensurePlayerRating(state, event.userIdsBySeat[seat])),
        ['p2', 'p4'].map(seat => this.ensurePlayerRating(state, event.userIdsBySeat[seat])),
        event.winnerTeam,
      )
      const ratingByUser = Object.fromEntries([...ratingResult.teamA, ...ratingResult.teamB].map(rating => [rating.id, rating]))
      const classicSettlement = match && classicStakeForMode(match.mode)
        ? settleClassicStake({ mode: match.mode, winnerTeam: event.winnerTeam, userIdsBySeat: event.userIdsBySeat, balancesByUser: Object.fromEntries(Object.values(event.userIdsBySeat).map(userId => [userId, state.wallets[userId].balance])) })
        : null
      event.ranking.forEach((seat, index) => this.settlePlayer({ state, eventId, event, tournament, replayId: `rpl_${eventId}`, ratingByUser, classicSettlement, seat, index, now, finishedAt }))
      this.settleTournament(state, tournament, fixedRun, match, eventId, event, now)
      this.finalizeMatch(state, match, tournament, eventId, event, timeline, finishedAt, finalSequence, now)
      state.gameResults[eventId] = { eventId, event: structuredClone(event), processedAt: now }
      return { eventId, accepted: true, duplicate: false, processedAt: now }
    })
  }
}
