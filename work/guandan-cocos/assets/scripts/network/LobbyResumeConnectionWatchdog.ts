const MAX_CONNECTION_FAILURES = 6
const RESUME_WATCHDOG_SECONDS = 30

export type LobbyResumeConnectionWatchdogDependencies = Readonly<{
  schedule: (callback: () => void, delaySeconds: number) => void
  onExhausted: (message: string) => void
}>

/** Bounds transport recovery for a persisted resume token until roomRejoined succeeds. */
export class LobbyResumeConnectionWatchdog {
  private generation = 0
  private failures = 0
  private active = false

  public constructor (private readonly dependencies: LobbyResumeConnectionWatchdogDependencies) {}

  public get pending (): boolean { return this.active }

  public start (): void {
    this.clear()
    this.active = true
    const generation = this.generation
    this.dependencies.schedule(() => {
      if (this.active && generation === this.generation) this.exhaust('本地牌局恢复超时，请重新连接')
    }, RESUME_WATCHDOG_SECONDS)
  }

  /** Returns true when this failure exhausted the active recovery cycle. */
  public recordFailure (): boolean {
    if (!this.active) return false
    this.failures += 1
    if (this.failures < MAX_CONNECTION_FAILURES) return false
    this.exhaust('本地牌局连接多次失败，请重新连接')
    return true
  }

  public clear (): void {
    this.generation += 1
    this.failures = 0
    this.active = false
  }

  private exhaust (message: string): void {
    if (!this.active) return
    this.active = false
    this.generation += 1
    this.dependencies.onExhausted(message)
  }
}
