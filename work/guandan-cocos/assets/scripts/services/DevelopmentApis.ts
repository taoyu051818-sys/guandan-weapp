import { copyData, snapshotData } from './DataSnapshot'
import { DevelopmentPlayerStore } from './DevelopmentPlayerStore'
export * from './FrontPageGatewayContracts'

import type {
  AuthGateway,
  FrontPageGateways,
  FriendRoomGateway,
  MatchmakingGateway,
  MatchQueueId,
  MatchTicket,
  PlayerCenterGateway,
  PlayerDashboard,
  ReplayDetail,
  ReplayEvent,
  ReplayGateway,
  ReplaySummary,
  SeasonGateway,
  SeasonTaskList,
  ShopProduct,
  UserProfile,
  WalletGateway,
  WalletSnapshot,
} from './FrontPageGatewayContracts'

export const SAMPLE_PRODUCTS = snapshotData<ShopProduct[]>([
  { id: 'tissue', name: '柔韧抽纸', pointsPrice: 900, description: '三层柔韧抽纸，示例规格3包。', category: '居家', stock: 99 },
  { id: 'detergent', name: '清香洗衣液', pointsPrice: 1900, description: '低泡易漂洗，示例容量1千克。', category: '清洁', stock: 60 },
  { id: 'thermos', name: '便携保温杯', pointsPrice: 2900, description: '轻量杯身，示例容量450毫升。', category: '出行', stock: 30 },
  { id: 'umbrella', name: '折叠晴雨伞', pointsPrice: 2400, description: '晴雨两用便携折叠伞。', category: '出行', stock: 45 },
  { id: 'dish_soap', name: '清新洗洁精', pointsPrice: 1200, description: '厨房清洁用品，示例容量500克。', category: '清洁', stock: 80 },
  { id: 'trash_bag', name: '加厚垃圾袋', pointsPrice: 800, description: '抽绳加厚垃圾袋，示例规格30只。', category: '居家', stock: 120 },
  { id: 'towel', name: '柔软面巾', pointsPrice: 1500, description: '吸水柔软日用毛巾。', category: '个护', stock: 75 },
  { id: 'soap', name: '植物香皂', pointsPrice: 600, description: '温和清洁香皂，示例规格100克。', category: '个护', stock: 150 },
])

export const SAMPLE_DASHBOARD = snapshotData<PlayerDashboard>({
  user: { id: 'local-player', accountId: '10000001', displayName: '陵水玩家', comprehensiveScore: 12571 },
  rating: { games: 12, wins: 7, eloOffset: 0, baseScore: 12571, comprehensiveScore: 12571 },
  stats: { gamesPlayed: 12, wins: 7, firstPlaceFinishes: 4, bombsPlayed: 19, elo: 1086 },
  season: { id: 'season-2026-lingshui', name: '陵水夏季赛季', status: 'active', progress: { score: 28, gamesPlayed: 12, wins: 7 } },
  recentMatches: [],
})

export const SAMPLE_SEASON_TASKS = snapshotData<SeasonTaskList>({
  season: { id: 'season-2026-lingshui', name: '陵水夏季赛季', status: 'active' },
  tasks: [
    { id: 'daily-play-1', name: '完成一局', target: 1, rewardPoints: 80, progress: 1, completed: true, claimed: false, cadence: 'daily' },
    { id: 'season-win-3', name: '赢得三局', target: 3, rewardPoints: 300, progress: 2, completed: false, claimed: false, cadence: 'season' },
    { id: 'season-bomb-5', name: '打出五次炸弹', target: 5, rewardPoints: 240, progress: 4, completed: false, claimed: false, cadence: 'season' },
  ],
})

export const SAMPLE_REPLAYS = snapshotData<ReplaySummary[]>([
  { id: 'demo-replay-1', eventId: 'demo:1', matchId: 'demo-match', roomId: '888888', ranking: ['p1', 'p3', 'p2', 'p4'], winnerTeam: 'teamA', finishedAt: Date.now() - 3600_000, eventCount: 7 },
])

export class FeatureInDevelopmentError extends Error {
  public constructor (feature: string) { super(`${feature}功能正在开发中`) }
}

/** Replace this class with the real HTTP/WebSocket adapter when the service is ready. */
export class DevelopmentMatchmakingGateway implements MatchmakingGateway {
  public async joinQueue (_queueId: MatchQueueId, _assignment?: { tournamentId: string, assignmentId: string }): Promise<MatchTicket> { throw new FeatureInDevelopmentError('比赛匹配') }
  public async getStatus (_ticketId: string): Promise<MatchTicket> { throw new FeatureInDevelopmentError('比赛匹配') }
  public async cancel (_ticketId: string): Promise<void> { throw new FeatureInDevelopmentError('取消匹配') }
}
export class DevelopmentFriendRoomGateway implements FriendRoomGateway {
  public async create (): Promise<never> { throw new FeatureInDevelopmentError('平台好友房') }
  public async join (): Promise<never> { throw new FeatureInDevelopmentError('平台好友房') }
  public async joinRoomNumber (): Promise<never> { throw new FeatureInDevelopmentError('平台好友房') }
  public async cancel (): Promise<void> {}
}

export class DevelopmentWalletGateway implements WalletGateway {
  public async getWallet (): Promise<WalletSnapshot> { return { points: 10_000, diamonds: 0 } }
}

export class DevelopmentAuthGateway implements AuthGateway {
  public constructor (private readonly player = new DevelopmentPlayerStore(SAMPLE_DASHBOARD)) {}
  public async getProfile (): Promise<UserProfile> { return this.player.getProfile() }
  public async updateProfile (profile: Pick<UserProfile, 'displayName' | 'avatarUrl'> & { avatarDataUri?: string }): Promise<UserProfile> {
    return this.player.updateProfile(profile)
  }
  public async getAvatarImage (): Promise<null> { return null }
  public signOut (): void {}
}

export class DevelopmentPlayerCenterGateway implements PlayerCenterGateway {
  public constructor (private readonly player = new DevelopmentPlayerStore(SAMPLE_DASHBOARD)) {}
  public async getDashboard (): Promise<PlayerDashboard> { return this.player.getDashboard() }
}
export class DevelopmentSeasonGateway implements SeasonGateway {
  public async listTasks (): Promise<SeasonTaskList> { return copyData<SeasonTaskList>(SAMPLE_SEASON_TASKS) }
  public async claim (_taskId: string): Promise<void> { throw new FeatureInDevelopmentError('任务领奖') }
}
export class DevelopmentReplayGateway implements ReplayGateway {
  public async list (): Promise<ReplaySummary[]> { return copyData<ReplaySummary[]>(SAMPLE_REPLAYS) }
  public async get (replayId: string): Promise<ReplayDetail> {
    const summary = copyData<ReplaySummary>(SAMPLE_REPLAYS.find(item => item.id === replayId) ?? SAMPLE_REPLAYS[0])
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
    return { ...summary, eventCount: events.length, participants: { p1: '陵水玩家', p2: '牌友二', p3: '队友', p4: '牌友四' }, viewerSeat: 'p1', events }
  }
}
export const createDevelopmentGateways = (): FrontPageGateways => {
  const player = new DevelopmentPlayerStore(SAMPLE_DASHBOARD)
  return {
    configured: false,
    auth: new DevelopmentAuthGateway(player),
    matchmaking: new DevelopmentMatchmakingGateway(),
    friendRooms: new DevelopmentFriendRoomGateway(),
    matchRecovery: { recover: async () => null, confirm: () => undefined, abandon: () => undefined },
    wallet: new DevelopmentWalletGateway(),
    playerCenter: new DevelopmentPlayerCenterGateway(player),
    seasons: new DevelopmentSeasonGateway(),
    replays: new DevelopmentReplayGateway(),
  }
}
