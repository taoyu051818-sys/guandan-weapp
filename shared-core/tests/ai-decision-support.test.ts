import { describe, expect, it } from 'vitest';
import { createDecisionSupport } from '../src/ai/decisionSupport';
import { createRuntimeIntelState } from '../src/ai/runtimeIntel';
import { getRuleProfile } from '../src/lib/rules';
import { PlayType, type Card, type Player, type PlayerId } from '../src/types/game';

const card = (id: string, value: number): Card => ({
  id,
  rank: value as Card['rank'],
  suit: 'spade',
  value,
  isLevelCard: false,
});

const player = (
  id: PlayerId,
  team: Player['team'],
  handSize: number,
  isAI: boolean = true,
): Player => ({
  id,
  name: id,
  isAI,
  team,
  hand: Array.from({ length: handSize }, (_, index) => card(`${id}-${index}`, index + 3)),
  role: 'normal',
});

const createSubject = () => {
  const runtimeIntel = createRuntimeIntelState();
  const support = createDecisionSupport({
    runtimeIntel,
    getRuleProfile: () => getRuleProfile('classic'),
    getPlayInfo: (cards) => cards.length === 4
      ? { type: PlayType.Bomb, maxValue: cards[0]?.value ?? 0, length: cards.length }
      : { type: cards.length === 2 ? PlayType.Pair : PlayType.Single, maxValue: cards[0]?.value ?? 0, length: cards.length },
    generateAllPlays: () => [],
    getPossiblePlays: () => [],
  });
  return { runtimeIntel, support };
};

describe('AI decision support boundary', () => {
  it('owns teammate discovery, intent and role selection', () => {
    const { support } = createSubject();
    const players = {
      p1: player('p1', 'teamA', 12),
      p2: player('p2', 'teamB', 12),
      p3: player('p3', 'teamA', 3),
      p4: player('p4', 'teamB', 12),
    };

    expect(support.getTeammateId(players, 'p1', 'teamA')).toBe('p3');
    expect(support.getIntent(null, 'p3', 3, 12)).toBe('assist_teammate');
    expect(support.getIntent(null, 'p3', 8, 5)).toBe('block_enemy');
    expect(support.getAdvancedRole('master', players, 'p3')).toBe('support');
  });

  it('projects observed enemy pressure without exposing engine orchestration', () => {
    const { runtimeIntel, support } = createSubject();
    const players = {
      p1: player('p1', 'teamA', 10),
      p2: player('p2', 'teamB', 5),
      p3: player('p3', 'teamA', 4),
      p4: player('p4', 'teamB', 9),
    };
    runtimeIntel.singlePairStreakByPlayer.set('p2', 2);
    runtimeIntel.lastTypeByPlayer.set('p4', PlayType.Bomb);

    const pressure = support.getEnemyPressureModel(players, 'teamA', 'p3');

    expect(pressure.minEnemyHand).toBe(5);
    expect(pressure.doubleEnemyLow).toBe(true);
    expect(pressure.sprintRisk).toBe(1);
    expect(pressure.bombRisk).toBeGreaterThan(0.5);
  });

  it('leaves teammate-yield ownership to the runner and intercepts an enemy sprint', () => {
    const { support } = createSubject();
    const players = {
      p1: player('p1', 'teamA', 10),
      p2: player('p2', 'teamB', 5),
      p3: player('p3', 'teamA', 6),
      p4: player('p4', 'teamB', 10),
    };
    const low = [card('low', 6)];
    const high = [card('high', 12)];
    const bomb = [card('b1', 8), card('b2', 8), card('b3', 8), card('b4', 8)];

    expect(support.chooseSupportOverride(
      [high, low, bomb],
      { playerId: 'p3', cards: low, type: PlayType.Single },
      players,
      'teamA',
      'p3',
    )).toBeUndefined();
    expect(support.chooseSupportOverride(
      [high, low, bomb],
      { playerId: 'p2', cards: low, type: PlayType.Single },
      players,
      'teamA',
      'p3',
    )).toEqual(low);
  });
});
