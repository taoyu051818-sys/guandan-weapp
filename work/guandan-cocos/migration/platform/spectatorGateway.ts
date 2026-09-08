import { MATCH_QUEUE_IDS } from '../../assets/scripts/services/FrontPageGatewayContracts'
import type { MatchQueueId, SpectatorFeed, SpectatorGateway, SpectatorMatchSummary } from '../../assets/scripts/services/FrontPageGatewayContracts'
import { PlatformApiClient } from '../../assets/scripts/services/platform/client'
import { malformedResponse, nonNegativeNumber, requireArray, requireNonEmptyString, requireRecord } from '../../assets/scripts/services/platform/validation'
import { normalizeReplayEvent } from '../../assets/scripts/services/platform/replayGateways'

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
