import { describe, expect, it } from 'vitest';
import { createAIEngine, createDeck, getRuleProfile, getPlayInfo, canPlay, rankHintMoves, PlayType } from '../src';
import type { Card, Player, PlayerId, PlayAction } from '../src';
import { structuralLegalMoves } from '../src/lib/legalMoves';
import { createHandRoutePlanner } from '../src/ai/team/handRoute';
import { assessHandStrength, strengthWeights } from '../src/ai/team/handStrength';

const profile = getRuleProfile('classic'), deck = createDeck(2);
const take = (rank: Card['rank'], n = 1) => deck.filter(card => card.rank === rank).slice(0, n);
const strength = (hand: Card[], ally: number) => assessHandStrength(hand,
  createHandRoutePlanner(hand, structuralLegalMoves(hand, profile), profile).whole(), ally);
const playersFor = (hand: Card[], counts: number[]) => Object.fromEntries(
  (['p1', 'p2', 'p3', 'p4'] as const).map((id, i) => [id, {
    id, name: '', isAI: true, team: i % 2 ? 'teamB' : 'teamA', role: 'normal',
    hand: i === 0 ? hand : new Array(counts[i]), handCount: counts[i],
  }])) as Record<PlayerId, Player>;
const context = { currentLevel: 2 as const, teamLevels: { teamA: 2 as const, teamB: 2 as const },
  roundMeta: null, ruleProfile: profile, publicHistory: [] as PlayAction[], roundId: 1, revision: 1 };

describe('highest-tier strength plans and shared hints', () => {
  it('distinguishes strong compact control from weak scattered cards', () => {
    const strong = strength([...take(6, 4), ...take(9, 4), ...take('A', 2)], 20);
    const weak = strength([3, 5, 7, 9, 'J'].flatMap(rank => take(rank as Card['rank'])), 5);
    expect(strong).toMatchObject({ tier: 'strong', plan: 'attack', turns: 3 });
    expect(weak).toMatchObject({ tier: 'weak', plan: 'support' });
    expect(strengthWeights(strong).control).toBeGreaterThan(strengthWeights(weak).control);
    expect(strengthWeights(weak).allyFeed).toBeGreaterThan(strengthWeights(strong).allyFeed);
  });
  it('changes the weak-hand plan when a teammate enters the <=10 sprint', () => {
    const hand = [3, 5, 7, 9, 'J'].flatMap(rank => take(rank as Card['rank']));
    expect(strength(hand, 11).plan).toBe('develop');
    expect(strength(hand, 10).plan).toBe('support');
    expect(strength(hand, 0).plan).toBe('develop');
  });
  it('uses close-out weights for a controlled two-hand exit', () => {
    const result = strength([...take(6, 4), ...take('Big', 2)], 7);
    expect(result.plan).toBe('close');
    expect(strengthWeights(result).route).toBe(125);
  });
  it('counts overlapping natural bombs once per rank', () => {
    const result = strength(take(7, 8), 20);
    expect(result.controls).toBe(1);
  });
  it('recognizes a straight flush as a control resource', () => {
    const hand = deck.filter(card => card.suit === 'spade' && [3, 4, 5, 6, 7].includes(Number(card.rank))).filter((_, i) => i < 5);
    const route = createHandRoutePlanner(hand, structuralLegalMoves(hand, profile), profile).whole();
    expect(route.types).toContain(PlayType.StraightFlush);
    expect(assessHandStrength(hand, route, 15).controls).toBeGreaterThanOrEqual(1);
  });
  it.each([['lead', null], ['enemy', 'p4'], ['ally', 'p3']] as const)(
    'hint and automated policy make the same first recommendation for %s', (_name, leader) => {
      const hand = [...take(6, 2), ...take(9, 2), ...take(3), ...take('Big')];
      const players = playersFor(hand, [6, 9, 8, 10]);
      const target: PlayAction | null = leader ? { playerId: leader, cards: take(5), type: PlayType.Single } : null;
      const seed = 57, engine = createAIEngine({ ruleProfile: profile, seed });
      const automatic = engine.makeDecision(hand, target, 'master', 'teamA', players, 'p1', context);
      const hinted = rankHintMoves({ hand, lastPlay: target, ruleProfile: profile, protectedGroups: [], seed,
        observation: { self: 'p1', team: 'teamA', seats: Object.values(players).map(p => ({ id: p.id, team: p.team, count: p.hand.length })),
          order: ['p1', 'p2', 'p3', 'p4'], history: [], historyComplete: true, level: 2, finishedPlayers: [], roundId: 1, revision: 1 } });
      expect(hinted[0]?.cards.map(c => c.id) ?? null).toEqual(automatic?.map(c => c.id) ?? null);
    });
  it('records different strength plans in real decisions', () => {
    for (const [hand, expected] of [
      [[...take(6, 4), ...take(9, 4), ...take('A', 2)], 'attack'],
      [[3, 5, 7, 9, 'J'].flatMap(rank => take(rank as Card['rank'])), 'support'],
    ] as const) {
      const own = [...hand], players = playersFor(own, [own.length, 20, expected === 'support' ? 5 : 20, 20]);
      const engine = createAIEngine({ ruleProfile: profile, seed: 51 });
      engine.makeDecision(own, null, 'master', 'teamA', players, 'p1', context);
      expect(engine.getLastDecisionTrace().team?.strength?.plan).toBe(expected);
    }
  });
  it.each([1, 2, 5, 10])('uses public sprint reasoning for either opponent with %i cards', count => {
    for (const seat of [1, 3]) {
      const hand = [...take(6, 2), ...take(9), ...take('K')], counts = [4, 17, 12, 17];
      counts[seat] = count;
      const players = playersFor(hand, counts), engine = createAIEngine({ ruleProfile: profile, seed: 5 });
      const choice = engine.makeDecision(hand, null, 'master', 'teamA', players, 'p1', context)!;
      expect(canPlay(choice, null, profile)).toBe(true);
      if (count === 1) expect(getPlayInfo(choice, profile)?.type).not.toBe(PlayType.Single);
      expect(engine.getLastDecisionTrace().team?.sampleCount).toBe(32);
    }
  });
});
