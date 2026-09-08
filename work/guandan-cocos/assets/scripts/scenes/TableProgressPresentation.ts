import type { PlayerId } from '../core/generated'
import type { GameSnapshot } from '../game/GameManager'

export type TableProgressPresentationDependencies = Readonly<{
  showToast: (message: string) => void
}>
const PLAYER_IDS: readonly PlayerId[] = ['p1', 'p2', 'p3', 'p4']

/** Presentation-only cursors: never changes game state, sends commands, or owns network listeners. */
export class TableProgressPresentation {
  private previousFinishedPlayers: PlayerId[] = []
  private readonly previousHandCounts = new Map<PlayerId, number>()

  public constructor (private readonly dependencies: TableProgressPresentationDependencies) {}

  public seedRecovery (state: GameSnapshot['state']): void {
    this.previousFinishedPlayers = [...state.finishedPlayers]
    this.previousHandCounts.clear()
    PLAYER_IDS.forEach(id => this.previousHandCounts.set(id, state.players[id].hand.length))
  }

  public reset (): void {
    this.previousFinishedPlayers = []
    this.previousHandCounts.clear()
  }

  public renderProgressNotifications (snapshot: GameSnapshot, humanId: PlayerId): void {
    if (snapshot.state.finishedPlayers.length < this.previousFinishedPlayers.length) {
      this.previousFinishedPlayers = []
      this.previousHandCounts.clear()
    }
    const newFinishers = snapshot.state.finishedPlayers.filter(id => !this.previousFinishedPlayers.includes(id))
    newFinishers.forEach(id => {
      const place = snapshot.state.finishedPlayers.indexOf(id)
      const rank = ['头游', '二游', '三游', '末游'][place] ?? '完成'
      const text = id === humanId ? `你已出完 · ${rank}` : `${snapshot.state.players[id].name} 已出完 · ${rank}`
      this.dependencies.showToast(text)
    })
    PLAYER_IDS.forEach(id => {
      const count = snapshot.state.players[id].hand.length
      const previous = this.previousHandCounts.get(id)
      if (id !== humanId && count > 0 && count <= 10 && previous !== undefined && previous > 10) {
        this.dependencies.showToast(`${snapshot.state.players[id].name} 仅剩 ${count} 张牌`)
      }
      this.previousHandCounts.set(id, count)
    })
    this.previousFinishedPlayers = [...snapshot.state.finishedPlayers]
  }

}
