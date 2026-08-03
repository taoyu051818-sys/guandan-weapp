import { _decorator, Component, EventTarget, sys } from 'cc'
import type { PlayerId, Rank, Team } from '../core/generated'
import type { Difficulty } from '../core/generated/lib/ai'
import { setRuleProfileByPreset } from '../core/generated/lib/rules'

export type GameMode = 'standard' | 'double_open' | 'campaign'
export type SessionStatus = 'menu' | 'grouping' | 'dealing' | 'playing' | 'tribute' | 'settlement' | 'lobby'

export type SessionSettings = {
  soundEnabled: boolean
  volume: number
  bgmEnabled: boolean
  bgmVolume: number
  sortOrder: 'asc' | 'desc'
  rulePreset: 'classic' | 'tournament'
  visualTheme: 'luxury' | 'compact'
}

export type PlayerStats = { gamesPlayed: number, wins: number, bombsPlayed: number, firstPlaceFinishes: number, elo: number }

export type SessionSnapshot = {
  status: SessionStatus
  gameMode: GameMode
  isMultiplayer: boolean
  roomId: string | null
  myPlayerId: PlayerId
  difficulty: Difficulty
  currentLevel: Rank
  dealerId: PlayerId | null
  teamLevels: Record<Team, Rank>
  settings: SessionSettings
  playerStats: PlayerStats
}

const { ccclass } = _decorator
const storageKey = 'guandan-cocos-session-v1'

const defaults = (): SessionSnapshot => ({
  status: 'menu', gameMode: 'standard', isMultiplayer: false, roomId: null, myPlayerId: 'p1',
  difficulty: 'medium', currentLevel: 2, dealerId: null,
  teamLevels: { teamA: 2, teamB: 2 },
  settings: { soundEnabled: true, volume: 0.5, bgmEnabled: true, bgmVolume: 0.3, sortOrder: 'desc', rulePreset: 'classic', visualTheme: 'luxury' },
  playerStats: { gamesPlayed: 0, wins: 0, bombsPlayed: 0, firstPlaceFinishes: 0, elo: 1000 },
})

/** Cocos replacement for the desktop Zustand application store. */
@ccclass('GameSession')
export class GameSession extends Component {
  public readonly events = new EventTarget()
  public snapshot: SessionSnapshot = defaults()

  protected onLoad (): void { this.restore() }

  public beginLocalGame (difficulty: Difficulty, mode: GameMode = 'standard'): void {
    this.snapshot = { ...this.snapshot, status: 'grouping', difficulty, gameMode: mode, isMultiplayer: false, roomId: null, myPlayerId: 'p1', dealerId: null }
    this.commit()
  }

  public setDifficulty (difficulty: Difficulty): void { this.snapshot = { ...this.snapshot, difficulty }; this.commit() }

  public enterLobby (): void { this.snapshot = { ...this.snapshot, status: 'lobby', isMultiplayer: true }; this.commit() }
  public joinRoom (roomId: string, myPlayerId: PlayerId): void { this.snapshot = { ...this.snapshot, status: 'lobby', isMultiplayer: true, roomId, myPlayerId }; this.commit() }
  public beginNetworkGrouping (): void { this.snapshot = { ...this.snapshot, status: 'grouping' }; this.commit() }
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

  public recordRound (winner: Team, wasFirst: boolean, bombCount: number): void {
    const previous = this.snapshot.playerStats
    const didWin = winner === 'teamA'
    this.snapshot = { ...this.snapshot, playerStats: { ...previous, gamesPlayed: previous.gamesPlayed + 1, wins: previous.wins + Number(didWin), bombsPlayed: previous.bombsPlayed + bombCount, firstPlaceFinishes: previous.firstPlaceFinishes + Number(wasFirst), elo: Math.max(0, previous.elo + (didWin ? 16 : -12)) } }
    this.commit()
  }

  private restore (): void {
    try {
      const raw = sys.localStorage.getItem(storageKey)
      if (raw) this.snapshot = { ...defaults(), ...JSON.parse(raw) as Partial<SessionSnapshot> }
    } catch { this.snapshot = defaults() }
    this.events.emit('guandan:session', this.snapshot)
  }

  private commit (): void {
    sys.localStorage.setItem(storageKey, JSON.stringify(this.snapshot))
    this.events.emit('guandan:session', this.snapshot)
  }
}
