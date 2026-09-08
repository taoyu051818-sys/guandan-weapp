import type { EngineState, PlayerId, Rank, RoomFormatSettings, SettlementResult, TributeState } from '../core/generated'
import type { NetworkEffectSync } from '../effects/NetworkEffectSyncPolicy'
import type { NetworkRequestResult } from './LobbySocketClient'

export const protocolVersion = (value: unknown): number | null => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null

export type FriendRoomSettings = Partial<RoomFormatSettings> & {
  mode: 'classic'
  rounds: number
  scoring: 'double-3' | 'double-4'
  scoreVisibility: 'live' | 'hidden'
  turnSeconds: 15 | 20 | 30 | 40 | 60
  trusteeSeconds: 0 | 15 | 30 | 60
  totalTimeMinutes: 0 | 20 | 30 | 60
  spectator: 'off' | 'live' | 'delayed-round' | 'delay-15' | 'delay-30' | 'delay-60'
  autoSort: boolean
  disableInteraction: boolean
  counterEnabled?: boolean
  disableVoice?: boolean
  sortOrder: 'desc' | 'asc'
  authoritativeValidation: true
}

export const DEFAULT_FRIEND_ROOM_SETTINGS: FriendRoomSettings = {
  mode: 'classic',
  rounds: 4,
  scoring: 'double-3',
  scoreVisibility: 'live',
  turnSeconds: 20,
  trusteeSeconds: 15,
  totalTimeMinutes: 0,
  spectator: 'off',
  autoSort: true,
  disableInteraction: true,
  sortOrder: 'desc',
  authoritativeValidation: true,
}

export type NetworkRoom = { roomId: string, hostName: string, playerCount: number, roomSettings?: FriendRoomSettings }
export type LobbyRoomStatus = 'idle' | 'joining' | 'ready' | 'rejoining' | 'leaving'
export type NetworkDeadlineAction = 'play' | 'tribute' | 'returnTribute' | 'finishTribute'
export type TrusteeReason = 'manual' | 'timeout' | 'disconnected'
export type NetworkTrustee = { reason: TrusteeReason, since: number }
export type DissolveVoteChoice = 'pending' | 'agree' | 'refuse' | 'offline'
export type NetworkDissolveVote = {
  initiator: PlayerId
  votes: Record<PlayerId, DissolveVoteChoice>
  expiresAt: number
}
export type NetworkScoreboard = {
  roundsPlayed: number
  currentLevel: Rank
  teamLevels: Record<'teamA' | 'teamB', Rank>
}
export type LobbyEntryKind = 'friend' | 'match'
export type LobbyCapabilities = {
  canUseBots: boolean
  canKickMembers: boolean
  requiresLobbyReady: boolean
}
export type MatchEndedReason = 'passed-a' | 'round-limit' | 'time-limit' | 'single-round'
export type NetworkMatchEnded = Readonly<{
  reason: MatchEndedReason
  endedAt: number
  roundsPlayed: number
  configuredRounds: number
  scores: Readonly<Record<'teamA' | 'teamB', number>>
  winnerTeam: 'teamA' | 'teamB' | null
}>
export type LobbySnapshot = RoomViewMetadata & {
  connected: boolean
  rooms: NetworkRoom[]
  roomId: string | null
  gameVersion: number
  members: PlayerId[]
  myPlayerId: PlayerId | null
  roomStatus: LobbyRoomStatus
  error: string | null
  turnDeadlineAt?: number | null
  deadlinePlayerId?: PlayerId | null
  deadlineAction?: NetworkDeadlineAction | null
  trustees?: Record<PlayerId, NetworkTrustee | null>
  consecutiveTimeouts?: Record<PlayerId, number>
  lobbyReadyRequired?: boolean
  lobbyReadyPlayerIds?: PlayerId[]
  botPlayerIds?: PlayerId[]
  roundReadyPlayerIds?: PlayerId[]
  dissolveVote?: NetworkDissolveVote | null
  roomSettings?: FriendRoomSettings | null
  scoreboard?: NetworkScoreboard | null
  entryKind?: LobbyEntryKind | null
  capabilities?: LobbyCapabilities | null
  gameStartPending?: boolean
  matchEnded?: NetworkMatchEnded | null
  recoveryAvailable?: boolean
}
export type LobbyNetworkResult = NetworkRequestResult | { requestId: null, requestType: string, responseType: 'client-error', ok: false, message: string }
export type NetworkStatePacket = { roomId: string, version: number, gameVersion: number, state: EngineState, effectSync: NetworkEffectSync }
export type NetworkRoundPacket = NetworkStatePacket & { tribute: TributeState | null }
export type NetworkViewerRoundStats = Readonly<{ bombsPlayed: number }>
export type NetworkRoundEndedPacket = {
  roomId: string
  version: number
  gameVersion: number
  result: SettlementResult
  effectSync: NetworkEffectSync
  state?: EngineState
  viewerRoundStats?: NetworkViewerRoundStats
}
export type MatchedRoomEntry = {
  entryAttemptId: string
  recoveryAttemptId?: string
  matchId?: string
  ticketPurpose?: 'entry' | 'rejoin'
  roomId: string
  gameEndpoint: string
  gameTicket: string
  seat: PlayerId | 'observer'
  isRoomHost?: boolean
  expiresAt?: number
  displayName?: string
}

export type LobbyLiveMetadata = {
  gameVersion?: number
  turnDeadlineAt?: number | null
  deadlinePlayerId?: PlayerId | null
  deadlineAction?: NetworkDeadlineAction | null
  trustees?: Record<PlayerId, NetworkTrustee | null>
  consecutiveTimeouts?: Record<PlayerId, number>
  lobbyReadyRequired?: boolean
  lobbyReadyPlayerIds?: PlayerId[]
  botPlayerIds?: PlayerId[]
  roundReadyPlayerIds?: PlayerId[]
  dissolveVote?: NetworkDissolveVote | null
  roomSettings?: FriendRoomSettings | null
  scoreboard?: NetworkScoreboard | null
  entryKind?: LobbyEntryKind
  capabilities?: LobbyCapabilities
  gameStartPending?: boolean
  matchEnded?: NetworkMatchEnded | null
}

export type LobbyWire<T> = { type: string, requestId?: number } & T
export type RoomViewMetadata = {
  roomRole?: 'player' | 'observer'
  seatedPlayerId?: PlayerId | null
  viewPlayerId?: PlayerId
  isRoomHost?: boolean
  hostPlayerId?: PlayerId | null
  observers?: { name: string, isHost: boolean }[]
  observerWaiting?: boolean
  observerClockAt?: number
  viewRevision?: number
}
export type RoomSnapshotWire = LobbyWire<LobbyLiveMetadata & RoomViewMetadata & {
  roomId: string
  myPlayerId: PlayerId
  resumeToken?: string
  state?: EngineState | null
  phase?: 'lobby' | 'observing' | 'playing' | 'tribute' | 'settlement'
  tribute?: TributeState | null
  roundResult?: SettlementResult | null
  viewerRoundStats?: NetworkViewerRoundStats
  version?: number
  memberPlayerIds?: PlayerId[]
}>
export type LiveMetadataWire = LobbyWire<LobbyLiveMetadata & {
  roomId?: string
  version?: number
  currentTurn?: PlayerId | null
  outcome?: 'rejected' | 'expired' | null
}>
export type PendingRoomEntry = {
  generation: number
  requestId: number
  requestType: 'createRoom' | 'joinRoom' | 'rejoinRoom'
  responseType: 'roomCreated' | 'roomJoined' | 'roomRejoined'
  roomId: string
  expectedPlayerId?: PlayerId
  matched: boolean
}

export const createEmptyTrustees = (): Record<PlayerId, NetworkTrustee | null> => ({
  p1: null,
  p2: null,
  p3: null,
  p4: null,
})

export const createEmptyTimeouts = (): Record<PlayerId, number> => ({ p1: 0, p2: 0, p3: 0, p4: 0 })

export const createRoomMetadataDefaults = (): Partial<LobbySnapshot> => ({
  roomRole: 'player', seatedPlayerId: null, viewPlayerId: undefined, isRoomHost: undefined,
  hostPlayerId: undefined, observers: [], observerWaiting: false, observerClockAt: undefined, viewRevision: undefined,
  gameVersion: 0,
  turnDeadlineAt: null,
  deadlinePlayerId: null,
  deadlineAction: null,
  trustees: createEmptyTrustees(),
  consecutiveTimeouts: createEmptyTimeouts(),
  lobbyReadyRequired: false,
  lobbyReadyPlayerIds: [],
  botPlayerIds: [],
  roundReadyPlayerIds: [],
  dissolveVote: null,
  roomSettings: null,
  scoreboard: null,
  entryKind: null,
  capabilities: null,
  gameStartPending: false,
  matchEnded: null,
})

export const createLobbySnapshot = (): LobbySnapshot => ({
  connected: false,
  rooms: [],
  roomId: null,
  members: [],
  myPlayerId: null,
  roomStatus: 'idle',
  error: null,
  recoveryAvailable: false,
  ...createRoomMetadataDefaults(),
  gameVersion: 0,
})

export const createClearedRoomPatch = (error?: string): Partial<LobbySnapshot> => ({
  roomId: null,
  members: [],
  myPlayerId: null,
  roomStatus: 'idle',
  recoveryAvailable: false,
  ...(error === undefined ? {} : { error }),
  ...createRoomMetadataDefaults(),
})

export const projectLobbyLiveMetadata = (message: LobbyLiveMetadata): Partial<LobbySnapshot> => {
  const next: Partial<LobbySnapshot> = {}
  if (Number.isSafeInteger(message.gameVersion) && Number(message.gameVersion) >= 0) next.gameVersion = Number(message.gameVersion)
  if (Object.prototype.hasOwnProperty.call(message, 'turnDeadlineAt')) next.turnDeadlineAt = message.turnDeadlineAt ?? null
  if (Object.prototype.hasOwnProperty.call(message, 'deadlinePlayerId')) next.deadlinePlayerId = message.deadlinePlayerId ?? null
  if (Object.prototype.hasOwnProperty.call(message, 'deadlineAction')) next.deadlineAction = message.deadlineAction ?? null
  if (message.trustees) next.trustees = message.trustees
  if (message.consecutiveTimeouts) next.consecutiveTimeouts = message.consecutiveTimeouts
  if (Object.prototype.hasOwnProperty.call(message, 'lobbyReadyRequired')) next.lobbyReadyRequired = Boolean(message.lobbyReadyRequired)
  if (message.lobbyReadyPlayerIds) next.lobbyReadyPlayerIds = message.lobbyReadyPlayerIds
  if (message.botPlayerIds) next.botPlayerIds = message.botPlayerIds
  if (message.roundReadyPlayerIds) next.roundReadyPlayerIds = message.roundReadyPlayerIds
  if (Object.prototype.hasOwnProperty.call(message, 'dissolveVote')) next.dissolveVote = message.dissolveVote ?? null
  if (Object.prototype.hasOwnProperty.call(message, 'roomSettings')) next.roomSettings = message.roomSettings ?? null
  if (Object.prototype.hasOwnProperty.call(message, 'scoreboard')) next.scoreboard = message.scoreboard ?? null
  if (message.entryKind === 'friend' || message.entryKind === 'match') next.entryKind = message.entryKind
  const capabilities = message.capabilities
  if (
    capabilities
    && typeof capabilities.canUseBots === 'boolean'
    && typeof capabilities.canKickMembers === 'boolean'
    && typeof capabilities.requiresLobbyReady === 'boolean'
  ) next.capabilities = { ...capabilities }
  if (Object.prototype.hasOwnProperty.call(message, 'gameStartPending')) next.gameStartPending = Boolean(message.gameStartPending)
  if (Object.prototype.hasOwnProperty.call(message, 'matchEnded')) {
    const matchEnded = normalizeNetworkMatchEnded(message.matchEnded)
    if (message.matchEnded === null || matchEnded) next.matchEnded = matchEnded
    if (matchEnded) Object.assign(next, {
      turnDeadlineAt: null, deadlinePlayerId: null, deadlineAction: null,
      roundReadyPlayerIds: [], gameStartPending: false,
    })
  }
  return next
}

const finiteInteger = (value: unknown): value is number => Number.isSafeInteger(value)

export const normalizeNetworkMatchEnded = (value: unknown): NetworkMatchEnded | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  const scores = candidate.scores as Record<string, unknown> | null
  if (
    (candidate.reason !== 'passed-a' && candidate.reason !== 'round-limit' && candidate.reason !== 'time-limit' && candidate.reason !== 'single-round') ||
    !finiteInteger(candidate.endedAt) || Number(candidate.endedAt) < 0 ||
    !finiteInteger(candidate.roundsPlayed) || Number(candidate.roundsPlayed) < 0 ||
    !finiteInteger(candidate.configuredRounds) || Number(candidate.configuredRounds) < 1 ||
    !scores || !finiteInteger(scores.teamA) || !finiteInteger(scores.teamB) ||
    (candidate.winnerTeam !== null && candidate.winnerTeam !== 'teamA' && candidate.winnerTeam !== 'teamB')
  ) return null
  return {
    reason: candidate.reason,
    endedAt: candidate.endedAt,
    roundsPlayed: candidate.roundsPlayed,
    configuredRounds: candidate.configuredRounds,
    scores: { teamA: scores.teamA, teamB: scores.teamB },
    winnerTeam: candidate.winnerTeam,
  }
}
