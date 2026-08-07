import { randomInt, randomUUID } from 'node:crypto'
import { CLASSIC_STAKES, classicStakeForMode, settleClassicStake } from './classic-stakes.js'
import { badRequest, conflict, forbidden, notFound, unauthorized } from './errors.js'
import {
  applyMatchRating,
  calculateComprehensiveScore,
  createInitialRating,
  createRatingSnapshot,
  formatComprehensiveScore,
} from './rating.js'
import { selectRatingMatch } from './rating-matchmaking.js'
import { findAvailableAccountId, normalizeAccountId } from './storage.js'
import {
  blockTournamentAssignment,
  checkInFixedTournamentRun,
  completeTournamentAssignment,
  createFixedTournamentRun,
  getCurrentTournamentAssignment,
  markTournamentAssignmentMatched,
  TournamentOrchestratorError,
} from './tournament-orchestrator.js'

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
const requireIdempotencyKey = (value) => {
  const key = typeof value === 'string' ? value.trim() : ''
  if (!key || key.length > 128) throw badRequest('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key 必填且不能超过128字符')
  return key
}
const fingerprint = (value) => JSON.stringify(value)
const platformCollections = [
  'userByAccountId',
  'userStats', 'playerRatings', 'matchHistoryByUser', 'matchQueues', 'tournamentStandings', 'tournamentRoundResults',
  'replays', 'spectatorFeeds', 'seasons', 'seasonProgress', 'taskDefinitions',
  'taskProgress', 'taskClaimIdempotency', 'dailyStats', 'merchants', 'merchantByOwner',
  'merchantStores', 'merchantEmployees', 'merchantPointGrants', 'merchantIdempotency',
  'spectatorEventReceipts', 'tournamentRuns', 'tournamentPlayerRoundResults',
]
const ensureCollections = (state) => {
  platformCollections.forEach(key => { state[key] ||= {} })
  return state
}
const reservedClassicStakeForUser = (state, userId) => {
  const activeMatchId = state.activeMatchByUser?.[userId]
  const match = activeMatchId ? state.matches?.[activeMatchId] : null
  if (!match || !['matching', 'matched'].includes(match.status)) return 0
  const participant = Array.isArray(match.participants)
    ? match.participants.find(item => item.userId === userId)
    : null
  if (!participant || !['matching', 'matched'].includes(participant.status)) return 0
  return classicStakeForMode(match.mode) || 0
}
const walletAvailability = (state, userId, wallet) => {
  const reserved = reservedClassicStakeForUser(state, userId)
  return {
    balance: wallet.balance,
    reserved,
    available: Math.max(0, wallet.balance - reserved),
  }
}
const emptyStats = (userId) => ({
  userId,
  gamesPlayed: 0,
  wins: 0,
  firstPlaceFinishes: 0,
  bombsPlayed: 0,
  updatedAt: 0,
})
const requirePositiveInteger = (value, code, message, maximum = Number.MAX_SAFE_INTEGER) => {
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > maximum) throw badRequest(code, message)
  return normalized
}
const businessDayKey = (timestamp) => new Date(Number(timestamp) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
const spectatorDelaySeconds = (value) => Math.max(15, Math.min(300, Number(value) || 30))
const spectatorTableLabel = (matchId, mode) => {
  const modeLabel = ({
    quick: '快速匹配',
    classic_50: '经典场 · 底分50',
    classic_300: '经典场 · 底分300',
    classic_2000: '经典场 · 底分2000',
    classic_10000: '经典场 · 底分10000',
    rookie_cup: '新手赛',
    weekend_cup: '周末赛',
    master_cup: '大师赛',
  })[mode] || '联机牌桌'
  return `${modeLabel} · ${String(matchId).slice(-6).toUpperCase()}桌`
}
const spectatorEventTypes = new Set([
  'game-start', 'round-start', 'tribute-start', 'tribute', 'return-tribute',
  'anti-tribute', 'play-start', 'play', 'pass', 'round-end', 'room-closed',
])
const spectatorPlayTypes = new Set(['Single', 'Pair', 'Triple', 'Straight', 'TripleWithPair', 'Tube', 'Plate', 'StraightFlush', 'Bomb', 'Rocket'])
const spectatorRanks = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10, 'J', 'Q', 'K', 'A', 'Small', 'Big'])
const spectatorSuits = new Set(['spade', 'heart', 'club', 'diamond', 'joker'])
const spectatorCloseReasons = new Set(['empty-timeout', 'dissolved', 'entry-timeout', 'host-left', 'server-shutdown'])
const spectatorEventKeys = new Set([
  'eventId', 'matchId', 'roomId', 'sequence', 'at', 'type', 'roundSequence',
  'playerId', 'cards', 'playType', 'automatic', 'ranking', 'winnerTeam',
  'isGameWon', 'reason',
])
const spectatorCardKeys = new Set(['rank', 'suit'])
const spectatorCommonKeys = ['eventId', 'matchId', 'roomId', 'sequence', 'at', 'type', 'roundSequence']
const spectatorKeysByType = {
  'game-start': new Set(spectatorCommonKeys),
  'round-start': new Set(spectatorCommonKeys),
  'tribute-start': new Set(spectatorCommonKeys),
  tribute: new Set([...spectatorCommonKeys, 'playerId']),
  'return-tribute': new Set([...spectatorCommonKeys, 'playerId']),
  'anti-tribute': new Set(spectatorCommonKeys),
  'play-start': new Set(spectatorCommonKeys),
  play: new Set([...spectatorCommonKeys, 'playerId', 'cards', 'playType', 'automatic']),
  pass: new Set([...spectatorCommonKeys, 'playerId', 'automatic']),
  'round-end': new Set([...spectatorCommonKeys, 'ranking', 'winnerTeam', 'isGameWon']),
  'room-closed': new Set([...spectatorCommonKeys, 'reason']),
}
const assertOnlyKeys = (record, allowed, code, message) => {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw badRequest(code, message)
  const unexpected = Object.keys(record).find(key => !allowed.has(key))
  if (unexpected) throw badRequest(code, `${message}：不允许字段 ${unexpected}`)
}
const normalizeSpectatorCard = (card) => {
  assertOnlyKeys(card, spectatorCardKeys, 'INVALID_SPECTATOR_CARD', '公开牌面字段无效')
  if (!spectatorRanks.has(card.rank) || !spectatorSuits.has(card.suit)) throw badRequest('INVALID_SPECTATOR_CARD', '公开牌面点数或花色无效')
  return { rank: card.rank, suit: card.suit }
}
const normalizeSpectatorEvent = (eventId, rawEvent, now) => {
  assertOnlyKeys(rawEvent, spectatorEventKeys, 'INVALID_SPECTATOR_EVENT', '观战事件字段无效')
  if (!eventId || rawEvent.eventId !== eventId) throw badRequest('EVENT_ID_MISMATCH', '观战事件ID请求头与正文不一致')
  const matchId = typeof rawEvent.matchId === 'string' ? rawEvent.matchId.trim() : ''
  if (!matchId || matchId.length > 128 || !/^[A-Za-z0-9:_-]+$/.test(matchId)) throw badRequest('INVALID_MATCH_ID', '观战事件 matchId 无效')
  if (!/^\d{6}$/.test(String(rawEvent.roomId || ''))) throw badRequest('INVALID_ROOM_ID', '观战事件 roomId 无效')
  const sequence = Number(rawEvent.sequence)
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 100_000) throw badRequest('INVALID_SPECTATOR_SEQUENCE', '观战事件 sequence 无效')
  if (eventId !== `spectate:${matchId}:${sequence}`) throw badRequest('INVALID_SPECTATOR_EVENT_ID', '观战事件ID必须与 matchId 和 sequence 一致')
  const at = Number(rawEvent.at)
  if (!Number.isSafeInteger(at) || at < now - 24 * 60 * 60 * 1000 || at > now + 60_000) throw badRequest('INVALID_SPECTATOR_TIME', '观战事件时间无效或超出允许窗口')
  if (!spectatorEventTypes.has(rawEvent.type)) throw badRequest('INVALID_SPECTATOR_TYPE', '不支持的观战事件类型')
  assertOnlyKeys(rawEvent, spectatorKeysByType[rawEvent.type], 'INVALID_SPECTATOR_EVENT', `${rawEvent.type} 观战事件字段无效`)
  const roundSequence = Number(rawEvent.roundSequence)
  if (!Number.isSafeInteger(roundSequence) || roundSequence < 1 || roundSequence > 1000) throw badRequest('INVALID_ROUND_SEQUENCE', '观战事件 roundSequence 无效')
  const event = { eventId, matchId, roomId: String(rawEvent.roomId), sequence, at, type: rawEvent.type, roundSequence }

  if (rawEvent.type === 'tribute' || rawEvent.type === 'return-tribute') {
    if (!seats.includes(rawEvent.playerId)) throw badRequest('INVALID_SPECTATOR_PLAYER', '贡还动作席位无效')
    event.playerId = rawEvent.playerId
  }

  if (rawEvent.type === 'play' || rawEvent.type === 'pass') {
    if (!seats.includes(rawEvent.playerId)) throw badRequest('INVALID_SPECTATOR_PLAYER', '公开动作席位无效')
    if (typeof rawEvent.automatic !== 'boolean') throw badRequest('INVALID_SPECTATOR_AUTOMATION', '公开动作必须声明是否为自动操作')
    event.playerId = rawEvent.playerId
    event.automatic = rawEvent.automatic
  }
  if (rawEvent.type === 'play') {
    if (!Array.isArray(rawEvent.cards) || rawEvent.cards.length < 1 || rawEvent.cards.length > 27) throw badRequest('INVALID_SPECTATOR_CARDS', '公开出牌必须包含 1 到 27 张牌')
    if (!spectatorPlayTypes.has(rawEvent.playType)) throw badRequest('INVALID_SPECTATOR_PLAY_TYPE', '公开出牌牌型无效')
    event.cards = rawEvent.cards.map(normalizeSpectatorCard)
    event.playType = rawEvent.playType
  }
  if (rawEvent.type === 'round-end') {
    if (!Array.isArray(rawEvent.ranking) || rawEvent.ranking.length !== 4 || new Set(rawEvent.ranking).size !== 4 || !rawEvent.ranking.every(seat => seats.includes(seat))) {
      throw badRequest('INVALID_SPECTATOR_RANKING', '公开局结算必须包含不重复的 p1 到 p4')
    }
    if (!['teamA', 'teamB'].includes(rawEvent.winnerTeam) || typeof rawEvent.isGameWon !== 'boolean') throw badRequest('INVALID_SPECTATOR_RESULT', '公开局结算结果无效')
    event.ranking = [...rawEvent.ranking]
    event.winnerTeam = rawEvent.winnerTeam
    event.isGameWon = rawEvent.isGameWon
  }
  if (rawEvent.type === 'room-closed') {
    if (!spectatorCloseReasons.has(rawEvent.reason)) throw badRequest('INVALID_SPECTATOR_CLOSE_REASON', '牌桌终止原因无效')
    event.reason = rawEvent.reason
  }
  return event
}
const publicSpectatorEvent = ({ eventId: _eventId, matchId: _matchId, roomId: _roomId, ...event }) => event
const isSeasonActive = (season, now) => Boolean(
  season && season.status === 'active' &&
  (!Number.isFinite(Number(season.startsAt)) || Number(season.startsAt) <= now) &&
  (!Number.isFinite(Number(season.endsAt)) || Number(season.endsAt) >= now),
)
const sanitizeTimeline = (timeline, finishedAt) => {
  if (!Array.isArray(timeline)) return []
  return timeline.slice(0, 500).map((raw, index) => {
    const event = raw && typeof raw === 'object' ? raw : {}
    const playerId = seats.includes(event.playerId) ? event.playerId : undefined
    const cards = Array.isArray(event.cards)
      ? event.cards.slice(0, 27).map(card => ({ rank: normalizeText(card?.rank, '?', 8), suit: normalizeText(card?.suit, '', 12) }))
      : undefined
    return {
      sequence: index + 1,
      at: Number.isFinite(Number(event.at)) ? Number(event.at) : Number(finishedAt || 0),
      type: normalizeText(event.type, 'action', 32),
      ...(playerId ? { playerId } : {}),
      ...(cards?.length ? { cards } : {}),
      ...(typeof event.text === 'string' ? { text: event.text.trim().slice(0, 80) } : {}),
    }
  })
}

const fixedTournamentFormat = 'fixed16-latin-3'
const isFixedTournament = (tournament) => tournament?.format === fixedTournamentFormat
const rankTournamentEntries = (state, tournamentId) => {
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
const qualificationStatus = (tournament, standing, index) => {
  if (tournament.status !== 'finished' || standing.played < Math.max(1, Number(tournament.roundsTotal) || 1)) return 'pending'
  return index < Number(tournament.advanceCount || 0) ? 'qualified' : 'eliminated'
}
const publicTournamentStanding = (state, tournament, standing, index) => {
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
const tournamentRunError = (error) => {
  if (!(error instanceof TournamentOrchestratorError)) throw error
  throw conflict(error.code, error.message)
}
const tournamentStateView = (state, tournament, userId, run) => {
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

export class PlatformService {
  constructor ({ store, accessTokens, gameTickets, now = () => Date.now(), createId = () => randomUUID(), createAccountId = () => String(randomInt(10_000_000, 100_000_000)), createRoomId } = {}) {
    if (!store || !accessTokens || !gameTickets) throw new TypeError('PlatformService 缺少 store/accessTokens/gameTickets')
    this.store = store
    this.accessTokens = accessTokens
    this.gameTickets = gameTickets
    this.now = now
    this.createId = createId
    this.createAccountId = createAccountId
    this.createRoomId = createRoomId || ((state) => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const candidate = String(randomInt(100000, 1000000))
        if (!Object.values(state.matches).some(match => match.roomId === candidate)) return candidate
      }
      throw conflict('ROOM_ID_EXHAUSTED', '暂时无法分配牌局房间，请稍后重试')
    })
  }

  accountIdIsAvailable (state, accountId, userId = null) {
    const indexedUserId = state.userByAccountId[accountId]
    if (indexedUserId && indexedUserId !== userId) return false
    return !Object.values(state.users).some(user => user.id !== userId && normalizeAccountId(user.accountId) === accountId)
  }

  allocateAccountId (state, userId) {
    state.userByAccountId ||= {}
    for (let attempt = 0; attempt < 128; attempt += 1) {
      const candidate = normalizeAccountId(this.createAccountId())
      if (candidate && this.accountIdIsAvailable(state, candidate, userId)) return candidate
    }
    const usedAccountIds = new Set([
      ...Object.keys(state.userByAccountId).map(normalizeAccountId).filter(Boolean),
      ...Object.values(state.users).map(user => normalizeAccountId(user.accountId)).filter(Boolean),
    ])
    try {
      return findAvailableAccountId(userId, usedAccountIds)
    } catch (error) {
      if (!(error instanceof RangeError)) throw error
      throw conflict('ACCOUNT_ID_EXHAUSTED', '暂时无法分配八位账号，请稍后重试')
    }
  }

  ensureUserAccountId (state, user) {
    state.userByAccountId ||= {}
    const current = normalizeAccountId(user.accountId)
    const accountId = current && this.accountIdIsAvailable(state, current, user.id)
      ? current
      : this.allocateAccountId(state, user.id)
    Object.entries(state.userByAccountId).forEach(([indexedAccountId, indexedUserId]) => {
      if (indexedUserId === user.id && indexedAccountId !== accountId) delete state.userByAccountId[indexedAccountId]
    })
    user.accountId = accountId
    state.userByAccountId[accountId] = user.id
    return accountId
  }

  ensurePlayerRating (state, userId) {
    state.playerRatings ||= {}
    const current = state.playerRatings[userId]
    if (!current) {
      const stats = state.userStats[userId] || emptyStats(userId)
      state.playerRatings[userId] = {
        ...createInitialRating(userId),
        games: Math.max(0, Number(stats.gamesPlayed) || 0),
        wins: Math.max(0, Math.min(Number(stats.wins) || 0, Number(stats.gamesPlayed) || 0)),
        updatedAt: Number(stats.updatedAt) || 0,
      }
    }
    return state.playerRatings[userId]
  }

  ratingView (rating) {
    const snapshot = createRatingSnapshot(rating)
    return {
      games: rating.games,
      wins: rating.wins,
      eloOffset: rating.eloOffset,
      baseScore: formatComprehensiveScore(snapshot.baseScore),
      comprehensiveScore: formatComprehensiveScore(snapshot.comprehensiveScore),
    }
  }

  spectatorRecord (state, matchId) {
    const match = state.matches[matchId]
    const feed = state.spectatorFeeds[matchId]
    if (!feed && (!match || !['matched', 'completed', 'aborted'].includes(match.status))) return null
    return {
      matchId,
      mode: normalizeText(feed?.mode || match?.mode, 'quick', 40),
      startedAt: Number(feed?.startedAt || match?.matchedAt || match?.createdAt || 0),
      finishedAt: Number(feed?.finishedAt || match?.completedAt || 0) || null,
      abortedAt: Number(feed?.abortedAt || match?.abortedAt || 0) || null,
      abortReason: normalizeText(feed?.abortReason || match?.abortReason, '', 32) || null,
      events: Array.isArray(feed?.events) ? feed.events : [],
    }
  }

  publicSpectatorSummary (record, delaySeconds) {
    const availableThrough = this.now() - delaySeconds * 1000
    const terminalAt = record.finishedAt || record.abortedAt
    return {
      matchId: record.matchId,
      tableLabel: spectatorTableLabel(record.matchId, record.mode),
      mode: record.mode,
      status: record.abortedAt ? 'aborted' : record.finishedAt ? 'finished' : 'running',
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      abortedAt: record.abortedAt,
      abortReason: record.abortReason,
      delaySeconds,
      availableEventCount: record.events.filter(event => event.at <= availableThrough).length,
      totalEventCount: record.events.length,
      timelineComplete: Boolean(terminalAt && terminalAt <= availableThrough),
    }
  }

  async loginExternal ({ externalId, displayName, avatarUrl }) {
    const safeExternalId = normalizeText(externalId, '', 180)
    if (!safeExternalId) throw badRequest('EXTERNAL_ID_REQUIRED', '外部用户标识不能为空')
    const safeName = normalizeText(displayName, '陵水牌友', 24)
    const now = this.now()
    const result = await this.store.transaction(state => {
      ensureCollections(state)
      const existingId = state.userByExternalId[safeExternalId]
      if (existingId) {
        const existing = state.users[existingId]
        this.ensureUserAccountId(state, existing)
        existing.displayName = safeName
        if (typeof avatarUrl === 'string') existing.avatarUrl = avatarUrl.trim().slice(0, 500)
        existing.updatedAt = now
        state.userStats[existingId] ||= emptyStats(existingId)
        state.matchHistoryByUser[existingId] ||= []
        return { user: existing, rating: this.ensurePlayerRating(state, existingId) }
      }
      const id = `usr_${this.createId()}`
      const accountId = this.allocateAccountId(state, id)
      const created = {
        id,
        accountId,
        externalId: safeExternalId,
        displayName: safeName,
        avatarUrl: typeof avatarUrl === 'string' ? avatarUrl.trim().slice(0, 500) : '',
        createdAt: now,
        updatedAt: now,
      }
      state.users[id] = created
      state.userByExternalId[safeExternalId] = id
      state.userByAccountId[accountId] = id
      state.userStats[id] = emptyStats(id)
      state.playerRatings[id] = createInitialRating(id)
      state.matchHistoryByUser[id] = []
      state.wallets[id] = { userId: id, balance: 10_000, currency: 'points', updatedAt: now }
      state.ledgerEntries.push({
        id: `led_${this.createId()}`,
        userId: id,
        amount: 10_000,
        balanceAfter: 10_000,
        type: 'welcome_bonus',
        referenceId: id,
        description: '开发账号初始积分',
        createdAt: now,
      })
      return { user: created, rating: state.playerRatings[id] }
    })
    return { ...this.accessTokens.issue(result.user.id), user: this.publicUser(result.user, result.rating) }
  }

  async devLogin ({ deviceId, externalId, displayName, avatarUrl } = {}) {
    const legacyIdentity = normalizeText(externalId, '', 80)
    const stableIdentity = normalizeText(deviceId, legacyIdentity || `guest-${this.createId()}`, 80)
    return this.loginExternal({ externalId: stableIdentity, displayName, avatarUrl })
  }

  async wxLogin ({ code, displayName, avatarUrl } = {}, wxCodeVerifier) {
    if (!wxCodeVerifier || typeof wxCodeVerifier.verify !== 'function') throw new TypeError('wxCodeVerifier 未配置')
    const identity = await wxCodeVerifier.verify(code)
    return this.loginExternal({ externalId: identity.externalId, displayName, avatarUrl })
  }

  async authenticate (token) {
    const claims = this.accessTokens.verify(token)
    const user = await this.store.read(state => state.users[claims.sub] || null)
    if (!user) throw unauthorized('登录用户不存在')
    return user
  }

  publicUser (user, rating = createInitialRating(user.id)) {
    return {
      id: user.id,
      accountId: user.accountId,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl || '',
      comprehensiveScore: formatComprehensiveScore(calculateComprehensiveScore(rating)),
      createdAt: user.createdAt,
    }
  }

  async getProfile (userId) {
    return this.store.read(state => {
      ensureCollections(state)
      const user = state.users[userId]
      if (!user) throw notFound('USER_NOT_FOUND', '用户不存在')
      return this.publicUser(user, this.ensurePlayerRating(state, userId))
    })
  }

  async updateProfile (userId, { displayName, avatarUrl } = {}) {
    const now = this.now()
    return this.store.transaction(state => {
      ensureCollections(state)
      const user = state.users[userId]
      if (!user) throw notFound('USER_NOT_FOUND', '用户不存在')
      if (displayName !== undefined) user.displayName = normalizeText(displayName, user.displayName, 24)
      if (avatarUrl !== undefined) user.avatarUrl = normalizeText(avatarUrl, '', 500)
      user.updatedAt = now
      return this.publicUser(user, this.ensurePlayerRating(state, userId))
    })
  }

  async getWallet (userId, limit = 20) {
    return this.store.read(state => {
      const wallet = state.wallets[userId]
      if (!wallet) throw notFound('WALLET_NOT_FOUND', '积分账户不存在')
      const ledgerEntries = state.ledgerEntries.filter(entry => entry.userId === userId).slice(-Math.max(1, Math.min(100, limit))).reverse()
      return { wallet: { ...wallet, ...walletAvailability(state, userId, wallet) }, ledgerEntries }
    })
  }

  async listProducts () {
    return this.store.read(state => Object.values(state.products).sort((left, right) => left.pointsPrice - right.pointsPrice))
  }

  async redeem (userId, { productId, quantity = 1, expectedPointsPrice } = {}, idempotencyKey) {
    const key = requireIdempotencyKey(idempotencyKey)
    const safeQuantity = Number(quantity)
    if (!Number.isSafeInteger(safeQuantity) || safeQuantity < 1 || safeQuantity > 99) throw badRequest('INVALID_QUANTITY', '兑换数量必须是1到99的整数')
    const safeProductId = normalizeText(productId, '', 80)
    if (!safeProductId) throw badRequest('PRODUCT_ID_REQUIRED', 'productId 必填')
    const normalizedExpectedPrice = expectedPointsPrice === undefined ? null : Number(expectedPointsPrice)
    if (normalizedExpectedPrice !== null && (!Number.isSafeInteger(normalizedExpectedPrice) || normalizedExpectedPrice < 0)) {
      throw badRequest('INVALID_EXPECTED_PRICE', 'expectedPointsPrice 必须是非负整数')
    }
    const requestFingerprint = fingerprint({ productId: safeProductId, quantity: safeQuantity, expectedPointsPrice: normalizedExpectedPrice })
    const now = this.now()
    return this.store.transaction(state => {
      const idempotencyId = `${userId}:${key}`
      const previous = state.orderIdempotency[idempotencyId]
      if (previous) {
        if (previous.fingerprint !== requestFingerprint) throw conflict('IDEMPOTENCY_CONFLICT', '同一个 Idempotency-Key 不能用于不同兑换请求')
        return state.orders[previous.orderId]
      }
      const product = state.products[safeProductId]
      if (!product) throw notFound('PRODUCT_NOT_FOUND', '商品不存在')
      if (normalizedExpectedPrice !== null && product.pointsPrice !== normalizedExpectedPrice) {
        throw conflict('PRODUCT_PRICE_CHANGED', '商品兑换价已变更，请刷新后确认', { expected: normalizedExpectedPrice, current: product.pointsPrice })
      }
      if (product.stock < safeQuantity) throw conflict('OUT_OF_STOCK', '商品库存不足', { stock: product.stock })
      const wallet = state.wallets[userId]
      if (!wallet) throw notFound('WALLET_NOT_FOUND', '积分账户不存在')
      const totalPoints = product.pointsPrice * safeQuantity
      const availability = walletAvailability(state, userId, wallet)
      if (availability.available < totalPoints) throw conflict('INSUFFICIENT_POINTS', '可用积分不足', { ...availability, required: totalPoints })
      const order = {
        orderId: `ord_${this.createId()}`,
        userId,
        productId: product.id,
        quantity: safeQuantity,
        totalPoints,
        status: 'paid',
        createdAt: now,
      }
      product.stock -= safeQuantity
      wallet.balance -= totalPoints
      wallet.updatedAt = now
      state.orders[order.orderId] = order
      state.orderIdempotency[idempotencyId] = { fingerprint: requestFingerprint, orderId: order.orderId }
      state.ledgerEntries.push({
        id: `led_${this.createId()}`,
        userId,
        amount: -totalPoints,
        balanceAfter: wallet.balance,
        type: 'shop_redeem',
        referenceId: order.orderId,
        description: `兑换商品：${product.name}`,
        createdAt: now,
      })
      return order
    })
  }

  async listTournaments (userId = null) {
    return this.store.read(state => {
      ensureCollections(state)
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

  async enrollTournament (userId, tournamentId, idempotencyKey, { expectedEntryPoints } = {}) {
    const key = requireIdempotencyKey(idempotencyKey)
    const normalizedExpectedPoints = expectedEntryPoints === undefined ? null : Number(expectedEntryPoints)
    if (normalizedExpectedPoints !== null && (!Number.isSafeInteger(normalizedExpectedPoints) || normalizedExpectedPoints < 0)) {
      throw badRequest('INVALID_EXPECTED_ENTRY_POINTS', 'expectedEntryPoints 必须是非负整数')
    }
    const now = this.now()
    return this.store.transaction(state => {
      ensureCollections(state)
      const tournament = state.tournaments[tournamentId]
      if (!tournament) throw notFound('TOURNAMENT_NOT_FOUND', '赛事不存在')
      const idempotencyId = `${userId}:${key}`
      const requestFingerprint = fingerprint({ tournamentId, expectedEntryPoints: normalizedExpectedPoints })
      const previous = state.enrollmentIdempotency[idempotencyId]
      if (previous) {
        if (previous.fingerprint !== requestFingerprint) throw conflict('IDEMPOTENCY_CONFLICT', '同一个 Idempotency-Key 不能用于不同报名请求')
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

  async checkInTournament (userId, tournamentId) {
    const now = this.now()
    return this.store.transaction(state => {
      ensureCollections(state)
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

  async getTournamentState (userId, tournamentId) {
    const now = this.now()
    return this.store.read(state => {
      ensureCollections(state)
      const tournament = state.tournaments[tournamentId]
      if (!tournament) throw notFound('TOURNAMENT_NOT_FOUND', '赛事不存在')
      if (!isFixedTournament(tournament)) throw conflict('TOURNAMENT_STATE_UNAVAILABLE', '该赛事不使用固定16人轮次状态')
      const run = state.tournamentRuns[tournamentId] || createFixedTournamentRun(tournament, now)
      return tournamentStateView(state, tournament, userId, run)
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

  removeOpenQueueMatch (state, mode, matchId) {
    const ids = Array.isArray(state.matchQueues[mode]) ? state.matchQueues[mode] : []
    const remaining = ids.filter(id => id !== matchId)
    if (remaining.length) state.matchQueues[mode] = remaining
    else delete state.matchQueues[mode]
  }

  matchView (match, userId) {
    const participant = match.participants.find(item => item.userId === userId)
    if (!participant) throw forbidden('该匹配记录不属于当前用户')
    const base = {
      ticketId: match.id,
      matchId: match.id,
      queueId: match.mode,
      mode: match.mode,
      status: participant.status,
      joinedAt: participant.joinedAt,
      ...(match.tournamentId ? {
        tournamentId: match.tournamentId,
        assignmentId: match.assignmentId,
        roundNumber: match.roundNumber,
        tableNumber: match.tableNumber,
      } : {}),
    }
    if (participant.status !== 'matched') return base
    return {
      ...base,
      roomId: match.roomId,
      seat: participant.seat,
      gameEndpoint: participant.gameEndpoint,
      gameTicket: participant.gameTicket,
      joinToken: participant.gameTicket,
      expiresAt: participant.expiresAt,
    }
  }

  joinFixedTournamentMatch (state, userId, tournament, assignmentId, now) {
    const run = state.tournamentRuns[tournament.id]
    if (!run) throw conflict('TOURNAMENT_CHECK_IN_REQUIRED', '请先完成赛事检录')
    if (run.phase === 'blocked') throw conflict('TOURNAMENT_ROUND_BLOCKED', '本轮存在异常牌桌，赛事已暂停推进')
    if (run.phase === 'finished') throw conflict('TOURNAMENT_ROUNDS_COMPLETE', '赛事已完成，请查看晋级结果')
    if (run.phase !== 'round-active') throw conflict('TOURNAMENT_NOT_READY', '赛事尚未满员，暂不能入桌')

    let assignment
    try {
      assignment = getCurrentTournamentAssignment(run, userId)
    } catch (error) {
      tournamentRunError(error)
    }
    if (!assignment || assignment.assignmentId !== assignmentId) throw conflict('TOURNAMENT_ASSIGNMENT_MISMATCH', '只能进入平台分配的当前轮牌桌')
    if (!['matching', 'matched'].includes(assignment.status)) throw conflict('TOURNAMENT_ASSIGNMENT_NOT_JOINABLE', '当前赛事牌桌不能进入')

    let match = assignment.matchId ? state.matches[assignment.matchId] : Object.values(state.matches).find(item => (
      item.tournamentId === tournament.id && item.assignmentId === assignment.assignmentId && item.status === 'matching'
    ))
    if (assignment.status === 'matched') {
      if (!match || match.id !== assignment.matchId) throw conflict('TOURNAMENT_ASSIGNMENT_CORRUPT', '赛事牌桌绑定状态不完整')
      const participant = match.participants.find(item => item.userId === userId)
      const expectedSeat = seats[assignment.userIds.indexOf(userId)]
      if (!participant || !expectedSeat || participant.seat !== expectedSeat || !match.roomId) {
        throw conflict('TOURNAMENT_ASSIGNMENT_CORRUPT', '赛事牌桌席位绑定状态不完整')
      }
      if (participant.status !== 'matched' || participant.expiresAt <= now) {
        const issued = this.gameTickets.issue({ userId, matchId: match.id, roomId: match.roomId, seat: expectedSeat })
        Object.assign(participant, { status: 'matched', ...issued, reissuedAt: now })
        delete participant.cancelledAt
      }
      state.activeMatchByUser[userId] = match.id
      return this.matchView(match, userId)
    }
    if (!match) {
      match = {
        id: `mat_${this.createId()}`,
        mode: tournament.queueId,
        status: 'matching',
        tournamentId: tournament.id,
        assignmentId: assignment.assignmentId,
        roundNumber: assignment.round,
        tableNumber: assignment.table,
        participants: [],
        createdAt: now,
      }
      state.matches[match.id] = match
    }

    let participant = match.participants.find(item => item.userId === userId)
    if (participant?.status === 'cancelled') {
      participant.status = 'matching'
      participant.joinedAt = now
      delete participant.cancelledAt
    } else if (!participant) {
      participant = { userId, status: 'matching', joinedAt: now }
      match.participants.push(participant)
    }
    state.activeMatchByUser[userId] = match.id

    const waiting = match.participants.filter(item => item.status === 'matching')
    if (waiting.length === 4) {
      const waitingIds = new Set(waiting.map(item => item.userId))
      if (assignment.userIds.some(id => !waitingIds.has(id))) throw conflict('TOURNAMENT_ASSIGNMENT_MISMATCH', '赛事牌桌玩家与分配名单不一致')
      match.status = 'matched'
      match.matchedAt = now
      match.roomId = this.createRoomId(state)
      assignment.userIds.forEach((assignedUserId, index) => {
        const assignedParticipant = match.participants.find(item => item.userId === assignedUserId)
        const issued = this.gameTickets.issue({ userId: assignedUserId, matchId: match.id, roomId: match.roomId, seat: seats[index] })
        Object.assign(assignedParticipant, { status: 'matched', seat: seats[index], ...issued })
      })
      try {
        state.tournamentRuns[tournament.id] = markTournamentAssignmentMatched(run, assignment.assignmentId, match.id, now)
      } catch (error) {
        tournamentRunError(error)
      }
      state.spectatorFeeds[match.id] = { matchId: match.id, mode: match.mode, startedAt: now, finishedAt: null, events: [] }
    }
    return this.matchView(match, userId)
  }

  async joinMatch (userId, { mode = 'quick', tournamentId = '', assignmentId = '' } = {}) {
    const safeMode = normalizeText(mode, 'quick', 40)
    const safeTournamentId = normalizeText(tournamentId, '', 128)
    const safeAssignmentId = normalizeText(assignmentId, '', 128)
    if (!allowedMatchModes.has(safeMode)) throw badRequest('INVALID_MATCH_MODE', '不支持的匹配模式')
    const now = this.now()
    return this.store.transaction(state => {
      ensureCollections(state)
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
      } else if (safeTournamentId || safeAssignmentId) {
        throw badRequest('UNEXPECTED_TOURNAMENT_ASSIGNMENT', '该匹配队列不接受赛事牌桌分配')
      }
      const activeId = state.activeMatchByUser[userId]
      if (activeId) {
        const active = state.matches[activeId]
        if (active) {
          const activeParticipant = active.participants.find(item => item.userId === userId)
          if (activeParticipant?.status === 'matched' && activeParticipant.expiresAt <= now) {
            activeParticipant.status = 'cancelled'
            activeParticipant.cancelledAt = now
            delete state.activeMatchByUser[userId]
          } else {
            if (active.mode !== safeMode) throw conflict('ALREADY_MATCHING', '请先取消当前匹配')
            if (tournament && isFixedTournament(tournament) && (active.tournamentId !== safeTournamentId || active.assignmentId !== safeAssignmentId)) {
              throw conflict('TOURNAMENT_ASSIGNMENT_MISMATCH', '当前匹配不属于请求的赛事牌桌')
            }
            return this.matchView(active, userId)
          }
        }
        delete state.activeMatchByUser[userId]
      }

      if (tournament && isFixedTournament(tournament)) {
        return this.joinFixedTournamentMatch(state, userId, tournament, safeAssignmentId, now)
      }

      const classicStake = classicStakeForMode(safeMode)
      if (classicStake) {
        const wallet = state.wallets[userId]
        if (!wallet) throw notFound('WALLET_NOT_FOUND', '积分账户不存在')
        if (wallet.balance < classicStake) {
          throw conflict('INSUFFICIENT_CLASSIC_STAKE', '积分不足，无法进入该经典场', { balance: wallet.balance, required: classicStake, mode: safeMode })
        }
      }

      const joiningRating = this.ensurePlayerRating(state, userId)
      const joiningScore = calculateComprehensiveScore(joiningRating)
      const openMatches = this.openQueueMatches(state, safeMode)
      openMatches.forEach(openMatch => {
        openMatch.participants.filter(item => item.status === 'matching').forEach(participant => {
          if (!Number.isFinite(participant.comprehensiveScoreAtJoin)) {
            participant.comprehensiveScoreAtJoin = calculateComprehensiveScore(this.ensurePlayerRating(state, participant.userId))
          }
        })
      })
      let match = selectRatingMatch({ queueId: safeMode, matches: openMatches, joiningScore, now })
      if (!match) {
        match = { id: `mat_${this.createId()}`, mode: safeMode, status: 'matching', participants: [], createdAt: now }
        state.matches[match.id] = match
        state.matchQueues[safeMode] = [...(state.matchQueues[safeMode] || []), match.id]
      }
      const returningParticipant = match.participants.find(item => item.userId === userId && item.status === 'cancelled')
      if (returningParticipant) {
        returningParticipant.status = 'matching'
        returningParticipant.joinedAt = now
        returningParticipant.comprehensiveScoreAtJoin = joiningScore
        delete returningParticipant.cancelledAt
      } else {
        match.participants.push({ userId, status: 'matching', joinedAt: now, comprehensiveScoreAtJoin: joiningScore })
      }
      state.activeMatchByUser[userId] = match.id

      const waiting = match.participants.filter(item => item.status === 'matching')
      if (waiting.length === 4) {
        match.status = 'matched'
        match.matchedAt = now
        match.roomId = this.createRoomId(state)
        waiting.forEach((participant, index) => {
          const issued = this.gameTickets.issue({ userId: participant.userId, matchId: match.id, roomId: match.roomId, seat: seats[index] })
          Object.assign(participant, { status: 'matched', seat: seats[index], ...issued })
        })
        state.spectatorFeeds[match.id] = {
          matchId: match.id,
          mode: match.mode,
          startedAt: now,
          finishedAt: null,
          events: [],
        }
        this.removeOpenQueueMatch(state, safeMode, match.id)
      }
      return this.matchView(match, userId)
    })
  }

  async getMatchStatus (userId, matchId) {
    return this.store.read(state => {
      const match = state.matches[matchId]
      if (!match) throw notFound('MATCH_NOT_FOUND', '匹配记录不存在')
      return this.matchView(match, userId)
    })
  }

  async cancelMatch (userId, matchId) {
    const now = this.now()
    return this.store.transaction(state => {
      const match = state.matches[matchId]
      if (!match) throw notFound('MATCH_NOT_FOUND', '匹配记录不存在')
      const participant = match.participants.find(item => item.userId === userId)
      if (!participant) throw forbidden('该匹配记录不属于当前用户')
      if (state.activeMatchByUser[userId] !== match.id) throw conflict('MATCH_NOT_ACTIVE', '只能取消当前进行中的匹配')
      if (!['matching', 'matched'].includes(match.status) || !['matching', 'matched'].includes(participant.status)) {
        throw conflict('MATCH_NOT_CANCELLABLE', '该匹配已经结束，不能取消')
      }
      if (participant.status === 'matched' && participant.expiresAt > now) throw conflict('MATCH_ALREADY_ASSIGNED', '已经分配牌桌，不能取消匹配')
      participant.status = 'cancelled'
      participant.cancelledAt = now
      if (state.activeMatchByUser[userId] === match.id) delete state.activeMatchByUser[userId]
      if (!match.participants.some(item => item.status === 'matching')) {
        match.status = 'cancelled'
        this.removeOpenQueueMatch(state, match.mode, match.id)
      }
      return this.matchView(match, userId)
    })
  }

  async getPlayerDashboard (userId) {
    return this.store.read(state => {
      ensureCollections(state)
      const user = state.users[userId]
      if (!user) throw notFound('USER_NOT_FOUND', '用户不存在')
      const stats = { ...(state.userStats[userId] || emptyStats(userId)) }
      delete stats.elo
      const rating = this.ensurePlayerRating(state, userId)
      const recentMatches = (state.matchHistoryByUser[userId] || []).slice(-10).reverse()
      const season = Object.values(state.seasons).find(item => isSeasonActive(item, this.now())) || null
      const seasonRecord = season ? (state.seasonProgress[`${season.id}:${userId}`] || { seasonId: season.id, userId, score: 0, gamesPlayed: 0, wins: 0 }) : null
      return { user: this.publicUser(user, rating), rating: this.ratingView(rating), stats, season: season ? { ...season, progress: seasonRecord } : null, recentMatches }
    })
  }

  async listTournamentStandings (tournamentId, userId = null) {
    return this.store.read(state => {
      ensureCollections(state)
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

  async listSeasonTasks (userId) {
    return this.store.read(state => {
      ensureCollections(state)
      const stats = state.userStats[userId] || emptyStats(userId)
      const dayKey = businessDayKey(this.now())
      const dailyStats = state.dailyStats[`${dayKey}:${userId}`] || emptyStats(userId)
      const season = Object.values(state.seasons).find(item => isSeasonActive(item, this.now())) || null
      if (!season) return { season: null, tasks: [] }
      const tasks = Object.values(state.taskDefinitions).filter(task => task.seasonId === season.id).map(task => {
        const metricSource = task.cadence === 'daily' ? dailyStats : stats
        const progress = Math.min(task.target, Number(metricSource[task.metric] || 0))
        const period = task.cadence === 'daily' ? dayKey : season.id
        const claim = state.taskProgress[`${userId}:${task.id}:${period}`]
        return { ...task, progress, completed: progress >= task.target, claimed: Boolean(claim?.claimedAt) }
      })
      return { season, tasks }
    })
  }

  async claimSeasonTask (userId, taskId, idempotencyKey) {
    const key = requireIdempotencyKey(idempotencyKey)
    const now = this.now()
    return this.store.transaction(state => {
      ensureCollections(state)
      const task = state.taskDefinitions[taskId]
      if (!task) throw notFound('TASK_NOT_FOUND', '赛季任务不存在')
      if (!isSeasonActive(state.seasons[task.seasonId], now)) throw conflict('SEASON_NOT_ACTIVE', '该任务所属赛季当前不可领奖')
      const stats = state.userStats[userId] || emptyStats(userId)
      const dayKey = businessDayKey(now)
      const metricSource = task.cadence === 'daily' ? (state.dailyStats[`${dayKey}:${userId}`] || emptyStats(userId)) : stats
      if (Number(metricSource[task.metric] || 0) < task.target) throw conflict('TASK_NOT_COMPLETE', '任务尚未完成')
      const period = task.cadence === 'daily' ? dayKey : task.seasonId
      const claimId = `${userId}:${taskId}:${period}`
      const idempotencyId = `${userId}:${key}`
      const previous = state.taskClaimIdempotency[idempotencyId]
      if (previous && previous !== claimId) throw conflict('IDEMPOTENCY_CONFLICT', '同一个 Idempotency-Key 不能领取不同任务')
      const existing = state.taskProgress[claimId]
      if (existing?.claimedAt) {
        state.taskClaimIdempotency[idempotencyId] = claimId
        return { ...existing, duplicate: true }
      }
      const wallet = state.wallets[userId]
      if (!wallet) throw notFound('WALLET_NOT_FOUND', '积分账户不存在')
      wallet.balance += task.rewardPoints
      wallet.updatedAt = now
      const claim = { userId, taskId, rewardPoints: task.rewardPoints, claimedAt: now }
      state.taskProgress[claimId] = claim
      state.taskClaimIdempotency[idempotencyId] = claimId
      state.ledgerEntries.push({
        id: `led_${this.createId()}`,
        userId,
        amount: task.rewardPoints,
        balanceAfter: wallet.balance,
        type: 'season_task_reward',
        referenceId: claimId,
        description: `赛季任务：${task.name}`,
        createdAt: now,
      })
      return { ...claim, duplicate: false }
    })
  }

  async listReplays (userId) {
    return this.store.read(state => {
      ensureCollections(state)
      return Object.values(state.replays).filter(replay => replay.userIds.includes(userId)).sort((left, right) => right.finishedAt - left.finishedAt).slice(0, 30).map(({ events, userIds: _userIds, ...summary }) => ({ ...summary, eventCount: events.length }))
    })
  }

  async getReplay (userId, replayId) {
    return this.store.read(state => {
      ensureCollections(state)
      const replay = state.replays[replayId]
      if (!replay) throw notFound('REPLAY_NOT_FOUND', '牌谱不存在')
      if (!replay.userIds.includes(userId)) throw forbidden('只能查看自己参与的牌谱')
      const { userIds: _userIds, ...publicReplay } = replay
      return publicReplay
    })
  }

  async listSpectatorFeeds (delaySeconds = 30) {
    const delay = spectatorDelaySeconds(delaySeconds)
    return this.store.read(state => {
      ensureCollections(state)
      const matchIds = new Set([
        ...Object.keys(state.spectatorFeeds),
        ...Object.values(state.matches).filter(match => ['matched', 'completed', 'aborted'].includes(match.status)).map(match => match.id),
      ])
      const feeds = [...matchIds]
        .map(matchId => this.spectatorRecord(state, matchId))
        .filter(Boolean)
        .map(record => this.publicSpectatorSummary(record, delay))
        .sort((left, right) => left.status === right.status ? right.startedAt - left.startedAt : left.status === 'running' ? -1 : 1)
        .slice(0, 50)
      return { delaySeconds: delay, feeds }
    })
  }

  async getSpectatorFeed (matchId, delaySeconds = 30) {
    const delay = spectatorDelaySeconds(delaySeconds)
    const availableThrough = this.now() - delay * 1000
    return this.store.read(state => {
      ensureCollections(state)
      const record = this.spectatorRecord(state, matchId)
      if (!record) throw notFound('SPECTATOR_FEED_NOT_FOUND', '观战牌局不存在')
      return {
        ...this.publicSpectatorSummary(record, delay),
        availableThrough,
        events: record.events.filter(event => event.at <= availableThrough).map(publicSpectatorEvent),
      }
    })
  }

  merchantContext (state, userId, { allowPending = false } = {}) {
    ensureCollections(state)
    const ownedId = state.merchantByOwner[userId]
    if (ownedId && state.merchants[ownedId]) {
      const merchant = state.merchants[ownedId]
      if (!allowPending && merchant.status !== 'active') throw forbidden('商户申请尚未审核通过')
      return { merchant, role: 'owner' }
    }
    const employee = Object.values(state.merchantEmployees).find(item => item.userId === userId && item.status === 'active')
    if (employee && state.merchants[employee.merchantId]) {
      const merchant = state.merchants[employee.merchantId]
      if (!allowPending && merchant.status !== 'active') throw forbidden('商户账户当前不可用')
      return { merchant, role: employee.role, employee }
    }
    throw forbidden('当前账号没有商户后台权限')
  }

  async applyMerchant (userId, { name, contactName } = {}) {
    const safeName = normalizeText(name, '', 60)
    if (!safeName) throw badRequest('MERCHANT_NAME_REQUIRED', '商户名称不能为空')
    const now = this.now()
    return this.store.transaction(state => {
      ensureCollections(state)
      const existingId = state.merchantByOwner[userId]
      if (existingId) return state.merchants[existingId]
      const merchant = {
        id: `mch_${this.createId()}`,
        ownerUserId: userId,
        name: safeName,
        contactName: normalizeText(contactName, state.users[userId]?.displayName || '负责人', 40),
        status: 'pending',
        dailyPointLimit: 5000,
        createdAt: now,
      }
      state.merchants[merchant.id] = merchant
      state.merchantByOwner[userId] = merchant.id
      return merchant
    })
  }

  async getMerchantConsole (userId) {
    return this.store.read(state => {
      const context = this.merchantContext(state, userId, { allowPending: true })
      const merchantId = context.merchant.id
      const stores = Object.values(state.merchantStores).filter(item => item.merchantId === merchantId)
      const employees = Object.values(state.merchantEmployees).filter(item => item.merchantId === merchantId)
      const grants = Object.values(state.merchantPointGrants).filter(item => item.merchantId === merchantId).sort((left, right) => right.createdAt - left.createdAt).slice(0, 50)
      return { merchant: context.merchant, role: context.role, stores, employees, grants, grantedPoints: grants.filter(item => item.status === 'posted').reduce((total, item) => total + item.amount, 0) }
    })
  }

  async createMerchantStore (userId, { name, address } = {}, idempotencyKey) {
    const key = requireIdempotencyKey(idempotencyKey)
    const safeName = normalizeText(name, '', 60)
    if (!safeName) throw badRequest('STORE_NAME_REQUIRED', '门店名称不能为空')
    const now = this.now()
    return this.store.transaction(state => {
      const context = this.merchantContext(state, userId)
      if (!['owner', 'manager'].includes(context.role)) throw forbidden('只有商户负责人或管理员可以创建门店')
      const idem = `${context.merchant.id}:store:${key}`
      const previous = state.merchantIdempotency[idem]
      if (previous) return state.merchantStores[previous]
      const store = { id: `str_${this.createId()}`, merchantId: context.merchant.id, name: safeName, address: normalizeText(address, '', 120), status: 'active', createdAt: now }
      state.merchantStores[store.id] = store
      state.merchantIdempotency[idem] = store.id
      return store
    })
  }

  async addMerchantEmployee (userId, { employeeUserId, role = 'cashier' } = {}) {
    const safeEmployeeId = normalizeText(employeeUserId, '', 100)
    if (!['cashier', 'manager'].includes(role)) throw badRequest('INVALID_EMPLOYEE_ROLE', '员工角色只能是 cashier 或 manager')
    return this.store.transaction(state => {
      const context = this.merchantContext(state, userId)
      if (context.role !== 'owner') throw forbidden('只有商户负责人可以管理员工')
      if (!state.users[safeEmployeeId]) throw notFound('EMPLOYEE_USER_NOT_FOUND', '员工用户不存在')
      const id = `${context.merchant.id}:${safeEmployeeId}`
      const employee = { id, merchantId: context.merchant.id, userId: safeEmployeeId, role, status: 'active', updatedAt: this.now() }
      state.merchantEmployees[id] = employee
      return employee
    })
  }

  async grantMerchantPoints (userId, { storeId, recipientUserId, amount, note } = {}, idempotencyKey) {
    const key = requireIdempotencyKey(idempotencyKey)
    const points = requirePositiveInteger(amount, 'INVALID_GRANT_AMOUNT', '单次积分必须是1到1000的整数', 1000)
    const now = this.now()
    return this.store.transaction(state => {
      const context = this.merchantContext(state, userId)
      const store = state.merchantStores[storeId]
      if (!store || store.merchantId !== context.merchant.id || store.status !== 'active') throw notFound('STORE_NOT_FOUND', '门店不存在或不可用')
      const recipient = state.users[recipientUserId]
      const wallet = state.wallets[recipientUserId]
      if (!recipient || !wallet) throw notFound('RECIPIENT_NOT_FOUND', '积分接收用户不存在')
      const recipientIsMerchantParty = recipientUserId === context.merchant.ownerUserId || Object.values(state.merchantEmployees).some(item => item.merchantId === context.merchant.id && item.userId === recipientUserId && item.status === 'active')
      if (recipientIsMerchantParty) throw forbidden('商户不能向负责人或员工账户发放积分')
      const idem = `${context.merchant.id}:grant:${key}`
      const requestFingerprint = fingerprint({ storeId, recipientUserId, amount: points, note: normalizeText(note, '', 80) })
      const previous = state.merchantIdempotency[idem]
      if (previous) {
        const grant = state.merchantPointGrants[previous]
        if (grant.fingerprint !== requestFingerprint) throw conflict('IDEMPOTENCY_CONFLICT', '同一个 Idempotency-Key 不能用于不同积分发放')
        return { ...grant, duplicate: true }
      }
      const dayStart = new Date(now).setHours(0, 0, 0, 0)
      const grantedToday = Object.values(state.merchantPointGrants).filter(item => item.merchantId === context.merchant.id && item.createdAt >= dayStart && item.status === 'posted').reduce((total, item) => total + item.amount, 0)
      if (grantedToday + points > context.merchant.dailyPointLimit) throw conflict('MERCHANT_DAILY_LIMIT', '商户今日积分发放额度不足', { grantedToday, dailyLimit: context.merchant.dailyPointLimit })
      wallet.balance += points
      wallet.updatedAt = now
      const grant = { id: `mgr_${this.createId()}`, merchantId: context.merchant.id, storeId, operatorUserId: userId, recipientUserId, amount: points, note: normalizeText(note, '', 80), status: 'posted', createdAt: now, fingerprint: requestFingerprint }
      state.merchantPointGrants[grant.id] = grant
      state.merchantIdempotency[idem] = grant.id
      state.ledgerEntries.push({ id: `led_${this.createId()}`, userId: recipientUserId, amount: points, balanceAfter: wallet.balance, type: 'merchant_grant', referenceId: grant.id, description: `商户积分：${context.merchant.name}`, createdAt: now })
      return { ...grant, duplicate: false }
    })
  }

  async acceptSpectatorEvent (eventId, rawEvent) {
    const now = this.now()
    const event = normalizeSpectatorEvent(eventId, rawEvent, now)
    return this.store.transaction(state => {
      ensureCollections(state)
      const previous = state.spectatorEventReceipts[eventId]
      if (previous) {
        if (previous.fingerprint !== fingerprint(event)) throw conflict('SPECTATOR_EVENT_ID_CONFLICT', '同一个观战事件ID不能对应不同内容')
        return { eventId, matchId: event.matchId, sequence: event.sequence, accepted: true, duplicate: true, ignored: Boolean(previous.ignored), processedAt: previous.processedAt }
      }
      const match = state.matches[event.matchId]
      if (!match || match.roomId !== event.roomId) throw forbidden('观战事件与已分配匹配不一致')
      if (!['matched', 'completed', 'aborted'].includes(match.status)) throw conflict('MATCH_NOT_SPECTATABLE', '当前匹配不能写入观战事件')
      const feed = state.spectatorFeeds[event.matchId]
      if (!feed) throw conflict('SPECTATOR_FEED_NOT_READY', '观战事件流尚未建立')
      if (feed.abortedAt) throw conflict('SPECTATOR_FEED_ABORTED', '已终止牌桌不能继续写入观战事件')
      if (feed.finishedAt && event.type === 'room-closed') {
        // 正常结算后的全员离桌只是牌局服资源回收。确认回调以终止发送端重试，
        // 但不追加异常事件、不改变 finished 状态，也不触碰赛事/钱包数据。
        const processedAt = now
        state.spectatorEventReceipts[eventId] = { eventId, matchId: event.matchId, sequence: event.sequence, fingerprint: fingerprint(event), processedAt, ignored: true }
        return { eventId, matchId: event.matchId, sequence: event.sequence, accepted: true, duplicate: false, ignored: true, processedAt }
      }
      // 结算回调和公开事件使用两条独立异步通道。结算可能先到，因此允许牌局实际
      // 结束时间附近、序号连续的尾部公开动作补写；但正常完成后不能改判为 aborted。
      if (feed.finishedAt && event.at > feed.finishedAt + 60_000) throw conflict('SPECTATOR_FEED_FINISHED', '已结算牌桌不能写入该观战事件')
      const expectedSequence = (feed.events.at(-1)?.sequence || 0) + 1
      if (event.sequence !== expectedSequence) throw conflict('SPECTATOR_EVENT_OUT_OF_ORDER', '观战事件序号不连续', { expectedSequence, receivedSequence: event.sequence })
      if (feed.events.length >= 100_000) throw conflict('SPECTATOR_FEED_LIMIT', '单桌观战事件数量已达上限')
      feed.events.push(structuredClone(event))
      if (event.type === 'room-closed') {
        feed.abortedAt = event.at
        feed.abortReason = event.reason
        match.status = 'aborted'
        match.abortedAt = event.at
        match.abortReason = event.reason
        match.participants.forEach(participant => {
          participant.status = 'aborted'
          participant.abortedAt = event.at
          if (state.activeMatchByUser[participant.userId] === match.id) delete state.activeMatchByUser[participant.userId]
        })
        const tournament = match.tournamentId ? state.tournaments[match.tournamentId] : null
        if (tournament && isFixedTournament(tournament) && match.assignmentId) {
          try {
            state.tournamentRuns[tournament.id] = blockTournamentAssignment(
              state.tournamentRuns[tournament.id],
              match.assignmentId,
              match.id,
              `牌桌异常终止：${event.reason}`,
              event.at,
            )
          } catch (error) {
            tournamentRunError(error)
          }
        }
      }
      const settledResultId = state.gameResultByMatch?.[event.matchId]
      const replay = settledResultId ? state.replays[`rpl_${settledResultId}`] : null
      if (replay) replay.events = feed.events.map(item => structuredClone(item))
      const processedAt = now
      state.spectatorEventReceipts[eventId] = { eventId, matchId: event.matchId, sequence: event.sequence, fingerprint: fingerprint(event), processedAt }
      return { eventId, matchId: event.matchId, sequence: event.sequence, accepted: true, duplicate: false, processedAt }
    })
  }

  async acceptGameResult (eventId, event) {
    if (!event || typeof event !== 'object') throw badRequest('INVALID_GAME_RESULT', '结算事件内容无效')
    if (!eventId || event.eventId !== eventId) throw badRequest('EVENT_ID_MISMATCH', '事件ID请求头与正文不一致')
    if (!/^\d{6}$/.test(String(event.roomId || ''))) throw badRequest('INVALID_ROOM_ID', '结算事件 roomId 无效')
    const ranking = event.ranking
    if (!Array.isArray(ranking) || ranking.length !== 4 || new Set(ranking).size !== 4 || !ranking.every(seat => seats.includes(seat))) {
      throw badRequest('INVALID_RANKING', '结算名次必须包含不重复的 p1 到 p4')
    }
    const usersBySeat = event.userIdsBySeat
    const now = this.now()
    if (!usersBySeat || !seats.every(seat => typeof usersBySeat[seat] === 'string' && usersBySeat[seat].trim())) throw badRequest('INVALID_PARTICIPANTS', '结算事件缺少席位用户')
    if (new Set(seats.map(seat => usersBySeat[seat])).size !== 4) throw badRequest('DUPLICATE_PARTICIPANTS', '四个席位必须对应四个不同用户')
    if (!['teamA', 'teamB'].includes(event.winnerTeam)) throw badRequest('INVALID_WINNER_TEAM', 'winnerTeam 必须是 teamA 或 teamB')
    const firstTeam = ['p1', 'p3'].includes(ranking[0]) ? 'teamA' : 'teamB'
    if (event.winnerTeam !== firstTeam) throw badRequest('WINNER_RANKING_MISMATCH', '胜方与头游席位不一致')
    const finishedAt = Number(event.finishedAt)
    if (!Number.isSafeInteger(finishedAt) || finishedAt < now - 30 * 24 * 60 * 60 * 1000 || finishedAt > now + 5 * 60 * 1000) {
      throw badRequest('INVALID_FINISHED_AT', '结算时间无效或超出允许窗口')
    }
    seats.forEach(seat => {
      const rawBombs = event.statsBySeat?.[seat]?.bombsPlayed
      if (rawBombs !== undefined && (!Number.isSafeInteger(rawBombs) || rawBombs < 0 || rawBombs > 99)) throw badRequest('INVALID_GAME_STATS', `${seat} 的炸弹数必须是 0 到 99 的整数`)
    })
    const rewards = [100, 60, 30, 10]
    return this.store.transaction(state => {
      ensureCollections(state)
      const previous = state.gameResults[eventId]
      if (previous) {
        if (fingerprint(previous.event) !== fingerprint(event)) throw conflict('EVENT_ID_CONFLICT', '同一个结算事件ID不能对应不同内容')
        return { eventId, accepted: true, duplicate: true, processedAt: previous.processedAt }
      }
      let matchedGame = null
      if (event.matchId) {
        const match = state.matches[event.matchId]
        if (!match || match.roomId !== String(event.roomId)) throw forbidden('结算事件与已分配匹配不一致')
        matchedGame = match
        const participantsBySeat = Object.fromEntries(match.participants.filter(item => item.seat).map(item => [item.seat, item.userId]))
        if (!seats.every(seat => participantsBySeat[seat] === usersBySeat[seat])) throw forbidden('结算席位用户与匹配分配不一致')
        state.gameResultByMatch ||= {}
        const settledEventId = state.gameResultByMatch[event.matchId]
        if (settledEventId && settledEventId !== eventId) throw conflict('MATCH_ALREADY_SETTLED', '该匹配已经完成结算')
      }
      const replayId = `rpl_${eventId}`
      const reportedTimeline = sanitizeTimeline(event.publicTimeline, finishedAt)
      const streamedTimeline = event.matchId && Array.isArray(state.spectatorFeeds[event.matchId]?.events)
        ? state.spectatorFeeds[event.matchId].events.map(item => structuredClone(item))
        : []
      const publicTimeline = streamedTimeline.length ? streamedTimeline : reportedTimeline
      if (!publicTimeline.length) publicTimeline.push({ sequence: 1, at: finishedAt, type: 'settlement', text: `本局第1名：${ranking[0]}` })
      const tournament = matchedGame
        ? (matchedGame.tournamentId ? state.tournaments[matchedGame.tournamentId] : Object.values(state.tournaments).find(item => item.queueId === matchedGame.mode))
        : null
      const fixedRun = tournament && isFixedTournament(tournament) ? state.tournamentRuns[tournament.id] : null
      if (tournament && isFixedTournament(tournament)) {
        if (!fixedRun || !matchedGame.assignmentId || !matchedGame.roundNumber || !matchedGame.tableNumber) {
          throw conflict('TOURNAMENT_ASSIGNMENT_CORRUPT', '赛事结算缺少服务端牌桌分配')
        }
        const resultKeys = Object.values(usersBySeat).map(userId => `${tournament.id}:${matchedGame.roundNumber}:${userId}`)
        const duplicateKey = resultKeys.find(key => state.tournamentPlayerRoundResults[key])
        if (duplicateKey) throw conflict('TOURNAMENT_PLAYER_ROUND_SETTLED', '玩家本轮赛事结果已经结算')
      }
      seats.forEach(seat => {
        const userId = usersBySeat[seat]
        if (!state.wallets[userId] || !state.users[userId]) throw badRequest('UNKNOWN_RESULT_USER', `结算用户不存在：${seat}`)
      })
      const ratingResult = applyMatchRating(
        ['p1', 'p3'].map(seat => this.ensurePlayerRating(state, usersBySeat[seat])),
        ['p2', 'p4'].map(seat => this.ensurePlayerRating(state, usersBySeat[seat])),
        event.winnerTeam,
      )
      const nextRatingsByUser = Object.fromEntries([...ratingResult.teamA, ...ratingResult.teamB].map(rating => [rating.id, rating]))
      const classicSettlement = matchedGame && classicStakeForMode(matchedGame.mode)
        ? settleClassicStake({
            mode: matchedGame.mode,
            winnerTeam: event.winnerTeam,
            userIdsBySeat: usersBySeat,
            balancesByUser: Object.fromEntries(Object.values(usersBySeat).map(userId => [userId, state.wallets[userId].balance])),
          })
        : null
      const tournamentPoints = [3, 2, 1, 0]
      ranking.forEach((seat, index) => {
        const userId = usersBySeat[seat]
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
        state.playerRatings[userId] = { ...nextRatingsByUser[userId], updatedAt: now }
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
          const progressId = `${season.id}:${userId}`
          const progress = state.seasonProgress[progressId] ||= { seasonId: season.id, userId, score: 0, gamesPlayed: 0, wins: 0, updatedAt: now }
          progress.gamesPlayed += 1
          if (won) progress.wins += 1
          progress.score += Math.max(1, 4 - index)
          progress.updatedAt = now
        }

        if (tournament) {
          const standingId = `${tournament.id}:${userId}`
          const standing = state.tournamentStandings[standingId] ||= { tournamentId: tournament.id, userId, played: 0, wins: 0, firstPlaces: 0, points: 0, opponentPoints: 0, rank: 0, advanced: false, opponents: [], updatedAt: now }
          standing.played += 1
          standing.points += tournamentPoints[index]
          if (won) standing.wins += 1
          if (index === 0) standing.firstPlaces += 1
          standing.opponents.push(...Object.values(usersBySeat).filter(id => id !== userId))
          standing.updatedAt = now
        }
      })
      if (tournament) {
        const resultId = `${tournament.id}:${eventId}`
        const roundsTotal = Math.max(1, Number(tournament.roundsTotal) || 1)
        const resultRound = isFixedTournament(tournament) ? matchedGame.roundNumber : Number(event.tournamentRound) || Math.max(1, Number(tournament.currentRound) || 1)
        state.tournamentRoundResults[resultId] = {
          id: resultId,
          tournamentId: tournament.id,
          eventId,
          matchId: event.matchId,
          ...(matchedGame?.assignmentId ? { assignmentId: matchedGame.assignmentId, tableNumber: matchedGame.tableNumber } : {}),
          ranking: [...ranking],
          usersBySeat: structuredClone(usersBySeat),
          round: resultRound,
          createdAt: now,
        }
        if (isFixedTournament(tournament)) {
          let nextRun
          try {
            nextRun = completeTournamentAssignment(fixedRun, matchedGame.assignmentId, matchedGame.id, now)
          } catch (error) {
            tournamentRunError(error)
          }
          state.tournamentRuns[tournament.id] = nextRun
          Object.values(usersBySeat).forEach(userId => {
            const playerRoundId = `${tournament.id}:${resultRound}:${userId}`
            state.tournamentPlayerRoundResults[playerRoundId] = {
              id: playerRoundId,
              tournamentId: tournament.id,
              round: resultRound,
              userId,
              assignmentId: matchedGame.assignmentId,
              matchId: matchedGame.id,
              eventId,
              createdAt: now,
            }
          })
          tournament.currentRound = nextRun.currentRound
          tournament.status = nextRun.phase === 'finished' ? 'finished' : 'running'
        }
        const tournamentStandings = rankTournamentEntries(state, tournament.id)
        if (!isFixedTournament(tournament)) {
          tournament.currentRound = Math.min(roundsTotal, Math.max(...tournamentStandings.map(item => item.played), 1))
          tournament.status = tournamentStandings.length >= 4 && tournamentStandings.every(item => item.played >= roundsTotal) ? 'finished' : 'running'
        }
        tournamentStandings.forEach((standing, index) => {
          standing.advanced = qualificationStatus(tournament, standing, index) === 'qualified'
        })
      }

      const participantNames = Object.fromEntries(seats.map(seat => [seat, state.users[usersBySeat[seat]]?.displayName || '牌友']))
      state.replays[replayId] = {
        id: replayId,
        eventId,
        matchId: event.matchId || '',
        roomId: String(event.roomId),
        userIds: Object.values(usersBySeat),
        participants: participantNames,
        ranking: [...ranking],
        winnerTeam: event.winnerTeam,
        tournamentId: tournament?.id || null,
        finishedAt,
        events: publicTimeline,
      }
      if (event.matchId) {
        const existingFeed = state.spectatorFeeds[event.matchId]
        state.spectatorFeeds[event.matchId] = {
          matchId: event.matchId,
          mode: matchedGame?.mode || existingFeed?.mode || 'quick',
          startedAt: existingFeed?.startedAt || matchedGame?.matchedAt || finishedAt,
          // 实时流优先。兼容旧牌局服时，结算正文携带的 publicTimeline 才作为回退。
          events: streamedTimeline.length ? streamedTimeline : reportedTimeline,
          finishedAt,
          abortedAt: null,
          abortReason: null,
        }
      }
      if (event.matchId && state.matches[event.matchId]) {
        const completedMatch = state.matches[event.matchId]
        completedMatch.status = 'completed'
        completedMatch.completedAt = now
        delete completedMatch.abortedAt
        delete completedMatch.abortReason
        completedMatch.participants.forEach(participant => {
          participant.status = 'completed'
          participant.completedAt = now
          delete participant.abortedAt
          delete participant.cancelledAt
        })
        Object.values(usersBySeat).forEach(userId => {
          if (state.activeMatchByUser[userId] === event.matchId) delete state.activeMatchByUser[userId]
        })
        state.gameResultByMatch[event.matchId] = eventId
      }
      state.gameResults[eventId] = { eventId, event: structuredClone(event), processedAt: now }
      return { eventId, accepted: true, duplicate: false, processedAt: now }
    })
  }
}
