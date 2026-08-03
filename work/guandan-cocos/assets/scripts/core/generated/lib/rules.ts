import { Card, PlayType, PlayAction, Rank, Suit } from '../types/game';

export interface RuleProfile {
  allowA2345Straight: boolean;
  straightFlushAsBomb: boolean;
  enableTripleWithPair: boolean;
}

const RULE_PRESETS: Record<'classic' | 'tournament', RuleProfile> = {
  classic: {
    allowA2345Straight: true,
    straightFlushAsBomb: true,
    enableTripleWithPair: true,
  },
  tournament: {
    allowA2345Straight: false,
    straightFlushAsBomb: false,
    enableTripleWithPair: true,
  },
};

let currentRuleProfile: RuleProfile = RULE_PRESETS.classic;

export const setRuleProfileByPreset = (preset: 'classic' | 'tournament') => {
  currentRuleProfile = RULE_PRESETS[preset];
};

export const getRuleProfile = () => currentRuleProfile;

// 获取卡牌的值，包含A可以作为1的情况
export const getFaceValue = (card: Card, isAceAsOne: boolean = false): number => {
  if (card.rank === 'A' && isAceAsOne) return 1;
  // 对于模拟牌（id以sim或mock开头），在目前的逻辑中，它模拟的面值就是它的 value
  if (card.id.startsWith('sim') || card.id.startsWith('mock')) {
     if (card.value === 14 && isAceAsOne) return 1; // 允许逢人配模拟 A 并作为 1
     return card.value; 
  }
  // 对于真实的牌，我们需要它的原始面值，忽略级牌被提升到15的影响
  const RANK_VALUES: Record<string, number> = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
    'J': 11, 'Q': 12, 'K': 13, 'A': 14
  };
  return RANK_VALUES[card.rank.toString()] || card.value;
};

// 统计各点数出现的次数 (用于普通牌型，基于比较价值)
const getRankCounts = (cards: Card[]) => {
  const counts: Record<number, number> = {};
  cards.forEach(c => {
    const v = c.value;
    counts[v] = (counts[v] || 0) + 1;
  });
  return Object.entries(counts)
    .map(([val, count]) => ({ value: Number(val), count }))
    .sort((a, b) => b.count - a.count || b.value - a.value); // 按数量降序，然后按点数降序
};

// 统计各面值出现的次数 (用于顺子、连对、钢板等连续牌型)
export const getFaceRankCounts = (cards: Card[]) => {
  const counts: Record<number, number> = {};
  cards.forEach(c => {
    const v = getFaceValue(c);
    counts[v] = (counts[v] || 0) + 1;
  });
  return Object.entries(counts)
    .map(([val, count]) => ({ value: Number(val), count }))
    .sort((a, b) => a.value - b.value); 
};

// 非红桃级牌（主牌）不能参与顺子/连对/钢板等连续牌型
const hasPlainLevelCard = (cards: Card[]) =>
  cards.some((c) => c.isLevelCard && !c.isRedJoker);

// 判断是否是顺子
const isStraight = (cards: Card[], profile: RuleProfile): { isValid: boolean, maxValue: number } => {
  if (cards.length !== 5) return { isValid: false, maxValue: 0 };
  if (hasPlainLevelCard(cards)) return { isValid: false, maxValue: 0 };
  
  // 检查A作为14的情况
  const sorted = [...cards].sort((a, b) => getFaceValue(a) - getFaceValue(b));
  let isValid = true;
  for (let i = 0; i < 4; i++) {
    if (getFaceValue(sorted[i + 1]) - getFaceValue(sorted[i]) !== 1) {
      isValid = false;
      break;
    }
  }
  // 顺子最大的牌不能超过 A (14)。如果包含了模拟牌 value=15，会被拒绝。
  if (isValid && getFaceValue(sorted[4]) <= 14) {
     return { isValid: true, maxValue: getFaceValue(sorted[4]) };
  }

  // 检查A作为1的情况（由规则预设控制）
  if (!profile.allowA2345Straight) return { isValid: false, maxValue: 0 };

  const sortedAceAsOne = [...cards].sort((a, b) => getFaceValue(a, true) - getFaceValue(b, true));
  isValid = true;
  for (let i = 0; i < 4; i++) {
    if (getFaceValue(sortedAceAsOne[i + 1], true) - getFaceValue(sortedAceAsOne[i], true) !== 1) {
      isValid = false;
      break;
    }
  }
  if (isValid && getFaceValue(sortedAceAsOne[4], true) <= 14) {
     return { isValid: true, maxValue: getFaceValue(sortedAceAsOne[4], true) };
  }

  return { isValid: false, maxValue: 0 };
};

// 检查是否是连续的N个M张
const isConsecutive = (cards: Card[], length: number, countPerRank: number) => {
  if (hasPlainLevelCard(cards)) return { isValid: false, maxValue: 0 };
  const faceRankCounts = getFaceRankCounts(cards);
  if (faceRankCounts.length !== length) return { isValid: false, maxValue: 0 };
  if (!faceRankCounts.every(r => r.count === countPerRank)) return { isValid: false, maxValue: 0 };
  
  for(let i = 0; i < length - 1; i++) {
    if (faceRankCounts[i + 1].value - faceRankCounts[i].value !== 1) return { isValid: false, maxValue: 0 };
  }
  // 最大值不能超过 14 (A)
  if (faceRankCounts[length - 1].value > 14) return { isValid: false, maxValue: 0 };

  return { isValid: true, maxValue: faceRankCounts[length - 1].value };
}

// 原始的基础判断逻辑（不考虑逢人配）
const getBasePlayInfo = (cards: Card[], profile: RuleProfile): { type: PlayType; maxValue: number, length?: number } | null => {
  const len = cards.length;
  const rankCounts = getRankCounts(cards);

  // 单牌
  if (len === 1) return { type: PlayType.Single, maxValue: rankCounts[0].value };

  // 对子
  if (len === 2 && rankCounts[0].count === 2) {
    return { type: PlayType.Pair, maxValue: rankCounts[0].value };
  }

  // 三不带
  if (len === 3 && rankCounts[0].count === 3) {
    return { type: PlayType.Triple, maxValue: rankCounts[0].value };
  }

  // 火箭 (4张王)
  if (len === 4 && cards.every(c => c.suit === 'joker')) {
    return { type: PlayType.Rocket, maxValue: 10000 }; 
  }

  // 炸弹 (4张及以上同点数)
  if (len >= 4 && rankCounts[0].count === len) {
    return { type: PlayType.Bomb, maxValue: len * 1000 + rankCounts[0].value, length: len };
  }

  // 三带一对
  if (profile.enableTripleWithPair && len === 5 && rankCounts.length === 2) {
    if (
      (rankCounts[0].count === 3 && rankCounts[1].count === 2) ||
      (rankCounts[0].count === 2 && rankCounts[1].count === 3)
    ) {
      const tripleValue = rankCounts.find(r => r.count === 3)!.value;
      return { type: PlayType.TripleWithPair, maxValue: tripleValue };
    }
  }

  // 顺子 与 同花顺
  if (len === 5) {
    const straightInfo = isStraight(cards, profile);
    if (straightInfo.isValid) {
      const isFlush = cards.every(c => c.suit === cards[0].suit);
      if (isFlush && profile.straightFlushAsBomb) {
        return { type: PlayType.StraightFlush, maxValue: 5500 + straightInfo.maxValue };
      }
      return { type: PlayType.Straight, maxValue: straightInfo.maxValue };
    }
  }

  // 三连对
  if (len === 6) {
    const cons = isConsecutive(cards, 3, 2);
    if (cons.isValid) return { type: PlayType.Tube, maxValue: cons.maxValue };
  }

  // 钢板
  if (len === 6) {
    const cons = isConsecutive(cards, 2, 3);
    if (cons.isValid) return { type: PlayType.Plate, maxValue: cons.maxValue };
  }

  return null;
};

export const getPlayInfos = (cards: Card[]): { type: PlayType; maxValue: number, length?: number }[] => {
  if (cards.length === 0) return [];

  const wildcards = cards.filter(c => c.isRedJoker);
  const normalCards = cards.filter(c => !c.isRedJoker);

  if (wildcards.length === 0 || normalCards.length === 0) {
    const info = getBasePlayInfo(cards, currentRuleProfile);
    return info ? [info] : [];
  }

  const validInfos: Map<string, ReturnType<typeof getBasePlayInfo>> = new Map();

  const tryAddInfo = (simulatedCards: Card[]) => {
    const info = getBasePlayInfo(simulatedCards, currentRuleProfile);
    if (info) {
      const key = `${info.type}-${info.maxValue}`;
      if (!validInfos.has(key)) {
        validInfos.set(key, info);
      }
    }
  };

  const suits: Suit[] = ['spade', 'heart', 'club', 'diamond'];
  const allValues = [2,3,4,5,6,7,8,9,10,11,12,13,14,15]; // 2到级牌

  if (wildcards.length === 1) {
    for (const v of allValues) {
      for (const s of suits) {
        const simCard: Card = { id: 'sim', suit: s, rank: '2' as Rank, value: v, isLevelCard: false, isRedJoker: false };
        tryAddInfo([...normalCards, simCard]);
      }
    }
  } else if (wildcards.length === 2) {
    for (const v1 of allValues) {
      for (const s1 of suits) {
        for (const v2 of allValues) {
          for (const s2 of suits) {
            const simCard1: Card = { id: 'sim1', suit: s1, rank: '2' as Rank, value: v1, isLevelCard: false, isRedJoker: false };
            const simCard2: Card = { id: 'sim2', suit: s2, rank: '2' as Rank, value: v2, isLevelCard: false, isRedJoker: false };
            tryAddInfo([...normalCards, simCard1, simCard2]);
          }
        }
      }
    }
  }

  return Array.from(validInfos.values()).filter(info => info !== null) as { type: PlayType; maxValue: number, length?: number }[];
};

export const getPlayInfo = (cards: Card[]): { type: PlayType; maxValue: number, length?: number } | null => {
  const infos = getPlayInfos(cards);
  if (infos.length === 0) return null;
  
  // 优先返回炸弹/同花顺等高级牌型
  const bomb = infos.find(i => i.type === PlayType.Bomb || i.type === PlayType.StraightFlush || i.type === PlayType.Rocket);
  if (bomb) {
    // 找最大的炸弹
    return infos.filter(i => i.type === PlayType.Bomb || i.type === PlayType.StraightFlush || i.type === PlayType.Rocket)
                .reduce((prev, current) => (prev.maxValue > current.maxValue) ? prev : current);
  }

  // 对于普通牌型（如三带二，顺子等），如果有多种可能（因为逢人配模拟出不同的合法组合）
  // 必须返回 maxValue 最大的那种组合，否则逢人配可能会被错误地当做小牌
  return infos.reduce((prev, current) => (prev.maxValue > current.maxValue) ? prev : current);
};

export const canPlay = (
  cards: Card[],
  lastPlay: PlayAction | null
): boolean => {
  const myInfos = getPlayInfos(cards);
  if (myInfos.length === 0) return false;

  if (!lastPlay || lastPlay.type === PlayType.Pass) return true;

  const lastPlayInfos = getPlayInfos(lastPlay.cards);
  if (lastPlayInfos.length === 0) return false; 
  
  // 我们只取上家当时打出的具体类型，但是由于 lastPlay 里面存了 type，我们可以直接用 lastPlay.type 和 lastPlay 的 maxValue
  // 但为了安全，我们重新解析 lastPlay.cards 中符合 lastPlay.type 的 info
  const validLastInfos = lastPlayInfos.filter(i => i.type === lastPlay.type);
  const lastPlayInfo = validLastInfos.length > 0 
    ? validLastInfos.reduce((prev, current) => (prev.maxValue > current.maxValue) ? prev : current)
    : lastPlayInfos[0];

  for (const playInfo of myInfos) {
    if (playInfo.type === PlayType.Rocket) return true;

    const isPlayBombType = playInfo.type === PlayType.Bomb || playInfo.type === PlayType.StraightFlush;
    const isLastBombType = lastPlayInfo.type === PlayType.Bomb || lastPlayInfo.type === PlayType.StraightFlush;

    if (isPlayBombType && !isLastBombType && lastPlayInfo.type !== PlayType.Rocket) {
      return true;
    }

    if (isPlayBombType && isLastBombType) {
      if (playInfo.maxValue > lastPlayInfo.maxValue) return true;
    }

    if (playInfo.type === lastPlayInfo.type) {
      // Includes Single, Pair, Triple, TripleWithPair, etc.
      if (cards.length === lastPlay.cards.length && playInfo.maxValue > lastPlayInfo.maxValue) {
        return true;
      }
    }
  }

  return false;
};
