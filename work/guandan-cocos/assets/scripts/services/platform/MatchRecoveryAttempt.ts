import { createEntryAttemptId, isEntryAttemptId, type EntryAttemptIdFactory } from '../../network/LobbyEntryAttempt'

/** Keeps one recovery identity stable from platform request through WebSocket acknowledgement. */
export class MatchRecoveryAttemptTracker {
  private activeAttemptId: string | null = null

  public constructor (private readonly createId: EntryAttemptIdFactory = createEntryAttemptId) {}

  public current (): string {
    if (this.activeAttemptId) return this.activeAttemptId
    const created = this.createId()
    if (!isEntryAttemptId(created)) throw new Error('恢复随机凭证格式无效')
    this.activeAttemptId = created
    return created
  }

  public complete (attemptId: string): boolean { return this.clear(attemptId) }

  public abandon (attemptId: string): boolean { return this.clear(attemptId) }

  private clear (attemptId: string): boolean {
    if (!isEntryAttemptId(attemptId) || this.activeAttemptId !== attemptId) return false
    this.activeAttemptId = null
    return true
  }
}
