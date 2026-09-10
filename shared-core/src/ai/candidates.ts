import { structuralLegalMoves } from '../lib/legalMoves';
import { getPlayInfo as resolveLead, ruleProfileKey, type RuleProfile } from '../lib/rules';
import { PlayType, type Card, type PlayAction } from '../types/game';
import type { AIDecisionMetrics, Difficulty } from './types';
import type { CachedPlayInfo } from './scoring';

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
  canPlay: (cards: Card[], lastPlay: PlayAction, ruleProfile: RuleProfile) => boolean;
  getPlayInfo?: (cards: Card[]) => CachedPlayInfo;
  cacheLimit?: number;
};

export type CandidateService = {
  generateAllPlays: (hand: Card[], ruleProfile?: RuleProfile) => Card[][];
  generateStructuralPlays: (hand: Card[], ruleProfile?: RuleProfile) => Card[][];
  getStructuralPlayInfo: (play: Card[]) => CachedPlayInfo;
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
  canPlay,
  getPlayInfo,
  cacheLimit = 600,
}: CandidateServiceOptions): CandidateService => {
  const structuralCache = new Map<string, Card[][]>();
  let structuralInfos = new WeakMap<Card[], CachedPlayInfo>();
  const generateStructuralPlays = (hand: Card[], ruleProfile = defaultRuleProfile): Card[][] => {
    const key = `structural:${ruleProfileKey(ruleProfile)}:${cardsKey(hand)}`;
    const cached = lruGet(structuralCache, key);
    if (cached) { metrics.cacheHitAllPlays++; return cached; }
    metrics.cacheMissAllPlays++;
    const plays = structuralLegalMoves(hand, ruleProfile, cards => {
      const info = getPlayInfo ? getPlayInfo(cards) : resolveLead(cards, ruleProfile);
      structuralInfos.set(cards, info);
      return info;
    });
    lruSet(structuralCache, key, plays, Math.min(12, cacheLimit));
    return plays;
  };

  const generateAllPlays = generateStructuralPlays;
  const getPossiblePlays = (
    hand: Card[], lastPlay: PlayAction | null, _difficulty: Difficulty = 'master',
    ruleProfile: RuleProfile = defaultRuleProfile,
  ): Card[][] => {
    const all = generateStructuralPlays(hand, ruleProfile);
    metrics.generatedPlays += all.length;
    const valid = !lastPlay || lastPlay.type === PlayType.Pass ? all
      : all.filter(play => canPlay(play, lastPlay, ruleProfile));
    metrics.validPlays += valid.length;
    metrics.prunedPlays += valid.length;
    return valid;
  };

  return {
    generateAllPlays,
    generateStructuralPlays,
    getStructuralPlayInfo: play => structuralInfos.has(play) ? structuralInfos.get(play)!
      : (getPlayInfo ? getPlayInfo(play) : resolveLead(play, defaultRuleProfile)),
    getPossiblePlays,
    clear: () => { structuralCache.clear(); structuralInfos = new WeakMap(); },
  };
};
