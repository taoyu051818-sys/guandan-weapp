import { ruleProfileKey, type RuleProfile } from '../lib/rules';
import type { AIEngineCheckpoint } from './types';
import { createSeededRandom } from './random';
import { validateTeamRecords } from './team/journal';

/** Drop retired tuning/intel on v1 migration, retain RNG and public decision journal.
 * Validate with a temporary RNG so malformed checkpoints cannot partially mutate an engine.
 */
export const validateAIEngineCheckpoint = (value: unknown, profile: RuleProfile): AIEngineCheckpoint => {
  const checkpoint = value as AIEngineCheckpoint & { decisionContext?: { ruleProfile: RuleProfile } };
  if (!checkpoint || ![1, 2].includes(checkpoint.version)
    || checkpoint.engineRuleProfileKey !== ruleProfileKey(profile)) {
    throw new Error('AI engine checkpoint is incompatible with this rule profile');
  }
  if (checkpoint.decisionContext && ruleProfileKey(checkpoint.decisionContext.ruleProfile) !== ruleProfileKey(profile)) {
    throw new Error('Invalid AI engine checkpoint decision context');
  }
  const random = createSeededRandom(0);
  random.restore(checkpoint.random);
  return { version: 2, engineRuleProfileKey: checkpoint.engineRuleProfileKey,
    random: random.checkpoint(), teamDecisions: validateTeamRecords(checkpoint.teamDecisions) };
};
