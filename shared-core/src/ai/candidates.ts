import { representativeLegalMoves } from '../lib/legalMoves';
import { ruleProfileKey, type RuleProfile } from '../lib/rules';
import { PlayType, type Card, type PlayAction } from '../types/game';
import type { AIDecisionMetrics, AdvancedRole, Difficulty } from './types';
import type { CandidateScorer } from './scoring';
import { getRankCounts } from './scoring';
import { STRATEGY_BY_DIFFICULTY } from './strategies/profiles';

const cardsKey = (cards: Card[]): string => cards.map((card) => card.id).sort().join(',');

const lruGet = <T>(cache: Map<string, T>, key: string): T | undefined => {
  if (!cache.has(key)) return undefined;
  const value = cache.get(key)!;
  cache.delete(key);
  cache.set(key, value);
  return value;
};

const lruSet = <T>(cache: Map<string, T>, key: string, value: T, limit: number): void => {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  if (cache.size <= limit) return;
  const oldestKey = cache.keys().next().value as string | undefined;
  if (oldestKey !== undefined) cache.delete(oldestKey);
};

export type CandidateServiceOptions = {
  ruleProfile: RuleProfile;
  metrics: AIDecisionMetrics;
  scorer: CandidateScorer;
  canPlay: (cards: Card[], lastPlay: PlayAction, ruleProfile: RuleProfile) => boolean;
  getRole: () => AdvancedRole;
  cacheLimit?: number;
};

export type CandidateService = {
  generateAllPlays: (hand: Card[], ruleProfile?: RuleProfile) => Card[][];
  getPossiblePlays: (
    hand: Card[],
    lastPlay: PlayAction | null,
    difficulty?: Difficulty,
    ruleProfile?: RuleProfile,
  ) => Card[][];
  clear: () => void;
};

export const createCandidateService = ({
  ruleProfile: defaultRuleProfile,
  metrics,
  scorer,
  canPlay,
  getRole,
  cacheLimit = 600,
}: CandidateServiceOptions): CandidateService => {
  const leadCache = new Map<string, Card[][]>();

  const generateAllPlays = (
    hand: Card[],
    ruleProfile: RuleProfile = defaultRuleProfile,
  ): Card[][] => {
    if (hand.length === 0) return [];
    const key = `${ruleProfileKey(ruleProfile)}:${cardsKey(hand)}`;
    const cached = lruGet(leadCache, key);
    if (cached) {
      metrics.cacheHitAllPlays += 1;
      return cached;
    }
    metrics.cacheMissAllPlays += 1;
    const plays = representativeLegalMoves(hand, null, ruleProfile);
    lruSet(leadCache, key, plays, cacheLimit);
    return plays;
  };

  const getPossiblePlays = (
    hand: Card[],
    lastPlay: PlayAction | null,
    difficulty: Difficulty = 'medium',
    ruleProfile: RuleProfile = defaultRuleProfile,
  ): Card[][] => {
    const profile = STRATEGY_BY_DIFFICULTY[difficulty];
    const allPlays = generateAllPlays(hand, ruleProfile);
    metrics.generatedPlays += allPlays.length;
    const validPlays = !lastPlay || lastPlay.type === PlayType.Pass
      ? allPlays
      : allPlays.filter((play) => canPlay(play, lastPlay, ruleProfile));
    metrics.validPlays += validPlays.length;

    const handCountMap = new Map<number, number>();
    getRankCounts(hand).forEach(({ value, count }) => handCountMap.set(value, count));
    const context = {
      handCountMap,
      isLeadTurn: !lastPlay || lastPlay.type === PlayType.Pass,
      profile,
      ruleProfile,
      lastPlay,
    };
    let pruned = scorer.pruneEquivalent(validPlays, context);
    if (difficulty === 'master') {
      const cap = getRole() === 'support' ? 391 : 355;
      if (pruned.length > cap) {
        pruned = [...pruned]
          .sort((left, right) => scorer.score(left, context) - scorer.score(right, context))
          .slice(0, cap);
      }
    }
    metrics.prunedPlays += pruned.length;
    return scorer.sort(pruned, hand, difficulty, context);
  };

  return {
    generateAllPlays,
    getPossiblePlays,
    clear: () => leadCache.clear(),
  };
};
