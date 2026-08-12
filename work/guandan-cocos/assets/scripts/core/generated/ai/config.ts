import type { HardRuntimeTuning, MasterRuntimeTuning } from './types';

export const DEFAULT_HARD_TUNING: Readonly<HardRuntimeTuning> = Object.freeze({
  interceptThreshold: 7,
  pairProbeMin: 5,
  pairProbeMax: 14,
  straightFlushBombBreakPenalty: 85,
});

export const DEFAULT_MASTER_TUNING: Readonly<MasterRuntimeTuning> = Object.freeze({
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
});

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const resolveHardRuntimeTuning = (
  patch: Partial<HardRuntimeTuning> = {},
): HardRuntimeTuning => {
  const next = { ...DEFAULT_HARD_TUNING, ...patch };
  next.interceptThreshold = clamp(Math.round(next.interceptThreshold), 3, 10);
  next.pairProbeMin = clamp(Math.round(next.pairProbeMin), 3, 14);
  next.pairProbeMax = clamp(Math.round(next.pairProbeMax), next.pairProbeMin, 15);
  next.straightFlushBombBreakPenalty = clamp(
    Math.round(next.straightFlushBombBreakPenalty),
    0,
    200,
  );
  return next;
};

export const resolveMasterRuntimeTuning = (
  patch: Partial<MasterRuntimeTuning> = {},
): MasterRuntimeTuning => {
  const next = { ...DEFAULT_MASTER_TUNING, ...patch };
  next.strikerEnemyPushThreshold = clamp(Math.round(next.strikerEnemyPushThreshold), 6, 12);
  next.strikerComboPushBonus = clamp(Number(next.strikerComboPushBonus.toFixed(2)), 1, 2.5);
  next.strikerSearchBudgetMs = clamp(Math.round(next.strikerSearchBudgetMs), 20, 120);
  next.supportSearchBudgetMs = clamp(Math.round(next.supportSearchBudgetMs), 8, 60);
  next.strikerBeam = clamp(Math.round(next.strikerBeam), 10, 60);
  next.supportBeam = clamp(Math.round(next.supportBeam), 6, 40);
  next.strikerDepthLimit = clamp(Math.round(next.strikerDepthLimit), 2, 7);
  next.supportDepthLimit = clamp(Math.round(next.supportDepthLimit), 1, 5);
  next.finishBySmall = !!next.finishBySmall;
  next.preferOnlySinglesPairsWithSmallLate = !!next.preferOnlySinglesPairsWithSmallLate;
  next.earlySmallDumpWeight = clamp(Number(next.earlySmallDumpWeight.toFixed(2)), 0, 1.2);
  next.routeStabilityWeight = clamp(Number(next.routeStabilityWeight.toFixed(2)), 0.2, 3);
  next.endgameComplexLockThreshold = clamp(Math.round(next.endgameComplexLockThreshold), 6, 12);
  next.endgameForceComplexFinish = !!next.endgameForceComplexFinish;
  next.endgameRouteWinGuard = !!next.endgameRouteWinGuard;
  next.endgameStrictLockThreshold = clamp(Math.round(next.endgameStrictLockThreshold), 6, 12);
  next.endgameSinglePairPenalty = clamp(Math.round(next.endgameSinglePairPenalty), 8, 40);
  return next;
};
