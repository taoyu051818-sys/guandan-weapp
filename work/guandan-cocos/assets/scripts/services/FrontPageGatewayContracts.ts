/**
 * Stable application-facing contracts shared by production and development gateways.
 * Keep this module free of sample data, transport code and Cocos dependencies.
 */
import type { FriendRoomSettings } from '../network/LobbyModels'

export const MATCH_QUEUE_IDS = ['quick', 'classic_50', 'classic_300', 'classic_2000', 'classic_10000', 'rookie_cup', 'weekend_cup', 'master_cup', 'lingshui_16_cup'] as const
export type MatchQueueId = typeof MATCH_QUEUE_IDS[number]

export type MatchTicket = {
  ticketId: string
  entryAttemptId?: string
  queueId: MatchQueueId
  status: 'matching' | 'matched' | 'playing' | 'completed' | 'aborted' | 'cancelled'
  roomId?: string
  gameEndpoint?: string
  joinToken?: string
  seat?: 'p1' | 'p2' | 'p3' | 'p4'
  expiresAt?: number
}

export interface MatchmakingGateway {
  joinQueue(queueId: MatchQueueId, assignment?: { tournamentId: string, assignmentId: string }): Promise<MatchTicket>
  getStatus(ticketId: string): Promise<MatchTicket>
  cancel(ticketId: string): Promise<void>
}

export type FriendRoomEntry = {
  entryAttemptId: string
  matchId: string
  roomId: string
  seat: 'p1' | 'p2' | 'p3' | 'p4'
  gameEndpoint: string
  gameTicket: string
  joinToken: string
  expiresAt: number
  roomExpiresAt: number
  roomSettings: FriendRoomSettings
  roomKind: 'friend'
  ticketPurpose: 'entry' | 'rejoin'
  recoveryAttemptId?: string
}

export type CreatedFriendRoomEntry = FriendRoomEntry & {
  inviteCode: string
  invitePayload: { version: 1, roomId: string, inviteCode: string }
  inviteText: string
}

export interface FriendRoomGateway {
  create(roomSettings: FriendRoomSettings): Promise<CreatedFriendRoomEntry>
  join(inviteText: string): Promise<FriendRoomEntry>
  cancel(matchId: string): Promise<void>
}

type MatchRecoveryBase = {
  entryAttemptId: string
  recoveryAttemptId: string
  matchId: string
  roomId: string
  seat: 'p1' | 'p2' | 'p3' | 'p4'
  ticketPurpose: 'entry' | 'rejoin'
  gameEndpoint: string
  gameTicket: string
  joinToken: string
  expiresAt: number
}

type FriendRecoveryInvitation =
  | { inviteCode: string, invitePayload: { version: 1, roomId: string, inviteCode: string }, inviteText: string }
  | { inviteCode?: never, invitePayload?: never, inviteText?: never }

export type MatchRecoveryEntry =
  | Readonly<MatchRecoveryBase & {
    roomKind: 'match'
    roomExpiresAt?: never
    roomSettings?: never
    inviteCode?: never
    invitePayload?: never
    inviteText?: never
  }>
  | Readonly<MatchRecoveryBase & {
    roomKind: 'friend'
    roomExpiresAt: number
    roomSettings: FriendRoomSettings
  } & FriendRecoveryInvitation>

export interface MatchRecoveryGateway {
  recover(): Promise<MatchRecoveryEntry | null>
  confirm(recoveryAttemptId: string): void
  abandon(recoveryAttemptId: string): void
}

export type ShopProduct = {
  id: string
  name: string
  pointsPrice: number
  description: string
  category: string
  stock: number
  imageUrl?: string
}

export type ShopOrder = {
  orderId: string
  productId: string
  quantity: number
  totalPoints: number
  status: 'created' | 'paid' | 'cancelled' | 'fulfilled'
}

export interface ShopGateway {
  listProducts(): Promise<ShopProduct[]>
  createOrder(productId: string, quantity: number, expectedPointsPrice?: number): Promise<ShopOrder>
}

export type WalletSnapshot = { points: number, diamonds: number }

export interface WalletGateway {
  getWallet(): Promise<WalletSnapshot>
}

export type UserProfile = { id: string, accountId: string, displayName: string, comprehensiveScore: number, avatarUrl?: string }

export interface AuthGateway {
  getProfile(): Promise<UserProfile>
  signOut(): void
}

export type PlayerStatsSnapshot = {
  gamesPlayed: number
  wins: number
  firstPlaceFinishes: number
  bombsPlayed: number
  elo: number
}

export type PlayerRatingSnapshot = {
  games: number
  wins: number
  eloOffset: number
  baseScore: number
  comprehensiveScore: number
}

export type RecentMatchSummary = {
  eventId: string
  replayId: string
  matchId: string
  roomId: string
  place: number
  won: boolean
  tournamentId?: string | null
  finishedAt: number
}

export type PlayerDashboard = {
  user: UserProfile
  rating: PlayerRatingSnapshot
  stats: PlayerStatsSnapshot
  season: null | { id: string, name: string, status: string, progress: { score: number, gamesPlayed: number, wins: number } }
  recentMatches: RecentMatchSummary[]
}

export interface PlayerCenterGateway { getDashboard(): Promise<PlayerDashboard> }

export type TournamentSummary = {
  id: string
  name: string
  description: string
  status: 'open' | 'scheduled' | 'running' | 'finished'
  startsAt?: number
  entryPoints: number
  queueId: MatchQueueId
  enrolled: boolean
  format?: 'fixed16-latin-3'
  capacity?: number
  checkedInCount?: number
  roundsTotal?: number
  currentRound?: number
  advanceCount?: number
  myStanding?: { played: number, points: number, rank: number, advanced: boolean }
}

export type TournamentStanding = {
  userId: string
  displayName: string
  played: number
  wins: number
  firstPlaces: number
  points: number
  opponentPoints: number
  rank: number
  advanced: boolean
  qualificationStatus: 'pending' | 'qualified' | 'eliminated'
}

export type TournamentStandings = {
  tournament: TournamentSummary
  standings: TournamentStanding[]
  provisional: boolean
  cutoffRank: number
  viewerStanding: TournamentStanding | null
}

export type TournamentAssignment = {
  assignmentId: string
  roundNumber: number
  tableNumber: number
  status: 'pending' | 'matching' | 'matched' | 'completed' | 'blocked'
  matchId?: string
}

export type TournamentState = {
  phase: 'check-in' | 'round-active' | 'blocked' | 'finished'
  tournament: TournamentSummary
  capacity: number
  checkedInCount: number
  roundNumber: number
  roundsTotal: number
  tablesTotal: number
  tablesSettled: number
  cutoffRank: number
  viewerEntry: { enrolled: boolean, checkedIn: boolean, rosterLocked: boolean }
  assignment: TournamentAssignment | null
  viewerStanding?: TournamentStanding
}

export interface TournamentGateway {
  listTournaments(): Promise<TournamentSummary[]>
  enroll(tournamentId: string, expectedEntryPoints?: number): Promise<TournamentSummary>
  checkIn(tournamentId: string): Promise<TournamentState>
  getState(tournamentId: string): Promise<TournamentState>
  getStandings(tournamentId: string): Promise<TournamentStandings>
}

export type SeasonTask = { id: string, name: string, target: number, rewardPoints: number, progress: number, completed: boolean, claimed: boolean, cadence: string }
export type SeasonTaskList = { season: null | { id: string, name: string, status: string }, tasks: SeasonTask[] }
export interface SeasonGateway { listTasks(): Promise<SeasonTaskList>, claim(taskId: string): Promise<void> }

export type ReplaySummary = { id: string, eventId: string, matchId: string, roomId: string, ranking: string[], winnerTeam: string, finishedAt: number, eventCount: number }
/**
 * Public replay events intentionally contain only information that was visible
 * at the table. In particular there are no card ids, private hands or platform
 * user ids. The optional semantic fields let the replay renderer reconstruct a
 * deterministic public table instead of guessing from a text label.
 */
export type ReplayEvent = {
  sequence: number
  at: number
  type: string
  roundSequence?: number
  playerId?: string
  cards?: Array<{ rank: string, suit: string }>
  playType?: string
  automatic?: boolean
  ranking?: string[]
  winnerTeam?: string
  isGameWon?: boolean
  reason?: string
  text?: string
}
export type ReplayViewerSeat = 'p1' | 'p2' | 'p3' | 'p4'
export type ReplayDetail = ReplaySummary & { participants: Record<string, string>, viewerSeat: ReplayViewerSeat | null, events: ReplayEvent[] }
export interface ReplayGateway { list(): Promise<ReplaySummary[]>, get(replayId: string): Promise<ReplayDetail> }

/** Canonical states are playing/completed/aborted; running/finished remain wire-compatible aliases. */
export type SpectatorMatchStatus = 'playing' | 'completed' | 'aborted' | 'running' | 'finished'
export type SpectatorMatchSummary = {
  matchId: string
  tableLabel: string
  mode: MatchQueueId
  status: SpectatorMatchStatus
  startedAt: number
  finishedAt: number | null
  abortedAt: number | null
  abortReason: string | null
  delaySeconds: number
  availableEventCount: number
  totalEventCount: number
  timelineComplete: boolean
}
export type SpectatorFeed = SpectatorMatchSummary & { availableThrough: number, events: ReplayEvent[] }
export interface SpectatorGateway {
  list(delaySeconds?: number): Promise<SpectatorMatchSummary[]>
  getFeed(matchId: string, delaySeconds?: number): Promise<SpectatorFeed>
}

export type MerchantStatus = 'pending' | 'active' | 'suspended' | 'rejected'
export type MerchantRole = 'owner' | 'manager' | 'cashier'
export type MerchantStoreStatus = 'active' | 'inactive'
export type MerchantEmployeeStatus = 'active' | 'inactive'
export type MerchantGrantStatus = 'posted' | 'reversed'

export type MerchantProfile = {
  id: string
  ownerUserId: string
  name: string
  contactName: string
  status: MerchantStatus
  dailyPointLimit: number
  createdAt: number
}

export type MerchantStore = {
  id: string
  merchantId: string
  name: string
  address: string
  status: MerchantStoreStatus
  createdAt: number
}

export type MerchantEmployee = {
  id: string
  merchantId: string
  userId: string
  role: Exclude<MerchantRole, 'owner'>
  status: MerchantEmployeeStatus
  updatedAt: number
}

export type MerchantPointGrant = {
  id: string
  merchantId: string
  storeId: string
  operatorUserId: string
  recipientUserId: string
  amount: number
  note: string
  status: MerchantGrantStatus
  createdAt: number
  duplicate?: boolean
}

export type MerchantConsole = {
  merchant: MerchantProfile
  role: MerchantRole
  stores: MerchantStore[]
  employees: MerchantEmployee[]
  grants: MerchantPointGrant[]
  grantedPoints: number
}

export type MerchantApplication = { name: string, contactName?: string }
export type MerchantStoreDraft = { name: string, address?: string }
export type MerchantEmployeeDraft = { employeeUserId: string, role: Exclude<MerchantRole, 'owner'> }
export type MerchantPointGrantDraft = { storeId: string, recipientUserId: string, amount: number, note?: string }

export interface MerchantGateway {
  getConsole(): Promise<MerchantConsole>
  apply(application: MerchantApplication): Promise<MerchantProfile>
  createStore(store: MerchantStoreDraft): Promise<MerchantStore>
  addEmployee(employee: MerchantEmployeeDraft): Promise<MerchantEmployee>
  grantPoints(grant: MerchantPointGrantDraft): Promise<MerchantPointGrant>
}

export type FrontPageGateways = {
  configured: boolean
  auth: AuthGateway
  matchmaking: MatchmakingGateway
  friendRooms: FriendRoomGateway
  matchRecovery: MatchRecoveryGateway
  shop: ShopGateway
  wallet: WalletGateway
  tournaments: TournamentGateway
  playerCenter: PlayerCenterGateway
  seasons: SeasonGateway
  replays: ReplayGateway
  spectator: SpectatorGateway
  merchant: MerchantGateway
}
