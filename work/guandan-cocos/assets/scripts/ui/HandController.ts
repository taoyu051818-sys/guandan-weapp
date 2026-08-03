import { _decorator, Component, instantiate, Node, Prefab, Vec3 } from 'cc'
import type { Card } from '../core/generated'
import { CardView } from './CardView'

const { ccclass, property } = _decorator

@ccclass('HandController')
export class HandController extends Component {
  @property(Prefab)
  public cardPrefab: Prefab | null = null
  private cards = new Map<string, Node>()

  public render (hand: Card[], selectedCardIds: string[]): void {
    const ids = new Set(hand.map(card => card.id))
    this.cards.forEach((node, id) => { if (!ids.has(id)) { node.destroy(); this.cards.delete(id) } })
    const spacing = Math.min(68, 920 / Math.max(hand.length - 1, 1))
    const startX = -spacing * (hand.length - 1) / 2
    hand.forEach((card, index) => {
      let node = this.cards.get(card.id)
      if (!node) {
        node = this.cardPrefab ? instantiate(this.cardPrefab) : new Node(`card-${card.id}`)
        if (!node.getComponent(CardView)) node.addComponent(CardView)
        node.parent = this.node
        this.cards.set(card.id, node)
      }
      node.setPosition(new Vec3(startX + index * spacing, 0, index))
      node.getComponent(CardView)?.bind({
        id: card.id,
        rank: card.suit === 'joker' ? (card.rank === 'Big' ? '大王' : '小王') : String(card.rank),
        suit: card.suit === 'spade' ? '♠' : card.suit === 'heart' ? '♥' : card.suit === 'club' ? '♣' : card.suit === 'diamond' ? '♦' : '王',
        red: card.suit === 'heart' || card.suit === 'diamond',
        selected: selectedCardIds.includes(card.id),
      })
    })
  }
}
