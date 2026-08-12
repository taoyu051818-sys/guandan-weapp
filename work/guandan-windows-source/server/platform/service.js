import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import { AccountService, emptyStats } from './account-service.js'
import { canonicalJsonFingerprint, matchesJsonFingerprint } from './canonical-json.js'
import { CommerceService } from './commerce-service.js'
import { badRequest, conflict, forbidden, notFound } from './errors.js'
import { FriendRoomService, friendRoomDefaultTtlMs, friendRoomKind } from './friend-room-service.js'
import { GameResultService } from './game-result-service.js'
import { MerchantService } from './merchant-service.js'
import { MatchmakingService } from './matchmaking-service.js'
import {
  createPublicSpectatorSummary,
  createSpectatorRecord,
  normalizeSpectatorDelay,
  normalizeSpectatorEvent,
  publicSpectatorEvent,
  validateSpectatorEventMatchTime,
} from './spectator-domain.js'
import { blockTournamentAssignment } from './tournament-orchestrator.js'
import {
  isFixedTournament,
  TournamentService,
  tournamentRunError,
} from './tournament-service.js'

const requireIdempotencyKey = (value) => {
  const key = typeof value === 'string' ? value.trim() : ''
  if (!key || key.length > 128) throw badRequest('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key 必填且不能超过128字符')
  return key
}
const fingerprint = canonicalJsonFingerprint
const platformCollections = [
  'userByAccountId',
  'userStats', 'playerRatings', 'matchHistoryByUser', 'matchQueues', 'tournamentStandings', 'tournamentRoundResults',
  'replays', 'spectatorFeeds', 'seasons', 'seasonProgress', 'taskDefinitions',
  'taskProgress', 'taskClaimIdempotency', 'dailyStats', 'merchants', 'merchantByOwner',
  'merchantStores', 'merchantEmployees', 'merchantPointGrants', 'merchantIdempotency',
  'spectatorEventReceipts', 'tournamentRuns', 'tournamentPlayerRoundResults', 'friendRoomEntryAttempts',
]
const ensureCollections = (state) => {
  platformCollections.forEach(key => { state[key] ||= {} })
  return state
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
    this.matchmaking.gameTickets = this.gameTickets
    return this.matchmaking.joinFixedTournamentMatch(state, userId, tournament, assignmentId, now)
  }

  async joinMatch (userId, { mode = 'quick', tournamentId = '', assignmentId = '' } = {}) {
    this.matchmaking.gameTickets = this.gameTickets
    return this.matchmaking.join(userId, { mode, tournamentId, assignmentId })
  }

  async getMatchStatus (userId, matchId) {
    return this.matchmaking.getStatus(userId, matchId)
  }

  async cancelMatch (userId, matchId) {
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
    const now = this.now()
    const event = normalizeSpectatorEvent(eventId, rawEvent, now)
    const accepted = await this.store.transaction(state => {
      ensureCollections(state)
      const receiptMatch = state.matches[event.matchId]
      const fixedAssignmentEntryTimeout = Boolean(
        event.type === 'room-closed' &&
        event.reason === 'entry-timeout' &&
        receiptMatch?.tournamentId &&
        receiptMatch?.assignmentId
      )
      const previous = state.spectatorEventReceipts[eventId]
      if (previous) {
        if (!matchesJsonFingerprint(previous.fingerprint, event)) {
          if (fixedAssignmentEntryTimeout) {
            return {
              eventId,
              matchId: event.matchId,
              sequence: event.sequence,
              accepted: true,
              duplicate: true,
              ignored: true,
              assignmentRetained: true,
              processedAt: now,
            }
          }
          throw conflict('SPECTATOR_EVENT_ID_CONFLICT', '同一个观战事件ID不能对应不同内容')
        }
        const previousMatch = receiptMatch
        if (event.type === 'game-start' && previousMatch) {
          this.markMatchPlaying(state, previousMatch, event.at)
          const previousFeed = state.spectatorFeeds[event.matchId]
          if (previousFeed) previousFeed.gameStartedAt ||= event.at
        }
        return {
          eventId,
          matchId: event.matchId,
          sequence: event.sequence,
          accepted: true,
          duplicate: true,
          ignored: Boolean(previous.ignored),
          processedAt: previous.processedAt,
          ...(previous.seatRelease ? { seatRelease: structuredClone(previous.seatRelease) } : {}),
          ...(event.type === 'game-start' && previousMatch ? {
            lifecycleClaim: {
              accepted: true,
              status: previousMatch.status,
              startedAt: Number(previousMatch.startedAt || event.at),
            },
          } : {}),
        }
      }
      const match = receiptMatch
      if (!match || match.roomId !== event.roomId) throw forbidden('观战事件与已分配匹配不一致')
      validateSpectatorEventMatchTime(event, match)
      if (event.type === 'game-start' && (
        this.cancelExpiredFriendRoom(state, match, now) ||
        this.cancelExpiredUnstartedMatch(state, match, now)
      )) {
        return { lifecycleExpired: true, matchId: match.id, expiredAt: now }
      }
      const feed = state.spectatorFeeds[event.matchId]
      if (!feed) throw conflict('SPECTATOR_FEED_NOT_READY', '观战事件流尚未建立')
      if (
        event.type === 'room-closed' &&
        event.reason === 'entry-timeout' &&
        match.tournamentId &&
        match.assignmentId
      ) {
        // A fixed assignment survives credential expiry. The game server may
        // discard its incomplete local waiting room, but that is not a match
        // abort. Do not reserve this sequence/eventId: the recreated room starts
        // its public stream from sequence 1 and must be able to claim game-start.
        return {
          eventId,
          matchId: event.matchId,
          sequence: event.sequence,
          accepted: true,
          duplicate: false,
          ignored: true,
          assignmentRetained: true,
          processedAt: now,
        }
      }
      if (
        event.type === 'room-closed' &&
        event.reason === 'entry-timeout' &&
        match.status === 'cancelled' &&
        match.cancelReason === 'entry-expired' &&
        feed.abortedAt &&
        feed.abortReason === 'entry-timeout'
      ) {
        // Platform TTL sweeping and the game server's local room expiry race by
        // design. Once the platform terminal state wins, acknowledge the later
        // signed close so its durable outbox can drain without adding a fake event.
        const processedAt = now
        state.spectatorEventReceipts[eventId] = {
          eventId,
          matchId: event.matchId,
          sequence: event.sequence,
          fingerprint: fingerprint(event),
          processedAt,
          ignored: true,
        }
        return { eventId, matchId: event.matchId, sequence: event.sequence, accepted: true, duplicate: false, ignored: true, processedAt }
      }
      if (
        event.type === 'room-closed' &&
        match.kind === friendRoomKind &&
        ['cancelled', 'aborted', 'completed'].includes(match.status) &&
        (feed.abortedAt || feed.finishedAt)
      ) {
        const processedAt = now
        state.spectatorEventReceipts[eventId] = {
          eventId,
          matchId: event.matchId,
          sequence: event.sequence,
          fingerprint: fingerprint(event),
          processedAt,
          ignored: true,
        }
        return { eventId, matchId: event.matchId, sequence: event.sequence, accepted: true, duplicate: false, ignored: true, processedAt }
      }
      const waitingFriendRoomLifecycle = Boolean(
        match.kind === friendRoomKind &&
        match.status === 'matching' &&
        (event.type === 'seat-left' || event.type === 'room-closed')
      )
      if (!waitingFriendRoomLifecycle && !['matched', 'playing', 'completed', 'aborted'].includes(match.status)) {
        throw conflict('MATCH_NOT_SPECTATABLE', '当前匹配不能写入观战事件')
      }
      let leavingParticipant = null
      let leavingParticipantWasActive = false
      if (event.type === 'seat-left') {
        if (match.kind !== friendRoomKind) throw conflict('FRIEND_SEAT_EVENT_REQUIRED', '只有好友房可以释放固定席位')
        if (!['matching', 'matched'].includes(match.status)) throw conflict('FRIEND_SEAT_LOCKED', '好友房已经开始或结束，不能释放席位')
        leavingParticipant = match.participants.find(participant => (
          participant.seat === event.playerId &&
          participant.userId === event.userId
        ))
        leavingParticipantWasActive = Boolean(leavingParticipant && ['matching', 'matched'].includes(leavingParticipant.status))
        const pendingCancellation = Boolean(
          leavingParticipant?.status === 'cancelled' &&
          leavingParticipant.cancellationRequestedAt &&
          !leavingParticipant.seatLifecycleConfirmedAt
        )
        if (!leavingParticipant || (!leavingParticipantWasActive && !pendingCancellation)) {
          throw conflict('FRIEND_SEAT_BINDING_MISMATCH', '离席事件与平台席位绑定不一致')
        }
      }
      let friendMatchEnd = null
      if (event.type === 'match-ended') {
        if (match.kind !== friendRoomKind) throw conflict('FRIEND_MATCH_END_REQUIRED', '只有好友房可以使用配置终局事件')
        if (match.status !== 'playing') throw conflict('FRIEND_MATCH_NOT_PLAYING', '好友房不在可结束的 playing 状态')
        if (Number.isFinite(Number(match.startedAt)) && event.endedAt < Number(match.startedAt)) {
          throw conflict('FRIEND_MATCH_END_BEFORE_START', '好友房结束时间不能早于平台确认的开局时间')
        }
        const configuredRounds = Number(match.roomSettings?.rounds)
        const totalTimeMinutes = Number(match.roomSettings?.totalTimeMinutes)
        const scoreWinner = event.scores.teamA === event.scores.teamB
          ? null
          : (event.scores.teamA > event.scores.teamB ? 'teamA' : 'teamB')
        if (event.reason === 'round-limit') {
          if (!Number.isSafeInteger(configuredRounds) || event.roundsPlayed !== configuredRounds) {
            throw conflict('FRIEND_ROUND_LIMIT_MISMATCH', '好友房完成局数与签名房间配置不一致')
          }
          if (event.winnerTeam !== scoreWinner) throw conflict('FRIEND_MATCH_WINNER_MISMATCH', '好友房胜方必须由最终比分确定')
        } else {
          if (!(totalTimeMinutes > 0)) throw conflict('FRIEND_TIME_LIMIT_DISABLED', '好友房未配置总时限')
          if (event.roundsPlayed > configuredRounds) throw conflict('FRIEND_MATCH_ROUNDS_EXCEEDED', '好友房已完成局数超过签名配置')
          if (event.winnerTeam !== null) throw conflict('FRIEND_TIME_LIMIT_MUST_DRAW', '中局总时限终局必须按 draw 上报')
          const earliestTimeLimitEnd = Number(match.startedAt) + totalTimeMinutes * 60_000
          if (!Number.isSafeInteger(earliestTimeLimitEnd) || event.endedAt < earliestTimeLimitEnd) {
            throw conflict('FRIEND_TIME_LIMIT_EARLY', '好友房尚未达到签名配置的总时限')
          }
        }
        friendMatchEnd = {
          reason: event.reason,
          scores: structuredClone(event.scores),
          roundsPlayed: event.roundsPlayed,
          endedAt: event.endedAt,
          winnerTeam: event.winnerTeam,
        }
      }
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
      if (feed.finishedAt && Number.isSafeInteger(feed.finalSpectatorSequence)) {
        if (event.sequence > feed.finalSpectatorSequence) {
          throw conflict('SPECTATOR_EVENT_AFTER_FINAL', '观战事件超过结算声明的最终序号', {
            finalSpectatorSequence: feed.finalSpectatorSequence,
            receivedSequence: event.sequence,
          })
        }
        if (event.sequence === feed.finalSpectatorSequence && (event.type !== 'round-end' || event.isGameWon !== true)) {
          throw conflict('INVALID_FINAL_SPECTATOR_EVENT', '结算声明的最终观战事件必须是获胜局 round-end')
        }
      }
      if (feed.events.length >= 100_000) throw conflict('SPECTATOR_FEED_LIMIT', '单桌观战事件数量已达上限')
      feed.events.push(structuredClone(event))
      if (event.type === 'game-start') {
        this.markMatchPlaying(state, match, event.at)
        feed.gameStartedAt ||= event.at
      }
      if (event.type === 'match-ended') {
        feed.matchEnd = structuredClone(friendMatchEnd)
        feed.finalSpectatorSequence = event.sequence
        match.friendMatchEnd = structuredClone(friendMatchEnd)
        if (event.reason === 'round-limit') {
          feed.finishedAt = event.endedAt
          feed.abortedAt = null
          feed.abortReason = null
          match.status = 'completed'
          match.completedAt = event.endedAt
          match.completionReason = event.reason
          match.participants.forEach(participant => {
            if (!['matching', 'matched', 'playing'].includes(participant.status)) return
            participant.status = 'completed'
            participant.completedAt = event.endedAt
            if (state.activeMatchByUser[participant.userId] === match.id) delete state.activeMatchByUser[participant.userId]
          })
        } else {
          feed.abortedAt = event.endedAt
          feed.abortReason = event.reason
          match.status = 'aborted'
          match.abortedAt = event.endedAt
          match.abortReason = event.reason
          match.participants.forEach(participant => {
            if (!['matching', 'matched', 'playing'].includes(participant.status)) return
            participant.status = 'aborted'
            participant.abortedAt = event.endedAt
            if (state.activeMatchByUser[participant.userId] === match.id) delete state.activeMatchByUser[participant.userId]
          })
        }
      }
      let seatRelease = null
      if (event.type === 'seat-left') {
        const revokedTickets = this.activeFriendTickets(leavingParticipant, now)
        seatRelease = {
          playerId: event.playerId,
          userId: event.userId,
          revokedTicketJti: leavingParticipant.claims?.jti || null,
          revokedTicketExp: Number(leavingParticipant.claims?.exp) || null,
          revokedTickets,
        }
        leavingParticipant.status = 'cancelled'
        leavingParticipant.cancelledAt = event.at
        leavingParticipant.leaveReason = event.reason
        leavingParticipant.ticketRevokedAt = event.at
        leavingParticipant.seatLifecycleConfirmedAt = event.at
        leavingParticipant.revokedTicketJti = leavingParticipant.claims?.jti || null
        leavingParticipant.revokedTicketExpiresAt = Number(leavingParticipant.expiresAt) || null
        delete leavingParticipant.gameTicket
        delete leavingParticipant.joinToken
        delete leavingParticipant.gameEndpoint
        delete leavingParticipant.expiresAt
        delete leavingParticipant.claims
        delete leavingParticipant.cancellationRequestedAt
        if (state.activeMatchByUser[event.userId] === match.id) delete state.activeMatchByUser[event.userId]
        if (event.reason === 'kicked') {
          match.bannedUserIds ||= []
          if (!match.bannedUserIds.includes(event.userId)) match.bannedUserIds.push(event.userId)
        }
        if (leavingParticipantWasActive && match.status === 'matched') {
          match.status = 'matching'
          delete match.matchedAt
        }
      }
      if (event.type === 'room-closed') {
        feed.abortedAt = event.at
        feed.abortReason = event.reason
        feed.finalSpectatorSequence = event.sequence
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
      state.spectatorEventReceipts[eventId] = {
        eventId,
        matchId: event.matchId,
        sequence: event.sequence,
        fingerprint: fingerprint(event),
        processedAt,
        ...(seatRelease ? { seatRelease: structuredClone(seatRelease) } : {}),
      }
      return {
        eventId,
        matchId: event.matchId,
        sequence: event.sequence,
        accepted: true,
        duplicate: false,
        processedAt,
        ...(seatRelease ? { seatRelease } : {}),
        ...(event.type === 'game-start' ? {
          lifecycleClaim: {
            accepted: true,
            status: match.status,
            startedAt: Number(match.startedAt || event.at),
          },
        } : {}),
      }
    })
    if (accepted.lifecycleExpired) {
      throw conflict('MATCH_ENTRY_EXPIRED', '牌桌入桌时限已过，平台已取消整桌；牌局服不得开始发牌', {
        matchId: accepted.matchId,
        expiredAt: accepted.expiredAt,
      })
    }
    return accepted
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
