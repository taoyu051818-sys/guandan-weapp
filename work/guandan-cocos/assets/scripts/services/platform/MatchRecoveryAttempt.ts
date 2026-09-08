import { createEntryAttemptIdAsync, isEntryAttemptId, type AsyncEntryAttemptIdFactory } from '../../network/LobbyEntryAttempt'

/** Keeps one recovery identity stable from platform request through WebSocket acknowledgement. */
export class MatchRecoveryAttemptTracker {
  private activeAttemptId: string | null = null
  private pendingId: Promise<string> | null = null

  public constructor (private readonly createId: AsyncEntryAttemptIdFactory = createEntryAttemptIdAsync) {}

  public current (): Promise<string> {
    if (this.activeAttemptId) return Promise.resolve(this.activeAttemptId)
    if (!this.pendingId) {
      this.pendingId = Promise.resolve().then(() => this.createId()).then(created => {
        if (!isEntryAttemptId(created)) throw new Error('恢复随机凭证格式无效')
        this.activeAttemptId = created
        return created
      }).finally(() => { this.pendingId = null })
    }
    return this.pendingId
  }

  public complete (attemptId: string): boolean { return this.clear(attemptId) }

  public abandon (attemptId: string): boolean { return this.clear(attemptId) }

  private clear (attemptId: string): boolean {
    if (!isEntryAttemptId(attemptId) || this.activeAttemptId !== attemptId) return false
    this.activeAttemptId = null
    return true
  }
}
