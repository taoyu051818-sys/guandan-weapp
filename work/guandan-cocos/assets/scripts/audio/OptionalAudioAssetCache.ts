type Cancel = () => void
type Loaded<T> = (error: Error | null, clip: T | null) => void
type Pending<T> = { listeners: Array<(clip: T | null) => void>, attempt: number, cancel?: Cancel }
type CacheClock = { now: () => number, later: (callback: () => void, ms: number) => Cancel }

const clock: CacheClock = {
  now: () => Date.now(),
  later: (callback, ms) => { const timer = setTimeout(callback, ms); return () => clearTimeout(timer) },
}
const RETRY_DELAYS = [500, 1500] as const
const RETRY_COOLDOWN_MS = 5000

/** Unknown/network errors are recoverable. Only explicit missing-file evidence is permanent. */
export const isMissingAudioAsset = (error: Error | null): boolean => {
  if (!error) return true // loader completed successfully but supplied no asset
  const code = (error as Error & { code?: string | number }).code
  if (code === 'ASSET_LOAD_TIMEOUT' || code === 'ASSET_LOAD_CANCELLED') return false
  return code === 'ENOENT' || code === 'ASSET_NOT_FOUND' || code === 404 || code === '404' ||
    /\b404\b|(?:asset|resource|file)[^\n]*(?:not found|does not exist)|bundle[^\n]*doesn't contain/i.test(error.message)
}

/** Owns optional clip loads, bounded retry and disposal; no Cocos or playback decisions. */
export class OptionalAudioAssetCache<T> {
  private readonly clips = new Map<string, T>()
  private readonly failures = new Map<string, number>()
  private readonly pending = new Map<string, Pending<T>>()
  private disposed = false

  public constructor (private readonly load: (path: string, done: Loaded<T>) => Cancel,
    private readonly time: CacheClock = clock) {}

  public peek (path: string): T | undefined { return this.clips.get(path) }

  public get (path: string, done: (clip: T | null) => void): void {
    if (this.disposed) return
    const cached = this.clips.get(path)
    if (cached) { done(cached); return }
    if (this.time.now() < (this.failures.get(path) ?? -Infinity)) { done(null); return }
    const current = this.pending.get(path)
    if (current) { current.listeners.push(done); return }
    const entry: Pending<T> = { listeners: [done], attempt: 0 }
    this.pending.set(path, entry)
    this.attempt(path, entry)
  }

  public dispose (): void {
    if (this.disposed) return
    this.disposed = true
    const pending = Array.from(this.pending.values())
    this.pending.clear()
    this.clips.clear()
    this.failures.clear()
    // Invalidate first: cancelling GameAssetLoader synchronously invokes its callback.
    for (const entry of pending) { entry.listeners.length = 0; entry.cancel?.() }
  }

  private attempt (path: string, entry: Pending<T>): void {
    if (this.disposed || this.pending.get(path) !== entry) return
    entry.cancel = undefined
    let settled = false
    const finish: Loaded<T> = (error, clip) => {
      if (settled || this.disposed || this.pending.get(path) !== entry) return
      settled = true
      entry.cancel = undefined
      if (!error && clip) {
        this.clips.set(path, clip)
        this.failures.delete(path)
      } else {
        const missing = isMissingAudioAsset(error)
        const cancelled = (error as (Error & { code?: string }) | null)?.code === 'ASSET_LOAD_CANCELLED'
        const delay = RETRY_DELAYS[entry.attempt++]
        if (!missing && !cancelled && delay !== undefined) {
          entry.cancel = this.time.later(() => this.attempt(path, entry), delay)
          return
        }
        this.failures.set(path, missing ? Infinity : this.time.now() + RETRY_COOLDOWN_MS)
      }
      this.pending.delete(path)
      const listeners = entry.listeners.splice(0)
      for (const listener of listeners) { if (!this.disposed) listener(error ? null : clip) }
    }
    try {
      const cancel = this.load(path, finish)
      // Cache hits may complete synchronously; do not overwrite a retry timer's cancel handle.
      if (!settled) entry.cancel = cancel
    } catch (error) { finish(error instanceof Error ? error : new Error(String(error)), null) }
  }
}
