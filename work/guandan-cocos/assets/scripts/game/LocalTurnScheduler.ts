import type { LocalMatchVersion } from './LocalMatchController'

export type LocalTurnScheduleOnce = (callback: () => void, delaySeconds: number) => void

/** Invalidates delayed local work at both lifecycle and authoritative state boundaries. */
export class LocalTurnScheduler {
  private generation = 0

  public constructor (private readonly scheduleOnce: LocalTurnScheduleOnce) {}

  public cancel (): void { this.generation += 1 }

  public schedule (
    expected: LocalMatchVersion,
    isCurrent: (version: LocalMatchVersion) => boolean,
    callback: () => void,
    delaySeconds: number,
  ): void {
    const generation = ++this.generation
    this.scheduleOnce(() => {
      if (generation !== this.generation || !isCurrent(expected)) return
      callback()
    }, delaySeconds)
  }
}
