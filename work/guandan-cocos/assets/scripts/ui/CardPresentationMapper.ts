import type { Card } from '../core/generated'

export type CardFacePresentation = Readonly<{
  rank: string
  suit: string
  red: boolean
}>

const SUIT_GLYPHS = Object.freeze({
  spade: '♠',
  heart: '♥',
  club: '♣',
  diamond: '♦',
} as const)

/** One canonical conversion from rule cards to every visible card face. */
export function mapCardToPresentation (card: Card): CardFacePresentation {
  if (card.suit === 'joker') {
    const big = card.rank === 'Big'
    return { rank: big ? '大王' : '小王', suit: '王', red: big }
  }
  return {
    rank: String(card.rank),
    suit: SUIT_GLYPHS[card.suit],
    red: card.suit === 'heart' || card.suit === 'diamond',
  }
}
