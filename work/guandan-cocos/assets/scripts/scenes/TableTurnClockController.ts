import { Color, Vec3, type Label } from 'cc'
import type { PlayerId } from '../core/generated'
import type { GameSnapshot } from '../game/GameManager'
import type { LobbySnapshot, NetworkDeadlineAction } from '../network/LobbyController'
import type { TableGameHud, TableGameHudSeatPlace, TableGameHudState } from '../ui/TableGameHud'

export type TableTurnClockProjection = Pick<
  TableGameHudState,
  'turnVisible' | 'turnSeconds' | 'turnDurationSeconds' | 'turnPlace'
>

export interface TableTurnClockControllerDependencies {
  label: Label
  tableHud: () => TableGameHud | null
  isMultiplayer: () => boolean
  lobbySnapshot: () => LobbySnapshot | null
  playCountdown: (seconds: number) => void
  actOnLocalTimeout: () => void
  schedule: (callback: () => void, intervalSeconds: number) => void
  unschedule: (callback: () => void) => void
  now?: () => number
}

export interface TableTurnClockUpdate {
  snapshot: GameSnapshot
  humanId: PlayerId
  humanFinished: boolean
  controlsY: number
}

const DEFAULT_TURN_SECONDS = 20
const PLAYER_ORDER: readonly PlayerId[] = ['p1', 'p2', 'p3', 'p4']
const PLAYER_PLACES: readonly TableGameHudSeatPlace[] = ['bottom', 'right', 'top', 'left']
const ACTION_LABELS: Readonly<Record<Exclude<NetworkDeadlineAction, 'play'>, string>> = {
  tribute: '进贡',
  returnTribute: '还贡',
  finishTribute: '开始本局',
}

/** Owns the table turn clock state, server-deadline projection and tick lifecycle. */
export class TableTurnClockController {
  private remainingSeconds = DEFAULT_TURN_SECONDS
  private countdownKey = ''
  private snapshot: GameSnapshot | null = null
  private humanId: PlayerId = 'p1'
  private disposed = false

  constructor (private readonly dependencies: TableTurnClockControllerDependencies) {
    dependencies.schedule(this.tick, 1)
  }

  update (update: TableTurnClockUpdate): void {
    if (this.disposed) return
    this.snapshot = update.snapshot
    this.humanId = update.humanId
    const multiplayer = this.dependencies.isMultiplayer()
    const lobby = this.dependencies.lobbySnapshot()
    const networkReady = !multiplayer || lobby?.roomStatus === 'ready'
    const networkDeadlineAvailable = Boolean(
      multiplayer &&
      networkReady &&
      !lobby?.matchEnded &&
      !update.snapshot.actionPending &&
      (update.snapshot.phase === 'playing' || update.snapshot.phase === 'tribute') &&
      lobby?.turnDeadlineAt &&
      lobby.deadlinePlayerId &&
      lobby.deadlineAction,
    )
    const available = multiplayer
      ? networkDeadlineAvailable
      : networkReady && !update.snapshot.actionPending && update.snapshot.phase === 'playing' &&
        !update.humanFinished && update.snapshot.state.currentTurn === update.humanId

    this.dependencies.label.node.active = available
    if (!available) {
      this.countdownKey = ''
      this.syncHud()
      return
    }

    if (multiplayer) {
      const deadline = lobby?.turnDeadlineAt
      if (!deadline) {
        this.dependencies.label.node.active = false
        this.countdownKey = ''
        this.syncHud()
        return
      }
      this.countdownKey = `server:${deadline}`
      this.remainingSeconds = Math.max(0, Math.ceil((deadline - this.now()) / 1000))
    } else {
      const snapshot = update.snapshot
      const key = `${snapshot.phase}:${snapshot.state.currentTurn}:${snapshot.state.playArea.length}:${snapshot.state.finishedPlayers.length}`
      if (key !== this.countdownKey) {
        this.countdownKey = key
        this.remainingSeconds = DEFAULT_TURN_SECONDS
      }
    }

    const countdownY = update.controlsY + 47
    this.dependencies.label.node.setPosition(new Vec3(0, countdownY, 0))
    this.refreshLabel()
  }

  project (snapshot: GameSnapshot, humanId: PlayerId): TableTurnClockProjection {
    const multiplayer = this.dependencies.isMultiplayer()
    const lobby = this.dependencies.lobbySnapshot()
    const networkClockVisible = Boolean(
      multiplayer &&
      lobby?.roomStatus === 'ready' &&
      !lobby.matchEnded &&
      !snapshot.actionPending &&
      lobby.turnDeadlineAt &&
      lobby.deadlinePlayerId &&
      lobby.deadlineAction &&
      this.dependencies.label.node.active,
    )
    const turnVisible = multiplayer
      ? networkClockVisible
      : Boolean(this.dependencies.label.node.active) || (snapshot.phase === 'playing' && !snapshot.actionPending)
    return {
      turnVisible,
      turnSeconds: turnVisible ? (this.dependencies.label.node.active ? this.remainingSeconds : this.durationSeconds()) : 0,
      turnDurationSeconds: this.durationSeconds(),
      turnPlace: this.turnPlace(snapshot, humanId),
    }
  }

  reset (): void {
    if (this.disposed) return
    this.countdownKey = ''
    this.remainingSeconds = DEFAULT_TURN_SECONDS
    this.snapshot = null
    this.dependencies.label.node.active = false
  }

  dispose (): void {
    if (this.disposed) return
    this.disposed = true
    this.dependencies.unschedule(this.tick)
    this.dependencies.label.node.active = false
    this.snapshot = null
  }

  private readonly tick = (): void => {
    if (this.disposed || !this.dependencies.label.node.active || this.remainingSeconds <= 0) return
    if (this.dependencies.isMultiplayer()) {
      const deadline = this.dependencies.lobbySnapshot()?.turnDeadlineAt
      if (!deadline) {
        this.dependencies.label.node.active = false
        this.syncHud()
        return
      }
      const previous = this.remainingSeconds
      this.remainingSeconds = Math.max(0, Math.ceil((deadline - this.now()) / 1000))
      if (this.remainingSeconds !== previous) this.playWarningTick()
      this.refreshLabel()
      return
    }

    this.remainingSeconds -= 1
    this.playWarningTick()
    this.refreshLabel()
    if (this.remainingSeconds === 0) this.dependencies.actOnLocalTimeout()
  }

  private playWarningTick (): void {
    if (this.remainingSeconds > 0 && this.remainingSeconds <= 5) {
      this.dependencies.playCountdown(this.remainingSeconds)
    }
  }

  private refreshLabel (): void {
    const label = this.dependencies.label
    const lobby = this.dependencies.lobbySnapshot()
    const deadlinePlayerId = lobby?.deadlinePlayerId
    const deadlineAction = lobby?.deadlineAction
    if (this.dependencies.isMultiplayer() && deadlinePlayerId && deadlineAction && deadlineAction !== 'play') {
      const playerName = this.snapshot?.state.players[deadlinePlayerId].name ?? deadlinePlayerId
      label.string = `${playerName} · ${ACTION_LABELS[deadlineAction]} ${this.remainingSeconds}s`
    } else label.string = `${this.remainingSeconds}s`
    label.color = this.remainingSeconds <= 5 ? new Color(255, 126, 96) : new Color(245, 224, 156)
    this.syncHud()
  }

  private syncHud (): void {
    if (!this.snapshot) return
    this.dependencies.tableHud()?.update(this.project(this.snapshot, this.humanId))
  }

  private durationSeconds (): number {
    return this.dependencies.isMultiplayer()
      ? (this.dependencies.lobbySnapshot()?.roomSettings?.turnSeconds ?? DEFAULT_TURN_SECONDS)
      : DEFAULT_TURN_SECONDS
  }

  private turnPlace (snapshot: GameSnapshot, humanId: PlayerId): TableGameHudSeatPlace {
    const deadlinePlayerId = this.dependencies.lobbySnapshot()?.deadlinePlayerId
    const activePlayerId = this.dependencies.isMultiplayer() && deadlinePlayerId
      ? deadlinePlayerId
      : snapshot.state.currentTurn
    return PLAYER_PLACES[(PLAYER_ORDER.indexOf(activePlayerId) - PLAYER_ORDER.indexOf(humanId) + 4) % 4]
  }

  private now (): number {
    return this.dependencies.now?.() ?? Date.now()
  }
}
