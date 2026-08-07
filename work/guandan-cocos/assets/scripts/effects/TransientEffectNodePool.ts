import { Node, NodePool, Tween, Vec3 } from 'cc'

export type TransientEffectNodePhase = 'acquire' | 'release'
export type TransientEffectNodeFactory = () => Node
export type TransientEffectNodeReset = (node: Node, phase: TransientEffectNodePhase) => void

type PoolRegistration = {
  pool: NodePool
  factory: TransientEffectNodeFactory
  reset: TransientEffectNodeReset
}

const defaultReset: TransientEffectNodeReset = (node, phase) => {
  node.active = phase === 'acquire'
  if (phase === 'acquire') {
    node.setPosition(Vec3.ZERO)
    node.setScale(Vec3.ONE)
    node.setRotationFromEuler(0, 0, 0)
  }
}

/** Keyed pools for short-lived labels, particles, masks and legacy sprites. */
export class TransientEffectNodePool {
  private readonly registrations = new Map<string, PoolRegistration>()
  private readonly active = new Map<Node, string>()

  public get activeCount (): number {
    this.pruneDestroyedActiveNodes()
    return this.active.size
  }

  public registerType (key: string, factory: TransientEffectNodeFactory, reset: TransientEffectNodeReset = defaultReset, replace = false): void {
    const normalized = this.normalizeKey(key)
    if (this.registrations.has(normalized)) {
      if (!replace) throw new Error(`Transient effect node type already registered: ${normalized}`)
      this.unregisterType(normalized)
    }
    this.registrations.set(normalized, { pool: new NodePool(), factory, reset })
  }

  public hasType (key: string): boolean { return this.registrations.has(key.trim()) }

  public acquire (key: string): Node {
    const normalized = this.normalizeKey(key)
    const registration = this.registrations.get(normalized)
    if (!registration) throw new Error(`Transient effect node type is not registered: ${normalized}`)

    let node = registration.pool.get()
    if (!node?.isValid) node = registration.factory()
    if (!node?.isValid) throw new Error(`Transient effect node factory returned an invalid node: ${normalized}`)
    this.active.set(node, normalized)
    try {
      registration.reset(node, 'acquire')
    } catch (error) {
      this.active.delete(node)
      node.destroy()
      throw error
    }
    return node
  }

  public tryAcquire (key: string): Node | null { return this.hasType(key) ? this.acquire(key) : null }

  public release (node: Node): boolean {
    const key = this.active.get(node)
    if (!key) return false
    this.active.delete(node)
    if (!node.isValid) return true

    const registration = this.registrations.get(key)
    this.stopNodeTree(node)
    if (!registration) { node.destroy(); return true }
    try {
      registration.reset(node, 'release')
      registration.pool.put(node)
    } catch {
      node.destroy()
    }
    return true
  }

  /** Stops and returns every live node while retaining the registered types. */
  public releaseAll (): void { Array.from(this.active.keys()).forEach(node => this.release(node)) }

  public pooledCount (key?: string): number {
    if (key !== undefined) return this.registrations.get(key.trim())?.pool.size() ?? 0
    let count = 0
    this.registrations.forEach(registration => { count += registration.pool.size() })
    return count
  }

  public unregisterType (key: string): boolean {
    const normalized = key.trim()
    const registration = this.registrations.get(normalized)
    if (!registration) return false
    Array.from(this.active.entries()).forEach(([node, activeKey]) => { if (activeKey === normalized) this.release(node) })
    registration.pool.clear()
    return this.registrations.delete(normalized)
  }

  /** Final teardown: cancels live nodes, destroys cached nodes and registrations. */
  public clear (): void {
    this.releaseAll()
    this.registrations.forEach(registration => registration.pool.clear())
    this.registrations.clear()
  }

  private stopNodeTree (node: Node): void {
    Tween.stopAllByTarget(node)
    node.components.forEach(component => Tween.stopAllByTarget(component))
    node.children.forEach(child => this.stopNodeTree(child))
  }

  private pruneDestroyedActiveNodes (): void {
    this.active.forEach((_, node) => { if (!node.isValid) this.active.delete(node) })
  }

  private normalizeKey (key: string): string {
    const normalized = key.trim()
    if (!normalized) throw new Error('Transient effect node type key cannot be empty')
    return normalized
  }
}
