import { EffectHandle, type EffectCancelReason } from './EffectHandle'
import type { EffectRenderContext } from './EffectRenderContext'
import type { EffectRenderer } from './EffectRenderer'
import { isRejectedNonCommercialEffectKey } from './ArchivedPlayVisuals'

export type EffectRendererRegistrationOptions = Readonly<{
  /** Replacing a renderer is explicit so duplicate setup cannot go unnoticed. */
  replace?: boolean
}>

/** Maps semantic profile keys to renderers and owns all live render handles. */
export class EffectRendererRegistry {
  private readonly renderers = new Map<string, EffectRenderer>()
  private readonly active = new Set<EffectHandle>()
  private readonly allowedKeys: ReadonlySet<string> | null
  private fallback: EffectRenderer | null = null

  public constructor (allowedKeys?: readonly string[]) {
    this.allowedKeys = allowedKeys ? new Set(this.normalizeKeys(allowedKeys)) : null
  }

  public get size (): number { return this.renderers.size }
  public get activeCount (): number { return this.active.size }

  public register (keys: string | readonly string[], renderer: EffectRenderer, options: EffectRendererRegistrationOptions = {}): () => void {
    const normalized = this.normalizeKeys(keys)
    const rejected = normalized.filter(key => !this.isAllowed(key))
    if (rejected.length) throw new Error(`Effect renderer key is not commercially approved: ${rejected.join(', ')}`)
    normalized.forEach(key => {
      const existing = this.renderers.get(key)
      if (existing && existing !== renderer && !options.replace) throw new Error(`Effect renderer already registered: ${key}`)
    })
    normalized.forEach(key => this.renderers.set(key, renderer))

    let registered = true
    return () => {
      if (!registered) return
      registered = false
      normalized.forEach(key => {
        if (this.renderers.get(key) === renderer) this.renderers.delete(key)
      })
    }
  }

  public unregister (key: string, renderer?: EffectRenderer): boolean {
    const normalized = key.trim()
    if (!this.isAllowed(normalized)) return false
    const current = this.renderers.get(normalized)
    if (!current || (renderer && renderer !== current)) return false
    return this.renderers.delete(normalized)
  }

  public setFallback (renderer: EffectRenderer | null): void { this.fallback = renderer }

  public resolve (key: string): EffectRenderer | null {
    const normalized = key.trim()
    return this.isAllowed(normalized) ? this.renderers.get(normalized) ?? this.fallback : null
  }

  public keys (): string[] { return Array.from(this.renderers.keys()) }

  /** Prepares a renderer without creating nodes, so impact audio cannot outrun cold assets. */
  public async prepare (context: EffectRenderContext): Promise<boolean> {
    if (context.quality === 'off' || context.profile.key === 'none' || !this.isAllowed(context.profile.key)) return false
    const renderer = this.resolve(context.profile.key)
    if (!renderer) return true
    try {
      if (renderer.supports && !renderer.supports(context)) return false
      return renderer.prepare ? await renderer.prepare(context) : true
    } catch (error) {
      context.services?.reportError?.(context.profile.key, error)
      return false
    }
  }

  /** Renders and tracks one effect. Missing/off effects finish silently. */
  public render (context: EffectRenderContext): EffectHandle {
    if (context.quality === 'off' || context.profile.key === 'none') return EffectHandle.completed('quality-off')
    const renderer = this.resolve(context.profile.key)
    if (!renderer) return EffectHandle.completed('unavailable')

    let handle: EffectHandle
    try {
      if (renderer.supports && !renderer.supports(context)) return EffectHandle.completed('unavailable')
      handle = renderer.render(context)
    } catch (error) {
      context.services?.reportError?.(context.profile.key, error)
      return EffectHandle.completed('failed')
    }

    this.active.add(handle)
    handle.onFinish(() => this.active.delete(handle))
    return handle
  }

  public cancelAll (reason: EffectCancelReason = 'skipped'): void {
    const handles = Array.from(this.active)
    this.active.clear()
    handles.forEach(handle => handle.cancel(reason))
  }

  /** Cancels active work, disposes each renderer once, then removes mappings. */
  public clear (reason: EffectCancelReason = 'destroyed'): void {
    this.cancelAll(reason)
    const unique = new Set(this.renderers.values())
    if (this.fallback) unique.add(this.fallback)
    unique.forEach(renderer => {
      try { renderer.dispose?.() } catch { /* best-effort teardown */ }
    })
    this.renderers.clear()
    this.fallback = null
  }

  private normalizeKeys (keys: string | readonly string[]): string[] {
    const normalized = (typeof keys === 'string' ? [keys] : keys).map(key => key.trim()).filter(Boolean)
    if (!normalized.length) throw new Error('At least one non-empty effect key is required')
    // Cocos' legacy web target does not downlevel spread over Set iterators
    // correctly. Keep this as Array.from so keys remain strings at runtime.
    return Array.from(new Set(normalized))
  }

  private isAllowed (key: string): boolean {
    if (isRejectedNonCommercialEffectKey(key)) return false
    return !this.allowedKeys || this.allowedKeys.has(key)
  }
}
