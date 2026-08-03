import { _decorator, Component } from 'cc'
import { createDeck, shuffleDeck } from '../core/generated'
import type { Card, PlayerId, Rank } from '../core/generated'

export type GroupingResult = { draws: Record<PlayerId, Card>, dealerId: PlayerId, teamA: PlayerId[], teamB: PlayerId[] }

const { ccclass } = _decorator
const ids: PlayerId[] = ['p1', 'p2', 'p3', 'p4']

/** Implements the desktop “摸牌定庄” phase with real cards, not display-only randomness. */
@ccclass('GroupingController')
export class GroupingController extends Component {
  public draw (level: Rank = 2): GroupingResult {
    const deck = shuffleDeck(createDeck(level))
    const red = deck.filter(card => card.suit === 'heart' || card.suit === 'diamond')
    const black = deck.filter(card => card.suit === 'spade' || card.suit === 'club')
    const draws: Record<PlayerId, Card> = { p1: red[0], p2: black[0], p3: red[1], p4: black[1] }
    const dealerId = ids.reduce((leader, id) => draws[id].value > draws[leader].value ? id : leader, 'p1' as PlayerId)
    return { draws, dealerId, teamA: ['p1', 'p3'], teamB: ['p2', 'p4'] }
  }
}
