import { MATCH_QUEUE_IDS } from '../FrontPageGatewayContracts'
import type { MatchQueueId, MatchTicket } from '../FrontPageGatewayContracts'
import type { GameEndpointPolicy } from './contracts'
import { isEntryAttemptId } from '../../network/LobbyEntryAttempt'
import { parseNetworkEndpoint, type NetworkEndpoint } from '../NetworkEndpoint'
import { isLocalHostname, malformedResponse, nonNegativeInteger, requireNonEmptyString, requireRecord } from './validation'

type RawMatchTicket = Partial<MatchTicket> & {
  id?: string
  matchId?: string
  endpoint?: string
  token?: string
  gameTicket?: string
  playerId?: MatchTicket['seat']
  mode?: MatchQueueId
}

const matchStatuses: MatchTicket['status'][] = ['matching', 'matched', 'playing', 'completed', 'aborted', 'cancelled']
const matchSeats: NonNullable<MatchTicket['seat']>[] = ['p1', 'p2', 'p3', 'p4']

export const normalizeGameEndpoint = (value: unknown, policy: GameEndpointPolicy): string => {
  const endpoint = requireNonEmptyString(value, '匹配服务地址')
  let parsed: NetworkEndpoint
  try { parsed = parseNetworkEndpoint(endpoint) } catch { throw malformedResponse('匹配服务地址不是有效的无凭证 WebSocket URL', { endpoint }) }
  if (!['ws:', 'wss:'].includes(parsed.protocol)) {
    throw malformedResponse('匹配服务地址必须是不含凭证的 WebSocket URL', { endpoint })
  }
  const insecure = parsed.protocol === 'ws:'
  if (insecure && policy === 'secure-only') throw malformedResponse('生产环境匹配服务地址必须使用 HTTPS/WSS', { endpoint })
  if (insecure && policy === 'allow-localhost-insecure' && !isLocalHostname(parsed.hostname)) {
    throw malformedResponse('非本机匹配服务地址必须使用 HTTPS/WSS', { endpoint })
  }
  return endpoint
}

export const normalizeTicket = (rawTicket: unknown, endpointPolicy: GameEndpointPolicy): MatchTicket => {
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
  if (ticket.entryAttemptId !== undefined) {
    if (!isEntryAttemptId(ticket.entryAttemptId)) throw malformedResponse('匹配入桌幂等 ID 不合法')
    result.entryAttemptId = ticket.entryAttemptId
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
  if (ticket.botFillAt !== undefined) result.botFillAt = nonNegativeInteger(ticket.botFillAt, '机器人补位时间')
  if (ticket.humanPlayerCount !== undefined) {
    result.humanPlayerCount = nonNegativeInteger(ticket.humanPlayerCount, '匹配非机器人玩家数量')
    if (result.humanPlayerCount > 4) throw malformedResponse('匹配非机器人玩家数量不能超过四人')
  }
  if (ticket.botCount !== undefined) {
    result.botCount = nonNegativeInteger(ticket.botCount, '匹配机器人数量')
    if (result.botCount > 3) throw malformedResponse('匹配机器人数量不能超过三人')
  }
  if ((result.humanPlayerCount ?? 0) + (result.botCount ?? 0) > 4) throw malformedResponse('匹配席位数量不能超过四人')
  if (result.status === 'matched' && (!result.entryAttemptId || !result.roomId || !result.gameEndpoint || !result.joinToken || !result.seat || !result.expiresAt)) {
    throw malformedResponse('已匹配票据缺少入桌所需字段')
  }
  return result
}
