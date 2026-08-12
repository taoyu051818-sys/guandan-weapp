import { MATCH_QUEUE_IDS } from '../FrontPageGatewayContracts'
import type { MatchQueueId, ReplayDetail, ReplayEvent, ReplayGateway, ReplaySummary, SpectatorFeed, SpectatorGateway, SpectatorMatchSummary } from '../FrontPageGatewayContracts'
import { PlatformApiClient } from './client'
import { malformedResponse, nonNegativeNumber, positiveInteger, requireArray, requireNonEmptyString, requireRecord } from './validation'

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

const normalizeSpectatorSummary = (value: unknown, context: string): SpectatorMatchSummary => {
  const feed = requireRecord(value, context)
  const status = String(feed.status)
  if (!['playing', 'completed', 'aborted', 'running', 'finished'].includes(status)) throw malformedResponse(`${context}状态不合法`, { status: feed.status })
  const mode = String(feed.mode)
  if (!MATCH_QUEUE_IDS.includes(mode as MatchQueueId)) throw malformedResponse(`${context}模式不合法`, { mode: feed.mode })
  const finishedAt = feed.finishedAt === null || feed.finishedAt === undefined ? null : nonNegativeNumber(feed.finishedAt, `${context}结束时间`)
  const abortedAt = feed.abortedAt === null || feed.abortedAt === undefined ? null : nonNegativeNumber(feed.abortedAt, `${context}终止时间`)
  if ((status === 'completed' || status === 'finished') && finishedAt === null) throw malformedResponse(`${context}已结束却缺少结束时间`)
  if (status === 'aborted' && abortedAt === null) throw malformedResponse(`${context}已终止却缺少终止时间`)
  if ((status === 'playing' || status === 'running') && (finishedAt !== null || abortedAt !== null)) throw malformedResponse(`${context}进行中却包含结束时间`)
  if ((status === 'completed' || status === 'finished') && abortedAt !== null) throw malformedResponse(`${context}正常结束却包含终止时间`)
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

export class HttpReplayGateway implements ReplayGateway {
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
    const viewerSeat = raw.viewerSeat === null || raw.viewerSeat === undefined ? null : String(raw.viewerSeat)
    if (viewerSeat !== null && !['p1', 'p2', 'p3', 'p4'].includes(viewerSeat)) throw malformedResponse('牌谱观察席位不合法', { viewerSeat })
    return {
      ...summary,
      participants: Object.fromEntries(Object.entries(participantsRaw).map(([seat, name]) => [seat, String(name)])),
      viewerSeat: viewerSeat as ReplayDetail['viewerSeat'],
      events,
    }
  }
}

export class HttpSpectatorGateway implements SpectatorGateway {
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
