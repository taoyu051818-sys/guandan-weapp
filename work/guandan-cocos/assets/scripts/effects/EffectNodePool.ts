import { Node, NodePool, Tween, UIOpacity, Vec3 } from 'cc'
import type { Card } from '../core/generated'
import { VfxCardSnapshot } from './VfxCardSnapshot'

/** Pool for transient card snapshots. Real hand nodes are never moved by effects. */
export class EffectNodePool {
  private readonly cards = new NodePool()

  public acquireCard (card: Card): Node {
    const node = this.cards.size() ? this.cards.get()! : this.createCard()
    node.active = true
    node.setScale(new Vec3(0.72, 0.72, 1))
    node.setRotationFromEuler(0, 0, 0)
    const opacity = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity)
    opacity.opacity = 255
    void node.getComponent(VfxCardSnapshot)?.bind(card)
    return node
  }

  public releaseCard (node: Node): void {
    if (!node.isValid) return
    Tween.stopAllByTarget(node)
    const opacity = node.getComponent(UIOpacity)
    if (opacity) Tween.stopAllByTarget(opacity)
    node.getComponent(VfxCardSnapshot)?.hide()
    this.cards.put(node)
  }

  public clear (): void { this.cards.clear() }

  private createCard (): Node {
    const node = new Node('EffectCardGhost')
    node.addComponent(VfxCardSnapshot).configure()
    return node
  }
}
