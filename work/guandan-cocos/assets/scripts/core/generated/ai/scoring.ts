import { compareBombResolutions, type RuleProfile } from '../lib/rules';
import { PlayType, type Card, type PlayAction } from '../types/game';
import type {
  Difficulty,
  HardRuntimeTuning,
  MasterRuntimeTuning,
  StrategyProfile,
} from './types';

export type RankCount = { value: number; count: number };
export type CachedPlayInfo = { type: PlayType; maxValue: number; length?: number } | null;

export const isBombType = (type: PlayType): boolean =>
  type === PlayType.Bomb || type === PlayType.StraightFlush || type === PlayType.Rocket;

export const getRankCounts = (cards: Card[]): RankCount[] => {
  const counts = new Map<number, number>();
  cards.forEach((card) => counts.set(card.value, (counts.get(card.value) ?? 0) + 1));
  return Array.from(counts, ([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || right.value - left.value);
};

export const pickLowestWinningPlayByResolution = (
  plays: Card[][],
  resolvePlay: (play: Card[]) => CachedPlayInfo,
): Card[] | null => {
  if (plays.length <= 1) return plays[0] ?? null;
  const rank = (play: Card[]): number => {
    const info = resolvePlay(play);
    if (!info) return Number.POSITIVE_INFINITY;
    const bombOffset = isBombType(info.type) ? 100_000 : 0;
    return bombOffset + info.maxValue * 100 + play.length;
  };
  return [...plays].sort((leftPlay, rightPlay) => {
    const left = resolvePlay(leftPlay);
    const right = resolvePlay(rightPlay);
    if (left && right && isBombType(left.type) && isBombType(right.type)) {
      return compareBombResolutions(left, right);
    }
    return rank(leftPlay) - rank(rightPlay);
  })[0] ?? null;
};

export type CandidateScorerOptions = {
  resolvePlay: (cards: Card[], lastPlay: PlayAction | null, ruleProfile: RuleProfile) => CachedPlayInfo;
  getHardTuning: () => HardRuntimeTuning;
  getMasterTuning: () => MasterRuntimeTuning;
};

export type CandidateScoreContext = {
  handCountMap: Map<number, number>;
  isLeadTurn: boolean;
  profile: Readonly<StrategyProfile>;
  ruleProfile: RuleProfile;
  lastPlay: PlayAction | null;
};

export type CandidateScorer = {
  score: (play: Card[], context: CandidateScoreContext) => number;
  pruneEquivalent: (plays: Card[][], context: CandidateScoreContext) => Card[][];
  sort: (
    plays: Card[][],
    hand: Card[],
    difficulty: Difficulty,
    context: CandidateScoreContext,
  ) => Card[][];
};

export const createCandidateScorer = ({
  resolvePlay,
  getHardTuning,
  getMasterTuning,
}: CandidateScorerOptions): CandidateScorer => {
  const getContextualInfo = (play: Card[], context: CandidateScoreContext): CachedPlayInfo =>
    resolvePlay(play, context.lastPlay, context.ruleProfile);
  const score = (play: Card[], context: CandidateScoreContext): number => {
    let total = 0;
    const playRankCounts = getRankCounts(play);
    playRankCounts.forEach((rankCount) => {
      const handCount = context.handCountMap.get(rankCount.value) ?? 0;
      if (handCount > rankCount.count) {
        total += (handCount - rankCount.count) * 2.5;
        if (handCount >= 4) total += 60 * context.profile.conservatism;
        if (handCount === 2) total += 1.5;
      }
    });

    const info = getContextualInfo(play, context);
    const wildcardCount = play.filter((card) => card.isRedJoker).length;
    if (wildcardCount > 0) total += wildcardCount * context.profile.wildcardPenalty;
    if (info && isBombType(info.type)) total += context.profile.bombPenalty;
    if (info?.type === PlayType.StraightFlush) {
      const bombHeadsBroken = playRankCounts.reduce((count, rankCount) => {
        const inHand = context.handCountMap.get(rankCount.value) ?? 0;
        return inHand >= 4 && rankCount.count < inHand ? count + 1 : count;
      }, 0);
      total += bombHeadsBroken
        * getHardTuning().straightFlushBombBreakPenalty
        * context.profile.conservatism;
    }

    const highCardCount = play.filter((card) => !card.isRedJoker && card.value >= 14).length;
    total += highCardCount * context.profile.highCardPenalty;
    if (context.isLeadTurn && info) {
      if (
        info.type === PlayType.Single
        || info.type === PlayType.Pair
        || info.type === PlayType.Triple
      ) {
        total += highCardCount * context.profile.openBigCardPenalty;
      }
      if (info.type === PlayType.TripleWithPair) {
        const pairRank = getRankCounts(play).find((rankCount) => rankCount.count === 2);
        if (pairRank && pairRank.value >= 14) {
          total += context.profile.openBigCardPenalty * 2;
        }
      }
    }
    return total;
  };

  const pruneEquivalent = (
    plays: Card[][],
    context: CandidateScoreContext,
  ): Card[][] => {
    const groups = new Map<string, Card[]>();
    for (const play of plays) {
      const info = getContextualInfo(play, context);
      if (!info) continue;
      const key = `${info.type}-${info.maxValue}-${play.length}`;
      const existing = groups.get(key);
      if (!existing || score(play, context) < score(existing, context)) groups.set(key, play);
    }
    return Array.from(groups.values());
  };

  const sort = (
    plays: Card[][],
    hand: Card[],
    difficulty: Difficulty,
    context: CandidateScoreContext,
  ): Card[][] => plays.sort((left, right) => {
    const leftInfo = getContextualInfo(left, context);
    const rightInfo = getContextualInfo(right, context);
    if (!leftInfo || !rightInfo) return 0;
    if (
      !context.isLeadTurn
      && isBombType(leftInfo.type)
      && isBombType(rightInfo.type)
    ) {
      const bombOrder = compareBombResolutions(leftInfo, rightInfo);
      if (bombOrder !== 0) return bombOrder;
    }

    const comboType = (type: PlayType): boolean =>
      type === PlayType.Straight
      || type === PlayType.Tube
      || type === PlayType.Plate
      || type === PlayType.TripleWithPair
      || type === PlayType.Triple;
    const leftComboBoost = context.isLeadTurn && comboType(leftInfo.type)
      ? context.profile.comboLeadBonus
      : 0;
    const rightComboBoost = context.isLeadTurn && comboType(rightInfo.type)
      ? context.profile.comboLeadBonus
      : 0;
    const smallDumpWeight = difficulty === 'master'
      ? getMasterTuning().earlySmallDumpWeight
      : context.profile.earlySmallDumpWeight;
    const smallDumpBonus = (type: PlayType, maxValue: number): number => (
      hand.length > 8
      && context.isLeadTurn
      && (type === PlayType.Single || type === PlayType.Pair)
      && maxValue <= 10
        ? smallDumpWeight * 10
        : 0
    );
    const leftScore = score(left, context)
      - leftComboBoost
      - (context.isLeadTurn ? left.length * context.profile.leadLengthBonus : 0)
      - smallDumpBonus(leftInfo.type, leftInfo.maxValue);
    const rightScore = score(right, context)
      - rightComboBoost
      - (context.isLeadTurn ? right.length * context.profile.leadLengthBonus : 0)
      - smallDumpBonus(rightInfo.type, rightInfo.maxValue);
    if (leftScore !== rightScore) return leftScore - rightScore;
    if (context.isLeadTurn) {
      if (left.length !== right.length) return right.length - left.length;
    } else {
      if (leftInfo.maxValue !== rightInfo.maxValue) {
        return (leftInfo.maxValue - rightInfo.maxValue) * context.profile.responseSmallCardBias;
      }
      if (left.length !== right.length) return left.length - right.length;
    }
    return leftInfo.maxValue - rightInfo.maxValue;
  });

  return { score, pruneEquivalent, sort };
};
