export const MATCH_QUEUE_IDS = ['quick', 'classic_50', 'classic_300', 'classic_2000', 'classic_10000', 'rookie_cup', 'weekend_cup', 'master_cup', 'lingshui_16_cup'] as const
export type MatchQueueId = typeof MATCH_QUEUE_IDS[number]

export type MatchTicket = {
  ticketId: string
  queueId: MatchQueueId
  status: 'matching' | 'matched' | 'cancelled'
  roomId?: string
  gameEndpoint?: string
  joinToken?: string
  seat?: 'p1' | 'p2' | 'p3' | 'p4'
  expiresAt?: number
}

export interface MatchmakingGateway {
  joinQueue(queueId: MatchQueueId, assignment?: { tournamentId: string, assignmentId: string }): Promise<MatchTicket>
  getStatus(ticketId: string): Promise<MatchTicket>
  cancel(ticketId: string): Promise<void>
}

export type ShopProduct = {
  id: string
  name: string
  pointsPrice: number
  description: string
  category: string
  stock: number
  imageUrl?: string
}

export type ShopOrder = {
  orderId: string
  productId: string
  quantity: number
  totalPoints: number
  status: 'created' | 'paid' | 'cancelled' | 'fulfilled'
}

export interface ShopGateway {
  listProducts(): Promise<ShopProduct[]>
  createOrder(productId: string, quantity: number, expectedPointsPrice?: number): Promise<ShopOrder>
}

export type WalletSnapshot = { points: number, diamonds: number }

export interface WalletGateway {
  getWallet(): Promise<WalletSnapshot>
}

export type UserProfile = { id: string, accountId: string, displayName: string, comprehensiveScore: number, avatarUrl?: string }

export interface AuthGateway {
  getProfile(): Promise<UserProfile>
  signOut(): void
}

export type PlayerStatsSnapshot = {
  gamesPlayed: number
  wins: number
  firstPlaceFinishes: number
  bombsPlayed: number
  elo: number
}

export type PlayerRatingSnapshot = {
  games: number
  wins: number
  eloOffset: number
  baseScore: number
  comprehensiveScore: number
}

export type RecentMatchSummary = {
  eventId: string
  replayId: string
  matchId: string
  roomId: string
  place: number
  won: boolean
  tournamentId?: string | null
  finishedAt: number
}

export type PlayerDashboard = {
  user: UserProfile
  rating: PlayerRatingSnapshot
  stats: PlayerStatsSnapshot
  season: null | { id: string, name: string, status: string, progress: { score: number, gamesPlayed: number, wins: number } }
  recentMatches: RecentMatchSummary[]
}

export interface PlayerCenterGateway { getDashboard(): Promise<PlayerDashboard> }

export type TournamentSummary = {
  id: string
  name: string
  description: string
  status: 'open' | 'scheduled' | 'running' | 'finished'
  startsAt?: number
  entryPoints: number
  queueId: MatchQueueId
  enrolled: boolean
  format?: 'fixed16-latin-3'
  capacity?: number
  checkedInCount?: number
  roundsTotal?: number
  currentRound?: number
  advanceCount?: number
  myStanding?: { played: number, points: number, rank: number, advanced: boolean }
}

export type TournamentStanding = {
  userId: string
  displayName: string
  played: number
  wins: number
  firstPlaces: number
  points: number
  opponentPoints: number
  rank: number
  advanced: boolean
  qualificationStatus: 'pending' | 'qualified' | 'eliminated'
}

export type TournamentStandings = {
  tournament: TournamentSummary
  standings: TournamentStanding[]
  provisional: boolean
  cutoffRank: number
  viewerStanding: TournamentStanding | null
}

export type TournamentAssignment = {
  assignmentId: string
  roundNumber: number
  tableNumber: number
  status: 'pending' | 'matching' | 'matched' | 'completed' | 'blocked'
  matchId?: string
}

export type TournamentState = {
  phase: 'check-in' | 'round-active' | 'blocked' | 'finished'
  tournament: TournamentSummary
  capacity: number
  checkedInCount: number
  roundNumber: number
  roundsTotal: number
  tablesTotal: number
  tablesSettled: number
  cutoffRank: number
  viewerEntry: { enrolled: boolean, checkedIn: boolean, rosterLocked: boolean }
  assignment: TournamentAssignment | null
  viewerStanding?: TournamentStanding
}

export interface TournamentGateway {
  listTournaments(): Promise<TournamentSummary[]>
  enroll(tournamentId: string, expectedEntryPoints?: number): Promise<TournamentSummary>
  checkIn(tournamentId: string): Promise<TournamentState>
  getState(tournamentId: string): Promise<TournamentState>
  getStandings(tournamentId: string): Promise<TournamentStandings>
}

export type SeasonTask = { id: string, name: string, target: number, rewardPoints: number, progress: number, completed: boolean, claimed: boolean, cadence: string }
export type SeasonTaskList = { season: null | { id: string, name: string, status: string }, tasks: SeasonTask[] }
export interface SeasonGateway { listTasks(): Promise<SeasonTaskList>, claim(taskId: string): Promise<void> }

export type ReplaySummary = { id: string, eventId: string, matchId: string, roomId: string, ranking: string[], winnerTeam: string, finishedAt: number, eventCount: number }
/**
 * Public replay events intentionally contain only information that was visible
 * at the table. In particular there are no card ids, private hands or platform
 * user ids. The optional semantic fields let the replay renderer reconstruct a
 * deterministic public table instead of guessing from a text label.
 */
export type ReplayEvent = {
  sequence: number
  at: number
  type: string
  roundSequence?: number
  playerId?: string
  cards?: Array<{ rank: string, suit: string }>
  playType?: string
  automatic?: boolean
  ranking?: string[]
  winnerTeam?: string
  isGameWon?: boolean
  reason?: string
  text?: string
}
export type ReplayDetail = ReplaySummary & { participants: Record<string, string>, events: ReplayEvent[] }
export interface ReplayGateway { list(): Promise<ReplaySummary[]>, get(replayId: string): Promise<ReplayDetail> }

export type SpectatorMatchStatus = 'running' | 'finished' | 'aborted'
export type SpectatorMatchSummary = {
  matchId: string
  tableLabel: string
  mode: MatchQueueId
  status: SpectatorMatchStatus
  startedAt: number
  finishedAt: number | null
  abortedAt: number | null
  abortReason: string | null
  delaySeconds: number
  availableEventCount: number
  totalEventCount: number
  timelineComplete: boolean
}
export type SpectatorFeed = SpectatorMatchSummary & { availableThrough: number, events: ReplayEvent[] }
export interface SpectatorGateway {
  list(delaySeconds?: number): Promise<SpectatorMatchSummary[]>
  getFeed(matchId: string, delaySeconds?: number): Promise<SpectatorFeed>
}

export type MerchantStatus = 'pending' | 'active' | 'suspended' | 'rejected'
export type MerchantRole = 'owner' | 'manager' | 'cashier'
export type MerchantStoreStatus = 'active' | 'inactive'
export type MerchantEmployeeStatus = 'active' | 'inactive'
export type MerchantGrantStatus = 'posted' | 'reversed'

export type MerchantProfile = {
  id: string
  ownerUserId: string
  name: string
  contactName: string
  status: MerchantStatus
  dailyPointLimit: number
  createdAt: number
}

export type MerchantStore = {
  id: string
  merchantId: string
  name: string
  address: string
  status: MerchantStoreStatus
  createdAt: number
}

export type MerchantEmployee = {
  id: string
  merchantId: string
  userId: string
  role: Exclude<MerchantRole, 'owner'>
  status: MerchantEmployeeStatus
  updatedAt: number
}

export type MerchantPointGrant = {
  id: string
  merchantId: string
  storeId: string
  operatorUserId: string
  recipientUserId: string
  amount: number
  note: string
  status: MerchantGrantStatus
  createdAt: number
  duplicate?: boolean
}

export type MerchantConsole = {
  merchant: MerchantProfile
  role: MerchantRole
  stores: MerchantStore[]
  employees: MerchantEmployee[]
  grants: MerchantPointGrant[]
  grantedPoints: number
}

export type MerchantApplication = { name: string, contactName?: string }
export type MerchantStoreDraft = { name: string, address?: string }
export type MerchantEmployeeDraft = { employeeUserId: string, role: Exclude<MerchantRole, 'owner'> }
export type MerchantPointGrantDraft = { storeId: string, recipientUserId: string, amount: number, note?: string }

export interface MerchantGateway {
  getConsole(): Promise<MerchantConsole>
  apply(application: MerchantApplication): Promise<MerchantProfile>
  createStore(store: MerchantStoreDraft): Promise<MerchantStore>
  addEmployee(employee: MerchantEmployeeDraft): Promise<MerchantEmployee>
  grantPoints(grant: MerchantPointGrantDraft): Promise<MerchantPointGrant>
}

export type FrontPageGateways = {
  configured: boolean
  auth: AuthGateway
  matchmaking: MatchmakingGateway
  shop: ShopGateway
  wallet: WalletGateway
  tournaments: TournamentGateway
  playerCenter: PlayerCenterGateway
  seasons: SeasonGateway
  replays: ReplayGateway
  spectator: SpectatorGateway
  merchant: MerchantGateway
}

export const SAMPLE_PRODUCTS: ShopProduct[] = [
  { id: 'tissue', name: '柔韧抽纸', pointsPrice: 900, description: '三层柔韧抽纸，示例规格3包。', category: '居家', stock: 99 },
  { id: 'detergent', name: '清香洗衣液', pointsPrice: 1900, description: '低泡易漂洗，示例容量1千克。', category: '清洁', stock: 60 },
  { id: 'thermos', name: '便携保温杯', pointsPrice: 2900, description: '轻量杯身，示例容量450毫升。', category: '出行', stock: 30 },
  { id: 'umbrella', name: '折叠晴雨伞', pointsPrice: 2400, description: '晴雨两用便携折叠伞。', category: '出行', stock: 45 },
  { id: 'dish_soap', name: '清新洗洁精', pointsPrice: 1200, description: '厨房清洁用品，示例容量500克。', category: '清洁', stock: 80 },
  { id: 'trash_bag', name: '加厚垃圾袋', pointsPrice: 800, description: '抽绳加厚垃圾袋，示例规格30只。', category: '居家', stock: 120 },
  { id: 'towel', name: '柔软面巾', pointsPrice: 1500, description: '吸水柔软日用毛巾。', category: '个护', stock: 75 },
  { id: 'soap', name: '植物香皂', pointsPrice: 600, description: '温和清洁香皂，示例规格100克。', category: '个护', stock: 150 },
]

export const SAMPLE_TOURNAMENTS: TournamentSummary[] = [
  { id: 'lingshui-16-cup', name: '陵水16人积分赛', description: '固定16人 · 三轮不重复同桌 · 前八晋级', status: 'running', entryPoints: 0, queueId: 'lingshui_16_cup', enrolled: true, format: 'fixed16-latin-3', capacity: 16, checkedInCount: 16, roundsTotal: 3, currentRound: 1, advanceCount: 8 },
  { id: 'rookie-cup', name: '新手体验赛', description: '随时报名 · 三轮积分', status: 'open', entryPoints: 0, queueId: 'rookie_cup', enrolled: false, roundsTotal: 3, currentRound: 1, advanceCount: 16 },
  { id: 'weekend-cup', name: '周末挑战赛', description: '三轮积分 · 前八晋级', status: 'scheduled', entryPoints: 200, queueId: 'weekend_cup', enrolled: false, roundsTotal: 3, currentRound: 1, advanceCount: 8 },
  { id: 'master-cup', name: '大师晋级赛', description: '五轮积分 · 前四晋级', status: 'scheduled', entryPoints: 500, queueId: 'master_cup', enrolled: false, roundsTotal: 5, currentRound: 1, advanceCount: 4 },
]

export const SAMPLE_DASHBOARD: PlayerDashboard = {
  user: { id: 'local-player', accountId: '10000001', displayName: '陵水玩家', comprehensiveScore: 12571 },
  rating: { games: 12, wins: 7, eloOffset: 0, baseScore: 12571, comprehensiveScore: 12571 },
  stats: { gamesPlayed: 12, wins: 7, firstPlaceFinishes: 4, bombsPlayed: 19, elo: 1086 },
  season: { id: 'season-2026-lingshui', name: '陵水夏季赛季', status: 'active', progress: { score: 28, gamesPlayed: 12, wins: 7 } },
  recentMatches: [],
}

export const SAMPLE_SEASON_TASKS: SeasonTaskList = {
  season: { id: 'season-2026-lingshui', name: '陵水夏季赛季', status: 'active' },
  tasks: [
    { id: 'daily-play-1', name: '完成一局', target: 1, rewardPoints: 80, progress: 1, completed: true, claimed: false, cadence: 'daily' },
    { id: 'season-win-3', name: '赢得三局', target: 3, rewardPoints: 300, progress: 2, completed: false, claimed: false, cadence: 'season' },
    { id: 'season-bomb-5', name: '打出五次炸弹', target: 5, rewardPoints: 240, progress: 4, completed: false, claimed: false, cadence: 'season' },
  ],
}

export const SAMPLE_REPLAYS: ReplaySummary[] = [
  { id: 'demo-replay-1', eventId: 'demo:1', matchId: 'demo-match', roomId: '888888', ranking: ['p1', 'p3', 'p2', 'p4'], winnerTeam: 'teamA', finishedAt: Date.now() - 3600_000, eventCount: 7 },
]

export const SAMPLE_SPECTATOR_MATCHES: SpectatorMatchSummary[] = [
  { matchId: 'demo-live-match', tableLabel: '快速匹配 · DEMO01桌', mode: 'quick', status: 'running', startedAt: Date.now() - 8 * 60_000, finishedAt: null, abortedAt: null, abortReason: null, delaySeconds: 30, availableEventCount: 3, totalEventCount: 5, timelineComplete: false },
  { matchId: 'demo-match', tableLabel: '周末赛 · DEMO02桌', mode: 'weekend_cup', status: 'finished', startedAt: Date.now() - 90 * 60_000, finishedAt: Date.now() - 60 * 60_000, abortedAt: null, abortReason: null, delaySeconds: 30, availableEventCount: 6, totalEventCount: 6, timelineComplete: true },
  { matchId: 'demo-aborted-match', tableLabel: '快速匹配 · DEMO03桌', mode: 'quick', status: 'aborted', startedAt: Date.now() - 20 * 60_000, finishedAt: null, abortedAt: Date.now() - 10 * 60_000, abortReason: 'empty-timeout', delaySeconds: 30, availableEventCount: 6, totalEventCount: 6, timelineComplete: true },
]

/** Explicitly synthetic and read-only; never used when a platform endpoint is configured. */
export const SAMPLE_MERCHANT_CONSOLE: MerchantConsole = {
  merchant: {
    id: 'demo-merchant',
    ownerUserId: 'demo-owner',
    name: '陵水生活馆（演示）',
    contactName: '演示负责人',
    status: 'active',
    dailyPointLimit: 5000,
    createdAt: Date.now() - 30 * 24 * 60 * 60_000,
  },
  role: 'owner',
  stores: [
    { id: 'demo-store-1', merchantId: 'demo-merchant', name: '清水湾演示店', address: '只读演示地址', status: 'active', createdAt: Date.now() - 20 * 24 * 60 * 60_000 },
  ],
  employees: [
    { id: 'demo-employee-1', merchantId: 'demo-merchant', userId: 'demo-cashier', role: 'cashier', status: 'active', updatedAt: Date.now() - 7 * 24 * 60 * 60_000 },
  ],
  grants: [
    { id: 'demo-grant-1', merchantId: 'demo-merchant', storeId: 'demo-store-1', operatorUserId: 'demo-cashier', recipientUserId: 'demo-customer', amount: 120, note: '演示消费奖励', status: 'posted', createdAt: Date.now() - 60 * 60_000 },
  ],
  grantedPoints: 120,
}

export class FeatureInDevelopmentError extends Error {
  public constructor (feature: string) { super(`${feature}功能正在开发中`) }
}

/** Replace this class with the real HTTP/WebSocket adapter when the service is ready. */
export class DevelopmentMatchmakingGateway implements MatchmakingGateway {
  public async joinQueue (_queueId: MatchQueueId, _assignment?: { tournamentId: string, assignmentId: string }): Promise<MatchTicket> { throw new FeatureInDevelopmentError('比赛匹配') }
  public async getStatus (_ticketId: string): Promise<MatchTicket> { throw new FeatureInDevelopmentError('比赛匹配') }
  public async cancel (_ticketId: string): Promise<void> { throw new FeatureInDevelopmentError('取消匹配') }
}

/** Products stay local for UI development; ordering intentionally has no backend implementation. */
export class DevelopmentShopGateway implements ShopGateway {
  public async listProducts (): Promise<ShopProduct[]> { return SAMPLE_PRODUCTS }
  public async createOrder (_productId: string, _quantity: number, _expectedPointsPrice?: number): Promise<ShopOrder> { throw new FeatureInDevelopmentError('商城购买') }
}

export class DevelopmentWalletGateway implements WalletGateway {
  public async getWallet (): Promise<WalletSnapshot> { return { points: 10_000, diamonds: 0 } }
}

export class DevelopmentAuthGateway implements AuthGateway {
  public async getProfile (): Promise<UserProfile> { return { id: 'local-player', accountId: '10000001', displayName: '陵水玩家', comprehensiveScore: 12571 } }
  public signOut (): void {}
}

export class DevelopmentTournamentGateway implements TournamentGateway {
  public async listTournaments (): Promise<TournamentSummary[]> { return SAMPLE_TOURNAMENTS }
  public async enroll (_tournamentId: string, _expectedEntryPoints?: number): Promise<TournamentSummary> { throw new FeatureInDevelopmentError('赛事报名') }
  public async checkIn (tournamentId: string): Promise<TournamentState> { return this.getState(tournamentId) }
  public async getState (tournamentId: string): Promise<TournamentState> {
    const tournament = SAMPLE_TOURNAMENTS.find(item => item.id === tournamentId) ?? SAMPLE_TOURNAMENTS[0]
    const viewerStanding: TournamentStanding = { userId: 'local-player', displayName: '陵水玩家', played: 0, wins: 0, firstPlaces: 0, points: 0, opponentPoints: 0, rank: 1, advanced: false, qualificationStatus: 'pending' }
    return {
      phase: 'round-active',
      tournament,
      capacity: 16,
      checkedInCount: 16,
      roundNumber: 1,
      roundsTotal: 3,
      tablesTotal: 4,
      tablesSettled: 0,
      cutoffRank: 8,
      viewerEntry: { enrolled: true, checkedIn: true, rosterLocked: true },
      assignment: { assignmentId: 'dev-lingshui-r1-t1', roundNumber: 1, tableNumber: 1, status: 'pending' },
      viewerStanding,
    }
  }
  public async getStandings (tournamentId: string): Promise<TournamentStandings> {
    const tournament = SAMPLE_TOURNAMENTS.find(item => item.id === tournamentId) ?? SAMPLE_TOURNAMENTS[0]
    const viewerStanding: TournamentStanding = { userId: 'local-player', displayName: '陵水玩家', played: 2, wins: 1, firstPlaces: 1, points: 5, opponentPoints: 11, rank: 1, advanced: false, qualificationStatus: 'pending' }
    return { tournament, standings: [viewerStanding], provisional: true, cutoffRank: tournament.advanceCount ?? 0, viewerStanding }
  }
}

export class DevelopmentPlayerCenterGateway implements PlayerCenterGateway { public async getDashboard (): Promise<PlayerDashboard> { return SAMPLE_DASHBOARD } }
export class DevelopmentSeasonGateway implements SeasonGateway {
  public async listTasks (): Promise<SeasonTaskList> { return SAMPLE_SEASON_TASKS }
  public async claim (_taskId: string): Promise<void> { throw new FeatureInDevelopmentError('任务领奖') }
}
export class DevelopmentReplayGateway implements ReplayGateway {
  public async list (): Promise<ReplaySummary[]> { return SAMPLE_REPLAYS }
  public async get (replayId: string): Promise<ReplayDetail> {
    const summary = SAMPLE_REPLAYS.find(item => item.id === replayId) ?? SAMPLE_REPLAYS[0]
    const startedAt = summary.finishedAt - 120_000
    const events: ReplayEvent[] = [
      { sequence: 1, at: startedAt, type: 'game-start', roundSequence: 1 },
      { sequence: 2, at: startedAt + 1_000, type: 'round-start', roundSequence: 1 },
      { sequence: 3, at: startedAt + 2_000, type: 'play-start', roundSequence: 1 },
      { sequence: 4, at: startedAt + 18_000, type: 'play', roundSequence: 1, playerId: 'p1', cards: [{ rank: 'A', suit: 'heart' }, { rank: 'A', suit: 'spade' }], playType: 'Pair', automatic: false },
      { sequence: 5, at: startedAt + 30_000, type: 'pass', roundSequence: 1, playerId: 'p2', automatic: false },
      { sequence: 6, at: startedAt + 44_000, type: 'play', roundSequence: 1, playerId: 'p3', cards: [{ rank: '9', suit: 'spade' }, { rank: '9', suit: 'heart' }, { rank: '9', suit: 'club' }, { rank: '9', suit: 'diamond' }], playType: 'Bomb', automatic: false },
      { sequence: 7, at: summary.finishedAt, type: 'round-end', roundSequence: 1, ranking: summary.ranking, winnerTeam: summary.winnerTeam, isGameWon: true },
    ]
    return { ...summary, eventCount: events.length, participants: { p1: '陵水玩家', p2: '牌友二', p3: '队友', p4: '牌友四' }, events }
  }
}
export class DevelopmentSpectatorGateway implements SpectatorGateway {
  private readonly runningFeedReads = new Map<string, number>()

  public async list (delaySeconds = 30): Promise<SpectatorMatchSummary[]> {
    return SAMPLE_SPECTATOR_MATCHES.map(item => {
      if (item.status !== 'running') return { ...item, delaySeconds }
      const reads = this.runningFeedReads.get(item.matchId) ?? 0
      return { ...item, delaySeconds, availableEventCount: Math.min(item.totalEventCount, Math.max(3, 2 + reads)) }
    })
  }

  public async getFeed (matchId: string, delaySeconds = 30): Promise<SpectatorFeed> {
    const summary = SAMPLE_SPECTATOR_MATCHES.find(item => item.matchId === matchId) ?? SAMPLE_SPECTATOR_MATCHES[0]
    const events: ReplayEvent[] = [
      { sequence: 1, at: summary.startedAt, type: 'game-start', roundSequence: 1 },
      { sequence: 2, at: summary.startedAt + 1_000, type: 'round-start', roundSequence: 1 },
      { sequence: 3, at: summary.startedAt + 2_000, type: 'play-start', roundSequence: 1 },
      { sequence: 4, at: summary.startedAt + 18_000, type: 'play', roundSequence: 1, playerId: 'p2', cards: [{ rank: 'K', suit: 'heart' }], playType: 'Single', automatic: false },
      { sequence: 5, at: summary.startedAt + 30_000, type: 'pass', roundSequence: 1, playerId: 'p3', automatic: true },
    ]
    if (summary.status === 'finished') events.push({ sequence: 6, at: summary.finishedAt ?? Date.now(), type: 'round-end', roundSequence: 1, ranking: ['p2', 'p4', 'p1', 'p3'], winnerTeam: 'teamB', isGameWon: true })
    if (summary.status === 'aborted') events.push({ sequence: 6, at: summary.abortedAt ?? Date.now(), type: 'room-closed', roundSequence: 1, reason: summary.abortReason ?? 'empty-timeout' })
    const readCount = summary.status === 'running' ? (this.runningFeedReads.get(summary.matchId) ?? 0) + 1 : 0
    if (summary.status === 'running') this.runningFeedReads.set(summary.matchId, readCount)
    const visibleEvents = summary.status === 'running' ? events.slice(0, Math.min(events.length, 2 + readCount)) : events
    return {
      ...summary,
      delaySeconds,
      availableEventCount: visibleEvents.length,
      totalEventCount: events.length,
      availableThrough: Date.now() - delaySeconds * 1000,
      events: visibleEvents,
    }
  }
}
export class DevelopmentMerchantGateway implements MerchantGateway {
  public async getConsole (): Promise<MerchantConsole> { return SAMPLE_MERCHANT_CONSOLE }
  public async apply (_application: MerchantApplication): Promise<MerchantProfile> { throw new FeatureInDevelopmentError('商户申请写入') }
  public async createStore (_store: MerchantStoreDraft): Promise<MerchantStore> { throw new FeatureInDevelopmentError('创建门店') }
  public async addEmployee (_employee: MerchantEmployeeDraft): Promise<MerchantEmployee> { throw new FeatureInDevelopmentError('添加员工') }
  public async grantPoints (_grant: MerchantPointGrantDraft): Promise<MerchantPointGrant> { throw new FeatureInDevelopmentError('商户积分发放') }
}

export const createDevelopmentGateways = (): FrontPageGateways => ({
  configured: false,
  auth: new DevelopmentAuthGateway(),
  matchmaking: new DevelopmentMatchmakingGateway(),
  shop: new DevelopmentShopGateway(),
  wallet: new DevelopmentWalletGateway(),
  tournaments: new DevelopmentTournamentGateway(),
  playerCenter: new DevelopmentPlayerCenterGateway(),
  seasons: new DevelopmentSeasonGateway(),
  replays: new DevelopmentReplayGateway(),
  spectator: new DevelopmentSpectatorGateway(),
  merchant: new DevelopmentMerchantGateway(),
})
