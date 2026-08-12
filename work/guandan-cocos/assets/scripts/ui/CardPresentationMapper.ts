import type { Card } from '../core/generated'
import type { ClassicCardSuit } from './CardSkinResolver'

export type CardFacePresentation = Readonly<{
  rank: string
  suit: ClassicCardSuit
  red: boolean
  levelCard: boolean
}>

/** One canonical conversion from rule cards to every visible card face. */
export function mapCardToPresentation (card: Card): CardFacePresentation {
  if (card.suit === 'joker') {
    const big = card.rank === 'Big'
    return { rank: big ? 'Big' : 'Small', suit: 'joker', red: big, levelCard: false }
  }
  return {
    rank: String(card.rank),
    suit: card.suit,
    red: card.suit === 'heart' || card.suit === 'diamond',
    levelCard: card.isLevelCard,
  }
}
