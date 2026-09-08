import { classicStakeForMode } from './classic-stakes.js'
import { calculateComprehensiveScore } from './rating.js'
import { roomPlayerNicknames } from '../player-nicknames.js'

const seats = ['p1', 'p2', 'p3', 'p4']
export const MATCH_BOT_FILL_DELAY_MS = 3_000

/** Owns the atomic matching -> matched transition when a normal queue waits too long. */
export class MatchBotFill {
  constructor ({
    gameTickets,
    createEntryAttemptId,
    createRoomId,
    ensurePlayerRating,
    ensureParticipantEntryAttemptId,
    removeOpenQueueMatch,
    delayMs = MATCH_BOT_FILL_DELAY_MS,
  }) {
    this.gameTickets = gameTickets
    this.createEntryAttemptId = createEntryAttemptId
    this.createRoomId = createRoomId
    this.ensurePlayerRating = ensurePlayerRating
    this.ensureParticipantEntryAttemptId = ensureParticipantEntryAttemptId
    this.removeOpenQueueMatch = removeOpenQueueMatch
    this.delayMs = Math.max(0, Number(delayMs) || 0)
  }

  enabledFor (match) {
    return Boolean(match && !match.tournamentId && (match.mode === 'quick' || classicStakeForMode(match.mode)))
  }

  deadlineFor (match) {
    const waiting = match.participants.filter(item => item.status === 'matching' && !item.isBot)
    if (!waiting.length) return null
    const oldestJoinedAt = Math.min(...waiting.map(item => Number(item.joinedAt) || Number(match.createdAt)))
    return Number.isFinite(oldestJoinedAt) ? oldestJoinedAt + this.delayMs : null
  }

  userIdsBySeatFor (match) {
    return Object.fromEntries(match.participants
      .filter(item => item.isBot && seats.includes(item.seat) && typeof item.userId === 'string')
      .map(item => [item.seat, item.userId]))
  }

  ensureAccount (state, match, seat, now, score) {
    const userId = `bot_${match.id}_${seat}`
    state.users[userId] ||= { id: userId, displayName: roomPlayerNicknames({ matchId: match.id })[seat], system: true, isBot: true, createdAt: now, updatedAt: now }
    state.wallets[userId] ||= { userId, balance: 100_000_000, currency: 'points', updatedAt: now, system: true }
    const rating = this.ensurePlayerRating(state, userId)
    if (Number.isFinite(score) && rating.games === 0) rating.eloOffset += score - calculateComprehensiveScore(rating)
    return userId
  }

  complete (state, match, now, { fillBots = false } = {}) {
    if (match.status !== 'matching') return false
    const humans = match.participants.filter(item => item.status === 'matching' && !item.isBot)
    if (!humans.length || humans.length > 4 || (!fillBots && humans.length !== 4)) return false
    const averageScore = humans.reduce((sum, item) => sum + (Number(item.comprehensiveScoreAtJoin) || 0), 0) / humans.length
    humans.forEach((participant, index) => { participant.seat = seats[index] })
    if (fillBots) {
      seats.slice(humans.length).forEach(seat => {
        match.participants.push({
          userId: this.ensureAccount(state, match, seat, now, averageScore),
          isBot: true,
          status: 'matched',
          seat,
          entryAttemptId: String(this.createEntryAttemptId()),
          joinedAt: now,
          comprehensiveScoreAtJoin: averageScore,
        })
      })
      match.botFilledAt = now
      match.botFillReason = 'wait-timeout'
    }
    const botUserIdsBySeat = this.userIdsBySeatFor(match)
    match.status = 'matched'
    match.matchedAt = now
    match.roomId = this.createRoomId(state)
    humans.forEach(participant => Object.assign(participant, {
      status: 'matched',
      ...this.gameTickets.issue({
        userId: participant.userId,
        matchId: match.id,
        matchMode: match.mode,
        roomId: match.roomId,
        seat: participant.seat,
        entryAttemptId: this.ensureParticipantEntryAttemptId(participant),
        ...(Object.keys(botUserIdsBySeat).length ? { botUserIdsBySeat } : {}),
      }),
    }))
    match.entryDeadlineAt = Math.min(...humans.map(participant => participant.expiresAt).filter(Number.isFinite))
    state.spectatorFeeds[match.id] = { matchId: match.id, mode: match.mode, startedAt: now, finishedAt: null, events: [] }
    this.removeOpenQueueMatch(state, match.mode, match.id)
    return true
  }

  fillExpired (state, now) {
    Object.values(state.matches).forEach(match => {
      if (!this.enabledFor(match) || match.status !== 'matching') return
      const deadline = this.deadlineFor(match)
      if (Number.isFinite(deadline) && now >= deadline) this.complete(state, match, now, { fillBots: true })
    })
  }
}
