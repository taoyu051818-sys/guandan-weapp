import type { Card } from '../types/game';
import type { RuleProfile } from '../lib/rules';
import { createCandidateService } from './candidates';
import { validateAIEngineCheckpoint } from './checkpoint';
import { createDecisionRunner } from './decisionRunner';
import { createSeededRandom, isCheckpointableRandomSource, type RandomSource } from './random';
import { createRuleMemoService } from './ruleMemo';
import { createTeamJournal } from './team/journal';
import { ruleProfileKey } from '../lib/rules';
import type { AIDecisionMetrics, AIDecisionTrace, AIEngine, AIEngineCheckpoint, AIEngineOptions } from './types';

export type { AIContext, AIDecisionMetrics, AIDecisionTrace, AIEngine, AIEngineCheckpoint,
  AIEngineConfig, AIEngineOptions, AdvancedRole, Difficulty } from './types';

const createMetrics = (): AIDecisionMetrics => ({
  elapsedMs: 0, generatedPlays: 0, validPlays: 0, prunedPlays: 0, endgameDepth: 0,
  endgameNodes: 0, cacheHitPlayInfo: 0, cacheMissPlayInfo: 0, cacheHitCanPlay: 0,
  cacheMissCanPlay: 0, cacheHitAllPlays: 0, cacheMissAllPlays: 0,
});

/** One highest-strength policy. Instance-local caches/RNG; no lower-tier fallback. */
export const createAIEngine = (options: AIEngineOptions): AIEngine => {
  const profile: RuleProfile = Object.freeze({ ...options.ruleProfile });
  const random: RandomSource = options.random
    ?? (options.seed === undefined ? Math.random : createSeededRandom(options.seed));
  const metrics = createMetrics();
  const trace: AIDecisionTrace = { passReason: '', difficulty: 'master', role: 'striker' };
  const journal = createTeamJournal();
  const ruleMemo = createRuleMemoService({ metrics, cacheLimit: 600, getRuleProfile: () => profile });
  const candidates = createCandidateService({
    ruleProfile: profile, metrics, canPlay: ruleMemo.canPlay, getPlayInfo: ruleMemo.getPlayInfo,
  });
  const resetMetrics = () => { Object.assign(metrics, createMetrics()); };
  const clear = () => { ruleMemo.clear(); candidates.clear(); };
  const resetTrace = () => {
    delete trace.team;
    Object.assign(trace, { passReason: '', difficulty: 'master', role: 'striker' });
  };
  const runner = createDecisionRunner({
    engineRuleProfile: profile, random, metrics, trace, resetMetrics,
    getPossiblePlays: candidates.getPossiblePlays,
    generateAllPlays: candidates.generateAllPlays,
    resolvePlay: (cards, target) => target
      ? ruleMemo.resolvePlay(cards, target, profile) : candidates.getStructuralPlayInfo(cards),
    recordTeamDecision: journal.add,
  });
  const checkpoint = (): AIEngineCheckpoint => {
    if (!isCheckpointableRandomSource(random)) throw new Error('AI engine random source is not checkpointable');
    return { version: 2, engineRuleProfileKey: ruleProfileKey(profile),
      random: random.checkpoint(), teamDecisions: journal.checkpoint() };
  };
  const restore = (value: unknown) => {
    if (!isCheckpointableRandomSource(random)) throw new Error('AI engine random source is not checkpointable');
    const validated = validateAIEngineCheckpoint(value, profile);
    random.restore(validated.random);
    journal.restore(validated.teamDecisions);
    clear(); resetMetrics(); resetTrace();
  };
  return {
    ruleProfile: profile,
    getLastMetrics: () => ({ ...metrics }),
    getLastDecisionTrace: () => JSON.parse(JSON.stringify(trace)) as AIDecisionTrace,
    generateAllPlays: (hand: Card[]) => candidates.generateAllPlays(hand),
    getPossiblePlays: candidates.getPossiblePlays,
    makeDecision: runner.makeDecision,
    checkpoint, restore,
    reset: () => { clear(); journal.reset(); resetMetrics(); resetTrace(); },
  };
};
