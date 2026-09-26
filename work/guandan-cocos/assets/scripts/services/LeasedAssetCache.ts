export type AssetLease<T> = Readonly<{ ready: Promise<T | null>, release: () => void }>
type Entry<T> = { users: number, pending: boolean, value: T | null, ready: Promise<T | null>, retired: boolean }

/** Active consumers pin assets. Only idle entries are evicted; late loads stay owned. */
export class LeasedAssetCache<T> {
  private readonly entries = new Map<string, Entry<T>>()
  public constructor (private readonly idleLimit: number, private readonly destroy: (value: T) => void) {}
  public acquire (key: string, load: () => Promise<T | null>): AssetLease<T> {
    let entry = this.entries.get(key)
    if (!entry) {
      entry = { users: 0, pending: true, value: null, ready: Promise.resolve(null), retired: false }
      const current = entry
      this.entries.set(key, current)
      current.ready = Promise.resolve().then(load).catch(() => null).then(value => {
        current.pending = false
        current.value = value
        if (!value) {
          if (this.entries.get(key) === current) this.entries.delete(key)
          current.retired = true
        }
        this.disposeRetired(current)
        this.trim()
        return value
      })
    }
    entry.users++
    this.entries.delete(key)
    this.entries.set(key, entry)
    const current = entry
    let released = false
    return {
      ready: current.ready.then(value => released ? null : value),
      release: () => {
        if (released) return
        released = true
        current.users--
        this.disposeRetired(current)
        this.trim()
      },
    }
  }
  /** Active leases remain valid even when the scene resets the cache. */
  public clear (): void {
    for (const entry of this.entries.values()) { entry.retired = true; this.disposeRetired(entry) }
    this.entries.clear()
  }
  private trim (): void {
    let idle = Array.from(this.entries.values()).filter(entry => !entry.users).length
    for (const [key, entry] of this.entries) {
      if (idle <= this.idleLimit) break
      if (entry.users) continue
      this.entries.delete(key)
      entry.retired = true
      this.disposeRetired(entry)
      idle--
    }
  }
  private disposeRetired (entry: Entry<T>): void {
    if (!entry.retired || entry.users || entry.pending || !entry.value) return
    const value = entry.value
    entry.value = null
    this.destroy(value)
  }
}
