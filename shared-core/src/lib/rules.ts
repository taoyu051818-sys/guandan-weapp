import { Card, PlayType, PlayAction, Rank, Suit, PlayResolution, WildcardUsage } from '../types/game';

export interface RuleProfile {
  readonly allowA2345Straight: boolean;
  readonly straightFlushAsBomb: boolean;
  readonly enableTripleWithPair: boolean;
}

export type RulePreset = 'classic' | 'tournament';

const freezeProfile = (profile: RuleProfile): RuleProfile => Object.freeze(profile);

export const RULE_PROFILES: Readonly<Record<RulePreset, RuleProfile>> = Object.freeze({
  classic: freezeProfile({
    allowA2345Straight: true,
    straightFlushAsBomb: true,
    enableTripleWithPair: true,
  }),
  tournament: freezeProfile({
    allowA2345Straight: false,
    straightFlushAsBomb: false,
    enableTripleWithPair: true,
  }),
});

export const getRuleProfile = (preset: RulePreset): RuleProfile => RULE_PROFILES[preset];

export const ruleProfileKey = (profile: RuleProfile): string => [
  Number(profile.allowA2345Straight),
  Number(profile.straightFlushAsBomb),
  Number(profile.enableTripleWithPair),
].join(':');

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
const getBasePlayInfo = (cards: Card[], profile: RuleProfile): PlayResolution | null => {
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

/** Heart-level wildcards represent ordinary ranks/level only, never either joker. */
export const WILDCARD_VALUES: readonly number[] = Object.freeze(Array.from({ length: 14 }, (_, index) => index + 2));

export const getPlayInfos = (cards: Card[], profile: RuleProfile): PlayResolution[] => {
  if (cards.length === 0) return [];

  const wildcards = cards.filter(c => c.isRedJoker);
  const normalCards = cards.filter(c => !c.isRedJoker);

  if (wildcards.length === 0 || normalCards.length === 0) {
    const info = getBasePlayInfo(cards, profile);
    return info ? [info] : [];
  }

  const validInfos = new Map<string, PlayResolution>();

  const tryAddInfo = (simulatedCards: Card[], wildcardUsages: WildcardUsage[]) => {
    if (wildcardUsages.some(usage => !WILDCARD_VALUES.includes(usage.representedValue) || usage.representedSuit === 'joker')) return;
    const info = getBasePlayInfo(simulatedCards, profile);
    if (info) {
      const key = `${info.type}-${info.maxValue}`;
      if (!validInfos.has(key)) {
        validInfos.set(key, { ...info, wildcardUsages });
      }
    }
  };

  const suits: Suit[] = ['spade', 'heart', 'club', 'diamond'];
  const naturalSuits = new Set(normalCards.map(card => card.suit).filter(suit => suit !== 'joker'));
  const flushSuit = naturalSuits.size === 1 ? Array.from(naturalSuits)[0] : null;
  // Suits affect only StraightFlush recognition. For each value assignment it
  // is therefore sufficient to test one flush-preserving assignment and one
  // deterministic non-flush assignment; pair/triple/bomb semantics are suitless.
  const suitAssignments: Suit[][] = flushSuit
    ? [
        wildcards.map(() => flushSuit),
        wildcards.map(() => suits.find(suit => suit !== flushSuit)!),
      ]
    : [wildcards.map(() => suits[0])];

  const tryValues = (values: number[]): void => {
    for (const assignedSuits of suitAssignments) {
      const simulated = values.map((value, index): Card => ({
        id: `sim${index + 1}`,
        suit: assignedSuits[index],
        rank: '2' as Rank,
        value,
        isLevelCard: false,
        isRedJoker: false,
      }));
      tryAddInfo([...normalCards, ...simulated], values.map((value, index) => ({
        cardId: wildcards[index].id,
        representedValue: value,
        representedSuit: assignedSuits[index],
      })));
    }
  };

  if (wildcards.length === 1) {
    for (const value of WILDCARD_VALUES) tryValues([value]);
  } else if (wildcards.length === 2) {
    for (const first of WILDCARD_VALUES) {
      for (const second of WILDCARD_VALUES) tryValues([first, second]);
    }
  }

  return Array.from(validInfos.values());
};

export const isBombResolution = (info: PlayResolution): boolean =>
  info.type === PlayType.Bomb || info.type === PlayType.StraightFlush || info.type === PlayType.Rocket;

/** Positive means left is the stronger bomb resolution. */
export const compareBombResolutions = (left: PlayResolution, right: PlayResolution): number => {
  if (left.type === PlayType.Rocket) return right.type === PlayType.Rocket ? 0 : 1;
  if (right.type === PlayType.Rocket) return -1;
  return left.maxValue - right.maxValue;
};

const strongestResolution = (infos: PlayResolution[]): PlayResolution | null =>
  infos.length
    ? infos.reduce((previous, current) => previous.maxValue > current.maxValue ? previous : current)
    : null;

const weakestResolution = (infos: PlayResolution[]): PlayResolution | null =>
  infos.length
    ? infos.reduce((previous, current) => previous.maxValue <= current.maxValue ? previous : current)
    : null;

export const getPlayInfo = (cards: Card[], profile: RuleProfile): PlayResolution | null => {
  const infos = getPlayInfos(cards, profile);
  if (infos.length === 0) return null;
  
  // 优先返回炸弹/同花顺等高级牌型
  const bomb = infos.find(isBombResolution);
  if (bomb) {
    // 找最大的炸弹
    return infos.filter(isBombResolution)
      .reduce((previous, current) => compareBombResolutions(previous, current) > 0 ? previous : current);
  }

  // 对于普通牌型（如三带二，顺子等），如果有多种可能（因为逢人配模拟出不同的合法组合）
  // 必须返回 maxValue 最大的那种组合，否则逢人配可能会被错误地当做小牌
  return infos.reduce((prev, current) => (prev.maxValue > current.maxValue) ? prev : current);
};

/** Explicit name for presentation consumers; getPlayInfo remains API-compatible. */
export const resolvePlay = (cards: Card[], profile: RuleProfile): PlayResolution | null => getPlayInfo(cards, profile);

const resolveAction = (action: PlayAction, profile: RuleProfile): PlayResolution | null => {
  const infos = getPlayInfos(action.cards, profile);
  const matchingType = infos.filter(info => info.type === action.type);
  if (action.resolution) {
    const exact = matchingType.find(info => info.maxValue === action.resolution?.maxValue);
    if (exact) return exact;
  }
  return strongestResolution(matchingType) ?? strongestResolution(infos);
};

const beatsResolution = (
  candidate: PlayResolution,
  candidateLength: number,
  target: PlayResolution,
  targetLength: number,
): boolean => {
  if (target.type === PlayType.Rocket) return false;
  if (candidate.type === PlayType.Rocket) return true;
  const candidateBomb = isBombResolution(candidate);
  const targetBomb = isBombResolution(target);
  if (candidateBomb && !targetBomb) return true;
  if (targetBomb) return candidateBomb && compareBombResolutions(candidate, target) > 0;
  return candidate.type === target.type
    && candidateLength === targetLength
    && candidate.maxValue > target.maxValue;
};

/**
 * Resolves ambiguity and legality as one operation. A response first uses the
 * weakest same-type interpretation that wins, then the weakest sufficient bomb.
 */
export const resolvePlayForContext = (
  cards: Card[],
  lastPlay: PlayAction | null,
  profile: RuleProfile,
): PlayResolution | null => {
  const infos = getPlayInfos(cards, profile);
  if (!infos.length) return null;
  if (!lastPlay || lastPlay.type === PlayType.Pass) return getPlayInfo(cards, profile);
  const target = resolveAction(lastPlay, profile);
  if (!target) return null;
  const legal = infos.filter(info => beatsResolution(info, cards.length, target, lastPlay.cards.length));
  const sameType = legal.filter(info => info.type === target.type);
  return weakestResolution(sameType.length ? sameType : legal);
};

export const canPlay = (
  cards: Card[],
  lastPlay: PlayAction | null,
  profile: RuleProfile,
): boolean => {
  return resolvePlayForContext(cards, lastPlay, profile) !== null;
};

/**
 * Stable reason codes for presentation and protocol callers.  Rules stay
 * authoritative here; clients may translate these codes without duplicating
 * bomb/type/length comparison logic.
 */
export type PlayValidationCode =
  | 'valid'
  | 'empty'
  | 'invalid-combination'
  | 'type-mismatch'
  | 'card-count-mismatch'
  | 'not-high-enough'
  | 'requires-bomb'
  | 'bomb-too-small'
  | 'rocket-unbeatable';

export interface PlayValidation {
  code: PlayValidationCode;
  canPlay: boolean;
  resolution: PlayResolution | null;
  requiredType: PlayType | null;
}

/**
 * Explains why a selected group can or cannot follow the current table play.
 * This deliberately calls `canPlay` first so the diagnostic can never reject
 * a group accepted by the actual rules path.
 */
export const diagnosePlay = (cards: Card[], lastPlay: PlayAction | null, profile: RuleProfile): PlayValidation => {
  if (cards.length === 0) {
    return { code: 'empty', canPlay: false, resolution: null, requiredType: lastPlay?.type ?? null };
  }

  const defaultResolution = getPlayInfo(cards, profile);
  if (!defaultResolution) {
    return { code: 'invalid-combination', canPlay: false, resolution: null, requiredType: lastPlay?.type ?? null };
  }
  const contextualResolution = resolvePlayForContext(cards, lastPlay, profile);
  if (contextualResolution) {
    return { code: 'valid', canPlay: true, resolution: contextualResolution, requiredType: lastPlay?.type ?? null };
  }
  if (!lastPlay || lastPlay.type === PlayType.Pass) {
    // Defensive fallback: a recognized leading play should already have been
    // accepted by canPlay, but callers still receive a safe non-playable code.
    return { code: 'invalid-combination', canPlay: false, resolution: defaultResolution, requiredType: null };
  }

  const myInfos = getPlayInfos(cards, profile);
  const lastInfo = resolveAction(lastPlay, profile);
  if (!lastInfo) {
    return { code: 'type-mismatch', canPlay: false, resolution: defaultResolution, requiredType: lastPlay.type };
  }

  if (lastInfo.type === PlayType.Rocket) {
    return { code: 'rocket-unbeatable', canPlay: false, resolution: defaultResolution, requiredType: lastInfo.type };
  }

  const myBombs = myInfos.filter(isBombResolution);
  if (isBombResolution(lastInfo)) {
    return {
      code: myBombs.length ? 'bomb-too-small' : 'requires-bomb',
      canPlay: false,
      resolution: defaultResolution,
      requiredType: lastInfo.type,
    };
  }

  const matchingType = myInfos.filter(info => info.type === lastInfo.type);
  if (!matchingType.length) {
    return { code: 'type-mismatch', canPlay: false, resolution: defaultResolution, requiredType: lastInfo.type };
  }
  if (cards.length !== lastPlay.cards.length) {
    return { code: 'card-count-mismatch', canPlay: false, resolution: defaultResolution, requiredType: lastInfo.type };
  }
  return { code: 'not-high-enough', canPlay: false, resolution: defaultResolution, requiredType: lastInfo.type };
};
