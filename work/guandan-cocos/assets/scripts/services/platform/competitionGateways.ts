import type { MatchQueueId, MatchTicket } from '../FrontPageGatewayContracts'
import { PlatformApiClient } from './client'
import { normalizeTicket } from './competitionDecoders'
import type { GameEndpointPolicy } from './contracts'
import { PlatformApiError } from './contracts'
import { idempotencyKey, requireRecord } from './validation'

export class HttpMatchmakingGateway {
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
