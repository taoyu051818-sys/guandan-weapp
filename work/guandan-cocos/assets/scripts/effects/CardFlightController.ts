import { Node, UITransform, Vec3, tween } from 'cc'
import type { Card } from '../core/generated'
import { EffectHandle, type EffectCancelReason } from './EffectHandle'
import { EffectNodePool } from './EffectNodePool'
import { preloadVfxCardFrames } from './VfxCardSnapshot'

const quadraticPoint = (start: Vec3, control: Vec3, end: Vec3, t: number): Vec3 => {
  const inverse = 1 - t
  return new Vec3(
    inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
    inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y,
    start.z + (end.z - start.z) * t,
  )
}

/** Shared flight/static fan geometry so a landed card never jumps on handoff. */
export const resolvePlayedCardSpacing = (cardCount: number): number =>
  Math.min(42, 210 / Math.max(1, cardCount - 1))

export class CardFlightController {
  private readonly active = new Set<Node>()
  private readonly handles = new Set<EffectHandle>()

  public constructor (private readonly root: Node, private readonly pool: EffectNodePool) {}

  public get activeCount (): number { return this.active.size }

  public play (
    cards: Card[],
    sourceWorldPositions: Vec3[],
    targetWorldPosition: Vec3,
    durationMs: number,
    onArrive?: () => void,
    onCardArrive?: (card: Card, cardIndex: number) => void,
  ): EffectHandle {
    if (!cards.length || durationMs <= 0) return EffectHandle.completed('unavailable')
    const rootTransform = this.root.getComponent(UITransform)
    const local = (world: Vec3): Vec3 => rootTransform?.convertToNodeSpaceAR(world) ?? world.clone()
    const target = local(targetWorldPosition)
    const localNodes = new Set<Node>()
    const handle = new EffectHandle(() => {
      localNodes.forEach(node => {
        this.active.delete(node)
        this.pool.releaseCard(node)
      })
      localNodes.clear()
    })
    this.handles.add(handle)
    handle.onFinish(() => this.handles.delete(handle))
    void preloadVfxCardFrames(cards).then(ready => {
      if (!handle.isActive) return
      if (!ready) {
        handle.cancel('unavailable')
        return
      }
      let completed = 0
      cards.forEach((card, index) => {
        const node = this.pool.acquireCard(card)
        this.active.add(node)
        localNodes.add(node)
        node.parent = this.root
        const fallback = sourceWorldPositions[0] ?? targetWorldPosition
        const source = local(sourceWorldPositions[index] ?? fallback)
        const spread = resolvePlayedCardSpacing(cards.length)
        const end = new Vec3(target.x + (index - (cards.length - 1) / 2) * spread, target.y, index)
        const distance = Math.hypot(end.x - source.x, end.y - source.y)
        const arcHeight = Math.max(54, Math.min(150, distance * 0.24))
        const control = new Vec3((source.x + end.x) / 2, (source.y + end.y) / 2 + arcHeight, index + 1)
        node.setPosition(source)
        const startAngle = (index - (cards.length - 1) / 2) * 3
        node.setRotationFromEuler(0, 0, startAngle)
        const seconds = durationMs / 1000
        tween(node)
          .delay(index * 0.025)
          .parallel(
            tween().update(seconds, (targetNode, rawRatio) => {
              const ratio = rawRatio ?? 0
              const progress = (1 - Math.cos(Math.PI * ratio)) / 2
              targetNode.setPosition(quadraticPoint(source, control, end, progress))
              targetNode.setRotationFromEuler(0, 0, startAngle * (1 - progress))
            }),
            tween().to(seconds * 0.55, { scale: new Vec3(0.94, 0.94, 1) }, { easing: 'sineOut' })
              .to(seconds * 0.45, { scale: new Vec3(0.86, 0.86, 1) }, { easing: 'sineIn' }),
          )
          .call(() => {
            if (!handle.isActive) return
            this.active.delete(node)
            localNodes.delete(node)
            this.pool.releaseCard(node)
            try { onCardArrive?.(card, index) } catch { /* presentation callbacks cannot strand the flight */ }
            completed += 1
            if (completed === cards.length) {
              try { onArrive?.() } catch { /* impact failures cannot strand the presentation lane */ }
              finally { handle.complete() }
            }
          })
          .start()
      })
    }).catch(() => {
      if (!handle.isActive) return
      handle.cancel('failed')
    })
    return handle
  }

  public skipAll (reason: EffectCancelReason = 'skipped'): void {
    const handles = Array.from(this.handles)
    this.handles.clear()
    handles.forEach(handle => handle.cancel(reason))
    this.active.forEach(node => this.pool.releaseCard(node))
    this.active.clear()
  }
}
