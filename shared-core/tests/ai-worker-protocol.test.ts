import { describe, expect, it } from 'vitest';
import { getRuleProfile } from '../src/lib/rules';
import type { Card, Player, PlayerId } from '../src/types/game';
import { createAIEngine, type AIContext } from '../src/ai';
import {
  aiWorkerEngineConfigKey,
  assertAIWorkerRequest,
  createAIWorkerRequest,
  type AIWorkerDecisionInput,
} from '../src/ai/workerProtocol';

const profile = getRuleProfile('classic');
const card: Card = {
  id: 'card-3',
  rank: 3,
  suit: 'spade',
  value: 3,
  isLevelCard: false,
};
const player = (id: PlayerId, team: Player['team']): Player => ({
  id,
  name: id,
  isAI: true,
  team,
  hand: [card],
  handCount: 1,
  role: 'normal',
});
const players: Record<PlayerId, Player> = {
  p1: player('p1', 'teamA'),
  p2: player('p2', 'teamB'),
  p3: player('p3', 'teamA'),
  p4: player('p4', 'teamB'),
};
const aiContext: AIContext = {
  currentLevel: 2,
  teamLevels: { teamA: 2, teamB: 2 },
  roundMeta: null,
  ruleProfile: profile,
};
const input: AIWorkerDecisionInput = {
  hand: [card],
  lastPlay: null,
  difficulty: 'master',
  myTeam: 'teamB',
  players,
  myPlayerId: 'p2',
  aiContext,
};

describe('AI worker protocol', () => {
  it('carries the exact seed and decision rule profile', () => {
    const baseline = createAIEngine({ ruleProfile: profile, seed: 9 });
    const checkpoint = baseline.checkpoint();
    const request = createAIWorkerRequest(17, input, {
      seed: 20260811,
    }, checkpoint);

    expect(request.id).toBe(17);
    expect(request.engine.seed).toBe(20260811);
    expect(request.engine.ruleProfile).toEqual(aiContext.ruleProfile);
    expect(request.checkpoint).toEqual(checkpoint);
    expect(() => assertAIWorkerRequest(request)).not.toThrow();
    expect(aiWorkerEngineConfigKey(request.engine)).toBe(
      aiWorkerEngineConfigKey(structuredClone(request.engine)),
    );
  });

  it('rejects a request whose engine and decision profiles diverge', () => {
    const baseline = createAIEngine({ ruleProfile: profile, seed: 9 });
    const request = createAIWorkerRequest(18, input, {
      seed: 9,
    });
    request.engine.ruleProfile = getRuleProfile('tournament');

    expect(() => assertAIWorkerRequest(request)).toThrow(/rule profile/);
  });
});
