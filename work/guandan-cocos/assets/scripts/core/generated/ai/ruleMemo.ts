import { PlayType, type Card, type PlayAction } from '../types/game';
import {
  canPlay,
  getPlayInfo,
  resolvePlayForContext,
  ruleProfileKey,
  type RuleProfile,
} from '../lib/rules';
import type { AIDecisionMetrics } from './types';

type RuleMemoOptions = Readonly<{
  metrics: AIDecisionMetrics;
  cacheLimit: number;
  getRuleProfile: () => RuleProfile;
}>;

const cardsKey = (cards: Card[]): string =>
  cards.map(card => card.id).sort().join(',');

const playKey = (play: PlayAction | null): string => {
  if (!play) return 'none';
  return `${play.playerId}|${play.type}|${play.resolution?.maxValue ?? 'legacy'}|${cardsKey(play.cards)}`;
};

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

/** Owns the per-engine memoization of shared rule queries. */
export const createRuleMemoService = ({
  metrics,
  cacheLimit,
  getRuleProfile,
}: RuleMemoOptions) => {
  const playInfoCache = new Map<string, ReturnType<typeof getPlayInfo>>();
  const canPlayCache = new Map<string, boolean>();
  let generation = 1;
  const scopedKey = (rawKey: string): string => `g${generation}:${rawKey}`;

  const memoGetPlayInfo = (
    cards: Card[],
    ruleProfile: RuleProfile = getRuleProfile(),
  ): ReturnType<typeof getPlayInfo> => {
    const key = scopedKey(`${ruleProfileKey(ruleProfile)}:${cardsKey(cards)}`);
    const hit = lruGet(playInfoCache, key);
    if (hit !== undefined) {
      metrics.cacheHitPlayInfo += 1;
      return hit;
    }
    metrics.cacheMissPlayInfo += 1;
    const info = getPlayInfo(cards, ruleProfile);
    lruSet(playInfoCache, key, info, cacheLimit);
    return info;
  };

  const memoCanPlay = (
    cards: Card[],
    lastPlay: PlayAction,
    ruleProfile: RuleProfile = getRuleProfile(),
  ): boolean => {
    const key = scopedKey(
      `${ruleProfileKey(ruleProfile)}:${cardsKey(cards)}->${playKey(lastPlay)}`,
    );
    const hit = lruGet(canPlayCache, key);
    if (hit !== undefined) {
      metrics.cacheHitCanPlay += 1;
      return hit;
    }
    metrics.cacheMissCanPlay += 1;
    const playable = canPlay(cards, lastPlay, ruleProfile);
    lruSet(canPlayCache, key, playable, cacheLimit);
    return playable;
  };

  const memoResolvePlay = (
    cards: Card[],
    lastPlay: PlayAction | null,
    ruleProfile: RuleProfile = getRuleProfile(),
  ): ReturnType<typeof resolvePlayForContext> => {
    if (!lastPlay || lastPlay.type === PlayType.Pass) return memoGetPlayInfo(cards, ruleProfile);
    const key = scopedKey(
      `${ruleProfileKey(ruleProfile)}:${cardsKey(cards)}->resolution:${playKey(lastPlay)}`,
    );
    const hit = lruGet(playInfoCache, key);
    if (hit !== undefined) {
      metrics.cacheHitPlayInfo += 1;
      return hit;
    }
    metrics.cacheMissPlayInfo += 1;
    const resolution = resolvePlayForContext(cards, lastPlay, ruleProfile);
    lruSet(playInfoCache, key, resolution, cacheLimit);
    return resolution;
  };

  const clear = (): void => {
    playInfoCache.clear();
    canPlayCache.clear();
    generation += 1;
  };

  return {
    getPlayInfo: memoGetPlayInfo,
    canPlay: memoCanPlay,
    resolvePlay: memoResolvePlay,
    clear,
  };
};
