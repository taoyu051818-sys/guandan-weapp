import { describe, expect, it } from 'vitest';
import { createDecisionSupport } from '../src/ai/decisionSupport';
import { createFallbackDecision } from '../src/ai/fallbackDecision';
import { createRuntimeIntelState } from '../src/ai/runtimeIntel';
import { getRuleProfile } from '../src/lib/rules';
import {
  PlayType,
  type Card,
  type Player,
  type PlayerId,
} from '../src/types/game';

const card = (id: string, value: number): Card => ({
  id,
  rank: value as Card['rank'],
  suit: 'spade',
  value,
  isLevelCard: false,
});

const player = (id: PlayerId, team: Player['team'], handSize: number): Player => ({
  id,
  name: id,
  isAI: true,
  team,
  hand: Array.from({ length: handSize }, (_, index) => card(`${id}-${index}`, index + 3)),
  role: 'normal',
});

const createSubject = (randomValues: number[]) => {
  const runtimeIntel = createRuntimeIntelState();
  const getPlayInfo = (cards: Card[]) => ({
    type: cards.length === 4
      ? PlayType.Bomb
      : cards.length === 2 ? PlayType.Pair : PlayType.Single,
    maxValue: cards[0]?.value ?? 0,
    length: cards.length,
  });
  const support = createDecisionSupport({
    runtimeIntel,
    getRuleProfile: () => getRuleProfile('classic'),
    getPlayInfo,
    generateAllPlays: () => [],
    getPossiblePlays: () => [],
  });
  const chooseFallback = createFallbackDecision({
    random: () => randomValues.shift() ?? 0,
    runtimeIntel,
    support,
    getPlayInfo,
  });
  const players: Record<PlayerId, Player> = {
    p1: player('p1', 'teamA', 10),
    p2: player('p2', 'teamB', 10),
    p3: player('p3', 'teamA', 4),
    p4: player('p4', 'teamB', 10),
  };
  return { chooseFallback, players, runtimeIntel };
};

describe('AI fallback decision boundary', () => {
  it('owns the easy-tier humanized candidate pick and random call order', () => {
    const { chooseFallback, players } = createSubject([0.5, 0.7]);
    const possiblePlays = [[card('low', 4)], [card('middle', 8)], [card('high', 12)]];

    expect(chooseFallback({
      hand: possiblePlays.flat(),
      possiblePlays,
      lastPlay: null,
      difficulty: 'easy',
      myTeam: 'teamB',
      players,
      teammateId: 'p4',
      intent: 'tempo',
      hardThreatMode: false,
      isAdvancedAI: false,
      isAChallenge: false,
      tributeAggressiveLead: false,
      markPass: () => null,
    })).toEqual(possiblePlays[2]);
  });

  it('conserves a bomb in an ordinary non-critical follow', () => {
    const { chooseFallback, players } = createSubject([0]);
    const bomb = [card('b1', 8), card('b2', 8), card('b3', 8), card('b4', 8)];
    players.p1.hand = Array.from({ length: 10 }, (_, index) => card(`enemy-a-${index}`, index + 3));
    players.p3.hand = Array.from({ length: 10 }, (_, index) => card(`enemy-b-${index}`, index + 3));
    let passReason = '';

    expect(chooseFallback({
      hand: bomb,
      possiblePlays: [bomb],
      lastPlay: { playerId: 'p1', cards: [card('lead', 7)], type: PlayType.Single },
      difficulty: 'medium',
      myTeam: 'teamB',
      players,
      teammateId: 'p4',
      intent: 'assist_teammate',
      hardThreatMode: false,
      isAdvancedAI: false,
      isAChallenge: false,
      tributeAggressiveLead: false,
      markPass: (reason) => { passReason = reason; return null; },
    })).toBeNull();
    expect(passReason).toBe('bomb_conservation');
  });

  it('feeds the teammate using the observed non-bomb play type', () => {
    const { chooseFallback, players, runtimeIntel } = createSubject([0.99]);
    const single = [card('single', 5)];
    const pair = [card('pair-a', 6), card('pair-b', 6)];
    runtimeIntel.lastTypeByPlayer.set('p4', PlayType.Pair);
    players.p4.hand = [card('teammate-remaining', 7)];

    expect(chooseFallback({
      hand: [...single, ...pair],
      possiblePlays: [single, pair],
      lastPlay: null,
      difficulty: 'hard',
      myTeam: 'teamB',
      players,
      teammateId: 'p4',
      intent: 'tempo',
      hardThreatMode: false,
      isAdvancedAI: true,
      isAChallenge: false,
      tributeAggressiveLead: false,
      markPass: () => null,
    })).toEqual(pair);
  });
});
