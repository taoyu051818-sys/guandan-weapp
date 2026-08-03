import { Card, Suit, Rank } from '../types/game';

const SUITS: Suit[] = ['spade', 'heart', 'club', 'diamond'];
const RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 'J', 'Q', 'K', 'A'];

// 掼蛋基础点数映射，大王和小王单独处理，级牌在运行中会增加值
const RANK_VALUES: Record<Rank, number> = {
  2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10,
  'J': 11, 'Q': 12, 'K': 13, 'A': 14,
  'Small': 16, 'Big': 17
};

// 获取卡牌的基础点数大小
export const getBaseValue = (rank: Rank): number => {
  return RANK_VALUES[rank];
};

export const createDeck = (currentLevel: Rank): Card[] => {
  const deck: Card[] = [];
  let idCounter = 1;

  // 两副牌
  for (let i = 0; i < 2; i++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        const isLevelCard = rank === currentLevel;
        const isRedJoker = isLevelCard && (suit === 'heart'); // 逢人配
        
        let value = getBaseValue(rank);
        // 级牌大小仅次于小王(16)，设为15
        if (isLevelCard) {
          value = 15;
        } else if (value > getBaseValue(currentLevel)) {
          // 如果某张牌本来比级牌大（比如打2，那么3本来是3，不用变。但如果是打10，那JQK原本是11,12,13，级牌10变成了15，JQK不变。
          // 实际上掼蛋里级牌是15，A是14，K是13，所以其他牌的基础值不用动，只要把级牌抽出来变成15即可。
          // 唯一的例外是如果打A，A本来就是14，变成15。如果打2，2本来就是2，变成15，那么3~A还是3~14。
          // 为了逻辑严密，我们保持级牌永远是 15。
        }

        deck.push({
          id: `card-${idCounter++}`,
          suit,
          rank,
          value,
          isLevelCard,
          isRedJoker,
        });
      }
    }
    // 添加大小王
    deck.push({ id: `card-${idCounter++}`, suit: 'joker', rank: 'Small', value: RANK_VALUES['Small'], isLevelCard: false });
    deck.push({ id: `card-${idCounter++}`, suit: 'joker', rank: 'Big', value: RANK_VALUES['Big'], isLevelCard: false });
  }

  return deck;
};

export const shuffleDeck = (deck: Card[]): Card[] => {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

export const dealCards = (shuffledDeck: Card[]) => {
  const hands = {
    p1: [] as Card[],
    p2: [] as Card[],
    p3: [] as Card[],
    p4: [] as Card[],
  };

  shuffledDeck.forEach((card, index) => {
    if (index % 4 === 0) hands.p1.push(card);
    else if (index % 4 === 1) hands.p2.push(card);
    else if (index % 4 === 2) hands.p3.push(card);
    else hands.p4.push(card);
  });

  // 排序手牌 (从左到右: 从大到小排列，左边大牌，右边小牌)
  const sortHand = (hand: Card[]) => {
    return hand.sort((a, b) => b.value - a.value);
  };

  return {
    p1: sortHand(hands.p1),
    p2: sortHand(hands.p2),
    p3: sortHand(hands.p3),
    p4: sortHand(hands.p4),
  };
};
