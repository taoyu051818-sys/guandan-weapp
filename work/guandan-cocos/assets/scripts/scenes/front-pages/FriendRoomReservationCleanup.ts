/** Tracks room ownership independently of response order and page visibility. */
export class FriendRoomReservationCleanup {
  private pendingRequests = 0
  private readonly retained = new Set<string>()
  private readonly handedOff = new Set<string>()
  private readonly pending = new Set<string>()
  private readonly cancelling = new Map<string, Promise<void>>()

  public constructor (
    private readonly cancel: (matchId: string) => Promise<void>,
    private readonly onFailure: () => void,
  ) {}

  public beginRequest (): Promise<void> | null {
    // Do not start a new admission while a previous explicit release is in flight.
    this.retry()
    this.pendingRequests += 1
    return this.cancelling.size ? Promise.all(Array.from(this.cancelling.values())).then(() => {}) : null
  }

  public endRequest (): void {
    this.pendingRequests -= 1
    this.retry()
  }

  public retain (matchId: string): void {
    this.retained.add(matchId)
    this.pending.delete(matchId)
  }

  public handoff (matchId: string): void {
    this.handedOff.add(matchId)
    this.retain(matchId)
  }

  public abandon (matchId: string): void {
    if (!matchId || this.retained.has(matchId) || this.handedOff.has(matchId)) return
    this.pending.add(matchId)
    this.retry()
  }

  public release (matchId: string): void {
    if (this.handedOff.has(matchId)) return
    this.retained.delete(matchId)
    this.abandon(matchId)
  }

  public retry (): void {
    // An unresolved admission can return the same idempotent reservation. Wait
    // until it has a chance to adopt the room before compensating old responses.
    if (this.pendingRequests) return
    for (const matchId of this.pending) {
      if (this.retained.has(matchId) || this.cancelling.has(matchId)) continue
      const operation = Promise.resolve().then(() => this.cancel(matchId)).then(() => {
        this.pending.delete(matchId)
      })
      this.cancelling.set(matchId, operation)
      void operation.then(
        () => { this.cancelling.delete(matchId) },
        () => { this.cancelling.delete(matchId); this.onFailure() },
      )
    }
  }
}
