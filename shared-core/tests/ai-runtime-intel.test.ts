import { describe, expect, it, vi } from 'vitest';
import {
  createRuntimeIntelState,
  deserializeRuntimeIntel,
  observeRuntimeIntel,
  serializeRuntimeIntel,
} from '../src/ai/runtimeIntel';
import type { Card, Player, PlayerId } from '../src/types/game';
import { PlayType } from '../src/types/game';

const card = (id: string, value: number): Card => ({
  id,
  rank: value as Card['rank'],
  suit: 'spade',
  value,
  isLevelCard: false,
});

const players = (total: number): Record<PlayerId, Player> => {
  const hand = Array.from({ length: total }, (_, index) => card(`hand-${index}`, index + 3));
  return {
    p1: { id: 'p1', name: 'p1', isAI: true, team: 'teamA', hand, handCount: hand.length, role: 'normal' },
    p2: { id: 'p2', name: 'p2', isAI: true, team: 'teamB', hand: [], handCount: 0, role: 'normal' },
    p3: { id: 'p3', name: 'p3', isAI: true, team: 'teamA', hand: [], handCount: 0, role: 'normal' },
    p4: { id: 'p4', name: 'p4', isAI: true, team: 'teamB', hand: [], handCount: 0, role: 'normal' },
  };
};

describe('runtime AI intelligence state', () => {
  it('records each observed play once and round-trips its checkpoint payload', () => {
    const state = createRuntimeIntelState();
    const played = card('seen-nine', 9);
    const action = { playerId: 'p1' as const, cards: [played], type: PlayType.Single };
    const getPlayInfo = vi.fn(() => ({ maxValue: 9 }));

    observeRuntimeIntel(state, action, players(8), getPlayInfo, vi.fn());
    observeRuntimeIntel(state, action, players(8), getPlayInfo, vi.fn());

    expect(state.seenValueCounts.get(9)).toBe(1);
    expect(state.singlePairStreakByPlayer.get('p1')).toBe(1);
    expect(getPlayInfo).toHaveBeenCalledTimes(1);
    expect(serializeRuntimeIntel(deserializeRuntimeIntel(serializeRuntimeIntel(state))))
      .toEqual(serializeRuntimeIntel(state));
  });

  it('clears remembered plays when the total hand size increases for a new round', () => {
    const state = createRuntimeIntelState();
    state.prevTotalCards = 1;
    state.seenValueCounts.set(9, 1);
    const onRoundReset = vi.fn();

    observeRuntimeIntel(state, null, players(8), () => null, onRoundReset);

    expect(onRoundReset).toHaveBeenCalledOnce();
    expect(state.prevTotalCards).toBe(8);
    expect(state.seenValueCounts.size).toBe(0);
  });
});
