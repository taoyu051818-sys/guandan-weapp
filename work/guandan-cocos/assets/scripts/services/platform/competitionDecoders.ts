import { MATCH_QUEUE_IDS } from '../FrontPageGatewayContracts'
import type { MatchQueueId, MatchTicket, TournamentAssignment, TournamentStanding, TournamentState, TournamentSummary } from '../FrontPageGatewayContracts'
import type { GameEndpointPolicy } from './contracts'
import { isEntryAttemptId } from '../../network/LobbyEntryAttempt'
import { isLocalHostname, isRecord, malformedResponse, nonNegativeInteger, nonNegativeNumber, positiveInteger, requireBoolean, requireNonEmptyString, requireRecord } from './validation'

type RawMatchTicket = Partial<MatchTicket> & {
  id?: string
  matchId?: string
  endpoint?: string
  token?: string
  gameTicket?: string
  playerId?: MatchTicket['seat']
  mode?: MatchQueueId
}

export type RawTournament = Partial<TournamentSummary> & {
  title?: string
  summary?: string
  entryFee?: number
  startsAt?: number | string
}

const matchStatuses: MatchTicket['status'][] = ['matching', 'matched', 'playing', 'completed', 'aborted', 'cancelled']
const matchSeats: NonNullable<MatchTicket['seat']>[] = ['p1', 'p2', 'p3', 'p4']

export const normalizeGameEndpoint = (value: unknown, policy: GameEndpointPolicy): string => {
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
  if (result.status === 'matched' && (!result.entryAttemptId || !result.roomId || !result.gameEndpoint || !result.joinToken || !result.seat || !result.expiresAt)) {
    throw malformedResponse('已匹配票据缺少入桌所需字段')
  }
  return result
}

export const normalizeTournament = (tournament: RawTournament): TournamentSummary => {
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

export const normalizeTournamentStanding = (value: unknown, context: string): TournamentStanding => {
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

export const normalizeTournamentState = (value: unknown): TournamentState => {
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
