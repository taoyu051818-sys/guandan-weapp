import { Color, Vec3, type Label } from 'cc'
import type { PlayerId } from '../core/generated'
import type { GameSnapshot } from '../game/GameManager'
import type { LobbySnapshot, NetworkDeadlineAction } from '../network/LobbyController'
import type { TableGameHud } from '../ui/TableGameHud'
import { projectTurnClock, type TableTurnClockProjection } from './TableTurnClockProjection'
export type { TableTurnClockProjection } from './TableTurnClockProjection'
export interface TableTurnClockControllerDependencies {
  label: Label
  tableHud: () => TableGameHud | null
  isMultiplayer: () => boolean
  lobbySnapshot: () => LobbySnapshot | null
  playCountdown: (seconds: number) => void
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

const ACTION_LABELS: Readonly<Record<Exclude<NetworkDeadlineAction, 'play'>, string>> = {
  tribute: '进贡',
  returnTribute: '还贡',
  finishTribute: '开始本局',
}

/** Owns the table turn clock state, server-deadline projection and tick lifecycle. */
export class TableTurnClockController {
  private remainingSeconds = 0
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
    const countdownY = update.controlsY + 47
    this.dependencies.label.node.setPosition(new Vec3(0, countdownY, 0))
    this.renderClock(false)
  }

  project (snapshot: GameSnapshot, humanId: PlayerId): TableTurnClockProjection {
    return projectTurnClock(snapshot, humanId, this.dependencies.lobbySnapshot(),
      !this.disposed && this.snapshot !== null && this.dependencies.isMultiplayer(), this.now())
  }

  reset (): void {
    if (this.disposed) return
    this.remainingSeconds = 0
    this.snapshot = null
    this.dependencies.label.node.active = false
    this.dependencies.label.string = ''
    this.dependencies.tableHud()?.update({ turnVisible: false, turnSeconds: 0 })
  }

  dispose (): void {
    if (this.disposed) return
    this.reset()
    this.disposed = true
    this.dependencies.unschedule(this.tick)
  }

  private readonly tick = (): void => {
    this.renderClock(true)
  }

  private renderClock (warn: boolean): void {
    if (this.disposed || !this.snapshot) return
    // One lobby/time sample drives both the label and HUD, even across a deadline boundary.
    const lobby = this.dependencies.lobbySnapshot()
    const clock = projectTurnClock(this.snapshot, this.humanId, lobby,
      this.dependencies.isMultiplayer(), this.now())
    const label = this.dependencies.label
    label.node.active = clock.turnVisible
    const previous = this.remainingSeconds
    this.remainingSeconds = clock.turnSeconds
    if (warn && clock.turnVisible && this.remainingSeconds !== previous
      && this.remainingSeconds > 0 && this.remainingSeconds <= 5) {
      this.dependencies.playCountdown(this.remainingSeconds)
    }
    const deadlinePlayerId = lobby?.deadlinePlayerId
    const deadlineAction = lobby?.deadlineAction
    if (!clock.turnVisible) label.string = ''
    else if (deadlinePlayerId && deadlineAction && deadlineAction !== 'play') {
      const playerName = this.snapshot.state.players[deadlinePlayerId]?.name ?? deadlinePlayerId
      label.string = `${playerName} · ${ACTION_LABELS[deadlineAction]} ${this.remainingSeconds}s`
    } else label.string = `${this.remainingSeconds}s`
    label.color = this.remainingSeconds <= 5 ? new Color(255, 126, 96) : new Color(245, 224, 156)
    this.dependencies.tableHud()?.update(clock)
  }
  private now (): number {
    return this.dependencies.now?.() ?? Date.now()
  }
}
