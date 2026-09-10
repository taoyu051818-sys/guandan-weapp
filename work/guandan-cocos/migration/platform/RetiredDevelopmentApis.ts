import { SAMPLE_PRODUCTS } from '../../assets/scripts/services/DevelopmentApis'
import type { ShopProduct } from '../../assets/scripts/services/FrontPageGatewayContracts'
import type { ShopGateway, ShopOrder } from './ShopContracts'
import { copyData, snapshotData } from '../../assets/scripts/services/DataSnapshot'
import { FeatureInDevelopmentError } from '../../assets/scripts/services/DevelopmentApis'
import type {
  MerchantApplication,
  MerchantConsole,
  MerchantEmployee,
  MerchantEmployeeDraft,
  MerchantGateway,
  MerchantPointGrant,
  MerchantPointGrantDraft,
  MerchantProfile,
  MerchantStore,
  MerchantStoreDraft,
  ReplayEvent,
  SpectatorFeed,
  SpectatorGateway,
  SpectatorMatchSummary,
  TournamentGateway,
  TournamentStanding,
  TournamentStandings,
  TournamentState,
  TournamentSummary,
} from '../../assets/scripts/services/FrontPageGatewayContracts'

export const SAMPLE_TOURNAMENTS = snapshotData<TournamentSummary[]>([
  { id: 'lingshui-16-cup', name: '陵水16人积分赛', description: '固定16人 · 三轮不重复同桌 · 前八晋级', status: 'running', entryPoints: 0, queueId: 'lingshui_16_cup', enrolled: true, format: 'fixed16-latin-3', capacity: 16, checkedInCount: 16, roundsTotal: 3, currentRound: 1, advanceCount: 8 },
  { id: 'rookie-cup', name: '新手体验赛', description: '随时报名 · 三轮积分', status: 'open', entryPoints: 0, queueId: 'rookie_cup', enrolled: false, roundsTotal: 3, currentRound: 1, advanceCount: 16 },
  { id: 'weekend-cup', name: '周末挑战赛', description: '三轮积分 · 前八晋级', status: 'scheduled', entryPoints: 200, queueId: 'weekend_cup', enrolled: false, roundsTotal: 3, currentRound: 1, advanceCount: 8 },
  { id: 'master-cup', name: '大师晋级赛', description: '五轮积分 · 前四晋级', status: 'scheduled', entryPoints: 500, queueId: 'master_cup', enrolled: false, roundsTotal: 5, currentRound: 1, advanceCount: 4 },
])


export const SAMPLE_SPECTATOR_MATCHES = snapshotData<SpectatorMatchSummary[]>([
  { matchId: 'demo-live-match', tableLabel: '快速匹配 · DEMO01桌', mode: 'quick', status: 'playing', startedAt: Date.now() - 8 * 60_000, finishedAt: null, abortedAt: null, abortReason: null, delaySeconds: 30, availableEventCount: 3, totalEventCount: 5, timelineComplete: false },
  { matchId: 'demo-match', tableLabel: '周末赛 · DEMO02桌', mode: 'weekend_cup', status: 'completed', startedAt: Date.now() - 90 * 60_000, finishedAt: Date.now() - 60 * 60_000, abortedAt: null, abortReason: null, delaySeconds: 30, availableEventCount: 6, totalEventCount: 6, timelineComplete: true },
  { matchId: 'demo-aborted-match', tableLabel: '快速匹配 · DEMO03桌', mode: 'quick', status: 'aborted', startedAt: Date.now() - 20 * 60_000, finishedAt: null, abortedAt: Date.now() - 10 * 60_000, abortReason: 'empty-timeout', delaySeconds: 30, availableEventCount: 6, totalEventCount: 6, timelineComplete: true },
])

/** Explicitly synthetic and read-only; never used when a platform endpoint is configured. */
export const SAMPLE_MERCHANT_CONSOLE = snapshotData<MerchantConsole>({
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
})


export class DevelopmentTournamentGateway implements TournamentGateway {
  public async withdraw (_tournamentId: string): Promise<TournamentState> { throw new FeatureInDevelopmentError('取消赛事报名') }
  public async listTournaments (): Promise<TournamentSummary[]> { return copyData<TournamentSummary[]>(SAMPLE_TOURNAMENTS) }
  public async enroll (_tournamentId: string, _expectedEntryPoints?: number): Promise<TournamentSummary> { throw new FeatureInDevelopmentError('赛事报名') }
  public async checkIn (tournamentId: string): Promise<TournamentState> { return this.getState(tournamentId) }
  public async getState (tournamentId: string): Promise<TournamentState> {
    const tournament = copyData<TournamentSummary>(SAMPLE_TOURNAMENTS.find(item => item.id === tournamentId) ?? SAMPLE_TOURNAMENTS[0])
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
    const tournament = copyData<TournamentSummary>(SAMPLE_TOURNAMENTS.find(item => item.id === tournamentId) ?? SAMPLE_TOURNAMENTS[0])
    const viewerStanding: TournamentStanding = { userId: 'local-player', displayName: '陵水玩家', played: 2, wins: 1, firstPlaces: 1, points: 5, opponentPoints: 11, rank: 1, advanced: false, qualificationStatus: 'pending' }
    return { tournament, standings: [viewerStanding], provisional: true, cutoffRank: tournament.advanceCount ?? 0, viewerStanding }
  }
}


export class DevelopmentSpectatorGateway implements SpectatorGateway {
  private readonly runningFeedReads = new Map<string, number>()

  public async list (delaySeconds = 30): Promise<SpectatorMatchSummary[]> {
    return SAMPLE_SPECTATOR_MATCHES.map(item => {
      if (item.status !== 'running' && item.status !== 'playing') return { ...item, delaySeconds }
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
    if (summary.status === 'finished' || summary.status === 'completed') events.push({ sequence: 6, at: summary.finishedAt ?? Date.now(), type: 'round-end', roundSequence: 1, ranking: ['p2', 'p4', 'p1', 'p3'], winnerTeam: 'teamB', isGameWon: true })
    if (summary.status === 'aborted') events.push({ sequence: 6, at: summary.abortedAt ?? Date.now(), type: 'room-closed', roundSequence: 1, reason: summary.abortReason ?? 'empty-timeout' })
    const playing = summary.status === 'running' || summary.status === 'playing'
    const readCount = playing ? (this.runningFeedReads.get(summary.matchId) ?? 0) + 1 : 0
    if (playing) this.runningFeedReads.set(summary.matchId, readCount)
    const visibleEvents = playing ? events.slice(0, Math.min(events.length, 2 + readCount)) : events
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
  public async getConsole (): Promise<MerchantConsole> { return copyData<MerchantConsole>(SAMPLE_MERCHANT_CONSOLE) }
  public async apply (_application: MerchantApplication): Promise<MerchantProfile> { throw new FeatureInDevelopmentError('商户申请写入') }
  public async createStore (_store: MerchantStoreDraft): Promise<MerchantStore> { throw new FeatureInDevelopmentError('创建门店') }
  public async addEmployee (_employee: MerchantEmployeeDraft): Promise<MerchantEmployee> { throw new FeatureInDevelopmentError('添加员工') }
  public async grantPoints (_grant: MerchantPointGrantDraft): Promise<MerchantPointGrant> { throw new FeatureInDevelopmentError('商户积分发放') }
}

/** Products stay local for UI development; ordering intentionally has no backend implementation. */
export class DevelopmentShopGateway implements ShopGateway {
  public async listProducts (): Promise<ShopProduct[]> { return copyData<ShopProduct[]>(SAMPLE_PRODUCTS) }
  public async createOrder (_productId: string, _quantity: number, _expectedPointsPrice?: number): Promise<ShopOrder> { throw new FeatureInDevelopmentError('商城购买') }
}
