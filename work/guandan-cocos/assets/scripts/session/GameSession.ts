import { _decorator, Component, EventTarget, sys } from 'cc'
import { getRuleProfile } from '../core/generated'
import type { PlayerId, RuleProfile, Team } from '../core/generated'
import {
  createDefaultSessionSnapshot,
  restoreSessionSnapshot,
  type RecentMatch,
  type SessionSettings,
  type SessionSnapshot,
} from './GameSessionModel'
export {
  SESSION_SCHEMA_VERSION,
  createDefaultSessionSnapshot,
  restoreSessionSnapshot,
} from './GameSessionModel'
export type {
  PlayerStats,
  RecentMatch,
  SessionSettings,
  SessionSnapshot,
  SessionStatus,
  VoicePack,
} from './GameSessionModel'

const { ccclass } = _decorator
const storageKey = 'guandan-cocos-session-v1'

/** Cocos replacement for the desktop Zustand application store. */
@ccclass('GameSession')
export class GameSession extends Component {
  public readonly events = new EventTarget()
  public snapshot: SessionSnapshot = createDefaultSessionSnapshot()

  /** Fallback for validating a hand before an authoritative rule profile arrives. */
  public get ruleProfile (): RuleProfile { return getRuleProfile(this.snapshot.settings.rulePreset) }

  protected onLoad (): void { this.restore() }

  public enterLobby (): void { this.snapshot = { ...this.snapshot, status: 'lobby', isMultiplayer: true }; this.commit() }
  public joinRoom (roomId: string, myPlayerId: PlayerId): void { this.snapshot = { ...this.snapshot, status: 'lobby', isMultiplayer: true, isObserver: false, roomId, myPlayerId }; this.commit() }
  public setRoomView (myPlayerId: PlayerId, isObserver: boolean): void { this.snapshot = { ...this.snapshot, myPlayerId, isObserver }; this.commit() }
  public leaveToMenu (): void {
    this.snapshot = {
      ...this.snapshot,
      status: 'menu',
      roomId: null,
      isMultiplayer: false,
      isObserver: false,
      currentLevel: 2,
      teamLevels: { teamA: 2, teamB: 2 },
      dealerId: null,
    }
    this.commit()
  }

  public beginPlay (): void { this.snapshot = { ...this.snapshot, status: 'playing' }; this.commit() }
  public beginTribute (): void { this.snapshot = { ...this.snapshot, status: 'tribute' }; this.commit() }
  public beginSettlement (): void { this.snapshot = { ...this.snapshot, status: 'settlement' }; this.commit() }

  public updateSettings (settings: Partial<SessionSettings>): void {
    this.snapshot = { ...this.snapshot, settings: { ...this.snapshot.settings, ...settings, voicePack: 'female' } }
    this.commit()
  }

  public recordRound (winner: Team, wasFirst: boolean, bombCount: number, recent?: Omit<RecentMatch, 'finishedAt' | 'winnerTeam'>, actualTeam?: Team): void {
    if (this.snapshot.isObserver) return
    const previous = this.snapshot.playerStats
    const myTeam: Team = actualTeam ?? (this.snapshot.myPlayerId === 'p1' || this.snapshot.myPlayerId === 'p3' ? 'teamA' : 'teamB')
    const didWin = winner === myTeam
    this.snapshot = {
      ...this.snapshot,
      ...(recent ? { currentLevel: recent.currentLevel, teamLevels: { ...recent.teamLevels } } : {}),
      playerStats: { ...previous, gamesPlayed: previous.gamesPlayed + 1, wins: previous.wins + Number(didWin), bombsPlayed: previous.bombsPlayed + Math.max(0, Math.floor(Number.isFinite(bombCount) ? bombCount : 0)), firstPlaceFinishes: previous.firstPlaceFinishes + Number(wasFirst), elo: Math.max(0, previous.elo + (didWin ? 16 : -12)) },
      recentMatch: recent ? { finishedAt: Date.now(), winnerTeam: winner, ...recent } : this.snapshot.recentMatch,
    }
    this.commit()
  }

  private restore (): void {
    try {
      const raw = sys.localStorage.getItem(storageKey)
      if (raw) this.snapshot = restoreSessionSnapshot(JSON.parse(raw))
    } catch { this.snapshot = createDefaultSessionSnapshot() }
    this.events.emit('guandan:session', this.snapshot)
  }

  private commit (): void {
    try {
      sys.localStorage.setItem(storageKey, JSON.stringify(this.snapshot))
    } catch (error) {
      console.warn('Unable to persist game session', error)
    }
    this.events.emit('guandan:session', this.snapshot)
  }
}
