import { _decorator, Component, EventTarget, sys } from 'cc'
import type { PlayerId, Rank, Team } from '../core/generated'
import { setRuleProfileByPreset } from '../core/generated/lib/rules'

export type GameMode = 'standard' | 'double_open' | 'campaign'
export type SessionStatus = 'menu' | 'grouping' | 'dealing' | 'playing' | 'tribute' | 'settlement' | 'lobby'
export type VoicePack = 'female' | 'male'
export const APPLICATION_AI_DIFFICULTY = 'master' as const

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

const { ccclass } = _decorator
const storageKey = 'guandan-cocos-session-v1'

const defaults = (): SessionSnapshot => ({
  status: 'menu', gameMode: 'standard', isMultiplayer: false, roomId: null, myPlayerId: 'p1',
  difficulty: APPLICATION_AI_DIFFICULTY, currentLevel: 2, dealerId: null,
  teamLevels: { teamA: 2, teamB: 2 },
  settings: { soundEnabled: true, volume: 0.5, voicePack: 'female', bgmEnabled: true, bgmVolume: 0.3, sortOrder: 'desc', rulePreset: 'classic', visualTheme: 'luxury', effectQuality: 'full', hapticEnabled: true },
  playerStats: { gamesPlayed: 0, wins: 0, bombsPlayed: 0, firstPlaceFinishes: 0, elo: 1000 }, campaignProgress: null, recentMatch: null,
})

/** Cocos replacement for the desktop Zustand application store. */
@ccclass('GameSession')
export class GameSession extends Component {
  public readonly events = new EventTarget()
  public snapshot: SessionSnapshot = defaults()

  protected onLoad (): void { this.restore() }

  public beginLocalGame (mode: GameMode = 'standard'): void {
    this.snapshot = { ...this.snapshot, status: 'grouping', difficulty: APPLICATION_AI_DIFFICULTY, gameMode: mode, isMultiplayer: false, roomId: null, myPlayerId: 'p1', dealerId: null, campaignProgress: mode === 'campaign' ? { chapter: 1, targetWins: 3, wins: 0, losses: 0, completed: false, failed: false } : null }
    this.commit()
  }

  public enterLobby (): void { this.snapshot = { ...this.snapshot, status: 'lobby', isMultiplayer: true }; this.commit() }
  public joinRoom (roomId: string, myPlayerId: PlayerId): void { this.snapshot = { ...this.snapshot, status: 'lobby', isMultiplayer: true, roomId, myPlayerId }; this.commit() }
  public leaveToMenu (): void { this.snapshot = { ...this.snapshot, status: 'menu', roomId: null, isMultiplayer: false }; this.commit() }

  public completeGrouping (dealerId: PlayerId): void {
    this.snapshot = { ...this.snapshot, dealerId, status: 'dealing' }
    this.commit()
  }

  public beginPlay (): void { this.snapshot = { ...this.snapshot, status: 'playing' }; this.commit() }
  public beginTribute (): void { this.snapshot = { ...this.snapshot, status: 'tribute' }; this.commit() }
  public beginSettlement (): void { this.snapshot = { ...this.snapshot, status: 'settlement' }; this.commit() }

  public setRoundLevels (teamLevels: Record<Team, Rank>, currentLevel: Rank): void {
    this.snapshot = { ...this.snapshot, teamLevels: { ...teamLevels }, currentLevel }
    this.commit()
  }

  public updateSettings (settings: Partial<SessionSettings>): void {
    this.snapshot = { ...this.snapshot, settings: { ...this.snapshot.settings, ...settings } }
    setRuleProfileByPreset(this.snapshot.settings.rulePreset)
    this.commit()
  }

  public recordRound (winner: Team, wasFirst: boolean, bombCount: number, recent?: Omit<RecentMatch, 'finishedAt' | 'winnerTeam'>): void {
    const previous = this.snapshot.playerStats
    const myTeam: Team = this.snapshot.myPlayerId === 'p1' || this.snapshot.myPlayerId === 'p3' ? 'teamA' : 'teamB'
    const didWin = winner === myTeam
    const campaign = this.snapshot.gameMode === 'campaign' && this.snapshot.campaignProgress
      ? { ...this.snapshot.campaignProgress, wins: this.snapshot.campaignProgress.wins + Number(didWin), losses: this.snapshot.campaignProgress.losses + Number(!didWin) }
      : this.snapshot.campaignProgress
    if (campaign) { campaign.completed = campaign.wins >= campaign.targetWins; campaign.failed = campaign.losses >= 2 }
    this.snapshot = {
      ...this.snapshot,
      playerStats: { ...previous, gamesPlayed: previous.gamesPlayed + 1, wins: previous.wins + Number(didWin), bombsPlayed: previous.bombsPlayed + bombCount, firstPlaceFinishes: previous.firstPlaceFinishes + Number(wasFirst), elo: Math.max(0, previous.elo + (didWin ? 16 : -12)) },
      campaignProgress: campaign,
      recentMatch: recent ? { finishedAt: Date.now(), winnerTeam: winner, ...recent } : this.snapshot.recentMatch,
    }
    this.commit()
  }

  private restore (): void {
    try {
      const raw = sys.localStorage.getItem(storageKey)
      if (raw) {
        const saved = JSON.parse(raw) as Partial<SessionSnapshot>
        const base = defaults()
        this.snapshot = {
          ...base,
          ...saved,
          difficulty: APPLICATION_AI_DIFFICULTY,
          // Route/room/round status is transient and cannot be restored without
          // a matching engine or server snapshot.
          status: 'menu',
          isMultiplayer: false,
          roomId: null,
          myPlayerId: 'p1',
          dealerId: null,
          settings: {
            ...base.settings,
            ...(saved.settings ?? {}),
            voicePack: saved.settings?.voicePack === 'male' ? 'male' : 'female',
          },
        }
      }
    } catch { this.snapshot = defaults() }
    setRuleProfileByPreset(this.snapshot.settings.rulePreset)
    this.events.emit('guandan:session', this.snapshot)
  }

  private commit (): void {
    sys.localStorage.setItem(storageKey, JSON.stringify(this.snapshot))
    this.events.emit('guandan:session', this.snapshot)
  }
}
