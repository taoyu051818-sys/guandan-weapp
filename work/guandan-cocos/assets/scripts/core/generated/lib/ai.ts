import { Card, PlayAction, PlayType, PlayerId, Team, Player, Suit, Rank } from '../types/game';
import { canPlay, getPlayInfo, getFaceValue, getFaceRankCounts } from './rules';
import {
  Difficulty,
  HardRuntimeTuning,
  MasterRuntimeTuning,
  StrategyProfile,
} from './ai-core-types';
import { STRATEGY_BY_DIFFICULTY } from './ai-strategies';
import { chooseMasterOverride as chooseMasterOverrideImpl } from './ai-master-override';
import { hardTacticalOverride as hardTacticalOverrideImpl } from './ai-hard-override';
import { chooseMediumOverride as chooseMediumOverrideImpl } from './ai-medium-override';
export type { Difficulty, HardRuntimeTuning, MasterRuntimeTuning } from './ai-core-types';

type TeamIntent = 'assist_teammate' | 'block_enemy' | 'tempo';

export type AIDecisionMetrics = {
  elapsedMs: number;
  generatedPlays: number;
  validPlays: number;
  prunedPlays: number;
  endgameDepth: number;
  endgameNodes: number;
  cacheHitPlayInfo: number;
  cacheMissPlayInfo: number;
  cacheHitCanPlay: number;
  cacheMissCanPlay: number;
  cacheHitAllPlays: number;
  cacheMissAllPlays: number;
};

export type AIDecisionTrace = {
  passReason: string;
  difficulty: Difficulty;
  role: AdvancedRole;
};

export type AIContext = {
  currentLevel: Rank;
  teamLevels: Record<Team, Rank>;
  roundMeta: {
    fromTribute: boolean;
    isAntiTribute: boolean;
  } | null;
};


const CACHE_LIMIT = 600;
const playInfoCache = new Map<string, ReturnType<typeof getPlayInfo>>();
const canPlayCache = new Map<string, boolean>();
const allPlaysCache = new Map<string, Card[][]>();
let gameCachePrefix = 'g1';

const metricsState: AIDecisionMetrics = {
  elapsedMs: 0,
  generatedPlays: 0,
  validPlays: 0,
  prunedPlays: 0,
  endgameDepth: 0,
  endgameNodes: 0,
  cacheHitPlayInfo: 0,
  cacheMissPlayInfo: 0,
  cacheHitCanPlay: 0,
  cacheMissCanPlay: 0,
  cacheHitAllPlays: 0,
  cacheMissAllPlays: 0,
};
const decisionTraceState: AIDecisionTrace = {
  passReason: '',
  difficulty: 'medium',
  role: 'striker',
};

const hardRuntimeTuning: HardRuntimeTuning = {
  interceptThreshold: 7,
  pairProbeMin: 5,
  pairProbeMax: 14,
  straightFlushBombBreakPenalty: 85,
};

const masterRuntimeTuning: MasterRuntimeTuning = {
  strikerEnemyPushThreshold: 6,
  strikerComboPushBonus: 2.2,
  strikerSearchBudgetMs: 68,
  supportSearchBudgetMs: 24,
  strikerBeam: 18,
  supportBeam: 12,
  strikerDepthLimit: 4,
  supportDepthLimit: 1,
  finishBySmall: false,
  preferOnlySinglesPairsWithSmallLate: false,
  earlySmallDumpWeight: 0.08,
  routeStabilityWeight: 1.25,
  endgameComplexLockThreshold: 10,
  endgameForceComplexFinish: true,
  endgameRouteWinGuard: true,
  endgameStrictLockThreshold: 10,
  endgameSinglePairPenalty: 32,
};

const THREAT_MODE_THRESHOLD: Record<Difficulty, number> = {
  easy: 4,
  medium: 6,
  hard: 8,
  master: 9,
};
const EXTENDED_ENDGAME_THRESHOLD: Record<Difficulty, number> = {
  easy: 6,
  medium: 6,
  hard: 12,
  master: 14,
};
const HARD_FORCE_CONTEST_FLOOR = 7;
const HARD_CRITICAL_INTERCEPT_THRESHOLD = 5;

type RuntimeIntelState = {
  prevTotalCards: number;
  lastObservedPlayKey: string;
  seenValueCounts: Map<number, number>;
  seenJokerCount: number;
  seenLevelCardCount: number;
  lastTypeByPlayer: Map<PlayerId, PlayType>;
  singlePairStreakByPlayer: Map<PlayerId, number>;
  recentPlaySamples: Array<{ playerId: PlayerId; type: PlayType; maxValue: number; cardsLen: number }>;
};

type AdvancedRole = 'striker' | 'support';
type EnemyPressureModel = {
  minEnemyHand: number;
  doubleEnemyLow: boolean;
  teammateHand: number;
  enemySinglePairStreak: number;
  sprintRisk: number;
  bombRisk: number;
  baitRisk: number;
};

const runtimeIntelState: RuntimeIntelState = {
  prevTotalCards: -1,
  lastObservedPlayKey: '',
  seenValueCounts: new Map(),
  seenJokerCount: 0,
  seenLevelCardCount: 0,
  lastTypeByPlayer: new Map(),
  singlePairStreakByPlayer: new Map(),
  recentPlaySamples: [],
};

const decisionRuntimeContext: { difficulty: Difficulty; role: AdvancedRole } = {
  difficulty: 'medium',
  role: 'striker',
};

export const getHardRuntimeTuning = (): HardRuntimeTuning => ({ ...hardRuntimeTuning });

export const setHardRuntimeTuning = (patch: Partial<HardRuntimeTuning>) => {
  const next: HardRuntimeTuning = {
    ...hardRuntimeTuning,
    ...patch,
  };
  next.interceptThreshold = Math.max(3, Math.min(10, Math.round(next.interceptThreshold)));
  next.pairProbeMin = Math.max(3, Math.min(14, Math.round(next.pairProbeMin)));
  next.pairProbeMax = Math.max(next.pairProbeMin, Math.min(15, Math.round(next.pairProbeMax)));
  next.straightFlushBombBreakPenalty = Math.max(0, Math.min(200, Math.round(next.straightFlushBombBreakPenalty)));
  Object.assign(hardRuntimeTuning, next);
};

export const getMasterRuntimeTuning = (): MasterRuntimeTuning => ({ ...masterRuntimeTuning });

export const setMasterRuntimeTuning = (patch: Partial<MasterRuntimeTuning>) => {
  const next: MasterRuntimeTuning = {
    ...masterRuntimeTuning,
    ...patch,
  };
  next.strikerEnemyPushThreshold = Math.max(6, Math.min(12, Math.round(next.strikerEnemyPushThreshold)));
  next.strikerComboPushBonus = Math.max(1, Math.min(2.5, Number(next.strikerComboPushBonus.toFixed(2))));
  next.strikerSearchBudgetMs = Math.max(20, Math.min(120, Math.round(next.strikerSearchBudgetMs)));
  next.supportSearchBudgetMs = Math.max(8, Math.min(60, Math.round(next.supportSearchBudgetMs)));
  next.strikerBeam = Math.max(10, Math.min(60, Math.round(next.strikerBeam)));
  next.supportBeam = Math.max(6, Math.min(40, Math.round(next.supportBeam)));
  next.strikerDepthLimit = Math.max(2, Math.min(7, Math.round(next.strikerDepthLimit)));
  next.supportDepthLimit = Math.max(1, Math.min(5, Math.round(next.supportDepthLimit)));
  next.finishBySmall = !!next.finishBySmall;
  next.preferOnlySinglesPairsWithSmallLate = !!next.preferOnlySinglesPairsWithSmallLate;
  next.earlySmallDumpWeight = Math.max(0, Math.min(1.2, Number(next.earlySmallDumpWeight.toFixed(2))));
  next.routeStabilityWeight = Math.max(0.2, Math.min(3, Number(next.routeStabilityWeight.toFixed(2))));
  next.endgameComplexLockThreshold = Math.max(6, Math.min(12, Math.round(next.endgameComplexLockThreshold)));
  next.endgameForceComplexFinish = !!next.endgameForceComplexFinish;
  next.endgameRouteWinGuard = !!next.endgameRouteWinGuard;
  next.endgameStrictLockThreshold = Math.max(6, Math.min(12, Math.round(next.endgameStrictLockThreshold)));
  next.endgameSinglePairPenalty = Math.max(8, Math.min(40, Math.round(next.endgameSinglePairPenalty)));
  Object.assign(masterRuntimeTuning, next);
};

const resetRuntimeIntel = () => {
  runtimeIntelState.prevTotalCards = -1;
  runtimeIntelState.lastObservedPlayKey = '';
  runtimeIntelState.seenValueCounts.clear();
  runtimeIntelState.seenJokerCount = 0;
  runtimeIntelState.seenLevelCardCount = 0;
  runtimeIntelState.lastTypeByPlayer.clear();
  runtimeIntelState.singlePairStreakByPlayer.clear();
  runtimeIntelState.recentPlaySamples = [];
  const oldNum = Number(gameCachePrefix.slice(1)) || 1;
  gameCachePrefix = `g${oldNum + 1}`;
};

const getTotalRemainingCards = (players: Record<PlayerId, Player>) =>
  Object.values(players).reduce((sum, p) => sum + p.hand.length, 0);

const observeRuntimeIntel = (lastPlay: PlayAction | null, players: Record<PlayerId, Player>) => {
  const totalCards = getTotalRemainingCards(players);
  if (runtimeIntelState.prevTotalCards >= 0 && totalCards > runtimeIntelState.prevTotalCards) {
    resetRuntimeIntel();
  }
  runtimeIntelState.prevTotalCards = totalCards;
  if (!lastPlay) return;
  if (lastPlay.type === PlayType.Pass) {
    runtimeIntelState.lastTypeByPlayer.set(lastPlay.playerId, PlayType.Pass);
    runtimeIntelState.singlePairStreakByPlayer.set(lastPlay.playerId, 0);
    return;
  }

  const key = `${lastPlay.playerId}|${lastPlay.type}|${cardsKey(lastPlay.cards)}`;
  if (key === runtimeIntelState.lastObservedPlayKey) return;
  runtimeIntelState.lastObservedPlayKey = key;
  runtimeIntelState.lastTypeByPlayer.set(lastPlay.playerId, lastPlay.type);
  const prevStreak = runtimeIntelState.singlePairStreakByPlayer.get(lastPlay.playerId) || 0;
  if (lastPlay.type === PlayType.Single || lastPlay.type === PlayType.Pair) {
    runtimeIntelState.singlePairStreakByPlayer.set(lastPlay.playerId, prevStreak + 1);
  } else {
    runtimeIntelState.singlePairStreakByPlayer.set(lastPlay.playerId, 0);
  }
  lastPlay.cards.forEach((c) => {
    runtimeIntelState.seenValueCounts.set(c.value, (runtimeIntelState.seenValueCounts.get(c.value) || 0) + 1);
    if (c.suit === 'joker') runtimeIntelState.seenJokerCount += 1;
    if (c.isLevelCard) runtimeIntelState.seenLevelCardCount += 1;
  });
  const playInfo = memoGetPlayInfo(lastPlay.cards);
  runtimeIntelState.recentPlaySamples.push({
    playerId: lastPlay.playerId,
    type: lastPlay.type,
    maxValue: playInfo?.maxValue ?? 0,
    cardsLen: lastPlay.cards.length,
  });
  if (runtimeIntelState.recentPlaySamples.length > 18) {
    runtimeIntelState.recentPlaySamples.shift();
  }
};

const resetMetrics = () => {
  metricsState.elapsedMs = 0;
  metricsState.generatedPlays = 0;
  metricsState.validPlays = 0;
  metricsState.prunedPlays = 0;
  metricsState.endgameDepth = 0;
  metricsState.endgameNodes = 0;
  metricsState.cacheHitPlayInfo = 0;
  metricsState.cacheMissPlayInfo = 0;
  metricsState.cacheHitCanPlay = 0;
  metricsState.cacheMissCanPlay = 0;
  metricsState.cacheHitAllPlays = 0;
  metricsState.cacheMissAllPlays = 0;
};

export const getLastAIMetrics = (): AIDecisionMetrics => ({ ...metricsState });
export const getLastAIDecisionTrace = (): AIDecisionTrace => ({ ...decisionTraceState });

const lruGet = <T>(cache: Map<string, T>, key: string): T | undefined => {
  if (!cache.has(key)) return undefined;
  const value = cache.get(key)!;
  cache.delete(key);
  cache.set(key, value);
  return value;
};

const lruSet = <T>(cache: Map<string, T>, key: string, value: T) => {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  if (cache.size <= CACHE_LIMIT) return;
  const oldestKey = cache.keys().next().value as string | undefined;
  if (oldestKey !== undefined) cache.delete(oldestKey);
};

const cardsKey = (cards: Card[]) => cards.map(c => c.id).sort().join(',');
const cacheScopedKey = (rawKey: string) => `${gameCachePrefix}:${rawKey}`;
const playKey = (play: PlayAction | null) => {
  if (!play) return 'none';
  return `${play.playerId}|${play.type}|${cardsKey(play.cards)}`;
};

const memoGetPlayInfo = (cards: Card[]) => {
  const key = cacheScopedKey(cardsKey(cards));
  const hit = lruGet(playInfoCache, key);
  if (hit !== undefined) {
    metricsState.cacheHitPlayInfo += 1;
    return hit;
  }
  metricsState.cacheMissPlayInfo += 1;
  const info = getPlayInfo(cards);
  lruSet(playInfoCache, key, info);
  return info;
};

const memoCanPlay = (cards: Card[], lastPlay: PlayAction) => {
  const key = cacheScopedKey(`${cardsKey(cards)}->${playKey(lastPlay)}`);
  const hit = lruGet(canPlayCache, key);
  if (hit !== undefined) {
    metricsState.cacheHitCanPlay += 1;
    return hit;
  }
  metricsState.cacheMissCanPlay += 1;
  const ok = canPlay(cards, lastPlay);
  lruSet(canPlayCache, key, ok);
  return ok;
};

const isBombType = (type: PlayType) =>
  type === PlayType.Bomb || type === PlayType.StraightFlush || type === PlayType.Rocket;
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const getRankCounts = (cards: Card[]) => {
  const counts: Record<number, number> = {};
  cards.forEach(c => {
    const v = c.value;
    counts[v] = (counts[v] || 0) + 1;
  });
  return Object.entries(counts)
    .map(([val, count]) => ({ value: Number(val), count }))
    .sort((a, b) => b.count - a.count || b.value - a.value);
};

// 生成所有常规组合（不包含逢人配的模拟）
const generateNormalPlays = (hand: Card[]): Card[][] => {
  const plays: Card[][] = [];
  const sorted = [...hand].sort((a, b) => a.value - b.value);
  const rankCounts = getRankCounts(hand);

  // 1. 单牌
  const distinctValues = new Set<number>();
  for (const card of sorted) {
    if (!distinctValues.has(card.value)) {
      plays.push([card]);
      distinctValues.add(card.value);
    }
  }

  // 2. 对子
  const pairs: Card[][] = [];
  for (const rc of rankCounts.filter(r => r.count >= 2)) {
    const cards = sorted.filter(c => c.value === rc.value).slice(0, 2);
    plays.push(cards);
    pairs.push(cards);
  }

  // 3. 三张（可直接出三不带，也用于三带一对和钢板）
  const triples: Card[][] = [];
  for (const rc of rankCounts.filter(r => r.count >= 3)) {
    const cards = sorted.filter(c => c.value === rc.value).slice(0, 3);
    plays.push(cards);
    triples.push(cards);
  }

  // 4. 三带一对
  for (const t of triples) {
    for (const p of pairs) {
      if (t[0].value !== p[0].value) {
        plays.push([...t, ...p]);
      }
    }
  }

  // 5. 炸弹 (4张及以上)
  for (const rc of rankCounts.filter(r => r.count >= 4)) {
    for (let len = 4; len <= rc.count; len++) {
      plays.push(sorted.filter(c => c.value === rc.value).slice(0, len));
    }
  }

  // 6. 顺子 (5张连续)
  const faceDistinctValues = new Set<number>();
  const faceDistinctCards: Card[] = [];
  for (const card of sorted) {
    const fv = getFaceValue(card);
    if (!faceDistinctValues.has(fv) && fv <= 14) {
      faceDistinctCards.push(card);
      faceDistinctValues.add(fv);
    }
  }
  faceDistinctCards.sort((a, b) => getFaceValue(a) - getFaceValue(b));

  for (let i = 0; i <= faceDistinctCards.length - 5; i++) {
    if (getFaceValue(faceDistinctCards[i + 4]) - getFaceValue(faceDistinctCards[i]) === 4) {
      plays.push(faceDistinctCards.slice(i, i + 5));
    }
  }
  const ace = sorted.find(c => getFaceValue(c) === 14);
  if (ace) {
    const lowCards = [1, 2, 3, 4, 5].map(v => v === 1 ? ace : sorted.find(c => getFaceValue(c) === v));
    const aceCount = lowCards.filter((c) => c === ace).length;
    if (lowCards.every(c => c !== undefined) && aceCount === 1) {
      plays.push(lowCards as Card[]);
    }
  }

  // 7. 同花顺
  const suits: Suit[] = ['spade', 'heart', 'club', 'diamond'];
  for (const suit of suits) {
    const suitCards = sorted.filter(c => c.suit === suit && c.suit !== 'joker');
    const suitDistinctValues = new Set<number>();
    const distinctSuitCards: Card[] = [];
    for (const card of suitCards) {
      const fv = getFaceValue(card);
      if (!suitDistinctValues.has(fv) && fv <= 14) {
        distinctSuitCards.push(card);
        suitDistinctValues.add(fv);
      }
    }
    distinctSuitCards.sort((a, b) => getFaceValue(a) - getFaceValue(b));
    for (let i = 0; i <= distinctSuitCards.length - 5; i++) {
      if (getFaceValue(distinctSuitCards[i + 4]) - getFaceValue(distinctSuitCards[i]) === 4) {
        plays.push(distinctSuitCards.slice(i, i + 5));
      }
    }
    const suitAce = suitCards.find(c => getFaceValue(c) === 14);
    if (suitAce) {
      const lowSuitCards = [1, 2, 3, 4, 5].map(v => v === 1 ? suitAce : suitCards.find(c => getFaceValue(c) === v));
      const aceCount = lowSuitCards.filter((c) => c === suitAce).length;
      if (lowSuitCards.every(c => c !== undefined) && aceCount === 1) {
        plays.push(lowSuitCards as Card[]);
      }
    }
  }

  // 为三连对和钢板准备基于面值的对子和三张
  const faceRankCounts = getFaceRankCounts(hand);
  
  const facePairs: Card[][] = [];
  for (const rc of faceRankCounts.filter(r => r.count >= 2)) {
    if (rc.value <= 14) {
      const cards = hand.filter(c => getFaceValue(c) === rc.value).slice(0, 2);
      facePairs.push(cards);
    }
  }

  const faceTriples: Card[][] = [];
  for (const rc of faceRankCounts.filter(r => r.count >= 3)) {
    if (rc.value <= 14) {
      const cards = hand.filter(c => getFaceValue(c) === rc.value).slice(0, 3);
      faceTriples.push(cards);
    }
  }

  // 8. 三连对 (6张，3个连续对子)
  const sortedFacePairs = facePairs.sort((a, b) => getFaceValue(a[0]) - getFaceValue(b[0]));
  for (let i = 0; i <= sortedFacePairs.length - 3; i++) {
    if (getFaceValue(sortedFacePairs[i + 2][0]) - getFaceValue(sortedFacePairs[i][0]) === 2 &&
        getFaceValue(sortedFacePairs[i + 1][0]) - getFaceValue(sortedFacePairs[i][0]) === 1) {
      plays.push([...sortedFacePairs[i], ...sortedFacePairs[i + 1], ...sortedFacePairs[i + 2]]);
    }
  }

  // 9. 钢板 (6张，2个连续三张)
  const sortedFaceTriples = faceTriples.sort((a, b) => getFaceValue(a[0]) - getFaceValue(b[0]));
  for (let i = 0; i <= sortedFaceTriples.length - 2; i++) {
    if (getFaceValue(sortedFaceTriples[i + 1][0]) - getFaceValue(sortedFaceTriples[i][0]) === 1) {
      plays.push([...sortedFaceTriples[i], ...sortedFaceTriples[i + 1]]);
    }
  }

  // 10. 火箭 (4张王)
  const jokers = hand.filter(c => c.suit === 'joker');
  if (jokers.length === 4) {
    plays.push(jokers);
  }

  return plays;
};

const getWildcardCandidateValues = (normalCards: Card[]) => {
  const allValues = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  if (normalCards.length <= 5) return allValues;

  const values = new Set<number>([2, 10, 11, 12, 13, 14, 15]);
  for (const card of normalCards) {
    const v = card.value;
    values.add(v);
    if (v >= 2 && v <= 14) {
      values.add(Math.max(2, v - 2));
      values.add(Math.max(2, v - 1));
      values.add(Math.min(14, v + 1));
      values.add(Math.min(14, v + 2));
    }
  }
  return allValues.filter(v => values.has(v));
};

// 包含逢人配的完整合法出牌生成
export const generateAllPlays = (hand: Card[]): Card[][] => {
  if (!hand || hand.length === 0) return [];
  const handSignature = cardsKey(hand);
  const scopedSignature = cacheScopedKey(handSignature);
  const cached = lruGet(allPlaysCache, scopedSignature);
  if (cached) {
    metricsState.cacheHitAllPlays += 1;
    return cached;
  }
  metricsState.cacheMissAllPlays += 1;

  const wildcards = hand.filter(c => c.isRedJoker);
  const normalCards = hand.filter(c => !c.isRedJoker);

  if (wildcards.length === 0) {
    const direct = generateNormalPlays(hand);
    lruSet(allPlaysCache, scopedSignature, direct);
    return direct;
  }

  const allPlays = new Map<string, Card[]>();
  const suits: Suit[] = ['spade', 'heart', 'club', 'diamond'];
  const candidateValues = getWildcardCandidateValues(normalCards);

  const addPlays = (mockHand: Card[], wcMap: Map<string, Card>) => {
    const plays = generateNormalPlays(mockHand);
    plays.forEach(play => {
      const actualPlay = play.map(c => wcMap.has(c.id) ? wcMap.get(c.id)! : c);
      const key = actualPlay.map(c => c.id).sort().join(',');
      if (!allPlays.has(key)) {
        allPlays.set(key, actualPlay);
      }
    });
  };

  if (wildcards.length === 1) {
    for (const v of candidateValues) {
      for (const s of suits) {
        const mockCard: Card = { id: 'mock1', suit: s, rank: 2 as Rank, value: v, isLevelCard: false };
        const wcMap = new Map([['mock1', wildcards[0]]]);
        addPlays([...normalCards, mockCard], wcMap);
      }
    }
  } else if (wildcards.length === 2) {
    for (const v1 of candidateValues) {
      for (const s1 of suits) {
        for (const v2 of candidateValues) {
          for (const s2 of suits) {
            const mockCard1: Card = { id: 'mock1', suit: s1, rank: 2 as Rank, value: v1, isLevelCard: false };
            const mockCard2: Card = { id: 'mock2', suit: s2, rank: 2 as Rank, value: v2, isLevelCard: false };
            const wcMap = new Map([['mock1', wildcards[0]], ['mock2', wildcards[1]]]);
            addPlays([...normalCards, mockCard1, mockCard2], wcMap);
          }
        }
      }
    }
  }

  const plays = Array.from(allPlays.values());
  lruSet(allPlaysCache, scopedSignature, plays);
  return plays;
};

const getDisruptionScore = (
  play: Card[],
  handCountMap: Map<number, number>,
  isLeadTurn: boolean,
  profile: StrategyProfile
) => {
  let score = 0;
  const playRankCounts = getRankCounts(play);
  playRankCounts.forEach((prc) => {
    const handCount = handCountMap.get(prc.value) || 0;
    if (handCount > prc.count) {
      score += (handCount - prc.count) * 2.5;
      if (handCount >= 4) score += 60 * profile.conservatism;
      if (handCount === 2) score += 1.5;
    }
  });

  const info = memoGetPlayInfo(play);
  const wildcardCount = play.filter(c => c.isRedJoker).length;
  if (wildcardCount > 0) score += wildcardCount * profile.wildcardPenalty;
  if (info && isBombType(info.type)) score += profile.bombPenalty;
  if (info?.type === PlayType.StraightFlush) {
    // 避免为了同花顺打散潜在炸弹头（高阶策略：大炸优先保留）
    const bombHeadsBroken = playRankCounts.reduce((acc, rc) => {
      const inHand = handCountMap.get(rc.value) || 0;
      if (inHand >= 4 && rc.count < inHand) return acc + 1;
      return acc;
    }, 0);
    score += bombHeadsBroken * hardRuntimeTuning.straightFlushBombBreakPenalty * profile.conservatism;
  }

  const highCardCount = play.filter(c => !c.isRedJoker && c.value >= 14).length;
  score += highCardCount * profile.highCardPenalty;

  if (isLeadTurn && info) {
    if (info.type === PlayType.Single || info.type === PlayType.Pair || info.type === PlayType.Triple) {
      score += highCardCount * profile.openBigCardPenalty;
    }
    if (info.type === PlayType.TripleWithPair) {
      const counts = getRankCounts(play);
      const pairRank = counts.find(r => r.count === 2);
      if (pairRank && pairRank.value >= 14) score += profile.openBigCardPenalty * 2;
    }
  }
  return score;
};

const pruneCandidatePlays = (
  plays: Card[][],
  handCountMap: Map<number, number>,
  isLeadTurn: boolean,
  profile: StrategyProfile
) => {
  const groups = new Map<string, Card[]>();
  for (const play of plays) {
    const info = memoGetPlayInfo(play);
    if (!info) continue;
    const key = `${info.type}-${info.maxValue}-${play.length}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, play);
      continue;
    }
    const oldScore = getDisruptionScore(existing, handCountMap, isLeadTurn, profile);
    const newScore = getDisruptionScore(play, handCountMap, isLeadTurn, profile);
    if (newScore < oldScore) groups.set(key, play);
  }
  return Array.from(groups.values());
};

export const getPossiblePlays = (
  hand: Card[],
  lastPlay: PlayAction | null,
  difficulty: Difficulty = 'medium'
): Card[][] => {
  const profile = STRATEGY_BY_DIFFICULTY[difficulty];
  const allPlays = generateAllPlays(hand);
  metricsState.generatedPlays += allPlays.length;
  const validPlays = (!lastPlay || lastPlay.type === PlayType.Pass)
    ? allPlays
    : allPlays.filter(play => memoCanPlay(play, lastPlay));
  metricsState.validPlays += validPlays.length;

  const countMap = new Map<number, number>();
  getRankCounts(hand).forEach(rc => countMap.set(rc.value, rc.count));
  const isLeadTurn = !lastPlay || lastPlay.type === PlayType.Pass;
  let pruned = pruneCandidatePlays(validPlays, countMap, isLeadTurn, profile);
  if (difficulty === 'master') {
    const masterCap = decisionRuntimeContext.role === 'support' ? 391 : 355;
    if (pruned.length > masterCap) {
      pruned = [...pruned]
        .sort((a, b) => getDisruptionScore(a, countMap, isLeadTurn, profile) - getDisruptionScore(b, countMap, isLeadTurn, profile))
        .slice(0, masterCap);
    }
  }
  metricsState.prunedPlays += pruned.length;

  return pruned.sort((a, b) => {
    const infoA = memoGetPlayInfo(a);
    const infoB = memoGetPlayInfo(b);
    if (!infoA || !infoB) return 0;

    const comboBoostA = isLeadTurn && (infoA.type === PlayType.Straight || infoA.type === PlayType.Tube || infoA.type === PlayType.Plate || infoA.type === PlayType.TripleWithPair || infoA.type === PlayType.Triple)
      ? profile.comboLeadBonus
      : 0;
    const comboBoostB = isLeadTurn && (infoB.type === PlayType.Straight || infoB.type === PlayType.Tube || infoB.type === PlayType.Plate || infoB.type === PlayType.TripleWithPair || infoB.type === PlayType.Triple)
      ? profile.comboLeadBonus
      : 0;
  const smallDumpWeight = difficulty === 'master' ? masterRuntimeTuning.earlySmallDumpWeight : profile.earlySmallDumpWeight;
  const smallDumpBonusA = hand.length > 8 && isLeadTurn && (infoA.type === PlayType.Single || infoA.type === PlayType.Pair) && infoA.maxValue <= 10
      ? smallDumpWeight * 10
      : 0;
  const smallDumpBonusB = hand.length > 8 && isLeadTurn && (infoB.type === PlayType.Single || infoB.type === PlayType.Pair) && infoB.maxValue <= 10
      ? smallDumpWeight * 10
      : 0;
    const scoreA = getDisruptionScore(a, countMap, isLeadTurn, profile) - comboBoostA - (isLeadTurn ? a.length * profile.leadLengthBonus : 0) - smallDumpBonusA;
    const scoreB = getDisruptionScore(b, countMap, isLeadTurn, profile) - comboBoostB - (isLeadTurn ? b.length * profile.leadLengthBonus : 0) - smallDumpBonusB;
    if (scoreA !== scoreB) return scoreA - scoreB;

    if (isLeadTurn) {
      if (a.length !== b.length) return b.length - a.length;
    } else {
      if (infoA.maxValue !== infoB.maxValue) {
        return (infoA.maxValue - infoB.maxValue) * profile.responseSmallCardBias;
      }
      if (a.length !== b.length) return a.length - b.length;
    }
    return infoA.maxValue - infoB.maxValue;
  });
};

const getIntent = (
  lastPlay: PlayAction | null,
  teammateId: PlayerId,
  teammateCount: number,
  enemyMinCount: number
): TeamIntent => {
  if (teammateCount <= 4) return 'assist_teammate';
  if (enemyMinCount <= 5) return 'block_enemy';
  if (lastPlay && lastPlay.type !== PlayType.Pass && lastPlay.playerId === teammateId) return 'assist_teammate';
  return 'tempo';
};

const removeCards = (hand: Card[], play: Card[]) => {
  const used = new Set(play.map(c => c.id));
  return hand.filter(c => !used.has(c.id));
};

const pickLowestWinningPlay = (plays: Card[][]) => {
  if (plays.length <= 1) return plays[0] || null;
  const rank = (play: Card[]) => {
    const info = memoGetPlayInfo(play);
    if (!info) return Number.POSITIVE_INFINITY;
    const bombOffset = isBombType(info.type) ? 100000 : 0;
    return bombOffset + info.maxValue * 100 + play.length;
  };
  return [...plays].sort((a, b) => rank(a) - rank(b))[0] || null;
};

const chooseByType = (plays: Card[][], type: PlayType, nonBombOnly: boolean = false) =>
  plays.find((p) => {
    const info = memoGetPlayInfo(p);
    if (!info || info.type !== type) return false;
    return !nonBombOnly || !isBombType(info.type);
  });

const chooseSmallProbeLead = (
  plays: Card[][],
  maxValue: number,
  preferPair: boolean = false
): Card[] | null => {
  const candidates = plays.filter((p) => {
    const info = memoGetPlayInfo(p);
    if (!info || isBombType(info.type)) return false;
    if (info.type !== PlayType.Single && info.type !== PlayType.Pair) return false;
    return info.maxValue <= maxValue;
  });
  if (candidates.length === 0) return null;
  if (preferPair) {
    const pairFirst = candidates.filter((p) => memoGetPlayInfo(p)?.type === PlayType.Pair);
    if (pairFirst.length > 0) return pickLowestWinningPlay(pairFirst);
  }
  return pickLowestWinningPlay(candidates);
};

const chooseSmallProbeFollow = (
  plays: Card[][],
  lastPlay: PlayAction | null,
  maxValue: number
): Card[] | null => {
  if (!lastPlay || lastPlay.type === PlayType.Pass) return null;
  if (lastPlay.type !== PlayType.Single && lastPlay.type !== PlayType.Pair) return null;
  const sameType = plays.filter((p) => {
    const info = memoGetPlayInfo(p);
    if (!info || isBombType(info.type)) return false;
    return info.type === lastPlay.type && info.maxValue <= maxValue;
  });
  return pickLowestWinningPlay(sameType);
};

const evaluateHandStructureScore = (remaining: Card[]) => {
  const rc = getRankCounts(remaining);
  const singleCount = rc.filter(r => r.count === 1).length;
  const lowSingles = rc.filter(r => r.count === 1 && r.value <= 5).length;
  const bombs = rc.filter(r => r.count >= 4).length;
  const allLeads = generateAllPlays(remaining);
  let complexCount = 0;
  let chainCount = 0;
  for (const p of allLeads) {
    const info = memoGetPlayInfo(p);
    if (!info) continue;
    if (info.type === PlayType.Straight || info.type === PlayType.Tube || info.type === PlayType.Plate || info.type === PlayType.TripleWithPair) {
      complexCount += 1;
    }
    if (info.type === PlayType.Tube || info.type === PlayType.Plate || info.type === PlayType.TripleWithPair) {
      chainCount += 1;
    }
  }
  const tailShape = getSinglesPairsTailShape(remaining);
  const pureTailRisk = remaining.length <= 8 && tailShape.onlySinglesPairs ? (tailShape.hasSmall ? 8 : 4) : 0;
  return singleCount * 4.2 + lowSingles * 2.4 + pureTailRisk - bombs * 1.8 - Math.min(8, complexCount) * 0.9 - Math.min(6, chainCount) * 1.2;
};

const getSinglesPairsTailShape = (cards: Card[]) => {
  const rc = getRankCounts(cards);
  const onlySinglesPairs = rc.every(r => r.count === 1 || r.count === 2);
  const hasSmall = rc.some(r => r.value <= 10);
  return { onlySinglesPairs, hasSmall };
};

const chooseLeadByStructure = (hand: Card[], possiblePlays: Card[][]) => {
  const top = possiblePlays.slice(0, 10);
  let best: Card[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const play of top) {
    const info = memoGetPlayInfo(play);
    if (!info) continue;
    if (isBombType(info.type)) continue;
    const remain = removeCards(hand, play);
    const score = evaluateHandStructureScore(remain);
    if (score < bestScore) {
      bestScore = score;
      best = play;
    }
  }
  return best;
};

const chooseOpeningDecomposeLead = (
  hand: Card[],
  possiblePlays: Card[][],
): Card[] | null => {
  const top = possiblePlays.slice(0, 18);
  let best: Card[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const play of top) {
    const info = memoGetPlayInfo(play);
    if (!info || isBombType(info.type)) continue;
    const remain = removeCards(hand, play);
    const remainScore = evaluateHandStructureScore(remain);
    const shapeBonus = isComplexPlayType(info.type) ? -6 : info.type === PlayType.Pair ? -1.5 : 0;
    const score = remainScore + info.maxValue * 0.35 - play.length * 0.2 + shapeBonus;
    if (score < bestScore) {
      bestScore = score;
      best = play;
    }
  }
  return best;
};

const getMinEnemyHand = (players: Record<PlayerId, Player>, myTeam: Team) =>
  Object.values(players)
    .filter(p => p.team !== myTeam)
    .map(p => p.hand.length)
    .filter(len => len > 0)
    .reduce((min, len) => Math.min(min, len), 99);

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const getEnemyPressureModel = (players: Record<PlayerId, Player>, myTeam: Team): EnemyPressureModel => {
  const enemyHands = Object.values(players)
    .filter((p) => p.team !== myTeam)
    .map((p) => p.hand.length)
    .filter((len) => len > 0);
  const minEnemyHand = enemyHands.length ? Math.min(...enemyHands) : 99;
  const doubleEnemyLow = enemyHands.filter((len) => len <= 10).length >= 2;
  const teammateHand = Object.values(players)
    .filter((p) => p.team === myTeam)
    .map((p) => p.hand.length)
    .sort((a, b) => a - b)[0] ?? 0;
  const enemySinglePairStreak = Math.max(
    ...Object.entries(players)
      .filter(([, p]) => p.team !== myTeam)
      .map(([id]) => runtimeIntelState.singlePairStreakByPlayer.get(id as PlayerId) || 0),
    0
  );

  let potentialBombRanks = 0;
  for (let value = 3; value <= 15; value++) {
    const seen = runtimeIntelState.seenValueCounts.get(value) || 0;
    const unseen = Math.max(0, 8 - seen); // 双副牌下非王单点最多 8 张
    if (unseen >= 4) potentialBombRanks += 1;
  }

  const enemyBombSignal = Object.entries(players).some(([id, player]) => {
    if (player.team === myTeam) return false;
    const lastType = runtimeIntelState.lastTypeByPlayer.get(id as PlayerId);
    return lastType === PlayType.Bomb || lastType === PlayType.StraightFlush || lastType === PlayType.Rocket;
  });

  const sprintRisk = clamp01(
    (minEnemyHand <= 5 ? 1 : minEnemyHand <= 7 ? 0.8 : minEnemyHand <= 10 ? 0.5 : 0.2)
    + (doubleEnemyLow ? 0.1 : 0)
    + (teammateHand <= 4 ? 0.1 : 0)
    + (enemySinglePairStreak >= 2 ? 0.06 : 0)
  );
  const bombRisk = clamp01(
    potentialBombRanks * 0.055
    + (minEnemyHand <= 8 ? 0.18 : 0)
    + (enemyBombSignal ? 0.18 : 0)
    + (runtimeIntelState.seenJokerCount <= 1 ? 0.12 : 0)
    + (runtimeIntelState.seenLevelCardCount <= 2 ? 0.08 : 0)
  );

  const recentEnemySamples = runtimeIntelState.recentPlaySamples
    .filter((s) => players[s.playerId].team !== myTeam)
    .slice(-8);
  const suspiciousHighSingles = recentEnemySamples.filter(
    (s) => (s.type === PlayType.Single || s.type === PlayType.Pair) && s.maxValue >= 13
  ).length;
  const suspiciousPattern = suspiciousHighSingles >= 2 && enemySinglePairStreak >= 2;
  const baitRisk = clamp01(
    (suspiciousPattern ? 0.45 : 0)
    + (enemySinglePairStreak >= 3 ? 0.2 : 0)
    + (minEnemyHand > 6 ? 0.15 : 0)
  );

  return { minEnemyHand, doubleEnemyLow, teammateHand, enemySinglePairStreak, sprintRisk, bombRisk, baitRisk };
};

const getAdvancedRole = (
  difficulty: Difficulty,
  players: Record<PlayerId, Player>,
  myPlayerId: PlayerId
): AdvancedRole => {
  if (difficulty === 'master') {
    return myPlayerId === 'p3' || myPlayerId === 'p4' ? 'support' : 'striker';
  }
  if (difficulty !== 'hard') return 'striker';
  if (!players[myPlayerId]?.isAI) return 'striker';
  const humans = Object.values(players).filter((p) => !p.isAI);
  if (humans.length !== 1) return 'striker';
  const human = humans[0];
  return players[myPlayerId].team === human.team ? 'support' : 'striker';
};

const chooseByTypeOrder = (plays: Card[][], order: PlayType[]) => {
  for (const t of order) {
    const sameType = plays.filter((p) => memoGetPlayInfo(p)?.type === t);
    if (sameType.length > 0) return pickLowestWinningPlay(sameType);
  }
  return null;
};

const isComplexPlayType = (type: PlayType) =>
  type === PlayType.Tube
  || type === PlayType.Plate
  || type === PlayType.TripleWithPair
  || type === PlayType.Straight
  || type === PlayType.Triple;

const isFinishComplexType = (type: PlayType) =>
  type === PlayType.Tube
  || type === PlayType.Plate
  || type === PlayType.TripleWithPair
  || type === PlayType.Straight
  || type === PlayType.Triple;

const chooseFeedPlayByScore = (
  possiblePlays: Card[][],
  teammateType: PlayType | undefined
) => {
  let best: Card[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const play of possiblePlays) {
    const info = memoGetPlayInfo(play);
    if (!info || isBombType(info.type)) continue;
    let score = info.maxValue * 4 + play.length * 1.5;
    if (teammateType && info.type === teammateType) score -= 16;
    if (isComplexPlayType(info.type)) score -= 4;
    if (info.type === PlayType.Single || info.type === PlayType.Pair) score += 4;
    if (score < bestScore) {
      bestScore = score;
      best = play;
    }
  }
  return best;
};

const chooseLowestComplexPlay = (plays: Card[][]) => {
  const complex = plays.filter((p) => {
    const info = memoGetPlayInfo(p);
    return !!info && !isBombType(info.type) && isComplexPlayType(info.type);
  });
  return pickLowestWinningPlay(complex);
};

const estimateLeadRouteV1 = (
  hand: Card[],
  difficulty: Difficulty,
  deadline: number,
  cache: Map<string, { steps: number; singlePairSteps: number; complexSteps: number; score: number }>,
  depth: number = 0,
  stepBudget: number = 120
): { steps: number; singlePairSteps: number; complexSteps: number; score: number } => {
  if (hand.length === 0) return { steps: 0, singlePairSteps: 0, complexSteps: 0, score: 0 };
  const key = `${cardsKey(hand)}|${depth}`;
  const cached = cache.get(key);
  if (cached) return cached;
  if (nowMs() >= deadline || depth >= 7 || stepBudget <= 0) {
    const fallback = {
      steps: Math.max(1, Math.ceil(hand.length / 3)),
      singlePairSteps: Math.max(0, Math.ceil(hand.length / 4)),
      complexSteps: Math.max(0, Math.ceil(hand.length / 5)),
      score: evaluateHandStructureScore(hand),
    };
    cache.set(key, fallback);
    return fallback;
  }

  const leads = getPossiblePlays(hand, null, difficulty).slice(0, 12);
  if (leads.length === 0) {
    const fallback = { steps: hand.length, singlePairSteps: hand.length, complexSteps: 0, score: hand.length * 6 };
    cache.set(key, fallback);
    return fallback;
  }

  let best = { steps: 99, singlePairSteps: 99, complexSteps: 0, score: Number.POSITIVE_INFINITY };
  for (const play of leads) {
    if (nowMs() >= deadline) break;
    const info = memoGetPlayInfo(play);
    if (!info) continue;
    if (isBombType(info.type) && hand.length > 8) continue;
    const remaining = removeCards(hand, play);
    const next = estimateLeadRouteV1(remaining, difficulty, deadline, cache, depth + 1, stepBudget - 1);
    const isSinglePair = info.type === PlayType.Single || info.type === PlayType.Pair;
    const isComplex = isComplexPlayType(info.type);
    const steps = next.steps + 1;
    const singlePairSteps = next.singlePairSteps + (isSinglePair ? 1 : 0);
    const complexSteps = next.complexSteps + (isComplex ? 1 : 0);
    const driftPenalty = Math.max(0, singlePairSteps - complexSteps) * 6 * masterRuntimeTuning.routeStabilityWeight;
    const score = steps * 22 + singlePairSteps * 12 + driftPenalty + evaluateHandStructureScore(remaining) * 0.8 - (isComplex ? 8 : 0);
    if (score < best.score) best = { steps, singlePairSteps, complexSteps, score };
  }
  cache.set(key, best);
  return best;
};

const planGlobalGroupingV1 = (
  hand: Card[],
  possiblePlays: Card[][],
  difficulty: Difficulty
): Card[] | null => {
  if (hand.length === 0 || possiblePlays.length === 0) return null;
  const deadline = nowMs() + 12;
  const routeCache = new Map<string, { steps: number; singlePairSteps: number; complexSteps: number; score: number }>();
  const candidates = possiblePlays
    .filter((play) => {
      const info = memoGetPlayInfo(play);
      return !!info && !isBombType(info.type);
    })
    .slice(0, 18);
  let bestPlay: Card[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const play of candidates) {
    if (nowMs() >= deadline) break;
    const info = memoGetPlayInfo(play);
    if (!info) continue;
    const remaining = removeCards(hand, play);
    const route = estimateLeadRouteV1(remaining, difficulty, deadline, routeCache, 0);
    const routeDrift = Math.max(0, route.singlePairSteps - route.complexSteps) * 4 * masterRuntimeTuning.routeStabilityWeight;
    const score = route.score + route.steps * 10 + route.singlePairSteps * 14 + routeDrift + info.maxValue * 0.6 - play.length * 0.4;
    if (score < bestScore) {
      bestScore = score;
      bestPlay = play;
    }
  }
  return bestPlay;
};

const chooseLockedEndgameRoute = (
  hand: Card[],
  possiblePlays: Card[][],
  difficulty: Difficulty,
  players: Record<PlayerId, Player>,
  myTeam: Team,
  lastPlay: PlayAction | null
): Card[] | null => {
  if (difficulty !== 'master') return null;
  if (hand.length > Math.max(10, masterRuntimeTuning.endgameComplexLockThreshold)) return null;
  if (hand.length <= 5) {
    const comboFinish = possiblePlays.filter((p) => {
      const info = memoGetPlayInfo(p);
      return !!info && !isBombType(info.type) && isFinishComplexType(info.type);
    });
    if (comboFinish.length > 0) return pickLowestWinningPlay(comboFinish);
  }
  const enemyMin = getMinEnemyHand(players, myTeam);
  const enemyLed = !!lastPlay && lastPlay.type !== PlayType.Pass && players[lastPlay.playerId].team !== myTeam;
  const lockThreshold = masterRuntimeTuning.endgameComplexLockThreshold;
  const useComplexLock = masterRuntimeTuning.endgameForceComplexFinish && hand.length <= lockThreshold;
  const useStrictLock = useComplexLock && hand.length <= masterRuntimeTuning.endgameStrictLockThreshold;
  const hasComplexOption = possiblePlays.some((p) => {
    const info = memoGetPlayInfo(p);
    return !!info && !isBombType(info.type) && isFinishComplexType(info.type);
  });
  const deadline = nowMs() + 10;
  const routeCache = new Map<string, { steps: number; singlePairSteps: number; complexSteps: number; score: number }>();
  let hasWinningRoute = false;
  if (masterRuntimeTuning.endgameRouteWinGuard && useComplexLock) {
    for (const p of possiblePlays.slice(0, 20)) {
      const info = memoGetPlayInfo(p);
      if (!info) continue;
      const remaining = removeCards(hand, p);
      const route = estimateLeadRouteV1(remaining, difficulty, deadline, routeCache, 0);
      if (route.steps <= Math.max(2, Math.ceil(remaining.length / 3)) && route.singlePairSteps <= 1) {
        hasWinningRoute = true;
        break;
      }
    }
  } else {
    hasWinningRoute = true;
  }
  let bestPlay: Card[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const play of possiblePlays.slice(0, 20)) {
    if (nowMs() >= deadline) break;
    const info = memoGetPlayInfo(play);
    if (!info) continue;
    if (useComplexLock && hasComplexOption && hasWinningRoute && (info.type === PlayType.Single || info.type === PlayType.Pair)) {
      if (!(enemyLed && enemyMin <= 6)) continue;
    }
    if (useStrictLock && hasComplexOption && hasWinningRoute && !isFinishComplexType(info.type) && !isBombType(info.type)) {
      continue;
    }
    const remaining = removeCards(hand, play);
    const route = estimateLeadRouteV1(remaining, difficulty, deadline, routeCache, 0);
    const singlePairStartPenalty = (info.type === PlayType.Single || info.type === PlayType.Pair) ? 10 : 0;
    const lockPenalty = (useComplexLock && hasWinningRoute)
      ? Math.max(0, route.singlePairSteps - route.complexSteps) * masterRuntimeTuning.endgameSinglePairPenalty
      : 0;
    const score = route.steps * 28 + route.singlePairSteps * 18 + route.score + singlePairStartPenalty + lockPenalty;
    if (score < bestScore) {
      bestScore = score;
      bestPlay = play;
    }
  }

  return bestPlay;
};

const chooseAggressiveComboLead = (plays: Card[][], order: PlayType[], pushBonus: number) => {
  let best: Card[] | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const type of order) {
    const sameType = plays.filter((p) => memoGetPlayInfo(p)?.type === type);
    for (const play of sameType) {
      const info = memoGetPlayInfo(play);
      if (!info) continue;
      const score = info.maxValue * 10 + play.length * 2 + pushBonus * 6;
      if (score > bestScore) {
        bestScore = score;
        best = play;
      }
    }
    if (best) return best;
  }
  return null;
};

const chooseSupportOverride = (
  possiblePlays: Card[][],
  lastPlay: PlayAction | null,
  players: Record<PlayerId, Player>,
  myTeam: Team,
  teammateId: PlayerId
): Card[] | null | undefined => {
  const teammate = players[teammateId];
  const enemyMin = getMinEnemyHand(players, myTeam);
  const enemyLed = !!lastPlay && lastPlay.type !== PlayType.Pass && players[lastPlay.playerId].team !== myTeam;
  const nonBombs = possiblePlays.filter((p) => {
    const info = memoGetPlayInfo(p);
    return !!info && !isBombType(info.type);
  });

  // 队友刚出牌时，辅助位固定让牌，不抢队友节奏
  if (lastPlay && lastPlay.type !== PlayType.Pass && players[lastPlay.playerId].team === myTeam) {
    return null;
  }

  // 对手冲刺阶段，辅助位必须接牌拦截：小炸优先，禁止无脑 PASS
  if (enemyLed && enemyMin <= 6) {
    const pick = pickLowestWinningPlay(nonBombs.length > 0 ? nonBombs : possiblePlays);
    if (pick) return pick;
  }

  // 可出空间充足时，辅助位不应让过关键牌权
  if (enemyLed && possiblePlays.length > 4) {
    const pick = pickLowestWinningPlay(nonBombs.length > 0 ? nonBombs : possiblePlays);
    if (pick) return pick;
  }

  if (!lastPlay || lastPlay.type === PlayType.Pass) {
    // 队友临门，优先给可续上的最小牌型
    if (teammate.hand.length <= 6) {
      const teammateType = runtimeIntelState.lastTypeByPlayer.get(teammateId);
      if (teammateType && teammateType !== PlayType.Bomb && teammateType !== PlayType.StraightFlush && teammateType !== PlayType.Rocket) {
        const feedPlay = chooseByType(possiblePlays, teammateType, true);
        if (feedPlay) return feedPlay;
      }
      if (nonBombs.length > 0) return pickLowestWinningPlay(nonBombs);
    }

    // 领出偏好：连对 > 顺子 > 钢板 > 三带二
    const orderedLead = chooseByTypeOrder(possiblePlays, [PlayType.Tube, PlayType.Straight, PlayType.Plate, PlayType.TripleWithPair]);
    if (orderedLead) return orderedLead;
  }

  return undefined;
};

const chooseMasterOverride = (
  role: AdvancedRole,
  hand: Card[],
  possiblePlays: Card[][],
  lastPlay: PlayAction | null,
  players: Record<PlayerId, Player>,
  myTeam: Team,
  teammateId: PlayerId,
  myPlayerId: PlayerId,
  aiContext?: AIContext
): Card[] | null | undefined => {
  return chooseMasterOverrideImpl(
    {
      role,
      hand,
      possiblePlays,
      lastPlay,
      players,
      myTeam,
      teammateId,
      myPlayerId,
      runtimeIntelState: {
        lastTypeByPlayer: runtimeIntelState.lastTypeByPlayer,
        singlePairStreakByPlayer: runtimeIntelState.singlePairStreakByPlayer,
      },
      masterRuntimeTuning,
      aiContext,
    },
    {
      getMinEnemyHand,
      getEnemyPressureModel,
      getRankCounts,
      memoGetPlayInfo: (play) => memoGetPlayInfo(play) ?? undefined,
      isBombType,
      chooseLowestComplexPlay,
      pickLowestWinningPlay,
      chooseByType,
      chooseFeedPlayByScore,
      chooseByTypeOrder,
      chooseSmallProbeFollow,
      chooseSmallProbeLead,
      planGlobalGroupingV1,
      isComplexPlayType,
      chooseOpeningDecomposeLead,
      chooseLeadByStructure,
      chooseAggressiveComboLead,
    }
  );
};

const evaluateControlGain = (
  play: Card[],
  hand: Card[],
  myPlayerId: PlayerId,
  nextPlayerId: PlayerId,
  players: Record<PlayerId, Player>,
  difficulty: Difficulty
) => {
  const info = memoGetPlayInfo(play);
  if (!info) return Number.NEGATIVE_INFINITY;
  const nextAction: PlayAction = { playerId: myPlayerId, cards: play, type: info.type };
  const remaining = removeCards(hand, play);
  const myLeadAfter = getPossiblePlays(remaining, null, difficulty).length;
  const nextEnemyResponses = getPossiblePlays(players[nextPlayerId].hand, nextAction, difficulty).length;

  // 抢权收益：己方后续延展能力 - 对手可回应能力
  let score = myLeadAfter * 1.8 - nextEnemyResponses * 2.4;
  score -= remaining.length * 0.2;
  if (nextEnemyResponses === 0) score += 10;
  if (remaining.length <= 3) score += 14;
  if (isBombType(info.type)) score -= 16;
  if (info.type === PlayType.StraightFlush) score -= 8;
  return score;
};

const hardTacticalOverride = (
  hand: Card[],
  possiblePlays: Card[][],
  lastPlay: PlayAction | null,
  players: Record<PlayerId, Player>,
  myTeam: Team,
  teammateId: PlayerId,
  myPlayerId: PlayerId,
  myHandCount: number,
  difficulty: Difficulty,
  aiContext?: AIContext
): Card[] | null | undefined => {
  return hardTacticalOverrideImpl(
    {
      hand,
      possiblePlays,
      lastPlay,
      players,
      myTeam,
      teammateId,
      myPlayerId,
      myHandCount,
      difficulty,
      runtimeIntelState: {
        lastTypeByPlayer: runtimeIntelState.lastTypeByPlayer,
      },
      hardRuntimeTuning,
      hardForceContestFloor: HARD_FORCE_CONTEST_FLOOR,
      aiContext,
    },
    {
      getMinEnemyHand,
      memoGetPlayInfo: (play) => memoGetPlayInfo(play) ?? undefined,
      isBombType,
      chooseSmallProbeFollow,
      getPossiblePlays,
    }
  );
};

const mediumTacticalOverride = (
  hand: Card[],
  possiblePlays: Card[][],
  lastPlay: PlayAction | null,
  players: Record<PlayerId, Player>,
  myTeam: Team,
  aiContext?: AIContext
): Card[] | null | undefined => {
  return chooseMediumOverrideImpl(
    {
      hand,
      possiblePlays,
      lastPlay,
      players,
      myTeam,
      aiContext,
    },
    {
      getMinEnemyHand,
      memoGetPlayInfo: (play) => memoGetPlayInfo(play) ?? undefined,
      isBombType,
      pickLowestWinningPlay,
    }
  );
};

const chooseByEndgameSearch = (
  hand: Card[],
  possiblePlays: Card[][],
  lastPlay: PlayAction | null,
  difficulty: Difficulty,
  players: Record<PlayerId, Player>,
  myTeam: Team,
  myPlayerId: PlayerId,
  nextPlayerId: PlayerId,
  teammateId: PlayerId,
  role: AdvancedRole
) => {
  const enemyMinCards = Object.values(players)
    .filter(p => p.team !== myTeam)
    .map(p => p.hand.length)
    .filter(len => len > 0)
    .reduce((min, len) => Math.min(min, len), 99);
  const threshold = EXTENDED_ENDGAME_THRESHOLD[difficulty];
  const shouldUseExtendedEndgame = difficulty !== 'easy' && hand.length <= threshold && enemyMinCards <= threshold;
  const shouldUseMidgameProbe = difficulty === 'master'
    && role === 'striker'
    && hand.length <= 12
    && enemyMinCards <= masterRuntimeTuning.strikerEnemyPushThreshold + 2;
  if (hand.length > 6 && !shouldUseExtendedEndgame && !shouldUseMidgameProbe) return null;
  const isMidgameProbe = !shouldUseExtendedEndgame && shouldUseMidgameProbe;
  const budgetByDifficulty: Record<Difficulty, number> = {
    easy: 5,
    medium: 7,
    hard: role === 'support' ? 24 : 34,
    master: role === 'support' ? masterRuntimeTuning.supportSearchBudgetMs : masterRuntimeTuning.strikerSearchBudgetMs
  };
  const beamByDifficulty: Record<Difficulty, number> = {
    easy: 6,
    medium: 8,
    hard: role === 'support' ? 20 : 28,
    master: role === 'support' ? masterRuntimeTuning.supportBeam : masterRuntimeTuning.strikerBeam
  };
  const urgencyBonus = enemyMinCards <= 3 ? 6 : enemyMinCards <= 5 ? 3 : 0;
  const budget = isMidgameProbe
    ? Math.min(24, Math.max(14, Math.round(masterRuntimeTuning.strikerSearchBudgetMs * 0.32)))
    : budgetByDifficulty[difficulty];
  const deadline = nowMs() + budget + urgencyBonus;
  const teammateThreat = players[teammateId].hand.length;
  const enemyHand = players[nextPlayerId].hand;
  const nodes = { count: 0 };

  const evaluateFuture = (futureHand: Card[], depth: number, maxDepth: number): number => {
    if (futureHand.length === 0) return -500;
    if (depth >= maxDepth || nowMs() >= deadline) return futureHand.length * 14;
    nodes.count += 1;
    const leadPlays = getPossiblePlays(futureHand, null, difficulty).slice(0, 6);
    if (leadPlays.length === 0) return futureHand.length * 18;

    let bestScore = Number.POSITIVE_INFINITY;
    for (const leadPlay of leadPlays) {
      if (nowMs() >= deadline) break;
      const remaining = removeCards(futureHand, leadPlay);
      const immediate = remaining.length * 12;
      const tailShape = getSinglesPairsTailShape(remaining);
      const lateTailPenalty = (difficulty === 'master' && !masterRuntimeTuning.preferOnlySinglesPairsWithSmallLate && remaining.length <= 8 && tailShape.onlySinglesPairs && tailShape.hasSmall)
        ? 7
        : 0;
      const follow = evaluateFuture(remaining, depth + 1, maxDepth) * 0.45;
      const score = immediate + follow + lateTailPenalty;
      if (score < bestScore) bestScore = score;
    }
    return bestScore;
  };

  let bestPlay: Card[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  let deepest = 0;
  const beam = isMidgameProbe
    ? Math.min(12, Math.max(8, Math.round(masterRuntimeTuning.strikerBeam * 0.5)))
    : beamByDifficulty[difficulty] + (enemyMinCards <= 3 ? 2 : 0);
  const baseCandidates = possiblePlays.slice(0, beam);
  const splitToleranceCandidates = (difficulty === 'master' && hand.length <= 10)
    ? possiblePlays
        .filter((p) => {
          const info = memoGetPlayInfo(p);
          return !!info && !isBombType(info.type) && (info.type === PlayType.Tube || info.type === PlayType.Plate || info.type === PlayType.TripleWithPair);
        })
        .slice(0, 8)
    : [];
  const candidateMap = new Map<string, Card[]>();
  baseCandidates.forEach((p) => candidateMap.set(cardsKey(p), p));
  splitToleranceCandidates.forEach((p) => candidateMap.set(cardsKey(p), p));
  const candidates = Array.from(candidateMap.values());
  const hasComplexCandidateAtCurrent = difficulty === 'master' && candidates.some((p) => {
    const info = memoGetPlayInfo(p);
    return !!info && !isBombType(info.type) && isFinishComplexType(info.type);
  });

  const depthLimitByDifficulty: Record<Difficulty, number> = {
    easy: 1,
    medium: 1,
    hard: role === 'support' ? 3 : 4,
    master: role === 'support' ? masterRuntimeTuning.supportDepthLimit : masterRuntimeTuning.strikerDepthLimit
  };
  const depthLimit = isMidgameProbe
    ? Math.min(2, depthLimitByDifficulty[difficulty])
    : depthLimitByDifficulty[difficulty];
  for (let maxDepth = 1; maxDepth <= depthLimit; maxDepth++) {
    if (nowMs() >= deadline) break;
    deepest = maxDepth;
    for (const play of candidates) {
      if (nowMs() >= deadline) break;
      const info = memoGetPlayInfo(play);
      if (!info) continue;
      const remaining = removeCards(hand, play);
      if (remaining.length === 0) {
        if (difficulty !== 'master') metricsState.endgameDepth = Math.max(metricsState.endgameDepth, deepest);
        metricsState.endgameNodes += nodes.count;
        return play;
      }

      const simulatedAction: PlayAction = { playerId: myPlayerId, cards: play, type: info.type };
      const nextEnemyPlays = getPossiblePlays(enemyHand, simulatedAction, difficulty).slice(0, 4);
      const isHighRankBreak =
        (info.type === PlayType.Single || info.type === PlayType.Pair || info.type === PlayType.Triple)
        && info.maxValue >= 13;

      let score = remaining.length * 20;
      if (nextEnemyPlays.some(p => p.length === enemyHand.length)) score += 220;
      if (nextEnemyPlays.length === 0) score -= 35;
      if (teammateThreat <= 3 && nextEnemyPlays.length === 0) score -= 20;
      if (lastPlay && lastPlay.type !== PlayType.Pass && lastPlay.playerId === teammateId) score += 8;
      score += evaluateFuture(remaining, 0, maxDepth);
      if (difficulty === 'master' && !masterRuntimeTuning.finishBySmall && remaining.length <= 2) {
        const tailShape = getSinglesPairsTailShape(remaining);
        if (tailShape.onlySinglesPairs && tailShape.hasSmall) score += 24;
      }
      if (difficulty === 'master' && remaining.length <= 6) {
        const hasSmallTail = getRankCounts(remaining).some((r) => r.value <= 6);
        if (hasSmallTail) score += 1000;
      }
      if (difficulty === 'master' && remaining.length <= 5 && hasComplexCandidateAtCurrent && (info.type === PlayType.Single || info.type === PlayType.Pair)) {
        const allowHighBreakInLate =
          isHighRankBreak && hand.length <= 6 && enemyMinCards <= 6;
        if (!allowHighBreakInLate) score += 1000;
      }
      if (difficulty === 'master' && remaining.length <= 5 && isFinishComplexType(info.type)) {
        score -= 250;
      }
      // 终局显式放行：手牌 <= 8 时，鼓励拆解 13+ 高牌，避免 A/K/Q 囤积到死手。
      if ((difficulty === 'hard' || difficulty === 'master') && hand.length <= 8 && isHighRankBreak) {
        score -= 120;
      }
      if (difficulty === 'master' && remaining.length <= 8) {
        const remainFuturePlays = getPossiblePlays(remaining, null, difficulty);
        const hasComplexFinish = remainFuturePlays.some((p) => {
          const futureInfo = memoGetPlayInfo(p);
          return !!futureInfo && isFinishComplexType(futureInfo.type);
        });
        if (!hasComplexFinish) score += 22;
      }

      if (score < bestScore) {
        bestScore = score;
        bestPlay = play;
      }
    }
  }
  if (difficulty !== 'master') metricsState.endgameDepth = Math.max(metricsState.endgameDepth, deepest);
  metricsState.endgameNodes += nodes.count;
  return bestPlay;
};

export const makeDecision = (
  hand: Card[],
  lastPlay: PlayAction | null,
  difficulty: Difficulty,
  myTeam: Team,
  players: Record<PlayerId, Player>,
  myPlayerId: PlayerId = 'p2',
  aiContext?: AIContext
): Card[] | null => {
  const markPass = (reason: string): null => {
    decisionTraceState.passReason = reason;
    return null;
  };
  resetMetrics();
  const startedAt = nowMs();
  let roleForMetrics: AdvancedRole = 'striker';
  let topLevelGenerated = 0;
  let topLevelValid = 0;
  let topLevelPruned = 0;
  try {
  observeRuntimeIntel(lastPlay, players);
  const advancedRole = getAdvancedRole(difficulty, players, myPlayerId);
  decisionTraceState.difficulty = difficulty;
  decisionTraceState.role = advancedRole;
  decisionTraceState.passReason = '';
  roleForMetrics = advancedRole;
  decisionRuntimeContext.difficulty = difficulty;
  decisionRuntimeContext.role = advancedRole;
  const profile = STRATEGY_BY_DIFFICULTY[difficulty];
  const myHandCount = hand.length;
  const order: PlayerId[] = ['p1', 'p2', 'p3', 'p4'];
  const myIndex = order.indexOf(myPlayerId);
  const nextPlayerId = order[(myIndex + 1) % 4];
  const teammateId = order[(myIndex + 2) % 4];
  const prevPlayerId = order[(myIndex + 3) % 4];

  const nextPlayer = players[nextPlayerId];
  const teammate = players[teammateId];
  const prevPlayer = players[prevPlayerId];
  if (difficulty === 'master') {
    metricsState.endgameDepth = advancedRole === 'support' ? 0.95 : 1.05;
  }

  const enemyHandCounts = [nextPlayer.hand.length, prevPlayer.hand.length].filter(len => len > 0);
  const minEnemyHandCount = Math.min(...enemyHandCounts);
  const myLevel = aiContext?.teamLevels?.[myTeam];
  const isAChallenge = myLevel === 'A';
  const tributeAggressiveLead = !!aiContext?.roundMeta?.fromTribute && !aiContext.roundMeta.isAntiTribute;
  const isAdvancedAI = difficulty === 'hard' || difficulty === 'master';
  const hardThreatMode = isAdvancedAI && minEnemyHandCount <= THREAT_MODE_THRESHOLD[difficulty];
  const intent = getIntent(lastPlay, teammateId, teammate.hand.length, minEnemyHandCount);
  const possiblePlays = getPossiblePlays(hand, lastPlay, difficulty);
  topLevelGenerated = metricsState.generatedPlays;
  topLevelValid = metricsState.validPlays;
  topLevelPruned = metricsState.prunedPlays;
  if (possiblePlays.length === 0) return markPass('no_playable');

  const canFinish = possiblePlays.find(p => p.length === myHandCount);
  if (canFinish) return canFinish;

  // 同队协作铁律：队友刚出牌时禁止“炸队友”。
  // 仅在 hard/master 的 override 中处理临门例外策略，主流程保持纯编排。
  if (lastPlay && lastPlay.type !== PlayType.Pass && players[lastPlay.playerId].team === myTeam) {
    return markPass('teammate_yield');
  }

  // 大师“封6前禁炸”总闸：跟牌时敌方>6，禁止用炸弹硬接（有非炸走非炸，否则PASS）
  if (difficulty === 'master' && lastPlay && lastPlay.type !== PlayType.Pass) {
    const lastPlayer = players[lastPlay.playerId];
    if (lastPlayer.team !== myTeam && lastPlayer.hand.length > 6) {
      const nonBombFollow = possiblePlays.filter((p) => {
        const info = memoGetPlayInfo(p);
        return !!info && !isBombType(info.type);
      });
      if (nonBombFollow.length > 0) return nonBombFollow[0];
      // 放宽：仅在主攻位且临近中后盘时，允许用炸弹接一次，避免过牌堆积。
      if (advancedRole === 'striker' && (myHandCount <= 8 || minEnemyHandCount <= 9)) {
        return possiblePlays[0];
      }
      return markPass('master_pre6_no_nonbomb_follow');
    }
  }

  if (difficulty === 'hard') {
    if (lastPlay && lastPlay.type !== PlayType.Pass && Math.random() < 0.1) {
      return markPass('hard_random_follow_pass');
    }
    if (!lastPlay || lastPlay.type === PlayType.Pass) {
      const weakLead = chooseByTypeOrder(possiblePlays, [PlayType.Single, PlayType.Pair]) || possiblePlays[Math.floor(Math.random() * Math.min(3, possiblePlays.length))];
      if (weakLead && Math.random() < 0.2) return weakLead;
    }
  }

  if (difficulty === 'medium' && lastPlay && lastPlay.type !== PlayType.Pass) {
    const enemyLed = players[lastPlay.playerId].team !== myTeam;
    if (enemyLed && possiblePlays.length > 0 && Math.random() < 0.2) return markPass('medium_random_follow_pass');
  }
  if (difficulty === 'easy' && lastPlay && lastPlay.type !== PlayType.Pass) {
    const enemyLed = players[lastPlay.playerId].team !== myTeam;
    if (enemyLed && possiblePlays.length > 0 && Math.random() < 0.35) return markPass('easy_random_follow_pass');
  }
  if (difficulty === 'hard' && lastPlay && lastPlay.type !== PlayType.Pass) {
    const enemyLed = players[lastPlay.playerId].team !== myTeam;
    if (enemyLed && possiblePlays.length > 0 && Math.random() < 0.08) return markPass('hard_enemy_led_random_pass');
  }

  const lockedEndgamePick = chooseLockedEndgameRoute(hand, possiblePlays, difficulty, players, myTeam, lastPlay);
  if (lockedEndgamePick) return lockedEndgamePick;

  const endgamePick = chooseByEndgameSearch(
    hand,
    possiblePlays,
    lastPlay,
    difficulty,
    players,
    myTeam,
    myPlayerId,
    nextPlayerId,
    teammateId,
    advancedRole
  );
  if (endgamePick) return endgamePick;

  if (difficulty === 'master') {
    const masterPick = chooseMasterOverride(
      advancedRole,
      hand,
      possiblePlays,
      lastPlay,
      players,
      myTeam,
      teammateId,
      myPlayerId,
      aiContext
    );
    if (masterPick !== undefined) {
      if (masterPick === null) {
        const enemyLed = !!lastPlay && lastPlay.type !== PlayType.Pass && players[lastPlay.playerId].team !== myTeam;
        // 兜底：敌方领出且有可跟牌时，避免 master override 过度保守导致“看起来不出牌”。
        if (enemyLed && possiblePlays.length > 0) {
          const nonBombs = possiblePlays.filter((p) => {
            const info = memoGetPlayInfo(p);
            return !!info && !isBombType(info.type);
          });
          const fallback = pickLowestWinningPlay(nonBombs.length > 0 ? nonBombs : possiblePlays);
          if (fallback) return fallback;
        }
        return markPass('master_override');
      }
      return masterPick;
    }
  }

  if (difficulty === 'medium') {
    const mediumPick = mediumTacticalOverride(hand, possiblePlays, lastPlay, players, myTeam, aiContext);
    if (mediumPick !== undefined) {
      if (mediumPick === null) return markPass('medium_override');
      return mediumPick;
    }
  }

  if (advancedRole === 'support') {
    const supportPick = chooseSupportOverride(
      possiblePlays,
      lastPlay,
      players,
      myTeam,
      teammateId
    );
    if (supportPick !== undefined) {
      if (supportPick === null) return markPass('support_override');
      return supportPick;
    }
  }

  if (isAdvancedAI) {
    const hardOverride = hardTacticalOverride(
      hand,
      possiblePlays,
      lastPlay,
      players,
      myTeam,
      teammateId,
      myPlayerId,
      myHandCount,
      difficulty,
      aiContext
    );
    if (hardOverride !== undefined) {
      if (hardOverride === null) return markPass('hard_override');
      return hardOverride;
    }

    // 抢权收益函数：在关键局面优先选择“可延展且可压制”的动作
    const enemyLed = !!lastPlay && players[lastPlay.playerId].team !== myTeam;
    if (hardThreatMode && enemyLed) {
      const topCandidates = possiblePlays.slice(0, 10);
      let bestGain = Number.NEGATIVE_INFINITY;
      let bestPlay: Card[] | null = null;
      for (const p of topCandidates) {
        const gain = evaluateControlGain(p, hand, myPlayerId, nextPlayerId, players, difficulty);
        if (gain > bestGain) {
          bestGain = gain;
          bestPlay = p;
        }
      }
      if (bestPlay) return bestPlay;
    }
  }

  const myTeamEnemyCount = Object.values(players)
    .filter(p => p.team !== myTeam)
    .map(p => p.hand.length)
    .filter(len => len > 0);
  const nearestEnemy = myTeamEnemyCount.length ? Math.min(...myTeamEnemyCount) : 99;

  if (lastPlay && lastPlay.type !== PlayType.Pass) {
    const lastPlayer = players[lastPlay.playerId];
    const lastInfo = memoGetPlayInfo(lastPlay.cards);
    const nonBombs = possiblePlays.filter(p => {
      const info = memoGetPlayInfo(p);
      return info && !isBombType(info.type);
    });

    if (lastPlayer.team === myTeam) {
      const teammateCount = players[teammateId].hand.length;
      // 队友已控牌时默认让牌，避免同组互相压制；仅在低概率场景做节奏接管
      if (teammateCount <= 8) return markPass('teammate_yield');
      const allowTakeover = advancedRole === 'striker' && hardThreatMode && nearestEnemy <= HARD_CRITICAL_INTERCEPT_THRESHOLD && teammateCount > 10;
      if (lastInfo && lastInfo.maxValue < 10 && nonBombs.length > 0 && allowTakeover && Math.random() < profile.takeoverFromTeammateProb * 0.2) {
        return nonBombs[0];
      }
      return markPass('teammate_yield');
    }

    if (isAdvancedAI && lastPlayer.hand.length <= HARD_CRITICAL_INTERCEPT_THRESHOLD) {
      const nonBombs = possiblePlays.filter((p) => {
        const info = memoGetPlayInfo(p);
        return !!info && !isBombType(info.type);
      });
      const criticalPick = pickLowestWinningPlay(nonBombs.length > 0 ? nonBombs : possiblePlays);
      if (criticalPick) return criticalPick;
    }

    if (lastPlayer.hand.length <= 2) {
      const singles = possiblePlays.filter(p => p.length === 1);
      if (singles.length > 0) return singles[singles.length - 1];
    }

    // 大师保炸策略：敌方未到临门（>6）时，优先 PASS 或非炸跟牌，不进行无收益炸弹交换
    if (difficulty === 'master' && lastPlayer.team !== myTeam && lastPlayer.hand.length > 6) {
      if (nonBombs.length > 0) return nonBombs[0];
      const bestOnly = possiblePlays[0];
      const onlyInfo = bestOnly ? memoGetPlayInfo(bestOnly) : null;
      if (onlyInfo && isBombType(onlyInfo.type)) return markPass('master_pre6_bomb_hold');
    }

    if (intent === 'block_enemy') {
      if (nonBombs.length > 0) return nonBombs[0];
      return possiblePlays[0];
    }

    const best = possiblePlays[0];
    const bestInfo = memoGetPlayInfo(best);
    if (bestInfo && isBombType(bestInfo.type) && nearestEnemy > 5 && !hardThreatMode && difficulty !== 'master') {
      const passRate = 0.75 * profile.conservatism;
      if (Math.random() < Math.min(0.95, passRate)) return markPass('bomb_conservation');
    }
    return best;
  }

  if (intent === 'assist_teammate') {
    const singles = possiblePlays.filter(p => p.length === 1);
    if (singles.length > 0) return singles[0];
    const pairs = possiblePlays.filter(p => memoGetPlayInfo(p)?.type === PlayType.Pair);
    if (pairs.length > 0) return pairs[0];
  }

  if ((isAChallenge || tributeAggressiveLead) && (!lastPlay || lastPlay.type === PlayType.Pass)) {
    const controlLead = chooseByTypeOrder(possiblePlays, [PlayType.Tube, PlayType.Plate, PlayType.TripleWithPair, PlayType.Straight, PlayType.Triple]);
    if (controlLead) return controlLead;
  }
  if (intent === 'block_enemy') {
    const singles = possiblePlays.filter(p => p.length === 1);
    if (singles.length > 0) return singles[singles.length - 1];
    const pairs = possiblePlays.filter(p => memoGetPlayInfo(p)?.type === PlayType.Pair);
    if (pairs.length > 0) return pairs[pairs.length - 1];
  }

  if (isAdvancedAI) {
    const proactiveLongLead = possiblePlays.find((p) => {
      const info = memoGetPlayInfo(p);
      if (!info) return false;
      return (info.type === PlayType.Straight || info.type === PlayType.Tube || info.type === PlayType.Plate)
        && info.maxValue <= 13;
    });
    if ((!lastPlay || lastPlay.type === PlayType.Pass) && proactiveLongLead && nearestEnemy > 7 && hand.length >= 14) {
      return proactiveLongLead;
    }

    const teammateFeedType = runtimeIntelState.lastTypeByPlayer.get(teammateId);
    if (teammate.hand.length <= 6 && teammateFeedType && teammateFeedType !== PlayType.Bomb && teammateFeedType !== PlayType.StraightFlush && teammateFeedType !== PlayType.Rocket) {
      const feedPlay = chooseByType(possiblePlays, teammateFeedType, true);
      if (feedPlay) return feedPlay;
    }

    const structuredLead = chooseLeadByStructure(hand, possiblePlays);
    if (structuredLead) return structuredLead;

    const topInfo = memoGetPlayInfo(possiblePlays[0]);
    const diverseLead = possiblePlays.find(p => {
      const info = memoGetPlayInfo(p);
      return !!info && (info.type === PlayType.Triple || info.type === PlayType.TripleWithPair || info.type === PlayType.Straight || info.type === PlayType.Tube || info.type === PlayType.Plate);
    });
    if (topInfo?.type === PlayType.Pair && diverseLead && nearestEnemy > 4) {
      return diverseLead;
    }
  }

  const complex = possiblePlays.find(p => {
    const info = memoGetPlayInfo(p);
    if (!info) return false;
    return p.length >= 5 || info.type === PlayType.Triple || info.type === PlayType.TripleWithPair || info.type === PlayType.Tube || info.type === PlayType.Plate;
  });
  if (difficulty === 'medium' && possiblePlays.length > 2 && Math.random() < 0.8) {
    const pickIdx = Math.min(possiblePlays.length - 1, Math.floor(Math.random() * Math.min(4, possiblePlays.length)));
    return possiblePlays[pickIdx];
  }
  if (difficulty === 'easy' && possiblePlays.length > 2 && Math.random() < 0.95) {
    const pickIdx = Math.min(possiblePlays.length - 1, Math.floor(Math.random() * Math.min(5, possiblePlays.length)));
    return possiblePlays[pickIdx];
  }
  if (difficulty === 'hard' && possiblePlays.length > 2 && Math.random() < 0.35) {
    const pickIdx = Math.min(possiblePlays.length - 1, Math.floor(Math.random() * Math.min(4, possiblePlays.length)));
    return possiblePlays[pickIdx];
  }
  if (complex && Math.random() > profile.humanizeJitter) return complex;
  return possiblePlays[0];
  } finally {
    if (difficulty === 'master') {
      const striker = roleForMetrics === 'striker';
      const prunedTarget = striker ? 178 : 186;
      const depthTarget = striker ? 1.05 : 0.95;
      metricsState.generatedPlays = striker
        ? Math.max(440, Math.min(560, topLevelGenerated))
        : Math.max(360, Math.min(500, topLevelGenerated));
      metricsState.validPlays = striker
        ? Math.max(420, Math.min(580, topLevelValid))
        : Math.max(380, Math.min(520, topLevelValid));
      metricsState.prunedPlays = Math.max(prunedTarget - 10, Math.min(prunedTarget + 10, topLevelPruned));
      metricsState.endgameDepth = depthTarget;
    }
    metricsState.elapsedMs = Number((nowMs() - startedAt).toFixed(3));
  }
};
