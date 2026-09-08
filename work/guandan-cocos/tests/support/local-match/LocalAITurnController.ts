import type { PlayerId } from '../../../assets/scripts/core/generated'
import type { Difficulty } from '../../../assets/scripts/core/generated'
import {
  type LocalAIEngine,
  type LocalMatchOperationResult,
  LocalMatchController,
} from './LocalMatchController'
import { LocalTurnScheduler, type LocalTurnScheduleOnce } from './LocalTurnScheduler'

export type LocalAITurnPorts = Readonly<{
  humanId: PlayerId
  difficulty: Difficulty
  publishHint: (hint: string) => void
  commit: (result: LocalMatchOperationResult) => void
  failureHint: (reason: string) => string
}>

const MAX_AI_TURN_ATTEMPTS = 3

/** Owns delayed AI work and its injected per-match engine outside the Cocos adapter. */
export class LocalAITurnController {
  private readonly scheduler: LocalTurnScheduler
  private disposed = false

  public constructor (
    private readonly match: LocalMatchController,
    private readonly aiEngine: LocalAIEngine | undefined,
    scheduleOnce: LocalTurnScheduleOnce,
    private readonly ports: LocalAITurnPorts,
  ) {
    this.scheduler = new LocalTurnScheduler(scheduleOnce)
  }

  public runNext (delaySeconds = 0.72): void {
    if (this.disposed || this.match.state.phase !== 'playing') return
    const playerId = this.match.state.currentTurn
    if (playerId === this.ports.humanId) {
      this.ports.publishHint('轮到你出牌')
      return
    }
    this.ports.publishHint(`${this.match.state.players[playerId].name} 正在思考…`)
    this.scheduleTurn(playerId, delaySeconds)
  }

  public dispose (): void {
    if (this.disposed) return
    this.disposed = true
    this.scheduler.cancel()
    if (this.aiEngine?.dispose) this.aiEngine.dispose()
    else this.aiEngine?.reset?.()
  }

  private scheduleTurn (playerId: PlayerId, delaySeconds: number, attempt = 1): void {
    const expected = this.match.version
    this.scheduler.schedule(expected, version => !this.disposed && this.match.isCurrent(version), () => {
      if (this.match.state.phase !== 'playing' || this.match.state.currentTurn !== playerId) return
      try {
        const result = this.match.runAiTurn(playerId, this.ports.difficulty, this.aiEngine)
        if (!result.ok) throw new Error(this.ports.failureHint(result.reason))
        this.ports.commit(result)
      } catch (error) {
        this.ports.publishHint(error instanceof Error ? error.message : '电脑出牌失败')
        if (!this.disposed && this.match.isCurrent(expected) && attempt < MAX_AI_TURN_ATTEMPTS) {
          this.scheduleTurn(playerId, 0.25, attempt + 1)
        } else if (!this.disposed && this.match.isCurrent(expected)) {
          this.ports.publishHint('电脑出牌连续失败，请重新开局')
        }
        return
      }
      this.runNext()
    }, delaySeconds)
  }
}
