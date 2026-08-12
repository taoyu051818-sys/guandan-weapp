import type { RuleProfile } from '../lib/rules';
import {
  PlayType,
  type Card,
  type PlayAction,
  type Player,
  type PlayerId,
  type Team,
} from '../types/game';
import { getRankCounts, isBombType, type CachedPlayInfo } from './scoring';
import type {
  AIDecisionMetrics,
  AdvancedRole,
  Difficulty,
  MasterRuntimeTuning,
} from './types';

type RouteEstimate = {
  steps: number;
  singlePairSteps: number;
  complexSteps: number;
  score: number;
};

type TailShape = { onlySinglesPairs: boolean; hasSmall: boolean };

type WorkBudget = {
  remaining: number;
  used: number;
};

const createWorkBudget = (units: number): WorkBudget => ({
  remaining: Math.max(1, Math.round(units)),
  used: 0,
});

const consumeWork = (budget: WorkBudget, units: number = 1): boolean => {
  if (budget.remaining < units) return false;
  budget.remaining -= units;
  budget.used += units;
  return true;
};

const cardsKey = (cards: Card[]): string => cards.map((card) => card.id).sort().join(',');

const removeCards = (hand: Card[], play: Card[]): Card[] => {
  const used = new Set(play.map((card) => card.id));
  return hand.filter((card) => !used.has(card.id));
};

const isComplexPlayType = (type: PlayType): boolean =>
  type === PlayType.Tube
  || type === PlayType.Plate
  || type === PlayType.TripleWithPair
  || type === PlayType.Straight
  || type === PlayType.Triple;

const isFinishComplexType = isComplexPlayType;

const EXTENDED_ENDGAME_THRESHOLD: Readonly<Record<Difficulty, number>> = Object.freeze({
  easy: 6,
  medium: 6,
  hard: 12,
  master: 14,
});

export type SearchServiceOptions = {
  metrics: AIDecisionMetrics;
  getMasterTuning: () => MasterRuntimeTuning;
  getRuleProfile: () => RuleProfile;
  getPossiblePlays: (
    hand: Card[],
    lastPlay: PlayAction | null,
    difficulty: Difficulty,
    ruleProfile: RuleProfile,
  ) => Card[][];
  getPlayInfo: (cards: Card[]) => CachedPlayInfo;
  evaluateHandStructureScore: (hand: Card[]) => number;
  getSinglesPairsTailShape: (hand: Card[]) => TailShape;
  getMinEnemyHand: (players: Record<PlayerId, Player>, myTeam: Team) => number;
  pickLowestWinningPlay: (plays: Card[][]) => Card[] | null;
};

export type SearchService = {
  planGlobalGrouping: (
    hand: Card[],
    possiblePlays: Card[][],
    difficulty: Difficulty,
  ) => Card[] | null;
  chooseLockedEndgameRoute: (
    hand: Card[],
    possiblePlays: Card[][],
    difficulty: Difficulty,
    players: Record<PlayerId, Player>,
    myTeam: Team,
    lastPlay: PlayAction | null,
  ) => Card[] | null;
  chooseEndgamePlay: (
    hand: Card[],
    possiblePlays: Card[][],
    lastPlay: PlayAction | null,
    difficulty: Difficulty,
    players: Record<PlayerId, Player>,
    myTeam: Team,
    myPlayerId: PlayerId,
    nextPlayerId: PlayerId,
    teammateId: PlayerId,
    role: AdvancedRole,
  ) => Card[] | null;
};

export const createSearchService = ({
  metrics,
  getMasterTuning,
  getRuleProfile,
  getPossiblePlays,
  getPlayInfo,
  evaluateHandStructureScore,
  getSinglesPairsTailShape,
  getMinEnemyHand,
  pickLowestWinningPlay,
}: SearchServiceOptions): SearchService => {
  const estimateLeadRoute = (
    hand: Card[],
    difficulty: Difficulty,
    cache: Map<string, RouteEstimate>,
    budget: WorkBudget,
    depth: number = 0,
  ): RouteEstimate => {
    if (hand.length === 0) {
      return { steps: 0, singlePairSteps: 0, complexSteps: 0, score: 0 };
    }
    const key = `${cardsKey(hand)}|${depth}`;
    const cached = cache.get(key);
    if (cached) return cached;
    if (depth >= 7 || !consumeWork(budget)) {
      const fallback = {
        steps: Math.max(1, Math.ceil(hand.length / 3)),
        singlePairSteps: Math.max(0, Math.ceil(hand.length / 4)),
        complexSteps: Math.max(0, Math.ceil(hand.length / 5)),
        score: evaluateHandStructureScore(hand),
      };
      cache.set(key, fallback);
      return fallback;
    }

    const leads = getPossiblePlays(hand, null, difficulty, getRuleProfile()).slice(0, 12);
    if (leads.length === 0) {
      const fallback = {
        steps: hand.length,
        singlePairSteps: hand.length,
        complexSteps: 0,
        score: hand.length * 6,
      };
      cache.set(key, fallback);
      return fallback;
    }

    let best: RouteEstimate = {
      steps: 99,
      singlePairSteps: 99,
      complexSteps: 0,
      score: Number.POSITIVE_INFINITY,
    };
    for (const play of leads) {
      if (!consumeWork(budget)) break;
      const info = getPlayInfo(play);
      if (!info || (isBombType(info.type) && hand.length > 8)) continue;
      const remaining = removeCards(hand, play);
      const next = estimateLeadRoute(remaining, difficulty, cache, budget, depth + 1);
      const isSinglePair = info.type === PlayType.Single || info.type === PlayType.Pair;
      const isComplex = isComplexPlayType(info.type);
      const steps = next.steps + 1;
      const singlePairSteps = next.singlePairSteps + (isSinglePair ? 1 : 0);
      const complexSteps = next.complexSteps + (isComplex ? 1 : 0);
      const driftPenalty = Math.max(0, singlePairSteps - complexSteps)
        * 6
        * getMasterTuning().routeStabilityWeight;
      const score = steps * 22
        + singlePairSteps * 12
        + driftPenalty
        + evaluateHandStructureScore(remaining) * 0.8
        - (isComplex ? 8 : 0);
      if (score < best.score) best = { steps, singlePairSteps, complexSteps, score };
    }
    cache.set(key, best);
    return best;
  };

  const planGlobalGrouping = (
    hand: Card[],
    possiblePlays: Card[][],
    difficulty: Difficulty,
  ): Card[] | null => {
    if (hand.length === 0 || possiblePlays.length === 0) return null;
    const budget = createWorkBudget(1200);
    const routeCache = new Map<string, RouteEstimate>();
    const candidates = possiblePlays
      .filter((play) => {
        const info = getPlayInfo(play);
        return !!info && !isBombType(info.type);
      })
      .slice(0, 18);
    let bestPlay: Card[] | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const play of candidates) {
      if (!consumeWork(budget)) break;
      const info = getPlayInfo(play);
      if (!info) continue;
      const remaining = removeCards(hand, play);
      const route = estimateLeadRoute(remaining, difficulty, routeCache, budget);
      const routeDrift = Math.max(0, route.singlePairSteps - route.complexSteps)
        * 4
        * getMasterTuning().routeStabilityWeight;
      const score = route.score
        + route.steps * 10
        + route.singlePairSteps * 14
        + routeDrift
        + info.maxValue * 0.6
        - play.length * 0.4;
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
    lastPlay: PlayAction | null,
  ): Card[] | null => {
    const tuning = getMasterTuning();
    if (difficulty !== 'master') return null;
    if (hand.length > Math.max(10, tuning.endgameComplexLockThreshold)) return null;
    if (hand.length <= 5) {
      const comboFinish = possiblePlays.filter((play) => {
        const info = getPlayInfo(play);
        return !!info && !isBombType(info.type) && isFinishComplexType(info.type);
      });
      if (comboFinish.length > 0) return pickLowestWinningPlay(comboFinish);
    }
    const enemyMin = getMinEnemyHand(players, myTeam);
    const enemyLed = !!lastPlay
      && lastPlay.type !== PlayType.Pass
      && players[lastPlay.playerId].team !== myTeam;
    const useComplexLock = tuning.endgameForceComplexFinish
      && hand.length <= tuning.endgameComplexLockThreshold;
    const useStrictLock = useComplexLock && hand.length <= tuning.endgameStrictLockThreshold;
    const hasComplexOption = possiblePlays.some((play) => {
      const info = getPlayInfo(play);
      return !!info && !isBombType(info.type) && isFinishComplexType(info.type);
    });
    if (!hasComplexOption) return null;
    const budget = createWorkBudget(1600);
    const routeCache = new Map<string, RouteEstimate>();
    let hasWinningRoute = !tuning.endgameRouteWinGuard || !useComplexLock;
    if (!hasWinningRoute) {
      for (const play of possiblePlays.slice(0, 20)) {
        if (!consumeWork(budget)) break;
        const info = getPlayInfo(play);
        if (!info) continue;
        const remaining = removeCards(hand, play);
        const route = estimateLeadRoute(remaining, difficulty, routeCache, budget);
        if (
          route.steps <= Math.max(2, Math.ceil(remaining.length / 3))
          && route.singlePairSteps <= 1
        ) {
          hasWinningRoute = true;
          break;
        }
      }
    }

    let bestPlay: Card[] | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const play of possiblePlays.slice(0, 20)) {
      if (!consumeWork(budget)) break;
      const info = getPlayInfo(play);
      if (!info) continue;
      if (
        useComplexLock
        && hasComplexOption
        && hasWinningRoute
        && (info.type === PlayType.Single || info.type === PlayType.Pair)
        && !(enemyLed && enemyMin <= 6)
      ) {
        continue;
      }
      if (
        useStrictLock
        && hasComplexOption
        && hasWinningRoute
        && !isFinishComplexType(info.type)
        && !isBombType(info.type)
      ) {
        continue;
      }
      const remaining = removeCards(hand, play);
      const route = estimateLeadRoute(remaining, difficulty, routeCache, budget);
      const singlePairStartPenalty = info.type === PlayType.Single || info.type === PlayType.Pair
        ? 10
        : 0;
      const lockPenalty = useComplexLock && hasWinningRoute
        ? Math.max(0, route.singlePairSteps - route.complexSteps)
          * tuning.endgameSinglePairPenalty
        : 0;
      const score = route.steps * 28
        + route.singlePairSteps * 18
        + route.score
        + singlePairStartPenalty
        + lockPenalty;
      if (score < bestScore) {
        bestScore = score;
        bestPlay = play;
      }
    }
    return bestPlay;
  };

  const chooseEndgamePlay = (
    hand: Card[],
    possiblePlays: Card[][],
    lastPlay: PlayAction | null,
    difficulty: Difficulty,
    players: Record<PlayerId, Player>,
    myTeam: Team,
    myPlayerId: PlayerId,
    nextPlayerId: PlayerId,
    teammateId: PlayerId,
    role: AdvancedRole,
  ): Card[] | null => {
    const tuning = getMasterTuning();
    const enemyMinCards = Object.values(players)
      .filter((player) => player.team !== myTeam)
      .map((player) => player.hand.length)
      .filter((length) => length > 0)
      .reduce((minimum, length) => Math.min(minimum, length), 99);
    const threshold = EXTENDED_ENDGAME_THRESHOLD[difficulty];
    const useExtendedEndgame = difficulty !== 'easy'
      && hand.length <= threshold
      && enemyMinCards <= threshold;
    const useMidgameProbe = difficulty === 'master'
      && role === 'striker'
      && hand.length <= 12
      && enemyMinCards <= tuning.strikerEnemyPushThreshold + 2;
    if (hand.length > 6 && !useExtendedEndgame && !useMidgameProbe) return null;
    const isMidgameProbe = !useExtendedEndgame && useMidgameProbe;
    const beamByDifficulty: Readonly<Record<Difficulty, number>> = {
      easy: 6,
      medium: 8,
      hard: role === 'support' ? 20 : 28,
      master: role === 'support' ? tuning.supportBeam : tuning.strikerBeam,
    };
    const baseWorkUnits: Readonly<Record<Difficulty, number>> = {
      easy: 80,
      medium: 120,
      hard: role === 'support' ? 420 : 640,
      master: (role === 'support' ? tuning.supportSearchBudgetMs : tuning.strikerSearchBudgetMs) * 16,
    };
    const urgencyUnits = enemyMinCards <= 3 ? 96 : enemyMinCards <= 5 ? 48 : 0;
    const budget = createWorkBudget(
      (isMidgameProbe ? Math.max(224, Math.round(tuning.strikerSearchBudgetMs * 5)) : baseWorkUnits[difficulty])
      + urgencyUnits,
    );
    const teammateThreat = players[teammateId].hand.length;
    const enemyHand = players[nextPlayerId].hand;

    const evaluateFuture = (futureHand: Card[], depth: number, maxDepth: number): number => {
      if (futureHand.length === 0) return -500;
      if (depth >= maxDepth || !consumeWork(budget)) return futureHand.length * 14;
      const leadPlays = getPossiblePlays(
        futureHand,
        null,
        difficulty,
        getRuleProfile(),
      ).slice(0, 6);
      if (leadPlays.length === 0) return futureHand.length * 18;
      let bestScore = Number.POSITIVE_INFINITY;
      for (const leadPlay of leadPlays) {
        if (!consumeWork(budget)) break;
        const remaining = removeCards(futureHand, leadPlay);
        const tailShape = getSinglesPairsTailShape(remaining);
        const lateTailPenalty = difficulty === 'master'
          && !tuning.preferOnlySinglesPairsWithSmallLate
          && remaining.length <= 8
          && tailShape.onlySinglesPairs
          && tailShape.hasSmall
            ? 7
            : 0;
        const score = remaining.length * 12
          + evaluateFuture(remaining, depth + 1, maxDepth) * 0.45
          + lateTailPenalty;
        if (score < bestScore) bestScore = score;
      }
      return bestScore;
    };

    let bestPlay: Card[] | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    let deepest = 0;
    const beam = isMidgameProbe
      ? Math.min(12, Math.max(8, Math.round(tuning.strikerBeam * 0.5)))
      : beamByDifficulty[difficulty] + (enemyMinCards <= 3 ? 2 : 0);
    const baseCandidates = possiblePlays.slice(0, beam);
    const splitToleranceCandidates = difficulty === 'master' && hand.length <= 10
      ? possiblePlays.filter((play) => {
          const info = getPlayInfo(play);
          return !!info
            && !isBombType(info.type)
            && (
              info.type === PlayType.Tube
              || info.type === PlayType.Plate
              || info.type === PlayType.TripleWithPair
            );
        }).slice(0, 8)
      : [];
    const candidateMap = new Map<string, Card[]>();
    baseCandidates.forEach((play) => candidateMap.set(cardsKey(play), play));
    splitToleranceCandidates.forEach((play) => candidateMap.set(cardsKey(play), play));
    const candidates = Array.from(candidateMap.values());
    const hasComplexCandidate = difficulty === 'master' && candidates.some((play) => {
      const info = getPlayInfo(play);
      return !!info && !isBombType(info.type) && isFinishComplexType(info.type);
    });
    const depthLimitByDifficulty: Readonly<Record<Difficulty, number>> = {
      easy: 1,
      medium: 1,
      hard: role === 'support' ? 3 : 4,
      master: role === 'support' ? tuning.supportDepthLimit : tuning.strikerDepthLimit,
    };
    const depthLimit = isMidgameProbe
      ? Math.min(2, depthLimitByDifficulty[difficulty])
      : depthLimitByDifficulty[difficulty];

    for (let maxDepth = 1; maxDepth <= depthLimit && budget.remaining > 0; maxDepth += 1) {
      deepest = maxDepth;
      for (const play of candidates) {
        if (!consumeWork(budget)) break;
        const info = getPlayInfo(play);
        if (!info) continue;
        const remaining = removeCards(hand, play);
        if (remaining.length === 0) {
          if (difficulty !== 'master') {
            metrics.endgameDepth = Math.max(metrics.endgameDepth, deepest);
          }
          metrics.endgameNodes += budget.used;
          return play;
        }

        const simulatedAction: PlayAction = { playerId: myPlayerId, cards: play, type: info.type };
        const nextEnemyPlays = getPossiblePlays(
          enemyHand,
          simulatedAction,
          difficulty,
          getRuleProfile(),
        ).slice(0, 4);
        const isHighRankBreak = (
          info.type === PlayType.Single
          || info.type === PlayType.Pair
          || info.type === PlayType.Triple
        ) && info.maxValue >= 13;
        let score = remaining.length * 20;
        if (nextEnemyPlays.some((enemyPlay) => enemyPlay.length === enemyHand.length)) score += 220;
        if (nextEnemyPlays.length === 0) score -= 35;
        if (teammateThreat <= 3 && nextEnemyPlays.length === 0) score -= 20;
        if (lastPlay && lastPlay.type !== PlayType.Pass && lastPlay.playerId === teammateId) score += 8;
        score += evaluateFuture(remaining, 0, maxDepth);
        if (difficulty === 'master' && !tuning.finishBySmall && remaining.length <= 2) {
          const tailShape = getSinglesPairsTailShape(remaining);
          if (tailShape.onlySinglesPairs && tailShape.hasSmall) score += 24;
        }
        if (
          difficulty === 'master'
          && remaining.length <= 6
          && getRankCounts(remaining).some((rankCount) => rankCount.value <= 6)
        ) {
          score += 1000;
        }
        if (
          difficulty === 'master'
          && remaining.length <= 5
          && hasComplexCandidate
          && (info.type === PlayType.Single || info.type === PlayType.Pair)
        ) {
          const allowHighBreak = isHighRankBreak && hand.length <= 6 && enemyMinCards <= 6;
          if (!allowHighBreak) score += 1000;
        }
        if (difficulty === 'master' && remaining.length <= 5 && isFinishComplexType(info.type)) {
          score -= 250;
        }
        if (
          (difficulty === 'hard' || difficulty === 'master')
          && hand.length <= 8
          && isHighRankBreak
        ) {
          score -= 120;
        }
        if (difficulty === 'master' && remaining.length <= 8) {
          const hasComplexFinish = getPossiblePlays(
            remaining,
            null,
            difficulty,
            getRuleProfile(),
          ).some((futurePlay) => {
            const futureInfo = getPlayInfo(futurePlay);
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
    if (difficulty !== 'master') {
      metrics.endgameDepth = Math.max(metrics.endgameDepth, deepest);
    }
    metrics.endgameNodes += budget.used;
    return bestPlay;
  };

  return {
    planGlobalGrouping,
    chooseLockedEndgameRoute,
    chooseEndgamePlay,
  };
};
