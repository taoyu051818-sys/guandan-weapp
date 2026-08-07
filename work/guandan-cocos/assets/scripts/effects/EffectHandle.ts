export type EffectFinishReason =
  | 'completed'
  | 'skipped'
  | 'replaced'
  | 'recovery'
  | 'destroyed'
  | 'quality-off'
  | 'unavailable'
  | 'failed'

export type EffectCancelReason = Exclude<EffectFinishReason, 'completed'>
export type EffectCleanup = (reason: EffectFinishReason) => void
export type EffectFinishListener = (reason: EffectFinishReason) => void

/**
 * Owns the lifetime of one rendered effect.
 *
 * Renderers attach every tween/node/listener cleanup to this handle. Calling
 * cancel is therefore enough to skip an animation, recover a room or destroy
 * the scene without leaving transient state behind.
 */
export class EffectHandle {
  private active = true
  private reason: EffectFinishReason | null = null
  private readonly cleanups: EffectCleanup[] = []
  private readonly listeners = new Set<EffectFinishListener>()
  private resolveFinished!: (reason: EffectFinishReason) => void
  public readonly finished: Promise<EffectFinishReason>

  public constructor (cleanup?: EffectCleanup) {
    this.finished = new Promise(resolve => { this.resolveFinished = resolve })
    if (cleanup) this.cleanups.push(cleanup)
  }

  public get isActive (): boolean { return this.active }
  public get finishReason (): EffectFinishReason | null { return this.reason }

  /** Adds a finalizer and returns a function that detaches it. */
  public addCleanup (cleanup: EffectCleanup): () => void {
    if (!this.active) {
      try { cleanup(this.reason ?? 'destroyed') } catch { /* already final; remain best-effort */ }
      return () => {}
    }
    this.cleanups.push(cleanup)
    return () => {
      const index = this.cleanups.indexOf(cleanup)
      if (index >= 0) this.cleanups.splice(index, 1)
    }
  }

  /** Subscribes once for completion/cancellation and returns an unsubscribe. */
  public onFinish (listener: EffectFinishListener): () => void {
    if (!this.active) {
      listener(this.reason ?? 'destroyed')
      return () => {}
    }
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  public complete (): void { this.finish('completed') }

  public cancel (reason: EffectCancelReason = 'skipped'): void { this.finish(reason) }

  protected finish (reason: EffectFinishReason): void {
    if (!this.active) return
    this.active = false
    this.reason = reason

    // Last registered is normally the most dependent resource, so unwind it
    // first. One broken finalizer must not prevent the remaining cleanup.
    for (let index = this.cleanups.length - 1; index >= 0; index -= 1) {
      try { this.cleanups[index](reason) } catch { /* best-effort cleanup */ }
    }
    this.cleanups.length = 0
    this.listeners.forEach(listener => {
      try { listener(reason) } catch { /* listeners cannot break finalization */ }
    })
    this.listeners.clear()
    this.resolveFinished(reason)
  }

  public static completed (reason: EffectFinishReason = 'completed'): EffectHandle {
    const handle = new EffectHandle()
    handle.finish(reason)
    return handle
  }
}

/** A parent handle that applies completion and cancellation to all children. */
export class CompositeEffectHandle extends EffectHandle {
  private readonly children = new Set<EffectHandle>()

  public constructor (children: Iterable<EffectHandle> = []) {
    super()
    for (const child of children) this.add(child)
  }

  public get childCount (): number { return this.children.size }

  public add<T extends EffectHandle> (handle: T): T {
    if (!this.isActive) {
      const reason = this.finishReason
      if (reason === 'completed') handle.complete()
      else handle.cancel(reason ?? 'destroyed')
      return handle
    }
    if (!handle.isActive) return handle
    this.children.add(handle)
    handle.onFinish(() => this.children.delete(handle))
    return handle
  }

  public remove (handle: EffectHandle, cancel = false): boolean {
    const removed = this.children.delete(handle)
    if (removed && cancel) handle.cancel('skipped')
    return removed
  }

  public clear (reason: EffectCancelReason = 'skipped'): void {
    const children = Array.from(this.children)
    this.children.clear()
    children.forEach(child => child.cancel(reason))
  }

  public override complete (): void {
    const children = Array.from(this.children)
    this.children.clear()
    children.forEach(child => child.complete())
    super.complete()
  }

  public override cancel (reason: EffectCancelReason = 'skipped'): void {
    const children = Array.from(this.children)
    this.children.clear()
    children.forEach(child => child.cancel(reason))
    super.cancel(reason)
  }
}
