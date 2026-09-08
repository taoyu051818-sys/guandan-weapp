/** Pending announcements are latest-action-wins, not a backlog that delays the next turn. */
export class ActionVoiceGate {
  private revision = 0

  public constructor (private readonly now: () => number = () => Date.now(),
    private readonly maxAgeMs = 1800) {}

  public begin (): () => boolean {
    const revision = ++this.revision
    const deadline = this.now() + this.maxAgeMs
    return () => revision === this.revision && this.now() <= deadline
  }

  public invalidate (): void { this.revision += 1 }
}
