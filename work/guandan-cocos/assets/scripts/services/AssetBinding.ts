import type { AssetLease } from './LeasedAssetCache'

/** One visual consumer; clears the old sprite before releasing its lease. */
export class AssetBinding<T> {
  private key: string | null = null
  private lease: AssetLease<T> | null = null
  private revision = 0
  public constructor (private readonly render: (value: T | null) => void) {}
  public update (key: string, acquire: () => AssetLease<T> | null): void {
    if (this.key === key) return
    this.clear()
    this.key = key
    const revision = this.revision
    this.lease = acquire()
    void this.lease?.ready.then(value => {
      if (revision === this.revision) this.render(value)
    })
  }
  public clear (): void {
    this.revision++
    this.key = null
    this.render(null)
    this.lease?.release()
    this.lease = null
  }
}
