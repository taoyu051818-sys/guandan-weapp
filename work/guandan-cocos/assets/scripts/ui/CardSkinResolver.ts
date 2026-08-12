export type ClassicCardSuit = 'spade' | 'heart' | 'club' | 'diamond' | 'joker'

export type CardSkinInput = {
  rank: string
  suit: ClassicCardSuit
  red: boolean
}

export type ClassicCardPlan = {
  key: string
  background: string
  cornerRank?: string
  cornerSuit?: string
  center?: string
  joker?: string
}

const RANK_NUMBER: Readonly<Record<string, number>> = {
  A: 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  J: 11,
  Q: 12,
  K: 13,
}

/** Complete 37-file manifest used by the table bootstrap preloader. */
export const ALL_CLASSIC_CARD_ASSET_NAMES: readonly string[] = Object.freeze([
  'bg_front',
  'black_joker',
  'red_joker',
  'num_black_1',
  'num_black_2',
  'num_black_3',
  'num_black_4',
  'num_black_5',
  'num_black_6',
  'num_black_7',
  'num_black_8',
  'num_black_9',
  'num_black_10',
  'num_black_11',
  'num_black_12',
  'num_black_13',
  'num_red_1',
  'num_red_2',
  'num_red_3',
  'num_red_4',
  'num_red_5',
  'num_red_6',
  'num_red_7',
  'num_red_8',
  'num_red_9',
  'num_red_10',
  'num_red_11',
  'num_red_12',
  'num_red_13',
  'shape_spade',
  'shape_spade_s',
  'shape_heart',
  'shape_heart_s',
  'shape_club',
  'shape_club_s',
  'shape_diamond',
  'shape_diamond_s',
])

/**
 * Resolves presentation data to the small set of composited classic-card
 * textures. It deliberately knows nothing about input, hand layout or game
 * state so changing a skin cannot alter selection behaviour.
 */
export function resolveClassicCardPlan (card: CardSkinInput): ClassicCardPlan | null {
  const suit = card.suit

  if (suit === 'joker') {
    if (card.rank !== 'Big' && card.rank !== 'Small') return null
    return {
      key: `joker:${card.rank}`,
      background: 'bg_front',
      joker: card.rank === 'Big' ? 'red_joker' : 'black_joker',
    }
  }

  if (suit !== 'spade' && suit !== 'heart' && suit !== 'club' && suit !== 'diamond') return null

  const number = RANK_NUMBER[card.rank]
  if (!number) return null
  const color = suit === 'heart' || suit === 'diamond' ? 'red' : 'black'
  return {
    key: `${suit}:${card.rank}`,
    background: 'bg_front',
    cornerRank: `num_${color}_${number}`,
    cornerSuit: `shape_${suit}_s`,
    center: `shape_${suit}`,
  }
}

export function classicCardAssetNames (plan: ClassicCardPlan): string[] {
  return [plan.background, plan.cornerRank, plan.cornerSuit, plan.center, plan.joker]
    .filter((asset): asset is string => Boolean(asset))
}
