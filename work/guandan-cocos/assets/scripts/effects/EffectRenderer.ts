import type { EffectHandle } from './EffectHandle'
import type { EffectRenderContext } from './EffectRenderContext'

/** A renderer translates one semantic profile into cancellable presentation. */
export interface EffectRenderer {
  supports?: (context: EffectRenderContext) => boolean
  /** Loads every asset required for a visible impact before its projectile starts. */
  prepare?: (context: EffectRenderContext) => Promise<boolean>
  render: (context: EffectRenderContext) => EffectHandle
  dispose?: () => void
}
