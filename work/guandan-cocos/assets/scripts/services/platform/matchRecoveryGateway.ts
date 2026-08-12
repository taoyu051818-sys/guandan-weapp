import type { MatchRecoveryEntry, MatchRecoveryGateway } from '../FrontPageGatewayContracts'
import { isEntryAttemptId } from '../../network/LobbyEntryAttempt'
import { PlatformApiClient } from './client'
import type { GameEndpointPolicy } from './contracts'
import { normalizeGameEndpoint } from './competitionDecoders'
import { normalizeRecoveredFriendRoomEntry } from './friendRoomGateway'
import { MatchRecoveryAttemptTracker } from './MatchRecoveryAttempt'
import { malformedResponse, requireNonEmptyString, requireRecord } from './validation'

const seats: MatchRecoveryEntry['seat'][] = ['p1', 'p2', 'p3', 'p4']

const normalizeMatchRecoveryEntry = (
  raw: unknown,
  recoveryAttemptId: string,
  endpointPolicy: GameEndpointPolicy,
): MatchRecoveryEntry => {
  const source = requireRecord(raw, '牌局恢复凭证')
  if (source.roomKind === 'friend') return normalizeRecoveredFriendRoomEntry(source, recoveryAttemptId, endpointPolicy)
  if (source.roomKind !== 'match') throw malformedResponse('牌局恢复类型不合法')
  if (source.inviteCode !== undefined || source.invitePayload !== undefined || source.inviteText !== undefined) throw malformedResponse('普通牌局恢复不得携带好友房邀请口令')
  if (source.ticketPurpose !== 'entry' && source.ticketPurpose !== 'rejoin') throw malformedResponse('牌局恢复票据用途不合法')
  if (source.entryAttemptId !== recoveryAttemptId || source.recoveryAttemptId !== recoveryAttemptId || !isEntryAttemptId(recoveryAttemptId)) {
    throw malformedResponse('牌局恢复幂等 ID 与请求不一致')
  }
  const roomId = requireNonEmptyString(source.roomId, '恢复房间 ID')
  if (!/^\d{6}$/.test(roomId)) throw malformedResponse('恢复房间 ID 必须是六位数字')
  if (!seats.includes(source.seat as MatchRecoveryEntry['seat'])) throw malformedResponse('恢复座位不合法')
  const gameTicket = requireNonEmptyString(source.gameTicket, '恢复游戏票据')
  if (requireNonEmptyString(source.joinToken, '恢复入桌票据') !== gameTicket) throw malformedResponse('恢复入桌票据不一致')
  if (typeof source.expiresAt !== 'number' || !Number.isFinite(source.expiresAt) || source.expiresAt <= Date.now()) {
    throw malformedResponse('恢复票据过期时间不合法')
  }
  return {
    entryAttemptId: recoveryAttemptId,
    recoveryAttemptId,
    matchId: requireNonEmptyString(source.matchId, '恢复匹配 ID'),
    roomId,
    seat: source.seat as MatchRecoveryEntry['seat'],
    roomKind: 'match',
    ticketPurpose: source.ticketPurpose,
    gameEndpoint: normalizeGameEndpoint(source.gameEndpoint, endpointPolicy),
    gameTicket,
    joinToken: gameTicket,
    expiresAt: source.expiresAt,
  }
}

export class HttpMatchRecoveryGateway implements MatchRecoveryGateway {
  private readonly attempts = new MatchRecoveryAttemptTracker()

  public constructor (private readonly client: PlatformApiClient, private readonly endpointPolicy: GameEndpointPolicy) {}

  public async recover (): Promise<MatchRecoveryEntry | null> {
    const recoveryAttemptId = this.attempts.current()
    const payload = requireRecord(await this.client.request<unknown>('/api/v1/matches/recover', 'POST', { recoveryAttemptId }), '牌局恢复响应')
    if (payload.entry === null) {
      this.attempts.complete(recoveryAttemptId)
      return null
    }
    return normalizeMatchRecoveryEntry(payload.entry, recoveryAttemptId, this.endpointPolicy)
  }

  public confirm (recoveryAttemptId: string): void { this.attempts.complete(recoveryAttemptId) }

  public abandon (recoveryAttemptId: string): void { this.attempts.abandon(recoveryAttemptId) }
}
