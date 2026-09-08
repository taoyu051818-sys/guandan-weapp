import type { AuthGateway, PlayerCenterGateway, PlayerDashboard, SeasonGateway, SeasonTask, SeasonTaskList, UserProfile } from '../FrontPageGatewayContracts'
import { PlatformApiClient } from './client'
import { finiteNumber, idempotencyKey, nonNegativeNumber, requireAccountId, requireArray, requireNonEmptyString, requireRecord } from './validation'

const normalizeUserProfile = (value: unknown, context: string): UserProfile => {
  const user = requireRecord(value, context)
  return {
    id: requireNonEmptyString(user.id, '用户 ID'),
    accountId: requireAccountId(user.accountId, '八位账号'),
    displayName: requireNonEmptyString(user.displayName, '用户昵称'),
    comprehensiveScore: nonNegativeNumber(user.comprehensiveScore, '综合分'),
    avatarUrl: typeof user.avatarUrl === 'string' && user.avatarUrl.trim() ? user.avatarUrl : undefined,
  }
}

const normalizeDashboard = (value: unknown): PlayerDashboard => {
  const payload = requireRecord(value, '玩家中心响应')
  const rating = requireRecord(payload.rating, '综合分明细')
  const stats = requireRecord(payload.stats, '玩家统计')
  const seasonRecord = payload.season === null || payload.season === undefined ? null : requireRecord(payload.season, '赛季信息')
  const seasonProgress = seasonRecord ? requireRecord(seasonRecord.progress, '赛季进度') : null
  return {
    user: normalizeUserProfile(payload.user, '玩家资料'),
    rating: {
      games: nonNegativeNumber(rating.games, '综合分场次'),
      wins: nonNegativeNumber(rating.wins, '综合分胜场'),
      eloOffset: finiteNumber(rating.eloOffset, 'ELO 修正'),
      baseScore: nonNegativeNumber(rating.baseScore, '长期基础分'),
      comprehensiveScore: nonNegativeNumber(rating.comprehensiveScore, '综合分'),
    },
    stats: {
      gamesPlayed: nonNegativeNumber(stats.gamesPlayed, '总场数'),
      wins: nonNegativeNumber(stats.wins, '胜场数'),
      firstPlaceFinishes: nonNegativeNumber(stats.firstPlaceFinishes, '头游次数'),
      bombsPlayed: nonNegativeNumber(stats.bombsPlayed, '炸弹次数'),
      elo: stats.elo === undefined
        ? nonNegativeNumber(rating.comprehensiveScore, '综合分')
        : nonNegativeNumber(stats.elo, '兼容竞技参数'),
    },
    season: seasonRecord && seasonProgress ? {
      id: requireNonEmptyString(seasonRecord.id, '赛季 ID'),
      name: requireNonEmptyString(seasonRecord.name, '赛季名称'),
      status: String(seasonRecord.status ?? ''),
      progress: {
        score: nonNegativeNumber(seasonProgress.score, '赛季分数'),
        gamesPlayed: nonNegativeNumber(seasonProgress.gamesPlayed, '赛季场数'),
        wins: nonNegativeNumber(seasonProgress.wins, '赛季胜场'),
      },
    } : null,
    recentMatches: requireArray(payload.recentMatches ?? [], '最近对局').map((item, index) => {
      const match = requireRecord(item, `第 ${index + 1} 条最近对局`)
      return {
        eventId: requireNonEmptyString(match.eventId, '结算事件 ID'),
        replayId: requireNonEmptyString(match.replayId, '牌谱 ID'),
        matchId: String(match.matchId ?? ''),
        roomId: String(match.roomId ?? ''),
        place: nonNegativeNumber(match.place, '对局名次'),
        won: Boolean(match.won),
        tournamentId: typeof match.tournamentId === 'string' ? match.tournamentId : null,
        finishedAt: nonNegativeNumber(match.finishedAt, '对局结束时间'),
      }
    }),
  }
}

export class HttpAuthGateway implements AuthGateway {
  public constructor (private readonly client: PlatformApiClient) {}

  public async getProfile (): Promise<UserProfile> {
    const payload = requireRecord(await this.client.request<unknown>('/api/v1/profile'), '用户信息响应')
    return normalizeUserProfile(payload.user, '用户信息')
  }

  public signOut (): void { this.client.signOut() }

  public async updateProfile (profile: Pick<UserProfile, 'displayName' | 'avatarUrl'>): Promise<UserProfile> {
    // wx.request has no portable PATCH support; the server keeps PATCH for web clients too.
    const payload = requireRecord(await this.client.request<unknown>('/api/v1/profile', 'POST', profile), '资料保存响应')
    return normalizeUserProfile(payload.user, '用户信息')
  }

  public async getAvatarImage (expectedAvatar?: string): Promise<string | null> {
    const payload = requireRecord(await this.client.request<unknown>('/api/v1/profile/avatar'), '头像响应')
    if (expectedAvatar && payload.avatarUrl !== expectedAvatar) return null
    return typeof payload.dataUri === 'string' && /^data:image\/(png|jpeg);base64,/.test(payload.dataUri) ? payload.dataUri : null
  }
}

export class HttpPlayerCenterGateway implements PlayerCenterGateway {
  public constructor (private readonly client: PlatformApiClient) {}
  public async getDashboard (): Promise<PlayerDashboard> { return normalizeDashboard(await this.client.request<unknown>('/api/v1/me/dashboard')) }
}

export class HttpSeasonGateway implements SeasonGateway {
  public constructor (private readonly client: PlatformApiClient) {}

  public async listTasks (): Promise<SeasonTaskList> {
    const payload = requireRecord(await this.client.request<unknown>('/api/v1/season/tasks'), '赛季任务响应')
    const season = payload.season === null || payload.season === undefined ? null : requireRecord(payload.season, '赛季信息')
    const tasks: SeasonTask[] = requireArray(payload.tasks, '赛季任务列表').map((item, index) => {
      const task = requireRecord(item, `第 ${index + 1} 个赛季任务`)
      return {
        id: requireNonEmptyString(task.id, '任务 ID'),
        name: requireNonEmptyString(task.name, '任务名称'),
        target: nonNegativeNumber(task.target, '任务目标'),
        rewardPoints: nonNegativeNumber(task.rewardPoints, '任务奖励'),
        progress: nonNegativeNumber(task.progress, '任务进度'),
        completed: Boolean(task.completed),
        claimed: Boolean(task.claimed),
        cadence: String(task.cadence ?? 'season'),
      }
    })
    return { season: season ? { id: requireNonEmptyString(season.id, '赛季 ID'), name: requireNonEmptyString(season.name, '赛季名称'), status: String(season.status ?? '') } : null, tasks }
  }

  public async claim (taskId: string): Promise<void> {
    await this.client.request<unknown>(`/api/v1/season/tasks/${encodeURIComponent(taskId)}/claim`, 'POST', undefined, { 'Idempotency-Key': idempotencyKey('task') })
  }
}
