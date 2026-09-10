import { ruleProfileKey, type RuleProfile } from '../lib/rules';
import type { Card, PlayAction, Player, PlayerId, Team } from '../types/game';
import type {
  AIContext,
  AIDecisionMetrics,
  AIEngineCheckpoint,
} from './types';

export type AIWorkerRuntimeConfig = {
  seed: number;
};

export type AIWorkerEngineConfig = AIWorkerRuntimeConfig & {
  ruleProfile: RuleProfile;
};

export type AIWorkerDecisionInput = {
  hand: Card[];
  lastPlay: PlayAction | null;
  difficulty: 'master';
  myTeam: Team;
  players: Record<PlayerId, Player>;
  myPlayerId: PlayerId;
  aiContext: AIContext;
};

export type AIWorkerRequest = AIWorkerDecisionInput & {
  id: number;
  engine: AIWorkerEngineConfig;
  checkpoint?: AIEngineCheckpoint;
};

export type AIWorkerResponse = {
  id: number;
  decision: Card[] | null;
  metrics?: AIDecisionMetrics;
  checkpoint?: AIEngineCheckpoint;
  error?: string;
};

export type AIWorkerDecisionResult = {
  decision: Card[] | null;
  metrics: AIDecisionMetrics | null;
  checkpoint: AIEngineCheckpoint;
};

export const createAIWorkerRequest = (
  id: number,
  input: AIWorkerDecisionInput,
  runtime: AIWorkerRuntimeConfig,
  checkpoint?: AIEngineCheckpoint,
): AIWorkerRequest => ({
  ...input,
  id,
  engine: {
    ...runtime,
    ruleProfile: input.aiContext.ruleProfile,
  },
  ...(checkpoint ? { checkpoint } : {}),
});

export const aiWorkerEngineConfigKey = (config: AIWorkerEngineConfig): string => JSON.stringify([
  config.seed >>> 0,
  ruleProfileKey(config.ruleProfile),
]);

export const assertAIWorkerRequest: (
  value: unknown,
) => asserts value is AIWorkerRequest = (value) => {
  if (!value || typeof value !== 'object') throw new Error('invalid AI worker request');
  const request = value as Partial<AIWorkerRequest>;
  if (!Number.isInteger(request.id) || !request.engine || !request.aiContext) {
    throw new Error('invalid AI worker request');
  }
  if (
    ruleProfileKey(request.engine.ruleProfile)
    !== ruleProfileKey(request.aiContext.ruleProfile)
  ) {
    throw new Error('AI worker rule profile does not match the decision context');
  }
  if (
    request.checkpoint
    && request.checkpoint.engineRuleProfileKey !== ruleProfileKey(request.engine.ruleProfile)
  ) {
    throw new Error('AI worker checkpoint does not match the engine rule profile');
  }
};
