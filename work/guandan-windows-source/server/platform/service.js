import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import { AccountService, emptyStats } from './account-service.js'
import { CommerceService } from './commerce-service.js'
import { badRequest, conflict, forbidden, notFound } from './errors.js'
import { FriendRoomService, friendRoomDefaultTtlMs } from './friend-room-service.js'
import { SpectatorEventService } from './spectator-event-service.js'
import { ensureCollections } from './state-collections.js'
import { GameResultService } from './game-result-service.js'
import { MerchantService } from './merchant-service.js'
import { MatchmakingService } from './matchmaking-service.js'
import {
  createPublicSpectatorSummary,
  createSpectatorRecord,
  normalizeSpectatorDelay,
  publicSpectatorEvent,
} from './spectator-domain.js'
import { TournamentService } from './tournament-service.js'

const requireIdempotencyKey = (value) => {
  const key = typeof value === 'string' ? value.trim() : ''
  if (!key || key.length > 128) throw badRequest('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key 必填且不能超过128字符')
  return key
}
const businessDayKey = (timestamp) => new Date(Number(timestamp) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
const isSeasonActive = (season, now) => Boolean(
  season && season.status === 'active' &&
  (!Number.isFinite(Number(season.startsAt)) || Number(season.startsAt) <= now) &&
  (!Number.isFinite(Number(season.endsAt)) || Number(season.endsAt) >= now),
)
export class PlatformService {
  constructor ({
    store,
    accessTokens,
    gameTickets,
    now = () => Date.now(),
    createId = () => randomUUID(),
    createAccountId = () => String(randomInt(10_000_000, 100_000_000)),
    createInviteCode = () => randomBytes(24).toString('base64url'),
    createEntryAttemptId = () => randomBytes(16).toString('base64url'),
    friendRoomTtlMs = friendRoomDefaultTtlMs,
    createRoomId,
  } = {}) {
    if (!store || !accessTokens || !gameTickets) throw new TypeError('PlatformService 缺少 store/accessTokens/gameTickets')
    this.store = store
    this.accessTokens = accessTokens
    this.gameTickets = gameTickets
    this.now = now
    this.createId = createId
    this.createAccountId = createAccountId
    this.createInviteCode = createInviteCode
    this.createEntryAttemptId = createEntryAttemptId
    this.accounts = new AccountService({
      store,
      accessTokens,
      now: () => this.now(),
      createId: () => this.createId(),
      createAccountId: () => this.createAccountId(),
    })
    this.commerce = new CommerceService({ store, now: () => this.now(), createId: () => this.createId() })
    this.merchants = new MerchantService({ store, now: () => this.now(), createId: () => this.createId() })
    this.tournaments = new TournamentService({ store, now: () => this.now(), createId: () => this.createId() })
    this.friendRoomTtlMs = Math.max(60_000, Math.min(24 * 60 * 60_000, Number(friendRoomTtlMs) || friendRoomDefaultTtlMs))
    this.createRoomId = createRoomId || ((state) => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const candidate = String(randomInt(100000, 1000000))
        if (!Object.values(state.matches).some(match => match.roomId === candidate)) return candidate
      }
      throw conflict('ROOM_ID_EXHAUSTED', '暂时无法分配牌局房间，请稍后重试')
    })
    this.friendRooms = new FriendRoomService({
      store,
      gameTickets,
      now: () => this.now(),
      createId: () => this.createId(),
      createInviteCode: () => this.createInviteCode(),
      createEntryAttemptId: () => this.createEntryAttemptId(),
      createRoomId: state => this.createRoomId(state),
      friendRoomTtlMs: this.friendRoomTtlMs,
      cancelExpiredUnstartedMatch: (state, match, timestamp) => this.cancelExpiredUnstartedMatch(state, match, timestamp),
    })
    this.matchmaking = new MatchmakingService({
      store,
      gameTickets,
      now: () => this.now(),
      createId: () => this.createId(),
      createEntryAttemptId: () => this.createEntryAttemptId(),
      createRoomId: state => this.createRoomId(state),
      ensurePlayerRating: (state, userId) => this.ensurePlayerRating(state, userId),
      ensureParticipantEntryAttemptId: (participant, preferred) => this.ensureParticipantEntryAttemptId(participant, preferred),
      friendRooms: this.friendRooms,
    })
    this.gameResultService = new GameResultService({
      store,
      now: () => this.now(),
      createId: () => this.createId(),
      ensurePlayerRating: (state, userId) => this.ensurePlayerRating(state, userId),
    })
    this.spectatorEvents = new SpectatorEventService({
      store,
      now: () => this.now(),
      markMatchPlaying: (state, match, at) => this.markMatchPlaying(state, match, at),
      cancelExpiredFriendRoom: (state, match, at) => this.cancelExpiredFriendRoom(state, match, at),
      cancelExpiredUnstartedMatch: (state, match, at) => this.cancelExpiredUnstartedMatch(state, match, at),
      activeFriendTickets: (participant, at) => this.activeFriendTickets(participant, at),
    })
  }

  ensurePlayerRating (state, userId) {
    return this.accounts.ensurePlayerRating(state, userId)
  }

  ratingView (rating) {
    return this.accounts.ratingView(rating)
  }

  async loginExternal ({ externalId, displayName, avatarUrl }) {
    return this.accounts.loginExternal({ externalId, displayName, avatarUrl })
  }

  async devLogin ({ deviceId, externalId, displayName, avatarUrl } = {}) {
    return this.accounts.devLogin({ deviceId, externalId, displayName, avatarUrl })
  }

  async wxLogin ({ code, displayName, avatarUrl } = {}, wxCodeVerifier) {
    return this.accounts.wxLogin({ code, displayName, avatarUrl }, wxCodeVerifier)
  }

  async authenticate (token) {
    return this.accounts.authenticate(token)
  }

  publicUser (user, rating) {
    return this.accounts.publicUser(user, rating)
  }

  async getProfile (userId) {
    return this.accounts.getProfile(userId)
  }

  async updateProfile (userId, { displayName, avatarUrl } = {}) {
    return this.accounts.updateProfile(userId, { displayName, avatarUrl })
  }

  async getWallet (userId, limit = 20) {
    return this.commerce.getWallet(userId, limit)
  }

  async listProducts () {
    return this.commerce.listProducts()
  }

  async redeem (userId, { productId, quantity = 1, expectedPointsPrice } = {}, idempotencyKey) {
    return this.commerce.redeem(userId, { productId, quantity, expectedPointsPrice }, idempotencyKey)
  }

  async listTournaments (userId = null) {
    return this.tournaments.list(userId)
  }

  async enrollTournament (userId, tournamentId, idempotencyKey, { expectedEntryPoints } = {}) {
    return this.tournaments.enroll(userId, tournamentId, idempotencyKey, { expectedEntryPoints })
  }

  async checkInTournament (userId, tournamentId) {
    return this.tournaments.checkIn(userId, tournamentId)
  }

  async getTournamentState (userId, tournamentId) {
    return this.tournaments.getState(userId, tournamentId)
  }

  friendRoomHasExpired (match, now) {
    return this.friendRooms.hasExpired(match, now)
  }

  cancelExpiredFriendRoom (state, match, now) {
    return this.friendRooms.cancelExpired(state, match, now)
  }

  cancelFriendRoomByHost (state, match, now) {
    return this.friendRooms.cancelByHost(state, match, now)
  }

  ensureParticipantEntryAttemptId (participant, preferred = '') {
    return this.friendRooms.ensureParticipantEntryAttemptId(participant, preferred)
  }

  activeFriendTickets (participant, now = this.now()) {
    this.friendRooms.gameTickets = this.gameTickets
    return this.friendRooms.activeTickets(participant, now)
  }

  async createFriendRoom (userId, { entryAttemptId, roomSettings } = {}) {
    this.syncFriendRoomDependencies()
    return this.friendRooms.create(userId, { entryAttemptId, roomSettings })
  }

  async joinFriendRoom (userId, { entryAttemptId, roomId, inviteCode } = {}) {
    this.syncFriendRoomDependencies()
    return this.friendRooms.join(userId, { entryAttemptId, roomId, inviteCode })
  }

  async recoverActiveFriendRoom (userId, input = {}) {
    this.syncFriendRoomDependencies()
    return this.friendRooms.recoverFriend(userId, input)
  }

  async recoverActiveMatch (userId, { recoveryAttemptId } = {}, { friendOnly = false } = {}) {
    this.syncFriendRoomDependencies()
    return this.friendRooms.recover(userId, { recoveryAttemptId }, { friendOnly })
  }

  syncFriendRoomDependencies () {
    this.friendRooms.friendRoomTtlMs = this.friendRoomTtlMs
    this.friendRooms.gameTickets = this.gameTickets
  }

  openQueueMatches (state, mode) {
    return this.matchmaking.openQueueMatches(state, mode)
  }

  removeOpenQueueMatch (state, mode, matchId) {
    return this.matchmaking.removeOpenQueueMatch(state, mode, matchId)
  }

  unstartedMatchHasExpired (_state, match, now) {
    return this.matchmaking.unstartedHasExpired(_state, match, now)
  }

  cancelExpiredUnstartedMatch (state, match, now) {
    return this.matchmaking.cancelExpired(state, match, now)
  }

  expireUnstartedMatches (state, now) {
    return this.matchmaking.expireAll(state, now)
  }

  async expireUnstartedMatchesIfNeeded (now) {
    return this.matchmaking.expireIfNeeded(now)
  }

  markMatchPlaying (state, match, startedAt) {
    return this.matchmaking.markPlaying(state, match, startedAt)
  }

  matchView (match, userId) {
    return this.matchmaking.view(match, userId)
  }

  joinFixedTournamentMatch (state, userId, tournament, assignmentId, now) {
    this.matchmaking.useGameTickets(this.gameTickets)
    return this.matchmaking.joinFixedTournamentMatch(state, userId, tournament, assignmentId, now)
  }

  async joinMatch (userId, { mode = 'quick', tournamentId = '', assignmentId = '' } = {}) {
    this.matchmaking.useGameTickets(this.gameTickets)
    return this.matchmaking.join(userId, { mode, tournamentId, assignmentId })
  }

  async getMatchStatus (userId, matchId) {
    this.matchmaking.useGameTickets(this.gameTickets)
    return this.matchmaking.getStatus(userId, matchId)
  }

  async cancelMatch (userId, matchId) {
    this.matchmaking.useGameTickets(this.gameTickets)
    return this.matchmaking.cancel(userId, matchId)
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
    return this.tournaments.listStandings(tournamentId, userId)
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
    const delay = normalizeSpectatorDelay(delaySeconds)
    const now = this.now()
    await this.expireUnstartedMatchesIfNeeded(now)
    return this.store.read(state => {
      ensureCollections(state)
      const matchIds = new Set([
        ...Object.keys(state.spectatorFeeds),
        ...Object.values(state.matches).filter(match => ['matched', 'playing', 'completed', 'aborted'].includes(match.status)).map(match => match.id),
      ])
      const feeds = [...matchIds]
        .map(matchId => createSpectatorRecord(state, matchId))
        .filter(Boolean)
        .map(record => createPublicSpectatorSummary(record, delay, this.now()))
        .sort((left, right) => left.status === right.status ? right.startedAt - left.startedAt : left.status === 'running' ? -1 : 1)
        .slice(0, 50)
      return { delaySeconds: delay, feeds }
    })
  }

  async getSpectatorFeed (matchId, delaySeconds = 30) {
    const delay = normalizeSpectatorDelay(delaySeconds)
    const now = this.now()
    const availableThrough = now - delay * 1000
    await this.expireUnstartedMatchesIfNeeded(now)
    return this.store.read(state => {
      ensureCollections(state)
      const record = createSpectatorRecord(state, matchId)
      if (!record) throw notFound('SPECTATOR_FEED_NOT_FOUND', '观战牌局不存在')
      return {
        ...createPublicSpectatorSummary(record, delay, this.now()),
        availableThrough,
        events: record.events.filter(event => event.at <= availableThrough).map(publicSpectatorEvent),
      }
    })
  }

  async applyMerchant (userId, { name, contactName } = {}) {
    return this.merchants.apply(userId, { name, contactName })
  }

  async getMerchantConsole (userId) {
    return this.merchants.getConsole(userId)
  }

  async createMerchantStore (userId, { name, address } = {}, idempotencyKey) {
    return this.merchants.createStore(userId, { name, address }, idempotencyKey)
  }

  async addMerchantEmployee (userId, { employeeUserId, role = 'cashier' } = {}) {
    return this.merchants.addEmployee(userId, { employeeUserId, role })
  }

  async grantMerchantPoints (userId, { storeId, recipientUserId, amount, note } = {}, idempotencyKey) {
    return this.merchants.grantPoints(userId, { storeId, recipientUserId, amount, note }, idempotencyKey)
  }

  async acceptSpectatorEvent (eventId, rawEvent) {
    return this.spectatorEvents.accept(eventId, rawEvent)
  }

  async claimGameStart (eventId, rawEvent) {
    if (rawEvent?.type !== 'game-start') throw badRequest('INVALID_LIFECYCLE_CLAIM', '开局确认只接受 game-start 事件')
    const accepted = await this.acceptSpectatorEvent(eventId, rawEvent)
    if (accepted.lifecycleClaim?.accepted !== true) throw conflict('GAME_START_NOT_CLAIMED', '平台未确认牌局开始')
    return accepted
  }

  async acceptGameResult (eventId, event) {
    return this.gameResultService.accept(eventId, event)
  }
}
