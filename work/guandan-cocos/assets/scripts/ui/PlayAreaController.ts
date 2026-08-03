import { _decorator, Component, Node, UITransform, Vec3 } from 'cc'
import type { PlayAction, PlayerId } from '../core/generated'
import { CardView } from './CardView'

const { ccclass } = _decorator
const places: Record<PlayerId, Vec3> = { p1: new Vec3(0, -72, 0), p2: new Vec3(290, 0, 0), p3: new Vec3(0, 112, 0), p4: new Vec3(-290, 0, 0) }

/** Displays each seat's newest action, including pass prompts and played-card fans. */
@ccclass('PlayAreaController')
export class PlayAreaController extends Component {
  private actionNodes = new Map<PlayerId, Node>()

  public render (actions: PlayAction[]): void {
    const latest = new Map<PlayerId, PlayAction>()
    actions.slice(-4).forEach(action => latest.set(action.playerId, action))
    ;(['p1', 'p2', 'p3', 'p4'] as PlayerId[]).forEach(id => {
      const action = latest.get(id)
      const old = this.actionNodes.get(id)
      if (!action) { old?.destroy(); this.actionNodes.delete(id); return }
      old?.destroy()
      const root = new Node(`play-${id}`)
      root.parent = this.node
      root.setPosition(places[id])
      root.addComponent(UITransform).setContentSize(250, 120)
      this.actionNodes.set(id, root)
      if (action.type === 'Pass') {
        const text = root.addComponent(CardView)
        text.bind({ id: `pass-${id}`, rank: '不', suit: '出', red: false, selected: false, interactive: false })
        return
      }
      const spacing = Math.min(43, 215 / Math.max(1, action.cards.length - 1))
      action.cards.forEach((card, index) => {
        const node = new Node(`played-${card.id}`)
        node.parent = root
        node.setPosition(new Vec3((index - (action.cards.length - 1) / 2) * spacing, 0, index))
        const view = node.addComponent(CardView)
        view.bind({ id: card.id, rank: card.suit === 'joker' ? (card.rank === 'Big' ? '大王' : '小王') : String(card.rank), suit: card.suit === 'spade' ? '♠' : card.suit === 'heart' ? '♥' : card.suit === 'club' ? '♣' : '♦', red: card.suit === 'heart' || card.suit === 'diamond', selected: false, interactive: false })
      })
    })
  }
}
