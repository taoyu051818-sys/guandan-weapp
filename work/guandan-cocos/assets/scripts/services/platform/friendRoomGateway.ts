import type {
  CreatedFriendRoomEntry,
  FriendRoomEntry,
  FriendRoomGateway,
  MatchRecoveryEntry,
} from '../FrontPageGatewayContracts'
import type { FriendRoomSettings } from '../../network/LobbyModels'
import { createEntryAttemptId, isEntryAttemptId } from '../../network/LobbyEntryAttempt'
import { PlatformApiClient } from './client'
import { normalizeGameEndpoint } from './competitionDecoders'
import type { GameEndpointPolicy } from './contracts'
import { PlatformApiError } from './contracts'
import { malformedResponse, requireBoolean, requireNonEmptyString, requireRecord } from './validation'

const seats: FriendRoomEntry['seat'][] = ['p1', 'p2', 'p3', 'p4']
const invitePattern = /^(\d{6})\.([A-Za-z0-9_-]{20,128})$/

const normalizeRoomSettings = (value: unknown): FriendRoomSettings => {
  const source = requireRecord(value, '好友房规则')
  const rounds = source.rounds
  if (!Number.isSafeInteger(rounds) || Number(rounds) < 4 || Number(rounds) > 32 || Number(rounds) % 4 !== 0) {
    throw malformedResponse('好友房局数不合法')
  }
  const oneOf = <T extends string | number>(raw: unknown, allowed: readonly T[], context: string): T => {
    if (!allowed.includes(raw as T)) throw malformedResponse(`${context}不合法`, { value: raw })
    return raw as T
  }
  if (source.mode !== 'classic' || source.authoritativeValidation !== true) throw malformedResponse('好友房权威规则不合法')
  return {
    mode: 'classic',
    rounds: Number(rounds),
    scoring: oneOf(source.scoring, ['double-3', 'double-4'] as const, '好友房计分'),
    scoreVisibility: oneOf(source.scoreVisibility, ['live', 'hidden'] as const, '好友房比分展示'),
    turnSeconds: oneOf(source.turnSeconds, [20, 40, 60] as const, '好友房首出时限'),
    trusteeSeconds: oneOf(source.trusteeSeconds, [0, 15, 30, 60] as const, '好友房托管时限'),
    totalTimeMinutes: oneOf(source.totalTimeMinutes, [0, 20, 30, 60] as const, '好友房总时限'),
    spectator: oneOf(source.spectator, ['off', 'live', 'delayed-round'] as const, '好友房观战设置'),
    autoSort: requireBoolean(source.autoSort, '好友房自动理牌'),
    disableInteraction: requireBoolean(source.disableInteraction, '好友房互动设置'),
    sortOrder: oneOf(source.sortOrder, ['desc', 'asc'] as const, '好友房牌序'),
    authoritativeValidation: true,
  }
}

const normalizeExpiry = (value: unknown, context: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= Date.now()) throw malformedResponse(`${context}不合法`, { value })
  return value
}

const normalizeEntry = (
  raw: unknown,
  expectedAttemptId: string,
  endpointPolicy: GameEndpointPolicy,
): FriendRoomEntry => {
  const source = requireRecord(raw, '好友房入桌凭证')
  const entryAttemptId = requireNonEmptyString(source.entryAttemptId, '好友房入桌幂等 ID')
  if (entryAttemptId !== expectedAttemptId) throw malformedResponse('好友房入桌幂等 ID 与请求不一致')
  if (source.roomKind !== 'friend') throw malformedResponse('好友房票据类型不合法')
  if (source.ticketPurpose !== 'entry' && source.ticketPurpose !== 'rejoin') throw malformedResponse('好友房票据用途不合法')
  const roomId = requireNonEmptyString(source.roomId, '好友房编号')
  if (!/^\d{6}$/.test(roomId)) throw malformedResponse('好友房编号必须是六位数字')
  if (!seats.includes(source.seat as FriendRoomEntry['seat'])) throw malformedResponse('好友房座位不合法')
  const gameTicket = requireNonEmptyString(source.gameTicket, '好友房游戏票据')
  const joinToken = requireNonEmptyString(source.joinToken, '好友房入桌票据')
  if (joinToken !== gameTicket) throw malformedResponse('好友房入桌票据不一致')
  const roomExpiresAt = source.roomExpiresAt
  if (typeof roomExpiresAt !== 'number' || !Number.isSafeInteger(roomExpiresAt) || roomExpiresAt <= 0 || (source.ticketPurpose === 'entry' && roomExpiresAt <= Date.now())) {
    throw malformedResponse('好友房租约过期时间不合法')
  }
  return {
    entryAttemptId,
    matchId: requireNonEmptyString(source.matchId, '好友房匹配 ID'),
    roomId,
    seat: source.seat as FriendRoomEntry['seat'],
    gameEndpoint: normalizeGameEndpoint(source.gameEndpoint, endpointPolicy),
    gameTicket,
    joinToken,
    expiresAt: normalizeExpiry(source.expiresAt, '好友房票据过期时间'),
    roomExpiresAt,
    roomSettings: normalizeRoomSettings(source.roomSettings),
    roomKind: 'friend',
    ticketPurpose: source.ticketPurpose,
    ...(source.recoveryAttemptId === undefined ? {} : { recoveryAttemptId: requireNonEmptyString(source.recoveryAttemptId, '好友房恢复幂等 ID') }),
  }
}

export const normalizeRecoveredFriendRoomEntry = (
  raw: unknown,
  recoveryAttemptId: string,
  endpointPolicy: GameEndpointPolicy,
): Extract<MatchRecoveryEntry, { roomKind: 'friend' }> => {
  const source = requireRecord(raw, '好友房恢复凭证')
  if (!isEntryAttemptId(recoveryAttemptId)) throw malformedResponse('好友房恢复幂等 ID 不合法')
  const entry = normalizeEntry(raw, recoveryAttemptId, endpointPolicy)
  if (entry.recoveryAttemptId !== recoveryAttemptId) throw malformedResponse('好友房恢复幂等 ID 与请求不一致')
  const carriesInvite = source.inviteCode !== undefined || source.invitePayload !== undefined || source.inviteText !== undefined
  const isWaitingHost = entry.ticketPurpose === 'entry' && entry.seat === 'p1'
  if (carriesInvite !== isWaitingHost) throw malformedResponse(isWaitingHost ? '好友房房主恢复邀请口令缺失' : '好友房访客恢复不得携带邀请口令')
  return carriesInvite
    ? { ...entry, recoveryAttemptId, ...normalizeInvitation(source, entry.roomId) }
    : { ...entry, recoveryAttemptId }
}

const normalizeInvitation = (source: Record<string, unknown>, roomId: string): Pick<CreatedFriendRoomEntry, 'inviteCode' | 'invitePayload' | 'inviteText'> => {
  const inviteCode = requireNonEmptyString(source.inviteCode, '好友房邀请码')
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(inviteCode)) throw malformedResponse('好友房邀请码不合法')
  const invitePayload = requireRecord(source.invitePayload, '好友房邀请载荷')
  const inviteText = requireNonEmptyString(source.inviteText, '好友房邀请口令')
  if (invitePayload.version !== 1 || invitePayload.roomId !== roomId || invitePayload.inviteCode !== inviteCode || inviteText !== `${roomId}.${inviteCode}`) {
    throw malformedResponse('好友房邀请口令与房间凭证不一致')
  }
  return { inviteCode, invitePayload: { version: 1, roomId, inviteCode }, inviteText }
}

const normalizeCreatedEntry = (raw: unknown, attemptId: string, policy: GameEndpointPolicy): CreatedFriendRoomEntry => {
  const source = requireRecord(raw, '好友房创建凭证')
  const entry = normalizeEntry(source, attemptId, policy)
  return { ...entry, ...normalizeInvitation(source, entry.roomId) }
}

const operationKey = (settings: FriendRoomSettings): string => JSON.stringify([
  settings.mode, settings.rounds, settings.scoring, settings.scoreVisibility, settings.turnSeconds,
  settings.trusteeSeconds, settings.totalTimeMinutes, settings.spectator, settings.autoSort,
  settings.disableInteraction, settings.sortOrder, settings.authoritativeValidation,
])

export class HttpFriendRoomGateway implements FriendRoomGateway {
  private readonly uncertainAttempts = new Map<string, string>()

  public constructor (private readonly client: PlatformApiClient, private readonly endpointPolicy: GameEndpointPolicy) {}

  public async create (roomSettings: FriendRoomSettings): Promise<CreatedFriendRoomEntry> {
    const normalizedSettings = normalizeRoomSettings(roomSettings)
    const operation = `create:${operationKey(normalizedSettings)}`
    return this.run(operation, async entryAttemptId => {
      const payload = requireRecord(await this.client.request<unknown>('/api/v1/friend-rooms/create', 'POST', {
        entryAttemptId, roomSettings: normalizedSettings,
      }), '好友房创建响应')
      return normalizeCreatedEntry(payload.entry, entryAttemptId, this.endpointPolicy)
    })
  }

  public async join (inviteText: string): Promise<FriendRoomEntry> {
    const normalized = inviteText.trim()
    const match = invitePattern.exec(normalized)
    if (!match) throw new PlatformApiError('请粘贴完整的好友房邀请口令', { code: 'INVALID_FRIEND_ROOM_INVITE', retryable: false })
    return this.run(`join:${normalized}`, async entryAttemptId => {
      const payload = requireRecord(await this.client.request<unknown>('/api/v1/friend-rooms/join', 'POST', {
        entryAttemptId, roomId: match[1], inviteCode: match[2],
      }), '好友房加入响应')
      return normalizeEntry(payload.entry, entryAttemptId, this.endpointPolicy)
    })
  }

  public async cancel (matchId: string): Promise<void> {
    const safeMatchId = matchId.trim()
    if (!safeMatchId) return
    await this.client.request<unknown>('/api/v1/match/cancel', 'POST', { matchId: safeMatchId })
  }

  private async run<T> (operation: string, request: (entryAttemptId: string) => Promise<T>): Promise<T> {
    const entryAttemptId = this.uncertainAttempts.get(operation) ?? createEntryAttemptId()
    this.uncertainAttempts.set(operation, entryAttemptId)
    try {
      const result = await request(entryAttemptId)
      if (this.uncertainAttempts.get(operation) === entryAttemptId) this.uncertainAttempts.delete(operation)
      return result
    } catch (error) {
      if (error instanceof PlatformApiError && !error.retryable && this.uncertainAttempts.get(operation) === entryAttemptId) {
        this.uncertainAttempts.delete(operation)
      }
      throw error
    }
  }
}
