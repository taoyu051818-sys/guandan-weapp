import { Node, Tween, Vec3, tween } from 'cc'
import { EffectHandle, type EffectCancelReason } from './EffectHandle'
import type { ShakeStrength } from './EffectTypes'

export type CardBlastReactionTarget = Readonly<{
  /** Stable semantic key used for deterministic timing and motion variation. */
  key: string
  /** A dedicated identity transform; never pass a layout-owned card node. */
  node: Node
}>

export type CardBlastReactionRequest = Readonly<{
  impactWorldPosition: Vec3
  strength: ShakeStrength
}>

type BlastMotion = Readonly<{
  lift: number
  spread: number
  tilt: number
  riseSeconds: number
  returnSeconds: number
  staggerSeconds: number
  airborneScale: number
}>

const MOTION: Readonly<Record<Exclude<ShakeStrength, 'none'>, BlastMotion>> = Object.freeze({
  light: Object.freeze({ lift: 22, spread: 6, tilt: 3.5, riseSeconds: 0.09, returnSeconds: 0.17, staggerSeconds: 0.004, airborneScale: 1.015 }),
  medium: Object.freeze({ lift: 34, spread: 10, tilt: 5.5, riseSeconds: 0.11, returnSeconds: 0.21, staggerSeconds: 0.006, airborneScale: 1.025 }),
  strong: Object.freeze({ lift: 50, spread: 16, tilt: 8, riseSeconds: 0.13, returnSeconds: 0.25, staggerSeconds: 0.008, airborneScale: 1.04 }),
})

const stableHash = (value: string): number => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const commitIdentity = (node: Node): void => {
  if (!node.isValid) return
  node.setPosition(Vec3.ZERO)
  node.setScale(Vec3.ONE)
  node.setRotationFromEuler(0, 0, 0)
}

const resetReactionNode = (node: Node): void => {
  if (!node.isValid) return
  Tween.stopAllByTarget(node)
  commitIdentity(node)
}

/**
 * Owns transient card motion independently from card layout and selection.
 * A new blast replaces the previous one so every cleanup path returns wrappers
 * to identity before another authoritative table render can observe them.
 */
export class CardBlastReaction {
  private activeHandle: EffectHandle | null = null

  public play (targets: readonly CardBlastReactionTarget[], request: CardBlastReactionRequest): EffectHandle {
    this.cancel('replaced')
    if (request.strength === 'none') return EffectHandle.completed('quality-off')

    const unique = new Map<Node, CardBlastReactionTarget>()
    targets.forEach(target => {
      if (target.node.isValid && target.node.activeInHierarchy && !unique.has(target.node)) unique.set(target.node, target)
    })
    const visible = Array.from(unique.values())
    if (!visible.length) return EffectHandle.completed('unavailable')

    const motion = MOTION[request.strength]
    const touched = new Set(visible.map(target => target.node))
    const handle = new EffectHandle(() => { touched.forEach(resetReactionNode) })
    this.activeHandle = handle
    handle.onFinish(() => {
      if (this.activeHandle === handle) this.activeHandle = null
    })

    let completed = 0
    visible.forEach(target => {
      const node = target.node
      resetReactionNode(node)
      const hash = stableHash(target.key)
      const world = node.worldPosition
      const deltaX = world.x - request.impactWorldPosition.x
      const side = Math.abs(deltaX) > 1 ? Math.sign(deltaX) : (hash & 1) === 0 ? -1 : 1
      const liftVariation = 0.88 + ((hash >>> 4) % 25) / 100
      const spreadVariation = 0.72 + ((hash >>> 9) % 37) / 100
      const tiltVariation = 0.72 + ((hash >>> 14) % 35) / 100
      const delay = (hash % 7) * motion.staggerSeconds
      const airborne = new Vec3(side * motion.spread * spreadVariation, motion.lift * liftVariation, 0)

      tween(node)
        .delay(delay)
        .to(motion.riseSeconds, {
          position: airborne,
          scale: new Vec3(motion.airborneScale, motion.airborneScale, 1),
          angle: -side * motion.tilt * tiltVariation,
        }, { easing: 'quadOut' })
        .to(motion.returnSeconds, {
          position: Vec3.ZERO,
          scale: Vec3.ONE,
          angle: 0,
        }, { easing: 'backOut' })
        .call(() => {
          if (!handle.isActive) return
          commitIdentity(node)
          completed += 1
          if (completed === visible.length) handle.complete()
        })
        .start()
    })
    return handle
  }

  public cancel (reason: EffectCancelReason = 'skipped'): void {
    const handle = this.activeHandle
    this.activeHandle = null
    if (handle?.isActive) handle.cancel(reason)
  }
}
