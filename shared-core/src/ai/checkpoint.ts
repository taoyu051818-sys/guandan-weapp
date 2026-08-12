import { ruleProfileKey, type RuleProfile } from '../lib/rules';
import type { AdvancedRole, AIEngineCheckpoint, Difficulty } from './types';
import { deserializeRuntimeIntel, type RuntimeIntelState } from './runtimeIntel';

export type ValidatedAIEngineCheckpoint = {
  runtimeIntel: RuntimeIntelState;
  decisionContext: AIEngineCheckpoint['decisionContext'];
};

const tuningIsValid = (tuning: Record<string, number | boolean>): boolean =>
  Object.values(tuning).every(value => (
    typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
  ));

export const validateAIEngineCheckpoint = (
  checkpoint: AIEngineCheckpoint,
  engineRuleProfile: RuleProfile,
): ValidatedAIEngineCheckpoint => {
  if (
    checkpoint.version !== 1
    || checkpoint.engineRuleProfileKey !== ruleProfileKey(engineRuleProfile)
  ) {
    throw new Error('AI engine checkpoint is incompatible with this rule profile');
  }

  const runtimeIntel = deserializeRuntimeIntel(checkpoint.runtimeIntel);
  if (
    !tuningIsValid({ ...checkpoint.hardTuning })
    || !tuningIsValid({ ...checkpoint.masterTuning })
  ) {
    throw new Error('Invalid AI engine checkpoint tuning');
  }

  const difficulties = new Set<Difficulty>(['easy', 'medium', 'hard', 'master']);
  const roles = new Set<AdvancedRole>(['striker', 'support']);
  const context = checkpoint.decisionContext;
  if (
    !difficulties.has(context.difficulty)
    || !roles.has(context.role)
    || typeof context.ruleProfile.allowA2345Straight !== 'boolean'
    || typeof context.ruleProfile.straightFlushAsBomb !== 'boolean'
    || typeof context.ruleProfile.enableTripleWithPair !== 'boolean'
    || ruleProfileKey(context.ruleProfile) !== ruleProfileKey(engineRuleProfile)
  ) {
    throw new Error('Invalid AI engine checkpoint decision context');
  }

  return {
    runtimeIntel,
    decisionContext: {
      difficulty: context.difficulty,
      role: context.role,
      ruleProfile: Object.freeze({ ...context.ruleProfile }),
    },
  };
};
