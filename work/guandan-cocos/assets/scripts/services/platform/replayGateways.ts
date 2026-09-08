import type { ReplayDetail, ReplayEvent, ReplayGateway, ReplaySummary } from '../FrontPageGatewayContracts'
import { PlatformApiClient } from './client'
import { malformedResponse, nonNegativeNumber, positiveInteger, requireArray, requireNonEmptyString, requireRecord } from './validation'

export const normalizeReplayEvent = (value: unknown, context: string): ReplayEvent => {
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
