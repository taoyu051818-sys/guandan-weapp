import { describe, expect, it } from 'vitest';
import { getRuleProfile } from '../src/lib/rules';
import type { Card, Player, PlayerId, Rank } from '../src/types/game';
import { createAIEngine, type AIContext } from '../src/ai';
import { createAIWorkerRequest, type AIWorkerDecisionInput } from '../src/ai/workerProtocol';
import { createAIWorkerRuntime } from '../src/ai/workerRuntime';

const VALUES: Readonly<Record<string, number>> = {
  '3': 3,
  '5': 5,
  '7': 7,
  '9': 9,
  J: 11,
  K: 13,
  A: 14,
  Small: 16,
};

const card = (rank: Rank, index: number): Card => ({
  id: `worker-${index}`,
  rank,
  suit: rank === 'Small' ? 'joker' : 'spade',
  value: VALUES[String(rank)],
  isLevelCard: false,
});

const hand = ([3, 5, 7, 9, 'J', 'K', 'A', 'Small'] as Rank[]).map(card);
const player = (id: PlayerId, team: Player['team'], cards: Card[]): Player => ({
  id,
  name: id,
  isAI: true,
  team,
  hand: cards,
  handCount: cards.length,
  role: 'normal',
});
const players: Record<PlayerId, Player> = {
  p1: player('p1', 'teamA', hand),
  p2: player('p2', 'teamB', hand),
  p3: player('p3', 'teamA', hand),
  p4: player('p4', 'teamB', hand),
};
const profile = getRuleProfile('classic');
const aiContext: AIContext = {
  currentLevel: 2,
  teamLevels: { teamA: 2, teamB: 2 },
  roundMeta: null,
  ruleProfile: profile,
};
const input: AIWorkerDecisionInput = {
  hand,
  lastPlay: null,
  difficulty: 'master',
  myTeam: 'teamB',
  players,
  myPlayerId: 'p2',
  aiContext,
};

describe('AI worker runtime', () => {
  it('executes the real worker checkpoint sequence identically to the main engine', () => {
    const seed = 20260811;
    const main = createAIEngine({ ruleProfile: profile, seed });
    const runtime = createAIWorkerRuntime();
    const engineConfig = {
      seed,
    };
    let checkpoint = main.checkpoint();

    for (let id = 1; id <= 6; id += 1) {
      main.restore(checkpoint);
      const expectedDecision = main.makeDecision(
        input.hand,
        input.lastPlay,
        input.difficulty,
        input.myTeam,
        input.players,
        input.myPlayerId,
        input.aiContext,
      );
      const expectedCheckpoint = main.checkpoint();
      const response = runtime.handle(createAIWorkerRequest(
        id,
        input,
        engineConfig,
        checkpoint,
      ));

      expect(response.error).toBeUndefined();
      expect(response.id).toBe(id);
      expect(response.decision?.map(({ id: cardId }) => cardId) ?? null)
        .toEqual(expectedDecision?.map(({ id: cardId }) => cardId) ?? null);
      expect(response.checkpoint).toEqual(expectedCheckpoint);
      checkpoint = expectedCheckpoint;
    }
  });

  it('keeps derived candidate caches warm when continuing from its own checkpoint', () => {
    const seed = 20260811;
    const bootstrap = createAIEngine({ ruleProfile: profile, seed });
    const runtime = createAIWorkerRuntime();
    const engineConfig = {
      seed,
    };
    const first = runtime.handle(createAIWorkerRequest(
      1,
      input,
      engineConfig,
      bootstrap.checkpoint(),
    ));
    expect(first.error).toBeUndefined();
    expect(first.metrics?.cacheMissAllPlays).toBe(1);
    expect(first.checkpoint).toBeDefined();

    const second = runtime.handle(createAIWorkerRequest(
      2,
      input,
      engineConfig,
      first.checkpoint,
    ));
    expect(second.error).toBeUndefined();
    expect(second.metrics?.cacheHitAllPlays).toBe(2);
    expect(second.metrics?.cacheMissAllPlays).toBe(0);
  });

  it('returns a structured error for malformed messages', () => {
    expect(createAIWorkerRuntime().handle({ id: 1 })).toMatchObject({
      id: -1,
      decision: null,
      error: 'invalid AI worker request',
    });
  });
});
