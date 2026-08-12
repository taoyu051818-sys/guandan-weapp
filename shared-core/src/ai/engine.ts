import type { Card, PlayAction, Player, PlayerId } from '../types/game';
import { ruleProfileKey, type RuleProfile } from '../lib/rules';
import { createCandidateService } from './candidates';
import { validateAIEngineCheckpoint } from './checkpoint';
import {
  resolveHardRuntimeTuning,
  resolveMasterRuntimeTuning,
} from './config';
import { createDecisionRunner } from './decisionRunner';
import { createDecisionSupport } from './decisionSupport';
import { createPolicyOverrides, type DecisionRuntimeContext } from './policyOverrides';
import {
  createSeededRandom,
  isCheckpointableRandomSource,
  type RandomSource,
} from './random';
import { createRuleMemoService } from './ruleMemo';
import {
  createRuntimeIntelState,
  observeRuntimeIntel as observeRuntimeIntelState,
  resetRuntimeIntelState,
  restoreRuntimeIntelState,
  serializeRuntimeIntel,
} from './runtimeIntel';
import { createCandidateScorer } from './scoring';
import { createSearchService } from './search';
import type {
  AIDecisionMetrics,
  AIDecisionTrace,
  AIEngine,
  AIEngineCheckpoint,
  AIEngineOptions,
  HardRuntimeTuning,
  MasterRuntimeTuning,
} from './types';

export type {
  AIContext,
  AIDecisionMetrics,
  AIDecisionTrace,
  AIEngine,
  AIEngineCheckpoint,
  AIEngineConfig,
  AIEngineOptions,
  AdvancedRole,
  Difficulty,
  HardRuntimeTuning,
  MasterRuntimeTuning,
} from './types';
export { DEFAULT_HARD_TUNING, DEFAULT_MASTER_TUNING } from './config';

const CACHE_LIMIT = 600;

const createMetricsState = (): AIDecisionMetrics => ({
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
});

const resetMetricsState = (metrics: AIDecisionMetrics): void => {
  Object.assign(metrics, createMetricsState());
};

/** Owns per-match mutable AI state and composes stateless decision services. */
export const createAIEngine = (options: AIEngineOptions): AIEngine => {
  const engineRuleProfile: RuleProfile = Object.freeze({ ...options.ruleProfile });
  const random: RandomSource = options.random
    ?? (options.seed === undefined ? Math.random : createSeededRandom(options.seed));
  const metricsState = createMetricsState();
  const decisionTraceState: AIDecisionTrace = {
    passReason: '',
    difficulty: 'medium',
    role: 'striker',
  };
  const hardRuntimeTuning = resolveHardRuntimeTuning(options.hardTuning);
  const masterRuntimeTuning = resolveMasterRuntimeTuning(options.masterTuning);
  const runtimeIntelState = createRuntimeIntelState();
  const decisionRuntimeContext: DecisionRuntimeContext = {
    difficulty: 'medium',
    role: 'striker',
    ruleProfile: engineRuleProfile,
  };

  const ruleMemo = createRuleMemoService({
    metrics: metricsState,
    cacheLimit: CACHE_LIMIT,
    getRuleProfile: () => decisionRuntimeContext.ruleProfile,
  });
  const getHardRuntimeTuning = (): HardRuntimeTuning => ({ ...hardRuntimeTuning });
  const getMasterRuntimeTuning = (): MasterRuntimeTuning => ({ ...masterRuntimeTuning });
  const candidateScorer = createCandidateScorer({
    resolvePlay: ruleMemo.resolvePlay,
    getHardTuning: getHardRuntimeTuning,
    getMasterTuning: getMasterRuntimeTuning,
  });
  const candidateService = createCandidateService({
    ruleProfile: engineRuleProfile,
    metrics: metricsState,
    scorer: candidateScorer,
    canPlay: ruleMemo.canPlay,
    getRole: () => decisionRuntimeContext.role,
    cacheLimit: CACHE_LIMIT,
  });
  const clearDerivedCaches = () => {
    ruleMemo.clear();
    candidateService.clear();
  };
  const resetRuntimeIntel = () => {
    resetRuntimeIntelState(runtimeIntelState);
    clearDerivedCaches();
  };
  const observeRuntimeIntel = (
    lastPlay: PlayAction | null,
    players: Record<PlayerId, Player>,
  ) => {
    observeRuntimeIntelState(
      runtimeIntelState,
      lastPlay,
      players,
      ruleMemo.getPlayInfo,
      resetRuntimeIntel,
    );
  };
  const resetMetrics = () => resetMetricsState(metricsState);
  const generateAllPlays = (hand: Card[]): Card[][] => candidateService.generateAllPlays(hand);
  const decisionSupport = createDecisionSupport({
    runtimeIntel: runtimeIntelState,
    getRuleProfile: () => decisionRuntimeContext.ruleProfile,
    getPlayInfo: ruleMemo.getPlayInfo,
    generateAllPlays,
    getPossiblePlays: candidateService.getPossiblePlays,
  });
  const searchService = createSearchService({
    metrics: metricsState,
    getMasterTuning: getMasterRuntimeTuning,
    getRuleProfile: () => decisionRuntimeContext.ruleProfile,
    getPossiblePlays: candidateService.getPossiblePlays,
    getPlayInfo: ruleMemo.getPlayInfo,
    evaluateHandStructureScore: decisionSupport.evaluateHandStructureScore,
    getSinglesPairsTailShape: decisionSupport.getSinglesPairsTailShape,
    getMinEnemyHand: decisionSupport.getMinEnemyHand,
    pickLowestWinningPlay: decisionSupport.pickLowestWinningPlay,
  });
  const policyOverrides = createPolicyOverrides({
    runtimeContext: decisionRuntimeContext,
    runtimeIntel: runtimeIntelState,
    hardTuning: hardRuntimeTuning,
    masterTuning: masterRuntimeTuning,
    support: decisionSupport,
    search: searchService,
    getPlayInfo: ruleMemo.getPlayInfo,
    getPossiblePlays: candidateService.getPossiblePlays,
  });
  const decisionRunner = createDecisionRunner({
    engineRuleProfile,
    random,
    metrics: metricsState,
    trace: decisionTraceState,
    runtimeContext: decisionRuntimeContext,
    runtimeIntel: runtimeIntelState,
    support: decisionSupport,
    search: searchService,
    overrides: policyOverrides,
    getPlayInfo: ruleMemo.getPlayInfo,
    getPossiblePlays: candidateService.getPossiblePlays,
    observeRuntimeIntel,
    resetMetrics,
  });

  const setHardRuntimeTuning = (patch: Partial<HardRuntimeTuning>) => {
    Object.assign(hardRuntimeTuning, resolveHardRuntimeTuning({ ...hardRuntimeTuning, ...patch }));
  };
  const setMasterRuntimeTuning = (patch: Partial<MasterRuntimeTuning>) => {
    Object.assign(
      masterRuntimeTuning,
      resolveMasterRuntimeTuning({ ...masterRuntimeTuning, ...patch }),
    );
  };
  const createCheckpoint = (): AIEngineCheckpoint => {
    if (!isCheckpointableRandomSource(random)) {
      throw new Error('AI engine random source is not checkpointable');
    }
    return {
      version: 1,
      engineRuleProfileKey: ruleProfileKey(engineRuleProfile),
      random: random.checkpoint(),
      hardTuning: { ...hardRuntimeTuning },
      masterTuning: { ...masterRuntimeTuning },
      runtimeIntel: serializeRuntimeIntel(runtimeIntelState),
      decisionContext: {
        difficulty: decisionRuntimeContext.difficulty,
        role: decisionRuntimeContext.role,
        ruleProfile: { ...decisionRuntimeContext.ruleProfile },
      },
    };
  };
  const restoreCheckpoint = (checkpoint: AIEngineCheckpoint): void => {
    if (!isCheckpointableRandomSource(random)) {
      throw new Error('AI engine random source is not checkpointable');
    }
    const validated = validateAIEngineCheckpoint(checkpoint, engineRuleProfile);
    random.restore(checkpoint.random);
    clearDerivedCaches();
    Object.assign(hardRuntimeTuning, checkpoint.hardTuning);
    Object.assign(masterRuntimeTuning, checkpoint.masterTuning);
    restoreRuntimeIntelState(runtimeIntelState, validated.runtimeIntel);
    Object.assign(decisionRuntimeContext, validated.decisionContext);
    resetMetrics();
    Object.assign(decisionTraceState, {
      passReason: '',
      difficulty: validated.decisionContext.difficulty,
      role: validated.decisionContext.role,
    });
  };
  const reset = () => {
    clearDerivedCaches();
    resetRuntimeIntelState(runtimeIntelState);
    resetMetrics();
    Object.assign(decisionTraceState, {
      passReason: '',
      difficulty: 'medium',
      role: 'striker',
    });
    Object.assign(decisionRuntimeContext, {
      difficulty: 'medium',
      role: 'striker',
      ruleProfile: engineRuleProfile,
    });
  };

  return {
    ruleProfile: engineRuleProfile,
    getHardRuntimeTuning,
    setHardRuntimeTuning,
    getMasterRuntimeTuning,
    setMasterRuntimeTuning,
    getLastMetrics: () => ({ ...metricsState }),
    getLastDecisionTrace: () => ({ ...decisionTraceState }),
    generateAllPlays,
    getPossiblePlays: candidateService.getPossiblePlays,
    makeDecision: decisionRunner.makeDecision,
    checkpoint: createCheckpoint,
    restore: restoreCheckpoint,
    reset,
  };
};
