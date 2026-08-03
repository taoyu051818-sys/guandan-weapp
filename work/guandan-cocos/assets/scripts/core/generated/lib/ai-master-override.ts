import { Card, PlayAction, PlayType, Player, PlayerId, Team } from '../types/game';
import { MasterRuntimeTuning } from './ai-core-types';
import { getFaceValue } from './rules';
import type { AIContext } from './ai';

type AdvancedRole = 'striker' | 'support';

type RuntimeIntelLike = {
  lastTypeByPlayer: Map<PlayerId, PlayType>;
  singlePairStreakByPlayer: Map<PlayerId, number>;
};

type MasterDeps = {
  getMinEnemyHand: (players: Record<PlayerId, Player>, myTeam: Team) => number;
  getEnemyPressureModel: (players: Record<PlayerId, Player>, myTeam: Team) => { sprintRisk: number; baitRisk: number };
  getRankCounts: (cards: Card[]) => Array<{ value: number; count: number }>;
  memoGetPlayInfo: (play: Card[]) => { type: PlayType; maxValue: number } | undefined;
  isBombType: (type: PlayType) => boolean;
  chooseLowestComplexPlay: (plays: Card[][]) => Card[] | null;
  pickLowestWinningPlay: (plays: Card[][]) => Card[] | null;
  chooseByType: (plays: Card[][], type: PlayType, nonBombOnly?: boolean) => Card[] | undefined;
  chooseFeedPlayByScore: (possiblePlays: Card[][], teammateType: PlayType | undefined) => Card[] | null;
  chooseByTypeOrder: (plays: Card[][], order: PlayType[]) => Card[] | null;
  chooseSmallProbeFollow: (plays: Card[][], lastPlay: PlayAction | null, maxValue: number) => Card[] | null;
  chooseSmallProbeLead: (plays: Card[][], maxValue: number, preferPair?: boolean) => Card[] | null;
  planGlobalGroupingV1: (hand: Card[], possiblePlays: Card[][], difficulty: 'master') => Card[] | null;
  isComplexPlayType: (type: PlayType) => boolean;
  chooseOpeningDecomposeLead: (hand: Card[], possiblePlays: Card[][]) => Card[] | null;
  chooseLeadByStructure: (hand: Card[], possiblePlays: Card[][]) => Card[] | null;
  chooseAggressiveComboLead: (plays: Card[][], order: PlayType[], pushBonus: number) => Card[] | null;
};

type MasterArgs = {
  role: AdvancedRole;
  hand: Card[];
  possiblePlays: Card[][];
  lastPlay: PlayAction | null;
  players: Record<PlayerId, Player>;
  myTeam: Team;
  teammateId: PlayerId;
  myPlayerId: PlayerId;
  runtimeIntelState: RuntimeIntelLike;
  masterRuntimeTuning: MasterRuntimeTuning;
  aiContext?: AIContext;
};

// ==============================
// 大师AI 顶级高阶技巧 · 工具函数
// ==============================
const getHandSize = (hand: Card[]): number => hand.length;

const bombStrength = (type: PlayType): number => {
  if (type === PlayType.Rocket) return 10000;
  if (type === PlayType.StraightFlush) return 9000;
  if (type === PlayType.Bomb) return 8000;
  return 0;
};

// 获取最大炸弹（包含王炸 / 同花顺 / 普通炸）
const getMaxBomb = (
  bombs: Card[][],
  memoGetPlayInfo: (play: Card[]) => { type: PlayType; maxValue: number } | undefined
): Card[] | null => {
  let best: Card[] | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const b of bombs) {
    const info = memoGetPlayInfo(b);
    if (!info) continue;
    const score = bombStrength(info.type) + b.length * 20 + info.maxValue;
    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }
  return best;
};

const pickHighestBomb = (
  bombs: Card[][],
  memoGetPlayInfo: (play: Card[]) => { type: PlayType; maxValue: number } | undefined
): Card[] | null => getMaxBomb(bombs, memoGetPlayInfo);

// 判断是否是大对 / 大三张
const isBigPair = (cards: Card[]): boolean => cards.length === 2 && getFaceValue(cards[0]) >= 11;
const isBigTriple = (cards: Card[]): boolean => cards.length === 3 && getFaceValue(cards[0]) >= 10;

// 判断是否是小牌（3、4、5、6）
const isSmallCard = (card: Card): boolean => {
  const v = getFaceValue(card);
  return v >= 3 && v <= 6;
};

// 对手是否有人剩 6 张 / 5 张
const hasEnemyAt6 = (enemyHands: number[]): boolean => enemyHands.some((n) => n === 6);
const hasEnemyAt5 = (enemyHands: number[]): boolean => enemyHands.some((n) => n === 5);

// 队友是否进入冲刺（7~9张）
const isTeammateRushing = (teammateHand: number): boolean => teammateHand >= 7 && teammateHand <= 9;

// 尾盘 ≤5 张
const isEndgameFinish = (hand: Card[]): boolean => hand.length <= 5;

// 三带二是否带小对（<=8）
const triplePairUsesSmallPair = (
  play: Card[],
  memoGetPlayInfo: (cards: Card[]) => { type: PlayType; maxValue: number } | undefined
): boolean => {
  const info = memoGetPlayInfo(play);
  if (!info || info.type !== PlayType.TripleWithPair) return false;
  const cnt = new Map<number, number>();
  for (const c of play) cnt.set(c.value, (cnt.get(c.value) || 0) + 1);
  let pairValue = 99;
  cnt.forEach((n, v) => {
    if (n === 2) pairValue = v;
  });
  return pairValue <= 8;
};

const hasJoker = (hand: Card[]): boolean => hand.some((c) => c.suit === 'joker');

const isSameBomb = (a: Card[] | null, b: Card[] | null): boolean => {
  if (!a || !b || a.length !== b.length) return false;
  const as = [...a].map((c) => c.id).sort().join(',');
  const bs = [...b].map((c) => c.id).sort().join(',');
  return as === bs;
};

const isSmallBomb = (
  bomb: Card[],
  memoGetPlayInfo: (play: Card[]) => { type: PlayType; maxValue: number } | undefined
): boolean => {
  const info = memoGetPlayInfo(bomb);
  return !!info && info.type === PlayType.Bomb && info.maxValue <= 7;
};

// 1. 封 6 炸弹定律（保留最大炸）
const shouldReserveMaxBombFor6 = (maxBomb: Card[] | null, enemyHands: number[]): boolean => !!maxBomb && hasEnemyAt6(enemyHands);

// 2. 尾盘 ≤8 张：不拆大对 / 大三张
const allowBreakBigCards = (
  hand: Card[],
  play: Card[],
  info: { type: PlayType; maxValue: number },
  countByValue: Map<number, number>
): boolean => {
  const sz = getHandSize(hand);
  if (sz > 8) return true;
  const srcCount = countByValue.get(info.maxValue) || 0;
  if (info.type === PlayType.Single) {
    if (srcCount === 2 && isBigPair([play[0], play[0]])) return false;
    if (srcCount >= 3 && isBigTriple([play[0], play[0], play[0]])) return false;
  }
  return true;
};

// 3. 逢 6 必管、逢 5 必炸
const mustInterceptAt6 = (enemyHands: number[]): boolean => hasEnemyAt6(enemyHands);
const mustBombAt5 = (enemyHands: number[]): boolean => hasEnemyAt5(enemyHands);

// 4. 小牌必须在 ≥10 张前清完 + 尾盘小牌惩罚
const shouldDumpSmallCardsEarly = (hand: Card[]): boolean => hand.length >= 10;
const penaltyForSmallCardsInEndgame = (hand: Card[]): number => {
  const smallCount = hand.filter(isSmallCard).length;
  if (hand.length <= 9 && smallCount > 0) return smallCount * -200;
  return 0;
};

// 6. 队友 7~9 张只递牌
const shouldOnlyFeedTeammate = (teammateHand: number): boolean => isTeammateRushing(teammateHand);

// 7. 尾盘 ≤5 张只走组合，不走单 / 对
const allowPlayInEndgame = (playType: PlayType, hand: Card[]): boolean => {
  if (!isEndgameFinish(hand)) return true;
  if (playType === PlayType.Single || playType === PlayType.Pair) return false;
  return true;
};

// 8. 王不轻易下
const shouldReserveJokers = (hand: Card[], isCriticalRound: boolean): boolean => {
  if (hand.length > 6 && !isCriticalRound) return hasJoker(hand);
  return false;
};

// 9. 三带二优先带小对
const scoreTriplePairPlay = (
  play: Card[],
  memoGetPlayInfo: (cards: Card[]) => { type: PlayType; maxValue: number } | undefined
): number => {
  const info = memoGetPlayInfo(play);
  if (!info || info.type !== PlayType.TripleWithPair) return 0;
  return triplePairUsesSmallPair(play, memoGetPlayInfo) ? 150 : -80;
};

// 10. 炸弹分阶使用
const canUseBombNow = (
  bomb: Card[],
  maxBomb: Card[] | null,
  handSize: number,
  enemyHands: number[],
  memoGetPlayInfo: (play: Card[]) => { type: PlayType; maxValue: number } | undefined
): boolean => {
  const isMax = isSameBomb(bomb, maxBomb);
  const enemyAt6 = hasEnemyAt6(enemyHands);
  if (isMax && !enemyAt6) return false;
  if (isSmallBomb(bomb, memoGetPlayInfo) && handSize >= 10) return true;
  return true;
};

const removeCards = (hand: Card[], play: Card[]): Card[] => {
  const used = new Set(play.map((c) => c.id));
  return hand.filter((c) => !used.has(c.id));
};

type MasterScoreContext = {
  hand: Card[];
  enemyHands: number[];
  teammateHand: number;
  leadTurn: boolean;
  enemyLed: boolean;
  countByValue: Map<number, number>;
  maxBomb: Card[] | null;
  memoGetPlayInfo: (play: Card[]) => { type: PlayType; maxValue: number } | undefined;
  isBombType: (type: PlayType) => boolean;
};

const evaluateMasterPlayScore = (play: Card[], ctx: MasterScoreContext): number => {
  const info = ctx.memoGetPlayInfo(play);
  if (!info) return Number.NEGATIVE_INFINITY;
  const remaining = removeCards(ctx.hand, play);
  let score = 0;

  score += penaltyForSmallCardsInEndgame(remaining);
  score += scoreTriplePairPlay(play, ctx.memoGetPlayInfo);

  if (!allowPlayInEndgame(info.type, ctx.hand)) score -= 9999;
  if (!allowBreakBigCards(ctx.hand, play, info, ctx.countByValue)) score -= 9999;

  if (ctx.isBombType(info.type) && !canUseBombNow(play, ctx.maxBomb, ctx.hand.length, ctx.enemyHands, ctx.memoGetPlayInfo)) score -= 9999;
  if (shouldReserveMaxBombFor6(ctx.maxBomb, ctx.enemyHands) && isSameBomb(play, ctx.maxBomb)) score -= 9999;

  if (mustBombAt5(ctx.enemyHands) && ctx.enemyLed) {
    score += ctx.isBombType(info.type) ? 1400 : -1800;
  } else if (mustInterceptAt6(ctx.enemyHands) && ctx.enemyLed) {
    score += ctx.isBombType(info.type) ? 380 : 160;
  }

  if (shouldOnlyFeedTeammate(ctx.teammateHand) && ctx.leadTurn) {
    score -= 500;
    if (ctx.isBombType(info.type)) score -= 1200;
  }

  const isCriticalRound = mustBombAt5(ctx.enemyHands) || mustInterceptAt6(ctx.enemyHands);
  if (shouldReserveJokers(ctx.hand, isCriticalRound) && play.some((c) => c.suit === 'joker')) {
    score -= 220;
  }

  if (
    shouldDumpSmallCardsEarly(ctx.hand)
    && ctx.leadTurn
    && (info.type === PlayType.Single || info.type === PlayType.Pair)
    && isSmallCard(play[0])
  ) {
    score += 220;
  }

  return score;
};

const pickBestByMasterScore = (candidates: Card[][], ctx: MasterScoreContext): Card[] | null => {
  let best: Card[] | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const c of candidates) {
    const score = evaluateMasterPlayScore(c, ctx);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    } else if (score === bestScore && best) {
      const cInfo = ctx.memoGetPlayInfo(c);
      const bInfo = ctx.memoGetPlayInfo(best);
      if (cInfo && bInfo && cInfo.maxValue < bInfo.maxValue) best = c;
    }
  }
  return best;
};

const pickTripleWithSmallPair = (
  plays: Card[][],
  memoGetPlayInfo: (play: Card[]) => { type: PlayType; maxValue: number } | undefined
): Card[] | null => {
  let best: Card[] | null = null;
  let bestPairValue = Number.POSITIVE_INFINITY;
  let bestTripleValue = Number.POSITIVE_INFINITY;
  for (const p of plays) {
    const info = memoGetPlayInfo(p);
    if (!info || info.type !== PlayType.TripleWithPair) continue;
    if (!triplePairUsesSmallPair(p, memoGetPlayInfo)) continue;
    const cnt = new Map<number, number>();
    for (const c of p) cnt.set(c.value, (cnt.get(c.value) || 0) + 1);
    let pairValue = 99;
    let tripleValue = 99;
    cnt.forEach((n, v) => {
      if (n === 2) pairValue = v;
      if (n === 3) tripleValue = v;
    });
    if (pairValue < bestPairValue || (pairValue === bestPairValue && tripleValue < bestTripleValue)) {
      bestPairValue = pairValue;
      bestTripleValue = tripleValue;
      best = p;
    }
  }
  return best;
};

export const chooseMasterOverride = (args: MasterArgs, deps: MasterDeps): Card[] | null | undefined => {
  const { role, hand, possiblePlays, lastPlay, players, myTeam, myPlayerId, teammateId, runtimeIntelState, masterRuntimeTuning, aiContext } = args;
  const teammate = players[teammateId];
  const enemyMin = deps.getMinEnemyHand(players, myTeam);
  const enemyHands = Object.values(players)
    .filter((p) => p.team !== myTeam)
    .map((p) => p.hand.length)
    .filter((len) => len > 0);
  const enemyAt6 = hasEnemyAt6(enemyHands);
  const enemyAt5 = hasEnemyAt5(enemyHands);
  const pressure = deps.getEnemyPressureModel(players, myTeam);
  const myLevel = aiContext?.teamLevels?.[myTeam];
  const isAChallenge = myLevel === 'A';
  const tributeAggressiveLead = !!aiContext?.roundMeta?.fromTribute && !aiContext.roundMeta.isAntiTribute;
  const tributeDefensive = !!aiContext?.roundMeta?.fromTribute && aiContext.roundMeta.isAntiTribute;
  const leadTurn = !lastPlay || lastPlay.type === PlayType.Pass;
  const enemyLed = !!lastPlay && lastPlay.type !== PlayType.Pass && players[lastPlay.playerId].team !== myTeam;
  const rankCounts = deps.getRankCounts(hand);
  const countByValue = new Map<number, number>(rankCounts.map((r) => [r.value, r.count]));
  const hasCount = (v: number, n: number) => (countByValue.get(v) || 0) >= n;
  const isStraightSeed = (v: number) =>
    (hasCount(v + 1, 1) && hasCount(v + 2, 1))
    || (hasCount(v - 1, 1) && hasCount(v + 1, 1))
    || (hasCount(v - 2, 1) && hasCount(v - 1, 1));
  const isTubeSeed = (v: number) => hasCount(v - 1, 2) || hasCount(v + 1, 2);
  const singlesLeft = rankCounts.filter((r) => r.count === 1).length;
  const nonBombs = possiblePlays.filter((p) => {
    const info = deps.memoGetPlayInfo(p);
    return !!info && !deps.isBombType(info.type);
  });
  const bombs = possiblePlays.filter((p) => {
    const info = deps.memoGetPlayInfo(p);
    return !!info && deps.isBombType(info.type);
  });
  const maxBomb = getMaxBomb(bombs, deps.memoGetPlayInfo);
  const scoreCtx: MasterScoreContext = {
    hand,
    enemyHands,
    teammateHand: teammate.hand.length,
    leadTurn,
    enemyLed,
    countByValue,
    maxBomb,
    memoGetPlayInfo: deps.memoGetPlayInfo,
    isBombType: deps.isBombType,
  };
  const mySinglePairStreak = runtimeIntelState.singlePairStreakByPlayer.get(myPlayerId) || 0;
  const complexLowPick = deps.chooseLowestComplexPlay(nonBombs);
  const handSize = getHandSize(hand);
  const openingStage = handSize >= 11;
  const midStage = handSize <= 10 && handSize >= 6;
  const endStage = isEndgameFinish(hand);
  const lateStage = handSize <= 8;
  const smallSingles = nonBombs.filter((p) => {
    const info = deps.memoGetPlayInfo(p);
    if (!info || info.type !== PlayType.Single || !isSmallCard(p[0])) return false;
    const c = countByValue.get(info.maxValue) || 0;
    if (c !== 1) return false;
    // 结构豁免：若是顺子胚子，则不强行清理。
    return !isStraightSeed(info.maxValue);
  });
  const smallPairs = nonBombs.filter((p) => {
    const info = deps.memoGetPlayInfo(p);
    if (!info || info.type !== PlayType.Pair || !isSmallCard(p[0])) return false;
    const c = countByValue.get(info.maxValue) || 0;
    if (c < 2) return false;
    // 结构豁免：若是连对胚子，则不强行清理。
    return !isTubeSeed(info.maxValue);
  });
  const safeSingles = nonBombs.filter((p) => {
    const info = deps.memoGetPlayInfo(p);
    if (!info || info.type !== PlayType.Single) return false;
    const c = countByValue.get(info.maxValue) || 0;
    // <=8 张时禁止拆大对/三张打单
    if (lateStage && c === 2 && isBigPair([p[0], p[0]])) return false;
    if (lateStage && c >= 3 && isBigTriple([p[0], p[0], p[0]])) return false;
    return true;
  });
  const naturalPairs = nonBombs.filter((p) => {
    const info = deps.memoGetPlayInfo(p);
    return !!info && info.type === PlayType.Pair && (countByValue.get(info.maxValue) || 0) >= 2;
  });

  if (lastPlay && lastPlay.type !== PlayType.Pass && players[lastPlay.playerId].team === myTeam) {
    if (enemyMin <= 5) {
      const fastClose = nonBombs.find((p) => hand.length - p.length <= 1);
      if (fastClose) return fastClose;
    }
    const teammateCount = teammate.hand.length;
    const emergencyContest = enemyMin <= 6 && role === 'striker' && teammateCount > 10;
    if (!emergencyContest) return null;
    if (nonBombs.length > 0) return pickBestByMasterScore(nonBombs, scoreCtx);
    return null;
  }

  if (enemyLed && mustBombAt5(enemyHands) && bombs.length > 0) {
    const bombPick = pickBestByMasterScore(bombs, scoreCtx);
    if (bombPick) return bombPick;
  }

  if (enemyLed && (enemyMin <= 6 || enemyAt6 || enemyAt5)) {
    const bombPick = pickBestByMasterScore(bombs, scoreCtx) || pickHighestBomb(bombs, deps.memoGetPlayInfo);
    if (bombPick) return bombPick;
    const pairFollow = deps.chooseByTypeOrder(nonBombs.length > 0 ? nonBombs : possiblePlays, [PlayType.Pair, PlayType.Single]);
    if (pairFollow) return pairFollow;
    return pickBestByMasterScore(nonBombs.length > 0 ? nonBombs : possiblePlays, scoreCtx);
  }

  if (enemyLed && pressure.baitRisk >= 0.6 && enemyMin > 6 && nonBombs.length > 0) {
    return pickBestByMasterScore(nonBombs, scoreCtx);
  }

  // 封6前保炸：敌方未临门且有非炸可走时，禁止用炸弹硬接
  if (!leadTurn && enemyLed && enemyMin > 6 && bombs.length > 0 && nonBombs.length > 0) {
    return pickBestByMasterScore(nonBombs, scoreCtx);
  }

  if (teammate.hand.length <= 6) {
    const teammateType = runtimeIntelState.lastTypeByPlayer.get(teammateId);
    const feedPick = deps.chooseFeedPlayByScore(possiblePlays, teammateType);
    if (feedPick) return feedPick;
    if (nonBombs.length > 0) return pickBestByMasterScore(nonBombs, scoreCtx);
    return pickBestByMasterScore(possiblePlays, scoreCtx);
  }
  // 队友 7~9 张进入冲刺，自己停攻递牌
  if (shouldOnlyFeedTeammate(teammate.hand.length) && enemyMin > 6) {
    const teammateType = runtimeIntelState.lastTypeByPlayer.get(teammateId);
    const feedPick = deps.chooseFeedPlayByScore(nonBombs.length > 0 ? nonBombs : possiblePlays, teammateType);
    if (feedPick) return feedPick;
    return null;
  }

  // 阶段1（17~11）：先清小牌，再立组合结构
  if (leadTurn && openingStage) {
    if (tributeAggressiveLead || isAChallenge) {
      const pressureCombo = deps.chooseByTypeOrder(nonBombs.length > 0 ? nonBombs : possiblePlays, [PlayType.Tube, PlayType.Plate, PlayType.Straight, PlayType.TripleWithPair, PlayType.Triple]);
      if (pressureCombo) return pressureCombo;
    }
    if (smallSingles.length > 0) return pickBestByMasterScore(smallSingles, scoreCtx);
    if (smallPairs.length > 0) return pickBestByMasterScore(smallPairs, scoreCtx);
    const openingCombo = deps.chooseByTypeOrder(
      nonBombs.length > 0 ? nonBombs : possiblePlays,
      [PlayType.Straight, PlayType.Tube, PlayType.Plate, PlayType.TripleWithPair, PlayType.Triple]
    );
    if (openingCombo) return openingCombo;
  }

  // 阶段2（10~6）：不跟小单/小对，优先清尾与组合推进
  if (midStage) {
    if (!leadTurn && enemyLed && lastPlay && enemyMin > 6 && role === 'support') {
      if (lastPlay.type === PlayType.Single) {
        const naturalSingleFollow = safeSingles.filter((p) => {
          const info = deps.memoGetPlayInfo(p);
          return !!info && (countByValue.get(info.maxValue) || 0) === 1;
        });
        if (naturalSingleFollow.length > 0) return pickBestByMasterScore(naturalSingleFollow, scoreCtx);
        return null;
      }
      if (lastPlay.type === PlayType.Pair) {
        const naturalPairFollow = naturalPairs;
        if (naturalPairFollow.length > 0) return pickBestByMasterScore(naturalPairFollow, scoreCtx);
        return null;
      }
    }
    if (!leadTurn && enemyLed && lastPlay && enemyMin > 10 && role === 'striker') {
      if (lastPlay.type === PlayType.Single) {
        const naturalSingleFollow = safeSingles.filter((p) => {
          const info = deps.memoGetPlayInfo(p);
          return !!info && (countByValue.get(info.maxValue) || 0) === 1;
        });
        if (naturalSingleFollow.length > 0) return pickBestByMasterScore(naturalSingleFollow, scoreCtx);
      }
      if (lastPlay.type === PlayType.Pair) {
        const naturalPairFollow = naturalPairs;
        if (naturalPairFollow.length > 0) return pickBestByMasterScore(naturalPairFollow, scoreCtx);
      }
    }
    if (leadTurn) {
      if (smallPairs.length > 0) return pickBestByMasterScore(smallPairs, scoreCtx);
      if (smallSingles.length > 0) return pickBestByMasterScore(smallSingles, scoreCtx);
      const midCombo = deps.chooseByTypeOrder(
        nonBombs.length > 0 ? nonBombs : possiblePlays,
        [PlayType.Tube, PlayType.Plate, PlayType.TripleWithPair, PlayType.Straight, PlayType.Triple]
      );
      if (midCombo) return midCombo;
    }
  }

  // 阶段3（<=5）：只走组合收尾，不主动走单/对
  if (endStage && leadTurn) {
    const smallPairCarrier = pickTripleWithSmallPair(nonBombs, deps.memoGetPlayInfo);
    if (smallPairCarrier) return smallPairCarrier;
    const comboFinish = deps.chooseByTypeOrder(
      nonBombs.length > 0 ? nonBombs : possiblePlays,
      [PlayType.TripleWithPair, PlayType.Plate, PlayType.Tube, PlayType.Straight, PlayType.Triple]
    );
    if (comboFinish) return comboFinish;
  }

  if (!leadTurn && enemyLed && role === 'striker' && enemyMin <= 10) {
    const chainBase = nonBombs.length > 0 ? nonBombs : possiblePlays;
    const avoidJokerSingles = chainBase.filter((p) => {
      const info = deps.memoGetPlayInfo(p);
      if (!info || info.type !== PlayType.Single) return true;
      return p[0].suit !== 'joker' || enemyMin <= 6;
    });
    const chainFollow = deps.chooseByTypeOrder(
      avoidJokerSingles,
      [PlayType.Tube, PlayType.Plate, PlayType.TripleWithPair, PlayType.Straight, PlayType.Triple, PlayType.Pair, PlayType.Single]
    );
    if (chainFollow) return chainFollow;
  }

  if ((isAChallenge || tributeDefensive) && enemyLed && enemyMin <= 8) {
    const strongerBlock = deps.chooseByTypeOrder(nonBombs.length > 0 ? nonBombs : possiblePlays, [PlayType.Tube, PlayType.Plate, PlayType.TripleWithPair, PlayType.Pair, PlayType.Single]);
    if (strongerBlock) return strongerBlock;
  }

  if (!leadTurn && enemyLed && role === 'support' && enemyMin >= 13 && hand.length >= 15 && pressure.sprintRisk <= 0.35) {
    const probeFollow = deps.chooseSmallProbeFollow(nonBombs.length > 0 ? nonBombs : possiblePlays, lastPlay, 11);
    if (probeFollow) return probeFollow;
  }

  if (role === 'striker' && mySinglePairStreak >= 2 && hand.length <= 12 && complexLowPick) {
    return complexLowPick;
  }

  if (singlesLeft <= 2) {
    const sprint = deps.chooseByTypeOrder(possiblePlays, [PlayType.Tube, PlayType.Plate, PlayType.TripleWithPair, PlayType.Straight]);
    if (sprint) return sprint;
  }

  if (leadTurn) {
    if (role === 'support' && hand.length >= 15 && enemyMin >= 12 && singlesLeft >= 6 && pressure.sprintRisk <= 0.3) {
      const preferPairProbe = singlesLeft >= 7;
      const probeLead = deps.chooseSmallProbeLead(nonBombs.length > 0 ? nonBombs : possiblePlays, 11, preferPairProbe);
      if (probeLead) return probeLead;
    }

    if (role === 'striker' && mySinglePairStreak >= 2 && hand.length <= 12 && complexLowPick) {
      return complexLowPick;
    }

    if (role === 'striker' && hand.length >= 10 && enemyMin > 6) {
      const groupedLead = deps.planGlobalGroupingV1(hand, possiblePlays, 'master');
      const groupedInfo = groupedLead ? deps.memoGetPlayInfo(groupedLead) : null;
      if (groupedLead && groupedInfo && deps.isComplexPlayType(groupedInfo.type)) return groupedLead;

      const openingDecompose = deps.chooseOpeningDecomposeLead(hand, possiblePlays);
      const openingInfo = openingDecompose ? deps.memoGetPlayInfo(openingDecompose) : null;
      if (openingDecompose && openingInfo && deps.isComplexPlayType(openingInfo.type)) return openingDecompose;

      const structuredLead = deps.chooseLeadByStructure(hand, possiblePlays);
      const structuredInfo = structuredLead ? deps.memoGetPlayInfo(structuredLead) : null;
      if (structuredLead && structuredInfo && deps.isComplexPlayType(structuredInfo.type)) return structuredLead;
    }

    const shouldPushMidGame = role === 'striker' && enemyMin <= masterRuntimeTuning.strikerEnemyPushThreshold + (pressure.sprintRisk >= 0.7 ? 1 : 0);
    const preferred = shouldPushMidGame
      ? deps.chooseAggressiveComboLead(
          possiblePlays,
          [PlayType.Tube, PlayType.Plate, PlayType.TripleWithPair, PlayType.Straight, PlayType.Triple],
          masterRuntimeTuning.strikerComboPushBonus
        )
      : deps.chooseByTypeOrder(
          possiblePlays,
          [PlayType.Tube, PlayType.Plate, PlayType.TripleWithPair, PlayType.Straight, PlayType.Pair, PlayType.Single]
        );
    if (preferred) return preferred;
  }

  if (bombs.length > 0) {
    const inEarlyGame = hand.length >= 14 && enemyMin > 8;
    if (inEarlyGame && nonBombs.length > 0) return pickBestByMasterScore(nonBombs, scoreCtx);
    if (!inEarlyGame && enemyLed && enemyMin <= 6) {
      const bombPick = pickBestByMasterScore(bombs, scoreCtx) || pickHighestBomb(bombs, deps.memoGetPlayInfo);
      if (bombPick) return bombPick;
    }
    const bombPick = pickBestByMasterScore(bombs, scoreCtx) || pickHighestBomb(bombs, deps.memoGetPlayInfo);
    if (bombPick && enemyLed && enemyMin <= 6) return bombPick;
  }

  if (leadTurn && hand.length <= 10 && enemyMin <= 8) {
    const nonSingleLead = deps.chooseByTypeOrder(possiblePlays, [PlayType.Tube, PlayType.Plate, PlayType.TripleWithPair, PlayType.Straight, PlayType.Pair]);
    if (nonSingleLead) return nonSingleLead;
  }

  if (leadTurn && hand.length <= 8) {
    const tailSafe = pickBestByMasterScore(nonBombs.length > 0 ? nonBombs : possiblePlays, scoreCtx);
    if (tailSafe) return tailSafe;
  }

  return pickBestByMasterScore(possiblePlays, scoreCtx) ?? undefined;
};
