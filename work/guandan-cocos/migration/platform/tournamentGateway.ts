import type { TournamentGateway, TournamentStandings, TournamentState, TournamentSummary } from '../../assets/scripts/services/FrontPageGatewayContracts'
import { PlatformApiClient } from '../../assets/scripts/services/platform/client'
import { normalizeTournament, normalizeTournamentStanding, normalizeTournamentState, type RawTournament } from './tournamentDecoders'
import { PlatformApiError } from '../../assets/scripts/services/platform/contracts'
import { idempotencyKey, malformedResponse, nonNegativeInteger, requireArray, requireBoolean, requireRecord } from '../../assets/scripts/services/platform/validation'

export class HttpTournamentGateway implements TournamentGateway {
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
