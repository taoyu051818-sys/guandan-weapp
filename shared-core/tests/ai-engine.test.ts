import { describe, expect, it, vi } from 'vitest';
import {
  getPlayInfo,
  getRuleProfile,
} from '../src/lib/rules';
import { representativeLegalMoves } from '../src/lib/legalMoves';
import { createCandidateScorer, pickLowestWinningPlayByResolution } from '../src/ai/scoring';
import type { Card, Player, PlayerId, Rank, Suit } from '../src/types/game';
import { PlayType } from '../src/types/game';
import {
  createAIEngine,
  type AIContext,
  type AIEngineCheckpoint,
} from '../src/ai';

const FACE_VALUES: Readonly<Record<string, number>> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
  Small: 16,
  Big: 17,
};

const card = (id: string, rank: Rank, suit: Suit = 'spade'): Card => ({
  id,
  rank,
  suit,
  value: FACE_VALUES[String(rank)],
  isLevelCard: false,
});

const createHand = (prefix: string): Card[] => (
  [3, 5, 7, 9, 'J', 'K', 'A', 'Small'] as Rank[]
).map((rank, index) => card(`${prefix}-${index}`, rank, rank === 'Small' ? 'joker' : 'spade'));

const createPlayers = (hand: Card[]): Record<PlayerId, Player> => ({
  p1: { id: 'p1', name: 'p1', isAI: true, team: 'teamA', hand: createHand('p1'), handCount: 8, role: 'normal' },
  p2: { id: 'p2', name: 'p2', isAI: true, team: 'teamB', hand, handCount: hand.length, role: 'normal' },
  p3: { id: 'p3', name: 'p3', isAI: true, team: 'teamA', hand: createHand('p3'), handCount: 8, role: 'normal' },
  p4: { id: 'p4', name: 'p4', isAI: true, team: 'teamB', hand: createHand('p4'), handCount: 8, role: 'normal' },
});

const createContext = (): AIContext => ({
  currentLevel: 2,
  teamLevels: { teamA: 2, teamB: 2 },
  roundMeta: null,
  ruleProfile: getRuleProfile('classic'),
});

describe('createAIEngine', () => {
  it('replays the same decision sequence for a fixed seed', () => {
    const first = createAIEngine({ ruleProfile: getRuleProfile('classic'), seed: 20260811 });
    const second = createAIEngine({ ruleProfile: getRuleProfile('classic'), seed: 20260811 });
    const hand = createHand('mine');
    const players = createPlayers(hand);
    const context = createContext();

    const decide = (engine: typeof first) => Array.from({ length: 6 }, () => (
      engine.makeDecision(hand, null, 'easy', 'teamB', players, 'p2', context)?.map(({ id }) => id) ?? null
    ));

    expect(decide(first)).toEqual(decide(second));
  });

  it('preserves the fixed-seed decision sequence across engine refactors', () => {
    const hand = createHand('mine');
    const players = createPlayers(hand);
    const context = createContext();
    const decide = (difficulty: 'easy' | 'medium' | 'hard' | 'master') => {
      const engine = createAIEngine({
        ruleProfile: getRuleProfile('classic'),
        seed: 20260811,
      });
      return Array.from({ length: 6 }, () => (
        engine.makeDecision(
          hand,
          null,
          difficulty,
          'teamB',
          players,
          'p2',
          context,
        )?.map(({ id }) => id) ?? null
      ));
    };

    expect(decide('easy')).toEqual([
      ['mine-1'],
      ['mine-0'],
      ['mine-2'],
      ['mine-1'],
      ['mine-0'],
      ['mine-0'],
    ]);
    expect(decide('medium')).toEqual(Array.from({ length: 6 }, () => ['mine-0']));
    expect(decide('hard')).toEqual([
      ['mine-7'],
      ['mine-7'],
      ['mine-7'],
      ['mine-0'],
      ['mine-7'],
      ['mine-7'],
    ]);
    expect(decide('master')).toEqual(Array.from({ length: 6 }, () => ['mine-7']));
  });

  it('isolates tuning, caches, and metrics between instances', () => {
    const first = createAIEngine({ ruleProfile: getRuleProfile('classic'), seed: 1 });
    const second = createAIEngine({ ruleProfile: getRuleProfile('classic'), seed: 2 });
    const hand = createHand('cache');

    first.setHardRuntimeTuning({ interceptThreshold: 10 });
    expect(first.getHardRuntimeTuning().interceptThreshold).toBe(10);
    expect(second.getHardRuntimeTuning().interceptThreshold).toBe(7);

    first.getPossiblePlays(hand, null);
    expect(first.getLastMetrics().cacheMissAllPlays).toBe(1);
    expect(second.getLastMetrics().cacheMissAllPlays).toBe(0);

    first.getPossiblePlays(hand, null);
    expect(first.getLastMetrics().cacheHitAllPlays).toBe(1);
    expect(second.getLastMetrics().cacheHitAllPlays).toBe(0);
  });

  it('reports the work actually performed for a master decision', () => {
    const profile = getRuleProfile('classic');
    const hand = [card('only-card', 3)];
    const players = createPlayers(hand);
    const engine = createAIEngine({ ruleProfile: profile, seed: 1 });

    expect(engine.makeDecision(
      hand,
      null,
      'master',
      'teamB',
      players,
      'p2',
      createContext(),
    )?.map(({ id }) => id)).toEqual(['only-card']);
    expect(engine.getLastMetrics()).toMatchObject({
      generatedPlays: 1,
      validPlays: 1,
      prunedPlays: 1,
      endgameDepth: 0,
    });
  });

  it('blocks an enemy sprint with the strongest intact response before random pass logic', () => {
    const profile = getRuleProfile('classic');
    const hand = [card('mine-nine', 9), card('mine-king', 'K')];
    const players = createPlayers(hand);
    players.p1.hand = [card('enemy-left-a', 3), card('enemy-left-b', 4)];
    players.p3.hand = createHand('other-enemy');
    const engine = createAIEngine({ ruleProfile: profile, seed: 1 });

    const decision = engine.makeDecision(
      hand,
      { playerId: 'p1', cards: [card('enemy-play', 8)], type: PlayType.Single },
      'hard',
      'teamB',
      players,
      'p2',
      createContext(),
    );

    expect(decision?.map(({ id }) => id)).toEqual(['mine-king']);
  });

  it('leads a pair instead of a single when an enemy has one card', () => {
    const profile = getRuleProfile('classic');
    const hand = [
      card('pair-six-a', 6),
      card('pair-six-b', 6, 'heart'),
      card('mine-ace', 'A'),
    ];
    const players = createPlayers(hand);
    players.p1.hand = [card('enemy-last-card', 10)];
    players.p3.hand = createHand('other-enemy');
    const engine = createAIEngine({ ruleProfile: profile, seed: 1 });

    const decision = engine.makeDecision(
      hand,
      null,
      'medium',
      'teamB',
      players,
      'p2',
      createContext(),
    );

    expect(getPlayInfo(decision ?? [], profile)?.type).toBe(PlayType.Pair);
  });

  it('isolates remembered plays and decision context between instances', () => {
    const profile = getRuleProfile('classic');
    const first = createAIEngine({ ruleProfile: profile, seed: 11 });
    const second = createAIEngine({ ruleProfile: profile, seed: 22 });
    const hand = createHand('intel');
    const players = createPlayers(hand);
    const observed = {
      playerId: 'p1' as const,
      cards: [card('seen-nine', 9)],
      type: PlayType.Single,
    };

    first.makeDecision(hand, observed, 'hard', 'teamB', players, 'p2', createContext());
    expect(first.checkpoint().runtimeIntel.seenValueCounts).toContainEqual([9, 1]);
    expect(second.checkpoint().runtimeIntel.seenValueCounts).toEqual([]);
    expect(first.getLastDecisionTrace().difficulty).toBe('hard');
    expect(second.getLastDecisionTrace().difficulty).toBe('medium');
  });

  it('uses the injected rule profile as the instance default', () => {
    const classic = createAIEngine({ ruleProfile: getRuleProfile('classic'), seed: 1 });
    const tournament = createAIEngine({ ruleProfile: getRuleProfile('tournament'), seed: 1 });
    const aceLow = [
      card('ace', 'A'),
      card('two', 2, 'heart'),
      card('three', 3, 'club'),
      card('four', 4, 'diamond'),
      card('five', 5),
    ];
    const isWholeHand = (play: Card[]) => play.length === aceLow.length;

    expect(classic.getPossiblePlays(aceLow, null).some(isWholeHand)).toBe(true);
    expect(tournament.getPossiblePlays(aceLow, null).some(isWholeHand)).toBe(false);
  });

  it('keeps candidate classes aligned with shared representative legal moves', () => {
    const profile = getRuleProfile('classic');
    const hand = [
      card('three-a', 3),
      card('three-b', 3, 'heart'),
      card('four', 4, 'heart'),
      card('five', 5, 'club'),
      card('six', 6, 'diamond'),
      card('seven', 7),
      card('eight', 8, 'heart'),
    ];
    const signature = (play: Card[]): string => {
      const info = getPlayInfo(play, profile);
      if (!info) throw new Error('candidate is not classifiable');
      return `${info.type}:${info.maxValue}:${play.length}`;
    };
    const engine = createAIEngine({ ruleProfile: profile, seed: 1 });
    const engineClasses = new Set(engine.getPossiblePlays(hand, null).map(signature));
    const sharedClasses = new Set(representativeLegalMoves(hand, null, profile).map(signature));

    expect(engineClasses).toEqual(sharedClasses);
  });

  it('orders and selects the least sufficient large bomb before the rocket', () => {
    const profile = getRuleProfile('classic');
    const nine = [card('nine-bomb', 3)];
    const ten = [card('ten-bomb', 3)];
    const rocket = [card('rocket', 'Big', 'joker')];
    const resolutions = new Map<string, ReturnType<typeof getPlayInfo>>([
      ['nine-bomb', { type: PlayType.Bomb, maxValue: 9_003, length: 9 }],
      ['ten-bomb', { type: PlayType.Bomb, maxValue: 10_003, length: 10 }],
      ['rocket', { type: PlayType.Rocket, maxValue: 10_000 }],
    ]);
    const resolve = (play: Card[]) => resolutions.get(play[0].id) ?? null;
    const tuning = createAIEngine({ ruleProfile: profile, seed: 1 });
    const scorer = createCandidateScorer({
      resolvePlay: resolve,
      getHardTuning: tuning.getHardRuntimeTuning,
      getMasterTuning: tuning.getMasterRuntimeTuning,
    });
    const context = {
      handCountMap: new Map<number, number>(),
      isLeadTurn: false,
      profile: {
        bombPenalty: 0, wildcardPenalty: 0, highCardPenalty: 0, openBigCardPenalty: 0,
        responseSmallCardBias: 1, comboLeadBonus: 0, leadLengthBonus: 0,
        earlySmallDumpWeight: 0, conservatism: 0, humanizeJitter: 0,
      },
      ruleProfile: profile,
      lastPlay: { playerId: 'p1' as const, cards: [], type: PlayType.Bomb },
    };

    expect(scorer.sort([rocket, ten, nine], [...rocket, ...ten, ...nine], 'easy', context))
      .toEqual([nine, ten, rocket]);
    expect(pickLowestWinningPlayByResolution([rocket, ten, nine], resolve)).toBe(nine);
  });

  it('bounds a cold public decision with nine-, ten-card, and rocket responses', () => {
    const profile = getRuleProfile('classic');
    const naturalCopies = (prefix: string, rank: Rank): Card[] => (
      ['spade', 'heart', 'club', 'diamond'] as Suit[]
    ).flatMap((suit) => [card(`${prefix}-${suit}-a`, rank, suit), card(`${prefix}-${suit}-b`, rank, suit)]);
    const wildcards: Card[] = [
      { ...card('level-wild-a', 7, 'heart'), value: 15, isLevelCard: true, isRedJoker: true },
      { ...card('level-wild-b', 7, 'heart'), value: 15, isLevelCard: true, isRedJoker: true },
    ];
    const rocket = [
      card('small-a', 'Small', 'joker'), card('small-b', 'Small', 'joker'),
      card('big-a', 'Big', 'joker'), card('big-b', 'Big', 'joker'),
    ];
    const hand = [...naturalCopies('mine-three', 3), ...wildcards, ...rocket];
    const targetCards = [...naturalCopies('target-two', 2), {
      ...card('target-wild', 7, 'heart'), value: 15, isLevelCard: true, isRedJoker: true,
    }];
    const targetInfo = getPlayInfo(targetCards, profile);
    const lastPlay = {
      playerId: 'p1' as const,
      cards: targetCards,
      type: PlayType.Bomb,
      resolution: targetInfo!,
    };
    const players: Record<PlayerId, Player> = {
      p1: { id: 'p1', name: 'p1', isAI: false, team: 'teamA', hand: [card('p1-left', 4)], handCount: 1, role: 'normal' },
      p2: { id: 'p2', name: 'p2', isAI: true, team: 'teamB', hand, handCount: hand.length, role: 'normal' },
      p3: { id: 'p3', name: 'p3', isAI: true, team: 'teamA', hand: createHand('p3-large-bomb'), handCount: 8, role: 'normal' },
      p4: { id: 'p4', name: 'p4', isAI: true, team: 'teamB', hand: createHand('p4-large-bomb'), handCount: 8, role: 'normal' },
    };
    const engine = createAIEngine({ ruleProfile: profile, seed: 1 });
    const cpuStartedAt = process.cpuUsage();
    const decision = engine.makeDecision(
      hand,
      lastPlay,
      'easy',
      'teamB',
      players,
      'p2',
      { ...createContext(), currentLevel: 7 },
    );
    const cpu = process.cpuUsage(cpuStartedAt);
    const cpuMs = (cpu.user + cpu.system) / 1_000;

    expect(getPlayInfo(decision ?? [], profile)).toMatchObject({
      type: PlayType.Bomb,
      maxValue: 9_003,
      length: 9,
    });
    expect(engine.getLastMetrics().generatedPlays).toBeLessThanOrEqual(20);
    expect(cpuMs).toBeLessThan(1_000);
  }, 5_000);

  it('keeps hard and master decisions stable when the wall clock jumps', () => {
    const profile = getRuleProfile('classic');
    const hand = createHand('clock');
    const players = createPlayers(hand);
    const context = createContext();
    const decide = (difficulty: 'hard' | 'master') => {
      const engine = createAIEngine({ ruleProfile: profile, seed: 987654321 });
      return Array.from({ length: 4 }, () => (
        engine.makeDecision(
          hand,
          null,
          difficulty,
          'teamB',
          players,
          'p2',
          context,
        )?.map(({ id }) => id) ?? null
      ));
    };
    const baseline = {
      hard: decide('hard'),
      master: decide('master'),
    };
    let clock = 0;
    const clockSpy = vi.spyOn(globalThis.performance, 'now').mockImplementation(() => {
      clock += 1_000_000;
      return clock;
    });
    try {
      expect(decide('hard')).toEqual(baseline.hard);
      expect(decide('master')).toEqual(baseline.master);
    } finally {
      clockSpy.mockRestore();
    }
  });

  it('restores serialized RNG, tuning, and runtime intel with cold caches', () => {
    const profile = getRuleProfile('classic');
    const source = createAIEngine({ ruleProfile: profile, seed: 20260811 });
    const restored = createAIEngine({ ruleProfile: profile, seed: 1 });
    const hand = createHand('checkpoint');
    const players = createPlayers(hand);
    const context = createContext();
    const firstObserved = {
      playerId: 'p1' as const,
      cards: [card('observed-3', 3)],
      type: PlayType.Single,
    };
    const secondObserved = {
      playerId: 'p4' as const,
      cards: [card('observed-4a', 4), card('observed-4b', 4, 'heart')],
      type: PlayType.Pair,
    };

    source.setHardRuntimeTuning({ interceptThreshold: 9 });
    source.makeDecision(hand, firstObserved, 'easy', 'teamB', players, 'p2', context);
    source.makeDecision(hand, secondObserved, 'easy', 'teamB', players, 'p2', context);
    const serialized = JSON.parse(JSON.stringify(source.checkpoint())) as AIEngineCheckpoint;

    expect(serialized.runtimeIntel.seenValueCounts).toEqual(expect.arrayContaining([
      [3, 1],
      [4, 2],
    ]));
    expect(serialized.hardTuning.interceptThreshold).toBe(9);

    restored.getPossiblePlays(hand, null);
    restored.getPossiblePlays(hand, null);
    restored.restore(serialized);
    restored.getPossiblePlays(hand, null);
    expect(restored.getLastMetrics().cacheHitAllPlays).toBe(0);
    expect(restored.getLastMetrics().cacheMissAllPlays).toBe(1);
    restored.restore(serialized);
    expect(restored.checkpoint()).toEqual(serialized);

    for (let index = 0; index < 5; index += 1) {
      const expected = source.makeDecision(
        hand,
        firstObserved,
        'easy',
        'teamB',
        players,
        'p2',
        context,
      );
      const actual = restored.makeDecision(
        hand,
        firstObserved,
        'easy',
        'teamB',
        players,
        'p2',
        context,
      );
      expect(actual?.map(({ id }) => id) ?? null).toEqual(
        expected?.map(({ id }) => id) ?? null,
      );
      expect(restored.checkpoint()).toEqual(source.checkpoint());
    }
  });

  it('rejects checkpointing an external stateless random source explicitly', () => {
    const engine = createAIEngine({
      ruleProfile: getRuleProfile('classic'),
      random: () => 0.5,
    });

    expect(() => engine.checkpoint()).toThrow(/not checkpointable/);
  });

  it('rejects an incompatible profile without changing the target engine', () => {
    const classic = createAIEngine({ ruleProfile: getRuleProfile('classic'), seed: 10 });
    const tournament = createAIEngine({ ruleProfile: getRuleProfile('tournament'), seed: 20 });
    const checkpoint = classic.checkpoint();
    const before = tournament.checkpoint();

    expect(() => tournament.restore(checkpoint)).toThrow(/incompatible/);
    expect(tournament.checkpoint()).toEqual(before);
  });

  it('rejects a checkpoint with a divergent decision profile atomically', () => {
    const profile = getRuleProfile('classic');
    const engine = createAIEngine({ ruleProfile: profile, seed: 10 });
    const checkpoint = engine.checkpoint();
    const before = engine.checkpoint();
    checkpoint.decisionContext.ruleProfile = getRuleProfile('tournament');

    expect(() => engine.restore(checkpoint)).toThrow(/decision context/);
    expect(engine.checkpoint()).toEqual(before);
  });

  it('uses authoritative teams for every seat, including remapped teammates', () => {
    const profile = getRuleProfile('classic');
    const mappings: Array<Record<PlayerId, Player['team']>> = [
      { p1: 'teamA', p2: 'teamB', p3: 'teamA', p4: 'teamB' },
      { p1: 'teamA', p2: 'teamA', p3: 'teamB', p4: 'teamB' },
    ];
    const seats: PlayerId[] = ['p1', 'p2', 'p3', 'p4'];

    for (const teams of mappings) {
      const players = Object.fromEntries(seats.map((playerId, index) => [
        playerId,
        {
          id: playerId,
          name: playerId,
          isAI: true,
          team: teams[playerId],
          hand: [card(`${playerId}-4`, 4), card(`${playerId}-9`, 9, 'heart')],
          handCount: 2,
          role: 'normal' as const,
        },
      ])) as Record<PlayerId, Player>;

      for (const playerId of seats) {
        const teammateId = seats.find((candidate) => (
          candidate !== playerId && teams[candidate] === teams[playerId]
        ));
        expect(teammateId).toBeDefined();
        const teammateLead = {
          playerId: teammateId!,
          cards: [card(`${teammateId}-3-lead`, 3)],
          type: PlayType.Single,
        };
        for (const difficulty of ['easy', 'medium', 'hard', 'master'] as const) {
          const engine = createAIEngine({ ruleProfile: profile, seed: 20260811 });
          expect(engine.makeDecision(
            players[playerId].hand,
            teammateLead,
            difficulty,
            teams[playerId],
            players,
            playerId,
            {
              currentLevel: 2,
              teamLevels: { teamA: 2, teamB: 2 },
              roundMeta: null,
              ruleProfile: profile,
            },
          )).toBeNull();
          expect(engine.getLastDecisionTrace().passReason).toBe('teammate_yield');
        }
      }
    }
  });
});
