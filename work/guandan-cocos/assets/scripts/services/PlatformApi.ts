import { MATCH_QUEUE_IDS } from './DevelopmentApis'
import type {
  AuthGateway,
  FrontPageGateways,
  MatchQueueId,
  MatchTicket,
  MerchantApplication,
  MerchantConsole,
  MerchantEmployee,
  MerchantEmployeeDraft,
  MerchantEmployeeStatus,
  MerchantGateway,
  MerchantGrantStatus,
  MerchantPointGrant,
  MerchantPointGrantDraft,
  MerchantProfile,
  MerchantRole,
  MerchantStatus,
  MerchantStore,
  MerchantStoreDraft,
  MerchantStoreStatus,
  PlayerCenterGateway,
  PlayerDashboard,
  ReplayDetail,
  ReplayEvent,
  ReplayGateway,
  ReplaySummary,
  SeasonGateway,
  SeasonTask,
  SeasonTaskList,
  ShopGateway,
  ShopOrder,
  ShopProduct,
  SpectatorFeed,
  SpectatorGateway,
  SpectatorMatchSummary,
  TournamentAssignment,
  TournamentGateway,
  TournamentStanding,
  TournamentStandings,
  TournamentState,
  TournamentSummary,
  UserProfile,
  WalletGateway,
  WalletSnapshot,
} from './DevelopmentApis'

export type HttpMethod = 'GET' | 'POST' | 'DELETE'

export type HttpRequest = {
  method: HttpMethod
  url: string
  headers?: Record<string, string>
  body?: unknown
  timeoutMs?: number
}

export type HttpResponse = { status: number, body: unknown }

export interface HttpTransport {
  request(input: HttpRequest): Promise<HttpResponse>
}

export interface CredentialStore {
  getAccessToken(): string | null
  setAccessToken(token: string): void
  clearAccessToken(): void
}

export type GameEndpointPolicy = 'secure-only' | 'allow-localhost-insecure' | 'allow-insecure'
export type HttpEndpointPolicy = 'secure-only' | 'allow-localhost-insecure' | 'allow-insecure'

export type PlatformApiConfig = {
  baseUrl: string
  deviceId: string
  displayName?: string
  credentialStore?: CredentialStore
  accessToken?: string
  timeoutMs?: number
  allowDevelopmentLogin?: boolean
  loginProvider?: () => Promise<PlatformLoginCredential>
  gameEndpointPolicy?: GameEndpointPolicy
  httpEndpointPolicy?: HttpEndpointPolicy
}

export type PlatformLoginCredential =
  | { kind: 'wechat', code: string, displayName?: string }
  | { kind: 'development', deviceId: string, displayName: string }

type ApiEnvelope<T> = {
  ok?: boolean
  data?: T
  error?: string | { code?: string, message?: string, details?: unknown, retryable?: boolean } | null
  message?: string
}

export type PlatformApiErrorOptions = {
  status?: number
  code?: string
  details?: unknown
  retryable?: boolean
}

export class PlatformApiError extends Error {
  public readonly status: number
  public readonly code: string
  public readonly details?: unknown
  public readonly retryable: boolean

  public constructor (message: string, options: PlatformApiErrorOptions = {}) {
    super(message)
    this.name = 'PlatformApiError'
    this.status = options.status ?? 0
    this.code = options.code ?? 'PLATFORM_API_ERROR'
    this.details = options.details
    this.retryable = options.retryable ?? isRetryableStatus(this.status)
  }
}

type RawMatchTicket = Partial<MatchTicket> & {
  id?: string
  matchId?: string
  endpoint?: string
  token?: string
  gameTicket?: string
  playerId?: MatchTicket['seat']
  mode?: MatchQueueId
}

type RawProduct = Partial<ShopProduct> & {
  price?: number
  points?: number
  tag?: string
  availableStock?: number
}

type RawTournament = Partial<TournamentSummary> & {
  title?: string
  summary?: string
  entryFee?: number
  startsAt?: number | string
}

const normalizeBaseUrl = (value: string, policy: HttpEndpointPolicy): string => {
  const normalized = value.trim().replace(/\/+$/, '')
  let parsed: URL
  try { parsed = new URL(normalized) } catch { throw new Error('平台服务地址不是有效 URL') }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) throw new Error('平台服务地址必须是不含凭证的 HTTP/HTTPS URL')
  if (parsed.protocol === 'http:' && policy === 'secure-only') throw new Error('生产环境平台服务必须使用 HTTPS')
  if (parsed.protocol === 'http:' && policy === 'allow-localhost-insecure' && !isLocalHostname(parsed.hostname)) throw new Error('非本机平台服务必须使用 HTTPS')
  return normalized
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const isRetryableStatus = (status: number): boolean => status === 0 || status === 408 || status === 425 || status === 429 || status >= 500

const responseError = (body: unknown, status: number, fallback: string): PlatformApiError => {
  const envelope = isRecord(body) ? body as ApiEnvelope<unknown> : undefined
  const rawError = envelope?.error
  const objectError = isRecord(rawError) ? rawError : undefined
  const message = typeof rawError === 'string'
    ? rawError
    : typeof objectError?.message === 'string'
      ? objectError.message
      : typeof envelope?.message === 'string'
        ? envelope.message
        : fallback
  return new PlatformApiError(message, {
    status,
    code: typeof objectError?.code === 'string' && objectError.code.trim() ? objectError.code : `HTTP_${status}`,
    details: objectError?.details,
    retryable: typeof objectError?.retryable === 'boolean' ? objectError.retryable : isRetryableStatus(status),
  })
}

const unwrap = <T>(response: HttpResponse): T => {
  if (response.status < 200 || response.status >= 300) throw responseError(response.body, response.status, `平台服务请求失败（${response.status}）`)
  if (isRecord(response.body) && ('ok' in response.body || 'data' in response.body)) {
    const envelope = response.body as ApiEnvelope<T>
    if (envelope.ok === false) throw responseError(response.body, response.status, '平台服务拒绝了请求')
    if (envelope.data !== undefined) return envelope.data
    throw new PlatformApiError('平台服务返回了缺少 data 的响应', { status: response.status, code: 'MALFORMED_RESPONSE', retryable: false })
  }
  return response.body as T
}

const nonNegativeNumber = (value: unknown, context: string): number => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') throw malformedResponse(`${context}不合法`, { value })
  const normalized = Number(value)
  if (!Number.isFinite(normalized) || normalized < 0) throw malformedResponse(`${context}不合法`, { value })
  return normalized
}

const finiteNumber = (value: unknown, context: string): number => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') throw malformedResponse(`${context}不合法`, { value })
  const normalized = Number(value)
  if (!Number.isFinite(normalized)) throw malformedResponse(`${context}不合法`, { value })
  return normalized
}

const requireAccountId = (value: unknown, context: string): string => {
  const accountId = requireNonEmptyString(value, context)
  if (!/^\d{8}$/.test(accountId)) throw malformedResponse(`${context}必须为八位数字`, { value })
  return accountId
}

const idempotencyKey = (prefix: string): string => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`

const malformedResponse = (message: string, details?: unknown): PlatformApiError => new PlatformApiError(message, {
  status: 200,
  code: 'MALFORMED_RESPONSE',
  details,
  retryable: false,
})

const requireRecord = (value: unknown, context: string): Record<string, unknown> => {
  if (!isRecord(value)) throw malformedResponse(`${context}格式不正确`)
  return value
}

const requireArray = (value: unknown, context: string): unknown[] => {
  if (!Array.isArray(value)) throw malformedResponse(`${context}格式不正确`)
  return value
}

const requireNonEmptyString = (value: unknown, context: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw malformedResponse(`${context}不能为空`)
  return value.trim()
}

const requireBoolean = (value: unknown, context: string): boolean => {
  if (typeof value !== 'boolean') throw malformedResponse(`${context}必须是布尔值`, { value })
  return value
}

const nonNegativeInteger = (value: unknown, context: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw malformedResponse(`${context}必须是非负整数`, { value })
  return value
}

const positiveInteger = (value: unknown, context: string): number => {
  const normalized = nonNegativeInteger(value, context)
  if (normalized <= 0) throw malformedResponse(`${context}必须是正整数`, { value })
  return normalized
}

/** XMLHttpRequest is available in Cocos Web, native and WeChat adapters. */
export class XhrTransport implements HttpTransport {
  public request (input: HttpRequest): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open(input.method, input.url, true)
      xhr.timeout = input.timeoutMs ?? 8000
      Object.entries(input.headers ?? {}).forEach(([name, value]) => xhr.setRequestHeader(name, value))
      xhr.onload = () => {
        let body: unknown = null
        try { body = xhr.responseText ? JSON.parse(xhr.responseText) : null } catch { body = xhr.responseText }
        resolve({ status: xhr.status, body })
      }
      xhr.onerror = () => reject(new PlatformApiError('无法连接平台服务', { code: 'NETWORK_ERROR', retryable: true }))
      xhr.ontimeout = () => reject(new PlatformApiError('平台服务响应超时', { code: 'REQUEST_TIMEOUT', retryable: true }))
      xhr.send(input.body === undefined ? null : JSON.stringify(input.body))
    })
  }
}

export class PlatformApiClient {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private volatileToken: string | null
  private loginPromise: Promise<string> | null = null

  public constructor (
    private readonly transport: HttpTransport,
    private readonly config: PlatformApiConfig,
  ) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl, config.httpEndpointPolicy ?? 'secure-only')
    if (!this.baseUrl) throw new Error('平台服务地址不能为空')
    this.timeoutMs = config.timeoutMs ?? 8000
    this.volatileToken = config.accessToken?.trim() || config.credentialStore?.getAccessToken() || null
  }

  public async request<T> (path: string, method: HttpMethod = 'GET', body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const token = await this.ensureAccessToken()
    const response = await this.send(path, method, body, {
      Authorization: `Bearer ${token}`,
      ...headers,
    })
    if (response.status !== 401) return unwrap<T>(response)
    const refreshedToken = await this.refreshAfterUnauthorized(token)
    return unwrap<T>(await this.send(path, method, body, { Authorization: `Bearer ${refreshedToken}`, ...headers }))
  }

  public signOut (): void { this.clearAccessToken() }

  private async ensureAccessToken (): Promise<string> {
    if (this.volatileToken) return this.volatileToken
    if (this.loginPromise) return this.loginPromise
    this.loginPromise = this.login()
    try { return await this.loginPromise } finally { this.loginPromise = null }
  }

  /** Only the token that actually received a 401 may be cleared. Late 401s reuse an already-refreshed token. */
  private async refreshAfterUnauthorized (rejectedToken: string): Promise<string> {
    if (this.volatileToken && this.volatileToken !== rejectedToken) return this.volatileToken
    if (this.volatileToken === rejectedToken) this.clearAccessToken(rejectedToken)
    return this.ensureAccessToken()
  }

  private async login (): Promise<string> {
    const credential = this.config.loginProvider
      ? await this.config.loginProvider()
      : this.config.allowDevelopmentLogin
        ? { kind: 'development' as const, deviceId: this.config.deviceId, displayName: this.config.displayName ?? '陵水玩家' }
        : null
    if (!credential) throw new PlatformApiError('尚未登录平台服务', { code: 'AUTH_REQUIRED', retryable: false })
    const path = credential.kind === 'wechat' ? '/api/v1/auth/wx-login' : '/api/v1/auth/dev-login'
    const body = credential.kind === 'wechat'
      ? { code: credential.code, displayName: credential.displayName ?? this.config.displayName ?? '陵水玩家' }
      : { deviceId: credential.deviceId, displayName: credential.displayName }
    const response = await this.send(path, 'POST', body)
    const payload = requireRecord(unwrap<unknown>(response), '登录响应')
    const rawToken = payload.accessToken ?? payload.token
    const token = typeof rawToken === 'string' ? rawToken.trim() : ''
    if (!token) throw malformedResponse('平台服务没有返回登录凭证')
    this.volatileToken = token
    this.config.credentialStore?.setAccessToken(token)
    return token
  }

  private clearAccessToken (expectedToken?: string): void {
    if (expectedToken !== undefined && this.volatileToken !== expectedToken) return
    this.volatileToken = null
    this.config.credentialStore?.clearAccessToken()
  }

  private async send (path: string, method: HttpMethod, body?: unknown, headers: Record<string, string> = {}): Promise<HttpResponse> {
    try {
      const defaultHeaders: Record<string, string> = { Accept: 'application/json' }
      if (method !== 'GET' && body !== undefined) defaultHeaders['Content-Type'] = 'application/json'
      return await this.transport.request({
        method,
        url: `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`,
        headers: { ...defaultHeaders, ...headers },
        body,
        timeoutMs: this.timeoutMs,
      })
    } catch (error) {
      if (error instanceof PlatformApiError) throw error
      throw new PlatformApiError(error instanceof Error ? error.message : '平台服务传输失败', {
        code: 'TRANSPORT_ERROR',
        details: error,
        retryable: true,
      })
    }
  }
}

class HttpAuthGateway implements AuthGateway {
  public constructor (private readonly client: PlatformApiClient) {}

  public async getProfile (): Promise<UserProfile> {
    const payload = requireRecord(await this.client.request<unknown>('/api/v1/profile'), '用户信息响应')
    const user = requireRecord(payload.user, '用户信息')
    return {
      id: requireNonEmptyString(user.id, '用户 ID'),
      accountId: requireAccountId(user.accountId, '八位账号'),
      displayName: requireNonEmptyString(user.displayName, '用户昵称'),
      comprehensiveScore: nonNegativeNumber(user.comprehensiveScore, '综合分'),
      avatarUrl: typeof user.avatarUrl === 'string' && user.avatarUrl.trim() ? user.avatarUrl : undefined,
    }
  }

  public signOut (): void { this.client.signOut() }
}

const normalizeDashboard = (value: unknown): PlayerDashboard => {
  const payload = requireRecord(value, '玩家中心响应')
  const user = requireRecord(payload.user, '玩家资料')
  const rating = requireRecord(payload.rating, '综合分明细')
  const stats = requireRecord(payload.stats, '玩家统计')
  const seasonRecord = payload.season === null || payload.season === undefined ? null : requireRecord(payload.season, '赛季信息')
  const seasonProgress = seasonRecord ? requireRecord(seasonRecord.progress, '赛季进度') : null
  return {
    user: {
      id: requireNonEmptyString(user.id, '用户 ID'),
      accountId: requireAccountId(user.accountId, '八位账号'),
      displayName: requireNonEmptyString(user.displayName, '用户昵称'),
      comprehensiveScore: nonNegativeNumber(user.comprehensiveScore, '综合分'),
      avatarUrl: typeof user.avatarUrl === 'string' && user.avatarUrl.trim() ? user.avatarUrl : undefined,
    },
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

class HttpPlayerCenterGateway implements PlayerCenterGateway {
  public constructor (private readonly client: PlatformApiClient) {}
  public async getDashboard (): Promise<PlayerDashboard> { return normalizeDashboard(await this.client.request<unknown>('/api/v1/me/dashboard')) }
}

const normalizeReplayEvent = (value: unknown, context: string): ReplayEvent => {
  const event = requireRecord(value, context)
  const cards = event.cards === undefined ? undefined : requireArray(event.cards, `${context}牌组`).map(cardValue => {
    const card = requireRecord(cardValue, `${context}牌`)
    return { rank: String(card.rank ?? ''), suit: String(card.suit ?? '') }
  })
  const ranking = event.ranking === undefined
    ? undefined
    : requireArray(event.ranking, `${context}名次`).map((seat, index) => requireNonEmptyString(seat, `${context}第 ${index + 1} 名席位`))
  return {
    sequence: nonNegativeNumber(event.sequence, `${context}序号`),
    at: nonNegativeNumber(event.at, `${context}时间`),
    type: requireNonEmptyString(event.type, `${context}类型`),
    ...(event.roundSequence === undefined ? {} : { roundSequence: positiveInteger(event.roundSequence, `${context}局序号`) }),
    ...(typeof event.playerId === 'string' ? { playerId: event.playerId } : {}),
    ...(cards ? { cards } : {}),
    ...(typeof event.playType === 'string' ? { playType: event.playType } : {}),
    ...(typeof event.automatic === 'boolean' ? { automatic: event.automatic } : {}),
    ...(ranking ? { ranking } : {}),
    ...(typeof event.winnerTeam === 'string' ? { winnerTeam: event.winnerTeam } : {}),
    ...(typeof event.isGameWon === 'boolean' ? { isGameWon: event.isGameWon } : {}),
    ...(typeof event.reason === 'string' ? { reason: event.reason } : {}),
    ...(typeof event.text === 'string' ? { text: event.text } : {}),
  }
}

const normalizeReplaySummary = (value: unknown, context: string): ReplaySummary => {
  const replay = requireRecord(value, context)
  const ranking = requireArray(replay.ranking, `${context}名次`).map(item => String(item))
  return {
    id: requireNonEmptyString(replay.id, `${context}ID`),
    eventId: requireNonEmptyString(replay.eventId, `${context}事件ID`),
    matchId: String(replay.matchId ?? ''),
    roomId: String(replay.roomId ?? ''),
    ranking,
    winnerTeam: String(replay.winnerTeam ?? ''),
    finishedAt: nonNegativeNumber(replay.finishedAt, `${context}结束时间`),
    eventCount: nonNegativeNumber(replay.eventCount ?? 0, `${context}事件数`),
  }
}

class HttpReplayGateway implements ReplayGateway {
  public constructor (private readonly client: PlatformApiClient) {}
  public async list (): Promise<ReplaySummary[]> {
    const payload = requireRecord(await this.client.request<unknown>('/api/v1/replays'), '牌谱列表响应')
    return requireArray(payload.replays, '牌谱列表').map((item, index) => normalizeReplaySummary(item, `第 ${index + 1} 条牌谱`))
  }
  public async get (replayId: string): Promise<ReplayDetail> {
    const payload = requireRecord(await this.client.request<unknown>(`/api/v1/replays/${encodeURIComponent(replayId)}`), '牌谱详情响应')
    const raw = requireRecord(payload.replay, '牌谱详情')
    const events = requireArray(raw.events, '牌谱事件').map((item, index) => normalizeReplayEvent(item, `第 ${index + 1} 个牌谱事件`))
    const summary = normalizeReplaySummary({ ...raw, eventCount: events.length }, '牌谱详情')
    const participantsRaw = requireRecord(raw.participants, '牌谱参与者')
    return { ...summary, participants: Object.fromEntries(Object.entries(participantsRaw).map(([seat, name]) => [seat, String(name)])), events }
  }
}

class HttpSeasonGateway implements SeasonGateway {
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

const normalizeSpectatorSummary = (value: unknown, context: string): SpectatorMatchSummary => {
  const feed = requireRecord(value, context)
  const status = String(feed.status)
  if (!['running', 'finished', 'aborted'].includes(status)) throw malformedResponse(`${context}状态不合法`, { status: feed.status })
  const mode = String(feed.mode)
  if (!MATCH_QUEUE_IDS.includes(mode as MatchQueueId)) throw malformedResponse(`${context}模式不合法`, { mode: feed.mode })
  const finishedAt = feed.finishedAt === null || feed.finishedAt === undefined ? null : nonNegativeNumber(feed.finishedAt, `${context}结束时间`)
  const abortedAt = feed.abortedAt === null || feed.abortedAt === undefined ? null : nonNegativeNumber(feed.abortedAt, `${context}终止时间`)
  if (status === 'finished' && finishedAt === null) throw malformedResponse(`${context}已结束却缺少结束时间`)
  if (status === 'aborted' && abortedAt === null) throw malformedResponse(`${context}已终止却缺少终止时间`)
  if (status === 'running' && (finishedAt !== null || abortedAt !== null)) throw malformedResponse(`${context}进行中却包含结束时间`)
  if (status === 'finished' && abortedAt !== null) throw malformedResponse(`${context}正常结束却包含终止时间`)
  if (status === 'aborted' && finishedAt !== null) throw malformedResponse(`${context}终止牌桌却包含正常结算时间`)
  return {
    matchId: requireNonEmptyString(feed.matchId, `${context}比赛 ID`),
    tableLabel: requireNonEmptyString(feed.tableLabel, `${context}牌桌名称`),
    mode: mode as SpectatorMatchSummary['mode'],
    status: status as SpectatorMatchSummary['status'],
    startedAt: nonNegativeNumber(feed.startedAt, `${context}开始时间`),
    finishedAt,
    abortedAt,
    abortReason: feed.abortReason === null || feed.abortReason === undefined ? null : String(feed.abortReason),
    delaySeconds: nonNegativeNumber(feed.delaySeconds, `${context}延迟`),
    availableEventCount: nonNegativeNumber(feed.availableEventCount, `${context}可见事件数`),
    totalEventCount: nonNegativeNumber(feed.totalEventCount, `${context}总事件数`),
    timelineComplete: Boolean(feed.timelineComplete),
  }
}

class HttpSpectatorGateway implements SpectatorGateway {
  public constructor (private readonly client: PlatformApiClient) {}
  public async list (delaySeconds = 30): Promise<SpectatorMatchSummary[]> {
    const payload = requireRecord(await this.client.request<unknown>(`/api/v1/spectate?delaySeconds=${encodeURIComponent(String(delaySeconds))}`), '观战列表响应')
    return requireArray(payload.feeds, '观战列表').map((item, index) => normalizeSpectatorSummary(item, `第 ${index + 1} 张观战牌桌`))
  }
  public async getFeed (matchId: string, delaySeconds = 30): Promise<SpectatorFeed> {
    const payload = requireRecord(await this.client.request<unknown>(`/api/v1/spectate/${encodeURIComponent(matchId)}?delaySeconds=${encodeURIComponent(String(delaySeconds))}`), '观战响应')
    const feed = requireRecord(payload.feed, '观战数据')
    return {
      ...normalizeSpectatorSummary(feed, '观战数据'),
      availableThrough: nonNegativeNumber(feed.availableThrough, '观战可见截止时间'),
      events: requireArray(feed.events, '观战事件').map((item, index) => normalizeReplayEvent(item, `第 ${index + 1} 个观战事件`)),
    }
  }
}

const merchantStatuses: MerchantStatus[] = ['pending', 'active', 'suspended', 'rejected']
const merchantRoles: MerchantRole[] = ['owner', 'manager', 'cashier']
const merchantStoreStatuses: MerchantStoreStatus[] = ['active', 'inactive']
const merchantEmployeeStatuses: MerchantEmployeeStatus[] = ['active', 'inactive']
const merchantGrantStatuses: MerchantGrantStatus[] = ['posted', 'reversed']

const requireMerchantStatus = (value: unknown, context: string): MerchantStatus => {
  if (!merchantStatuses.includes(value as MerchantStatus)) throw malformedResponse(`${context}不合法`, { value })
  return value as MerchantStatus
}

const requireMerchantRole = (value: unknown, context: string): MerchantRole => {
  if (!merchantRoles.includes(value as MerchantRole)) throw malformedResponse(`${context}不合法`, { value })
  return value as MerchantRole
}

const normalizeMerchantProfile = (value: unknown, context: string): MerchantProfile => {
  const merchant = requireRecord(value, context)
  return {
    id: requireNonEmptyString(merchant.id, `${context} ID`),
    ownerUserId: requireNonEmptyString(merchant.ownerUserId, `${context}负责人 ID`),
    name: requireNonEmptyString(merchant.name, `${context}名称`),
    contactName: requireNonEmptyString(merchant.contactName, `${context}联系人`),
    status: requireMerchantStatus(merchant.status, `${context}状态`),
    dailyPointLimit: nonNegativeInteger(merchant.dailyPointLimit, `${context}日发放限额`),
    createdAt: nonNegativeInteger(merchant.createdAt, `${context}创建时间`),
  }
}

const normalizeMerchantStore = (value: unknown, context: string): MerchantStore => {
  const store = requireRecord(value, context)
  if (!merchantStoreStatuses.includes(store.status as MerchantStoreStatus)) throw malformedResponse(`${context}状态不合法`, { value: store.status })
  return {
    id: requireNonEmptyString(store.id, `${context} ID`),
    merchantId: requireNonEmptyString(store.merchantId, `${context}商户 ID`),
    name: requireNonEmptyString(store.name, `${context}名称`),
    address: typeof store.address === 'string' ? store.address : (() => { throw malformedResponse(`${context}地址格式不正确`) })(),
    status: store.status as MerchantStoreStatus,
    createdAt: nonNegativeInteger(store.createdAt, `${context}创建时间`),
  }
}

const normalizeMerchantEmployee = (value: unknown, context: string): MerchantEmployee => {
  const employee = requireRecord(value, context)
  if (!['manager', 'cashier'].includes(String(employee.role))) throw malformedResponse(`${context}角色不合法`, { value: employee.role })
  if (!merchantEmployeeStatuses.includes(employee.status as MerchantEmployeeStatus)) throw malformedResponse(`${context}状态不合法`, { value: employee.status })
  return {
    id: requireNonEmptyString(employee.id, `${context} ID`),
    merchantId: requireNonEmptyString(employee.merchantId, `${context}商户 ID`),
    userId: requireNonEmptyString(employee.userId, `${context}用户 ID`),
    role: employee.role as MerchantEmployee['role'],
    status: employee.status as MerchantEmployeeStatus,
    updatedAt: nonNegativeInteger(employee.updatedAt, `${context}更新时间`),
  }
}

const normalizeMerchantPointGrant = (value: unknown, context: string): MerchantPointGrant => {
  const grant = requireRecord(value, context)
  if (!merchantGrantStatuses.includes(grant.status as MerchantGrantStatus)) throw malformedResponse(`${context}状态不合法`, { value: grant.status })
  if (grant.duplicate !== undefined && typeof grant.duplicate !== 'boolean') throw malformedResponse(`${context}重复标记不合法`, { value: grant.duplicate })
  const amount = positiveInteger(grant.amount, `${context}积分数量`)
  if (amount > 1000) throw malformedResponse(`${context}积分数量超过单次上限`, { value: grant.amount })
  return {
    id: requireNonEmptyString(grant.id, `${context} ID`),
    merchantId: requireNonEmptyString(grant.merchantId, `${context}商户 ID`),
    storeId: requireNonEmptyString(grant.storeId, `${context}门店 ID`),
    operatorUserId: requireNonEmptyString(grant.operatorUserId, `${context}操作员 ID`),
    recipientUserId: requireNonEmptyString(grant.recipientUserId, `${context}接收用户 ID`),
    amount,
    note: typeof grant.note === 'string' ? grant.note : (() => { throw malformedResponse(`${context}备注格式不正确`) })(),
    status: grant.status as MerchantGrantStatus,
    createdAt: nonNegativeInteger(grant.createdAt, `${context}创建时间`),
    ...(typeof grant.duplicate === 'boolean' ? { duplicate: grant.duplicate } : {}),
  }
}

const normalizeMerchantConsole = (value: unknown): MerchantConsole => {
  const payload = requireRecord(value, '商户后台响应')
  const merchant = normalizeMerchantProfile(payload.merchant, '商户资料')
  const role = requireMerchantRole(payload.role, '商户角色')
  const stores = requireArray(payload.stores, '商户门店列表').map((item, index) => normalizeMerchantStore(item, `第 ${index + 1} 个商户门店`))
  const employees = requireArray(payload.employees, '商户员工列表').map((item, index) => normalizeMerchantEmployee(item, `第 ${index + 1} 个商户员工`))
  const grants = requireArray(payload.grants, '商户积分发放列表').map((item, index) => normalizeMerchantPointGrant(item, `第 ${index + 1} 条积分发放`))
  const foreignRecord = [...stores, ...employees, ...grants].find(item => item.merchantId !== merchant.id)
  if (foreignRecord) throw malformedResponse('商户后台响应包含其他商户的数据', { recordId: foreignRecord.id })
  return { merchant, role, stores, employees, grants, grantedPoints: nonNegativeInteger(payload.grantedPoints, '商户累计发放积分') }
}

const invalidMerchantInput = (message: string): PlatformApiError => new PlatformApiError(message, {
  code: 'INVALID_MERCHANT_INPUT',
  retryable: false,
})

class HttpMerchantGateway implements MerchantGateway {
  private readonly uncertainMutationKeys = new Map<string, string>()

  public constructor (private readonly client: PlatformApiClient) {}

  public async getConsole (): Promise<MerchantConsole> {
    return normalizeMerchantConsole(await this.client.request<unknown>('/api/v1/merchants/me'))
  }

  public async apply (application: MerchantApplication): Promise<MerchantProfile> {
    const name = application.name.trim()
    const contactName = application.contactName?.trim() ?? ''
    if (!name || name.length > 60) throw invalidMerchantInput('商户名称必须为 1 到 60 个字符')
    if (contactName.length > 40) throw invalidMerchantInput('联系人姓名不能超过 40 个字符')
    return this.mutate(`apply\u0000${name}\u0000${contactName}`, 'merchant-apply', async key => {
      const payload = requireRecord(await this.client.request<unknown>('/api/v1/merchants/apply', 'POST', {
        name,
        ...(contactName ? { contactName } : {}),
      }, { 'Idempotency-Key': key }), '商户申请响应')
      return normalizeMerchantProfile(payload.merchant, '商户申请')
    })
  }

  public async createStore (draft: MerchantStoreDraft): Promise<MerchantStore> {
    const name = draft.name.trim()
    const address = draft.address?.trim() ?? ''
    if (!name || name.length > 60) throw invalidMerchantInput('门店名称必须为 1 到 60 个字符')
    if (address.length > 120) throw invalidMerchantInput('门店地址不能超过 120 个字符')
    return this.mutate(`store\u0000${name}\u0000${address}`, 'merchant-store', async key => {
      const payload = requireRecord(await this.client.request<unknown>('/api/v1/merchants/stores', 'POST', {
        name,
        ...(address ? { address } : {}),
      }, { 'Idempotency-Key': key }), '创建门店响应')
      return normalizeMerchantStore(payload.store, '创建的门店')
    })
  }

  public async addEmployee (draft: MerchantEmployeeDraft): Promise<MerchantEmployee> {
    const employeeUserId = draft.employeeUserId.trim()
    if (!employeeUserId || employeeUserId.length > 100) throw invalidMerchantInput('员工用户 ID 必须为 1 到 100 个字符')
    if (!['manager', 'cashier'].includes(draft.role)) throw invalidMerchantInput('员工角色只能是管理员或收银员')
    return this.mutate(`employee\u0000${employeeUserId}\u0000${draft.role}`, 'merchant-employee', async key => {
      const payload = requireRecord(await this.client.request<unknown>('/api/v1/merchants/employees', 'POST', {
        employeeUserId,
        role: draft.role,
      }, { 'Idempotency-Key': key }), '添加员工响应')
      return normalizeMerchantEmployee(payload.employee, '添加的员工')
    })
  }

  public async grantPoints (draft: MerchantPointGrantDraft): Promise<MerchantPointGrant> {
    const storeId = draft.storeId.trim()
    const recipientUserId = draft.recipientUserId.trim()
    const note = draft.note?.trim() ?? ''
    if (!storeId) throw invalidMerchantInput('请选择有效门店')
    if (!recipientUserId || recipientUserId.length > 100) throw invalidMerchantInput('积分接收用户 ID 必须为 1 到 100 个字符')
    if (!Number.isSafeInteger(draft.amount) || draft.amount < 1 || draft.amount > 1000) throw invalidMerchantInput('单次积分必须是 1 到 1000 的整数')
    if (note.length > 80) throw invalidMerchantInput('积分发放备注不能超过 80 个字符')
    return this.mutate(`grant\u0000${storeId}\u0000${recipientUserId}\u0000${draft.amount}\u0000${note}`, 'merchant-grant', async key => {
      const payload = requireRecord(await this.client.request<unknown>('/api/v1/merchants/points/grant', 'POST', {
        storeId,
        recipientUserId,
        amount: draft.amount,
        ...(note ? { note } : {}),
      }, { 'Idempotency-Key': key }), '积分发放响应')
      return normalizeMerchantPointGrant(payload.grant, '积分发放记录')
    })
  }

  private async mutate<T> (operation: string, prefix: string, request: (key: string) => Promise<T>): Promise<T> {
    const key = this.uncertainMutationKeys.get(operation) ?? idempotencyKey(prefix)
    this.uncertainMutationKeys.set(operation, key)
    try {
      const result = await request(key)
      if (this.uncertainMutationKeys.get(operation) === key) this.uncertainMutationKeys.delete(operation)
      return result
    } catch (error) {
      if (error instanceof PlatformApiError && error.status >= 400 && error.status < 500 && this.uncertainMutationKeys.get(operation) === key) {
        this.uncertainMutationKeys.delete(operation)
      }
      throw error
    }
  }
}

const normalizeProduct = (product: RawProduct): ShopProduct => {
  const stock = nonNegativeNumber(product.stock ?? product.availableStock, '商品库存')
  if (!Number.isInteger(stock)) throw malformedResponse('商品库存必须是整数', { stock })
  return {
    id: String(product.id ?? ''),
    name: String(product.name ?? '未命名商品'),
    description: String(product.description ?? ''),
    category: String(product.category ?? product.tag ?? '生活'),
    pointsPrice: nonNegativeNumber(product.pointsPrice ?? product.points ?? product.price, '商品积分价格'),
    stock,
    imageUrl: product.imageUrl,
  }
}

const matchStatuses: MatchTicket['status'][] = ['matching', 'matched', 'cancelled']
const matchSeats: NonNullable<MatchTicket['seat']>[] = ['p1', 'p2', 'p3', 'p4']

const isLocalHostname = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return normalized === 'localhost' || normalized === '::1' || /^127(?:\.\d{1,3}){3}$/.test(normalized)
}

const normalizeGameEndpoint = (value: unknown, policy: GameEndpointPolicy): string => {
  const endpoint = requireNonEmptyString(value, '匹配服务地址')
  let parsed: URL
  try { parsed = new URL(endpoint) } catch { throw malformedResponse('匹配服务地址不是有效 URL', { endpoint }) }
  if (!['ws:', 'wss:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
    throw malformedResponse('匹配服务地址必须是不含凭证的 WebSocket URL', { endpoint })
  }
  const insecure = parsed.protocol === 'ws:'
  if (insecure && policy === 'secure-only') throw malformedResponse('生产环境匹配服务地址必须使用 HTTPS/WSS', { endpoint })
  if (insecure && policy === 'allow-localhost-insecure' && !isLocalHostname(parsed.hostname)) {
    throw malformedResponse('非本机匹配服务地址必须使用 HTTPS/WSS', { endpoint })
  }
  return endpoint
}

const normalizeTicket = (rawTicket: unknown, endpointPolicy: GameEndpointPolicy): MatchTicket => {
  const record = requireRecord(rawTicket, '匹配票据')
  const ticket = record as RawMatchTicket
  const ticketId = requireNonEmptyString(ticket.ticketId ?? ticket.matchId ?? ticket.id, '匹配票据 ID')
  const rawQueueId = ticket.queueId ?? ticket.mode
  if (!MATCH_QUEUE_IDS.includes(rawQueueId as MatchQueueId)) throw malformedResponse('匹配队列类型不合法', { queueId: rawQueueId })
  if (!matchStatuses.includes(ticket.status as MatchTicket['status'])) throw malformedResponse('匹配状态不合法', { status: ticket.status })

  const result: MatchTicket = {
    ticketId,
    queueId: rawQueueId as MatchQueueId,
    status: ticket.status as MatchTicket['status'],
  }
  const rawSeat = ticket.seat ?? ticket.playerId
  if (rawSeat !== undefined) {
    if (!matchSeats.includes(rawSeat as NonNullable<MatchTicket['seat']>)) throw malformedResponse('匹配座位不合法', { seat: rawSeat })
    result.seat = rawSeat as NonNullable<MatchTicket['seat']>
  }
  if (ticket.roomId !== undefined) {
    const roomId = requireNonEmptyString(ticket.roomId, '匹配房间 ID')
    if (!/^\d{6}$/.test(roomId)) throw malformedResponse('匹配房间 ID 必须是六位数字', { roomId })
    result.roomId = roomId
  }
  const rawJoinToken = ticket.joinToken ?? ticket.gameTicket ?? ticket.token
  if (rawJoinToken !== undefined) result.joinToken = requireNonEmptyString(rawJoinToken, '入桌凭证')
  const rawEndpoint = ticket.gameEndpoint ?? ticket.endpoint
  if (rawEndpoint !== undefined) result.gameEndpoint = normalizeGameEndpoint(rawEndpoint, endpointPolicy)
  if (ticket.expiresAt !== undefined) {
    if (typeof ticket.expiresAt !== 'number' || !Number.isFinite(ticket.expiresAt) || ticket.expiresAt <= Date.now()) {
      throw malformedResponse('匹配票据过期时间不合法', { expiresAt: ticket.expiresAt })
    }
    result.expiresAt = ticket.expiresAt
  }
  if (result.status === 'matched' && (!result.roomId || !result.gameEndpoint || !result.joinToken || !result.seat || !result.expiresAt)) {
    throw malformedResponse('已匹配票据缺少入桌所需字段')
  }
  return result
}

const normalizeTournament = (tournament: RawTournament): TournamentSummary => {
  if (!['open', 'scheduled', 'running', 'finished'].includes(String(tournament.status))) {
    throw malformedResponse('赛事状态不合法', { status: tournament.status })
  }
  if (!MATCH_QUEUE_IDS.includes(tournament.queueId as MatchQueueId)) {
    throw malformedResponse('赛事队列类型不合法', { queueId: tournament.queueId })
  }
  let startsAt: number | undefined
  if (tournament.startsAt !== undefined) {
    startsAt = new Date(tournament.startsAt).getTime()
    if (!Number.isFinite(startsAt)) throw malformedResponse('赛事开始时间不合法', { startsAt: tournament.startsAt })
  }
  const result: TournamentSummary = {
    id: String(tournament.id ?? ''),
    name: String(tournament.name ?? tournament.title ?? '未命名赛事'),
    description: String(tournament.description ?? tournament.summary ?? ''),
    status: tournament.status as TournamentSummary['status'],
    startsAt,
    entryPoints: nonNegativeNumber(tournament.entryPoints ?? tournament.entryFee, '赛事报名积分'),
    queueId: tournament.queueId as MatchQueueId,
    enrolled: Boolean(tournament.enrolled),
  }
  if (tournament.format !== undefined) {
    if (tournament.format !== 'fixed16-latin-3') throw malformedResponse('赛事赛制不合法', { format: tournament.format })
    result.format = tournament.format
  }
  if (tournament.capacity !== undefined) result.capacity = positiveInteger(tournament.capacity, '赛事容量')
  if (tournament.checkedInCount !== undefined) result.checkedInCount = nonNegativeInteger(tournament.checkedInCount, '赛事已检录人数')
  if (result.capacity !== undefined && result.checkedInCount !== undefined && result.checkedInCount > result.capacity) {
    throw malformedResponse('赛事已检录人数不能超过容量', { capacity: result.capacity, checkedInCount: result.checkedInCount })
  }
  const roundsTotal = Number(tournament.roundsTotal)
  const currentRound = Number(tournament.currentRound)
  const advanceCount = Number(tournament.advanceCount)
  if (Number.isSafeInteger(roundsTotal) && roundsTotal > 0) result.roundsTotal = roundsTotal
  if (Number.isSafeInteger(currentRound) && currentRound > 0) result.currentRound = currentRound
  if (Number.isSafeInteger(advanceCount) && advanceCount >= 0) result.advanceCount = advanceCount
  if (isRecord(tournament.myStanding)) {
    result.myStanding = {
      played: nonNegativeNumber(tournament.myStanding.played, '我的赛事场数'),
      points: nonNegativeNumber(tournament.myStanding.points, '我的赛事积分'),
      rank: nonNegativeNumber(tournament.myStanding.rank, '我的赛事排名'),
      advanced: Boolean(tournament.myStanding.advanced),
    }
  }
  return result
}

const tournamentQualificationStatuses: TournamentStanding['qualificationStatus'][] = ['pending', 'qualified', 'eliminated']

const normalizeTournamentStanding = (value: unknown, context: string): TournamentStanding => {
  const standing = requireRecord(value, context)
  const qualificationStatus = standing.qualificationStatus
  if (!tournamentQualificationStatuses.includes(qualificationStatus as TournamentStanding['qualificationStatus'])) {
    throw malformedResponse(`${context}晋级状态不合法`, { qualificationStatus })
  }
  return {
    userId: requireNonEmptyString(standing.userId, `${context}用户 ID`),
    displayName: requireNonEmptyString(standing.displayName, `${context}用户昵称`),
    played: nonNegativeInteger(standing.played, `${context}场数`),
    wins: nonNegativeInteger(standing.wins, `${context}胜场`),
    firstPlaces: nonNegativeInteger(standing.firstPlaces, `${context}头游次数`),
    points: nonNegativeInteger(standing.points, `${context}积分`),
    opponentPoints: nonNegativeInteger(standing.opponentPoints, `${context}对手分`),
    rank: positiveInteger(standing.rank, `${context}排名`),
    advanced: requireBoolean(standing.advanced, `${context}晋级标记`),
    qualificationStatus: qualificationStatus as TournamentStanding['qualificationStatus'],
  }
}

const tournamentAssignmentStatuses: TournamentAssignment['status'][] = ['pending', 'matching', 'matched', 'completed', 'blocked']

const normalizeTournamentAssignment = (value: unknown): TournamentAssignment => {
  const assignment = requireRecord(value, '赛事桌次分配')
  if (!tournamentAssignmentStatuses.includes(assignment.status as TournamentAssignment['status'])) {
    throw malformedResponse('赛事桌次分配状态不合法', { status: assignment.status })
  }
  const result: TournamentAssignment = {
    assignmentId: requireNonEmptyString(assignment.assignmentId, '赛事桌次分配 ID'),
    roundNumber: positiveInteger(assignment.roundNumber ?? assignment.round, '赛事桌次轮数'),
    tableNumber: positiveInteger(assignment.tableNumber ?? assignment.table, '赛事桌号'),
    status: assignment.status as TournamentAssignment['status'],
  }
  if (assignment.matchId !== undefined && assignment.matchId !== null) result.matchId = requireNonEmptyString(assignment.matchId, '赛事匹配 ID')
  return result
}

const tournamentPhases: TournamentState['phase'][] = ['check-in', 'round-active', 'blocked', 'finished']

const normalizeTournamentState = (value: unknown): TournamentState => {
  const state = requireRecord(value, '赛事状态响应')
  if (!tournamentPhases.includes(state.phase as TournamentState['phase'])) throw malformedResponse('赛事阶段不合法', { phase: state.phase })
  const tournament = normalizeTournament(requireRecord(state.tournament, '赛事状态中的赛事') as RawTournament)
  if (!tournament.id) throw malformedResponse('赛事状态缺少赛事 ID')
  const capacity = positiveInteger(state.capacity, '赛事状态容量')
  const checkedInCount = nonNegativeInteger(state.checkedInCount, '赛事状态已检录人数')
  const roundNumber = nonNegativeInteger(state.roundNumber, '赛事状态当前轮数')
  const roundsTotal = positiveInteger(state.roundsTotal, '赛事状态总轮数')
  const tablesTotal = nonNegativeInteger(state.tablesTotal, '赛事状态总桌数')
  const tablesSettled = nonNegativeInteger(state.tablesSettled, '赛事状态已结算桌数')
  const cutoffRank = nonNegativeInteger(state.cutoffRank, '赛事状态晋级线')
  if (checkedInCount > capacity) throw malformedResponse('赛事状态已检录人数不能超过容量', { capacity, checkedInCount })
  if (roundNumber > roundsTotal) throw malformedResponse('赛事状态当前轮数不能超过总轮数', { roundNumber, roundsTotal })
  if (tablesSettled > tablesTotal) throw malformedResponse('赛事状态已结算桌数不能超过总桌数', { tablesTotal, tablesSettled })
  if (cutoffRank > capacity) throw malformedResponse('赛事状态晋级线不能超过容量', { capacity, cutoffRank })
  if (tournament.capacity !== undefined && tournament.capacity !== capacity) throw malformedResponse('赛事状态容量与赛事信息不一致')
  if (tournament.checkedInCount !== undefined && tournament.checkedInCount !== checkedInCount) throw malformedResponse('赛事状态检录人数与赛事信息不一致')
  if (tournament.roundsTotal !== undefined && tournament.roundsTotal !== roundsTotal) throw malformedResponse('赛事状态总轮数与赛事信息不一致')

  const viewerEntry = requireRecord(state.viewerEntry, '赛事用户入口状态')
  let assignment: TournamentAssignment | null
  if (state.assignment === null) assignment = null
  else assignment = normalizeTournamentAssignment(state.assignment)
  if (assignment && assignment.roundNumber !== roundNumber) throw malformedResponse('赛事桌次轮数与当前轮数不一致')
  if (assignment && assignment.tableNumber > tablesTotal) throw malformedResponse('赛事桌号超过当前总桌数')

  const result: TournamentState = {
    phase: state.phase as TournamentState['phase'],
    tournament,
    capacity,
    checkedInCount,
    roundNumber,
    roundsTotal,
    tablesTotal,
    tablesSettled,
    cutoffRank,
    viewerEntry: {
      enrolled: requireBoolean(viewerEntry.enrolled, '赛事报名状态'),
      checkedIn: requireBoolean(viewerEntry.checkedIn, '赛事检录状态'),
      rosterLocked: requireBoolean(viewerEntry.rosterLocked, '赛事名单锁定状态'),
    },
    assignment,
  }
  if (state.viewerStanding !== undefined && state.viewerStanding !== null) {
    result.viewerStanding = normalizeTournamentStanding(state.viewerStanding, '我的赛事排名')
  }
  return result
}

class HttpShopGateway implements ShopGateway {
  private readonly uncertainOrderKeys = new Map<string, string>()

  public constructor (private readonly client: PlatformApiClient) {}

  public async listProducts (): Promise<ShopProduct[]> {
    const payload = requireRecord(await this.client.request<unknown>('/api/v1/products'), '商品列表响应')
    return requireArray(payload.products, '商品列表').map((item, index) => {
      const product = normalizeProduct(requireRecord(item, `第 ${index + 1} 个商品`) as RawProduct)
      if (!product.id) throw malformedResponse(`第 ${index + 1} 个商品缺少 ID`)
      return product
    })
  }

  public async createOrder (productId: string, quantity: number, expectedPointsPrice?: number): Promise<ShopOrder> {
    const safeProductId = productId.trim()
    if (!safeProductId) throw new PlatformApiError('商品 ID 不能为空', { code: 'INVALID_ORDER', retryable: false })
    if (!Number.isInteger(quantity) || quantity <= 0) throw new PlatformApiError('商品数量必须是正整数', { code: 'INVALID_ORDER', retryable: false })
    if (expectedPointsPrice !== undefined && (!Number.isFinite(expectedPointsPrice) || expectedPointsPrice < 0)) {
      throw new PlatformApiError('预期商品积分价格不合法', { code: 'INVALID_ORDER', retryable: false })
    }
    const operation = `${safeProductId}\u0000${quantity}`
    const key = this.uncertainOrderKeys.get(operation) ?? idempotencyKey('shop')
    this.uncertainOrderKeys.set(operation, key)
    try {
      const payload = requireRecord(await this.client.request<unknown>('/api/v1/orders/redeem', 'POST', {
        productId: safeProductId,
        quantity,
        ...(expectedPointsPrice === undefined ? {} : { expectedPointsPrice }),
      }, { 'Idempotency-Key': key }), '订单响应')
      const order = requireRecord(payload.order, '订单')
      const status = order.status
      if (!['created', 'paid', 'cancelled', 'fulfilled'].includes(String(status))) throw malformedResponse('订单状态不合法', { status })
      const responseQuantity = nonNegativeNumber(order.quantity, '订单商品数量')
      if (!Number.isInteger(responseQuantity) || responseQuantity <= 0) throw malformedResponse('订单商品数量必须是正整数', { quantity: order.quantity })
      const result: ShopOrder = {
        orderId: requireNonEmptyString(order.orderId, '订单 ID'),
        productId: requireNonEmptyString(order.productId, '订单商品 ID'),
        quantity: responseQuantity,
        totalPoints: nonNegativeNumber(order.totalPoints, '订单总积分'),
        status: status as ShopOrder['status'],
      }
      if (this.uncertainOrderKeys.get(operation) === key) this.uncertainOrderKeys.delete(operation)
      return result
    } catch (error) {
      if (error instanceof PlatformApiError && error.status >= 400 && error.status < 500 && this.uncertainOrderKeys.get(operation) === key) {
        this.uncertainOrderKeys.delete(operation)
      }
      throw error
    }
  }
}

class HttpWalletGateway implements WalletGateway {
  public constructor (private readonly client: PlatformApiClient) {}

  public async getWallet (): Promise<WalletSnapshot> {
    const payload = requireRecord(await this.client.request<unknown>('/api/v1/wallet'), '钱包响应')
    const wallet = requireRecord(payload.wallet, '钱包') as { balance?: number, points?: number, diamonds?: number }
    return {
      points: nonNegativeNumber(wallet.points ?? wallet.balance, '钱包积分余额'),
      diamonds: wallet.diamonds === undefined ? 0 : nonNegativeNumber(wallet.diamonds, '钱包钻石余额'),
    }
  }
}

class HttpTournamentGateway implements TournamentGateway {
  public constructor (private readonly client: PlatformApiClient) {}

  public async listTournaments (): Promise<TournamentSummary[]> {
    const payload = requireRecord(await this.client.request<unknown>('/api/v1/tournaments'), '赛事列表响应')
    return requireArray(payload.tournaments, '赛事列表').map((item, index) => {
      const tournament = normalizeTournament(requireRecord(item, `第 ${index + 1} 个赛事`) as RawTournament)
      if (!tournament.id) throw malformedResponse(`第 ${index + 1} 个赛事缺少 ID`)
      return tournament
    })
  }

  public async enroll (tournamentId: string, expectedEntryPoints?: number): Promise<TournamentSummary> {
    if (expectedEntryPoints !== undefined && (!Number.isFinite(expectedEntryPoints) || expectedEntryPoints < 0)) {
      throw new PlatformApiError('预期赛事报名费不合法', { code: 'INVALID_ENROLLMENT', retryable: false })
    }
    await this.client.request<unknown>(`/api/v1/tournaments/${encodeURIComponent(tournamentId)}/enroll`, 'POST', {
      ...(expectedEntryPoints === undefined ? {} : { expectedEntryPoints }),
    }, {
      'Idempotency-Key': idempotencyKey('enroll'),
    })
    const tournaments = await this.listTournaments()
    const enrolled = tournaments.find(tournament => tournament.id === tournamentId)
    if (!enrolled) throw new PlatformApiError('赛事报名成功，但未能刷新赛事信息', {
      status: 200,
      code: 'ENROLLMENT_REFRESH_FAILED',
      retryable: true,
    })
    return enrolled
  }

  public async checkIn (tournamentId: string): Promise<TournamentState> {
    const safeTournamentId = this.safeTournamentId(tournamentId)
    const payload = await this.client.request<unknown>(`/api/v1/tournaments/${encodeURIComponent(safeTournamentId)}/check-in`, 'POST')
    return this.normalizedStateFor(payload, safeTournamentId)
  }

  public async getState (tournamentId: string): Promise<TournamentState> {
    const safeTournamentId = this.safeTournamentId(tournamentId)
    const payload = await this.client.request<unknown>(`/api/v1/tournaments/${encodeURIComponent(safeTournamentId)}/state`)
    return this.normalizedStateFor(payload, safeTournamentId)
  }

  public async getStandings (tournamentId: string): Promise<TournamentStandings> {
    const safeTournamentId = this.safeTournamentId(tournamentId)
    const payload = requireRecord(await this.client.request<unknown>(`/api/v1/tournaments/${encodeURIComponent(safeTournamentId)}/standings`), '赛事排名响应')
    const tournament = normalizeTournament(requireRecord(payload.tournament, '赛事信息') as RawTournament)
    if (!tournament.id) throw malformedResponse('赛事排名缺少赛事 ID')
    if (tournament.id !== safeTournamentId) throw malformedResponse('赛事排名中的赛事 ID 与请求不一致')
    const standings = requireArray(payload.standings, '赛事排名列表').map((item, index) => normalizeTournamentStanding(item, `第 ${index + 1} 条赛事排名`))
    const provisional = requireBoolean(payload.provisional, '赛事排名暂定状态')
    const cutoffRank = nonNegativeInteger(payload.cutoffRank, '赛事排名晋级线')
    if (!Object.prototype.hasOwnProperty.call(payload, 'viewerStanding')) throw malformedResponse('赛事排名缺少当前用户排名')
    const viewerStanding = payload.viewerStanding === null
      ? null
      : normalizeTournamentStanding(payload.viewerStanding, '当前用户赛事排名')
    return { tournament, standings, provisional, cutoffRank, viewerStanding }
  }

  private safeTournamentId (tournamentId: string): string {
    const safeTournamentId = tournamentId.trim()
    if (!safeTournamentId) throw new PlatformApiError('赛事 ID 不能为空', { code: 'INVALID_TOURNAMENT', retryable: false })
    return safeTournamentId
  }

  private normalizedStateFor (payload: unknown, tournamentId: string): TournamentState {
    const state = normalizeTournamentState(payload)
    if (state.tournament.id !== tournamentId) throw malformedResponse('赛事状态中的赛事 ID 与请求不一致')
    return state
  }
}

class HttpMatchmakingGateway {
  public constructor (private readonly client: PlatformApiClient, private readonly endpointPolicy: GameEndpointPolicy) {}

  public async joinQueue (queueId: MatchQueueId, assignment?: { tournamentId: string, assignmentId: string }): Promise<MatchTicket> {
    let assignmentBody: { tournamentId: string, assignmentId: string } | undefined
    if (assignment) {
      const tournamentId = assignment.tournamentId.trim()
      const assignmentId = assignment.assignmentId.trim()
      if (!tournamentId || !assignmentId) throw new PlatformApiError('赛事匹配分配信息不完整', { code: 'INVALID_TOURNAMENT_ASSIGNMENT', retryable: false })
      assignmentBody = { tournamentId, assignmentId }
    }
    const payload = requireRecord(await this.client.request<unknown>('/api/v1/match/join', 'POST', { mode: queueId, ...assignmentBody }, {
      'Idempotency-Key': idempotencyKey('match'),
    }), '匹配响应')
    return normalizeTicket(payload.match, this.endpointPolicy)
  }

  public async getStatus (ticketId: string): Promise<MatchTicket> {
    const payload = requireRecord(await this.client.request<unknown>(`/api/v1/match/status?matchId=${encodeURIComponent(ticketId)}`), '匹配状态响应')
    return normalizeTicket(payload.match, this.endpointPolicy)
  }

  public async cancel (ticketId: string): Promise<void> {
    await this.client.request<unknown>('/api/v1/match/cancel', 'POST', { matchId: ticketId })
  }
}

export const createHttpGateways = (config: PlatformApiConfig, transport: HttpTransport = new XhrTransport()): FrontPageGateways => {
  const client = new PlatformApiClient(transport, config)
  return {
    configured: true,
    auth: new HttpAuthGateway(client),
    matchmaking: new HttpMatchmakingGateway(client, config.gameEndpointPolicy ?? 'allow-localhost-insecure'),
    shop: new HttpShopGateway(client),
    wallet: new HttpWalletGateway(client),
    tournaments: new HttpTournamentGateway(client),
    playerCenter: new HttpPlayerCenterGateway(client),
    seasons: new HttpSeasonGateway(client),
    replays: new HttpReplayGateway(client),
    spectator: new HttpSpectatorGateway(client),
    merchant: new HttpMerchantGateway(client),
  }
}
