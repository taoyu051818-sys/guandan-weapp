import type { PlayerId, Rank, Team } from '../core/generated'

export type GameMode = 'standard' | 'double_open' | 'campaign'
export type SessionStatus = 'menu' | 'grouping' | 'dealing' | 'playing' | 'tribute' | 'settlement' | 'lobby'
export type VoicePack = 'female' | 'male'
export const APPLICATION_AI_DIFFICULTY = 'master' as const
export const SESSION_SCHEMA_VERSION = 2 as const

export type SessionSettings = {
  soundEnabled: boolean
  volume: number
  voicePack: VoicePack
  bgmEnabled: boolean
  bgmVolume: number
  sortOrder: 'asc' | 'desc'
  rulePreset: 'classic' | 'tournament'
  visualTheme: 'luxury' | 'compact'
  effectQuality: 'full' | 'reduced' | 'off'
  hapticEnabled: boolean
}

export type PlayerStats = { gamesPlayed: number, wins: number, bombsPlayed: number, firstPlaceFinishes: number, elo: number }
export type CampaignProgress = { chapter: number, targetWins: number, wins: number, losses: number, completed: boolean, failed: boolean }
export type RecentMatch = { finishedAt: number, winnerTeam: Team, levelUp: number, currentLevel: Rank, teamLevels: Record<Team, Rank>, scores: Record<Team, number> }

export type SessionSnapshot = {
  schemaVersion: typeof SESSION_SCHEMA_VERSION
  status: SessionStatus
  gameMode: GameMode
  isMultiplayer: boolean
  roomId: string | null
  myPlayerId: PlayerId
  difficulty: typeof APPLICATION_AI_DIFFICULTY
  currentLevel: Rank
  dealerId: PlayerId | null
  teamLevels: Record<Team, Rank>
  settings: SessionSettings
  playerStats: PlayerStats
  campaignProgress: CampaignProgress | null
  recentMatch: RecentMatch | null
}

const ranks: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 'J', 'Q', 'K', 'A']
const teams: readonly Team[] = ['teamA', 'teamB']
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const oneOf = <T extends string>(value: unknown, values: readonly T[], fallback: T): T => (
  typeof value === 'string' && values.includes(value as T) ? value as T : fallback
)
const rank = (value: unknown, fallback: Rank): Rank => ranks.includes(value as Rank) ? value as Rank : fallback
const finite = (value: unknown, fallback: number): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback
const count = (value: unknown, fallback: number): number => Math.max(0, Math.floor(finite(value, fallback)))
const bounded = (value: unknown, fallback: number, minimum: number, maximum: number): number => (
  Math.max(minimum, Math.min(maximum, finite(value, fallback)))
)
const bool = (value: unknown, fallback: boolean): boolean => typeof value === 'boolean' ? value : fallback

export const createDefaultSessionSnapshot = (): SessionSnapshot => ({
  schemaVersion: SESSION_SCHEMA_VERSION,
  status: 'menu',
  gameMode: 'standard',
  isMultiplayer: false,
  roomId: null,
  myPlayerId: 'p1',
  difficulty: APPLICATION_AI_DIFFICULTY,
  currentLevel: 2,
  dealerId: null,
  teamLevels: { teamA: 2, teamB: 2 },
  settings: {
    soundEnabled: true,
    volume: 0.5,
    voicePack: 'female',
    bgmEnabled: true,
    bgmVolume: 0.3,
    sortOrder: 'desc',
    rulePreset: 'classic',
    visualTheme: 'luxury',
    effectQuality: 'full',
    hapticEnabled: true,
  },
  playerStats: { gamesPlayed: 0, wins: 0, bombsPlayed: 0, firstPlaceFinishes: 0, elo: 1000 },
  campaignProgress: null,
  recentMatch: null,
})

const restoreTeamLevels = (value: unknown, fallback: Record<Team, Rank>): Record<Team, Rank> => {
  const source = isRecord(value) ? value : {}
  return {
    teamA: rank(source.teamA, fallback.teamA),
    teamB: rank(source.teamB, fallback.teamB),
  }
}

const restoreScores = (value: unknown): Record<Team, number> => {
  const source = isRecord(value) ? value : {}
  return { teamA: finite(source.teamA, 0), teamB: finite(source.teamB, 0) }
}

const restoreCampaign = (value: unknown): CampaignProgress | null => {
  if (!isRecord(value)) return null
  const targetWins = Math.max(1, count(value.targetWins, 3))
  const wins = count(value.wins, 0)
  const losses = count(value.losses, 0)
  return {
    chapter: Math.max(1, count(value.chapter, 1)),
    targetWins,
    wins,
    losses,
    completed: bool(value.completed, wins >= targetWins),
    failed: bool(value.failed, losses >= 2),
  }
}

const restoreRecentMatch = (value: unknown): RecentMatch | null => {
  if (!isRecord(value) || !teams.includes(value.winnerTeam as Team)) return null
  return {
    finishedAt: count(value.finishedAt, 0),
    winnerTeam: value.winnerTeam as Team,
    levelUp: Math.trunc(finite(value.levelUp, 0)),
    currentLevel: rank(value.currentLevel, 2),
    teamLevels: restoreTeamLevels(value.teamLevels, { teamA: 2, teamB: 2 }),
    scores: restoreScores(value.scores),
  }
}

/** Migrates every historical/partial JSON shape into the current complete schema. */
export const restoreSessionSnapshot = (value: unknown): SessionSnapshot => {
  const base = createDefaultSessionSnapshot()
  if (!isRecord(value)) return base
  const settings = isRecord(value.settings) ? value.settings : {}
  const stats = isRecord(value.playerStats) ? value.playerStats : {}
  return {
    ...base,
    schemaVersion: SESSION_SCHEMA_VERSION,
    // Route, room and seat ownership are transient without an engine/server snapshot.
    status: 'menu',
    gameMode: oneOf(value.gameMode, ['standard', 'double_open', 'campaign'], base.gameMode),
    isMultiplayer: false,
    roomId: null,
    myPlayerId: 'p1',
    dealerId: null,
    currentLevel: rank(value.currentLevel, base.currentLevel),
    teamLevels: restoreTeamLevels(value.teamLevels, base.teamLevels),
    settings: {
      soundEnabled: bool(settings.soundEnabled, base.settings.soundEnabled),
      volume: bounded(settings.volume, base.settings.volume, 0, 1),
      voicePack: oneOf(settings.voicePack, ['female', 'male'], base.settings.voicePack),
      bgmEnabled: bool(settings.bgmEnabled, base.settings.bgmEnabled),
      bgmVolume: bounded(settings.bgmVolume, base.settings.bgmVolume, 0, 1),
      sortOrder: oneOf(settings.sortOrder, ['asc', 'desc'], base.settings.sortOrder),
      rulePreset: oneOf(settings.rulePreset, ['classic', 'tournament'], base.settings.rulePreset),
      visualTheme: oneOf(settings.visualTheme, ['luxury', 'compact'], base.settings.visualTheme),
      effectQuality: oneOf(settings.effectQuality, ['full', 'reduced', 'off'], base.settings.effectQuality),
      hapticEnabled: bool(settings.hapticEnabled, base.settings.hapticEnabled),
    },
    playerStats: {
      gamesPlayed: count(stats.gamesPlayed, base.playerStats.gamesPlayed),
      wins: count(stats.wins, base.playerStats.wins),
      bombsPlayed: count(stats.bombsPlayed, base.playerStats.bombsPlayed),
      firstPlaceFinishes: count(stats.firstPlaceFinishes, base.playerStats.firstPlaceFinishes),
      elo: count(stats.elo, base.playerStats.elo),
    },
    campaignProgress: restoreCampaign(value.campaignProgress),
    recentMatch: restoreRecentMatch(value.recentMatch),
  }
}
