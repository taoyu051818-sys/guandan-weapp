import { describe, expect, it } from 'vitest';
import { createDeck, shuffleDeck } from '../src/lib/deck';
import { representativeLegalMoves, structuralLegalMoves } from '../src/lib/legalMoves';
import { canPlay, getPlayInfo, getPlayInfos, getRuleProfile } from '../src/lib/rules';
import { createSeededRandom } from '../src/ai/random';
import { createPublicBelief } from '../src/ai/team/belief';
import { createHandRoutePlanner } from '../src/ai/team/handRoute';
import { holdingCanBeat, summarizeHolding } from '../src/ai/team/holdingShapes';
import type { TeamObservation } from '../src/ai/team/types';
import { estimateTableOutlook } from '../src/ai/team/tableOutlook';
import { PlayType, type Card, type PlayAction } from '../src/types/game';

const profile = getRuleProfile('classic');
const deck = createDeck(2);
const take = (rank: Card['rank'], n = 1) => deck.filter(card => card.rank === rank).slice(0, n);
const view = (hand: Card[], history: PlayAction[] = []): TeamObservation => ({
  hand, self: 'p1', team: 'teamA', level: 2, profile,
  seats: [{ id: 'p1', team: 'teamA', count: hand.length }, { id: 'p2', team: 'teamB', count: 6 },
    { id: 'p3', team: 'teamA', count: 4 }, { id: 'p4', team: 'teamB', count: 8 }],
  order: ['p1', 'p2', 'p3', 'p4'], lastPlay: null, history, historyComplete: true, finishedPlayers: [],
});

describe('public holding capability model', () => {
  it('matches authoritative legal capabilities across profiles, levels and wildcards', () => {
    const random = createSeededRandom(90210);
    for (const preset of ['classic', 'tournament'] as const) {
      const rules = getRuleProfile(preset);
      for (const level of [2, 7, 'A'] as const) {
        for (let sample = 0; sample < 18; sample++) {
          const cards = shuffleDeck(createDeck(level), random).slice(0, 5 + sample % 11);
          const moves = representativeLegalMoves(cards, null, rules);
          const expected = new Map<string, number>();
          for (const move of moves) for (const info of getPlayInfos(move, rules)) {
            const key = `${info.type}:${move.length}`;
            expected.set(key, Math.max(expected.get(key) ?? 0, info.maxValue));
          }
          const summary = summarizeHolding(cards, rules);
          expect([...summary].map(([key, info]) => [key, info.maxValue]).sort(), `level=${level} sample=${sample}`)
            .toEqual([...expected].sort());
        }
      }
    }
  });

  it('never substitutes a heart-level wildcard for a joker or natural level in a sequence', () => {
    const wilds = deck.filter(card => card.isRedJoker);
    const jokerWild = summarizeHolding([...take('Big'), ...wilds.slice(0, 1)], profile);
    expect(holdingCanBeat(jokerWild, { type: PlayType.Pair, maxValue: 16 }, 2)).toBe(false);
    const noStraight = [...take(2), ...take(3), ...take(4), ...take(5), ...take(6)];
    expect([...summarizeHolding(noStraight, profile).values()].some(info => info.type === PlayType.Straight)).toBe(false);
  });

  it('distinguishes a natural straight flush from an ordinary straight and supports wildcard suit choices', () => {
    const flush = [3, 4, 5, 6, 7].map(rank => deck.find(card => card.rank === rank && card.suit === 'spade')!);
    expect(summarizeHolding(flush, profile).has(`${PlayType.Straight}:5`)).toBe(false);
    expect(summarizeHolding(flush, profile).has(`${PlayType.StraightFlush}:5`)).toBe(true);
    for (const cards of [flush, [...flush.slice(0, 4), deck.find(card => card.isRedJoker)!], deck.filter(card => card.isRedJoker)]) {
      const expected = new Map<string, number>();
      for (const move of structuralLegalMoves(cards, profile)) for (const info of getPlayInfos(move, profile)) {
        const key = `${info.type}:${move.length}`;
        expected.set(key, Math.max(expected.get(key) ?? 0, info.maxValue));
      }
      expect([...summarizeHolding(cards, profile)].map(([key, info]) => [key, info.maxValue]).sort()).toEqual([...expected].sort());
    }
  });

  it('deduplicates the current play from history, records all players and accepts partial histories honestly', () => {
    const lead: PlayAction = { playerId: 'p2', cards: take('A'), type: PlayType.Single };
    const a = createPublicBelief(view(take(5, 2), [lead]), createSeededRandom(9));
    const b = createPublicBelief({ ...view(take(5, 2), [lead]), lastPlay: lead }, createSeededRandom(9));
    expect(a.summaries).toEqual(b.summaries);
    expect(a.coverage).toBeLessThan(1);
    expect(a.sampleCount).toBe(32);
    expect(a.summaries).toHaveLength(3);
  });

  it('proves an exhausted joker pair impossible from public history', () => {
    const history: PlayAction[] = [{ playerId: 'p2', cards: take('Big', 2), type: PlayType.Pair }];
    const belief = createPublicBelief(view(take(5, 2), history), createSeededRandom(7));
    // Ask only about a two-card hand to exclude bomb responses.
    const initial = view(take(5, 2), history);
    const smallView = { ...initial, seats: initial.seats.map(seat => seat.id === 'p2' ? { ...seat, count: 2 } : seat) };
    const two = createPublicBelief(smallView, createSeededRandom(7));
    expect(two.probability('p2', { type: PlayType.Pair, maxValue: 16 }, 2, true)).toBe(0);
    expect(belief.summaries).toHaveLength(3);
  });

  it('uses voluntary passes as soft evidence, never certainty', () => {
    const lead: PlayAction = { playerId: 'p1', cards: take('K'), type: PlayType.Single };
    const base = view(take(5, 2), [lead]);
    const passed = { ...base, history: [lead, { playerId: 'p2', cards: [], type: PlayType.Pass } as PlayAction] };
    const a = createPublicBelief(base, createSeededRandom(33));
    const b = createPublicBelief(passed, createSeededRandom(33));
    const target = getPlayInfo(lead.cards, profile)!;
    expect(b.probability('p2', target, 1)).toBeLessThan(a.probability('p2', target, 1));
    expect(b.probability('p2', target, 1)).toBeGreaterThan(0);
  });
});

describe('whole-hand route planning', () => {
  it('handles interchangeable duplicate copies and preserves a two-step pair exit', () => {
    const hand = [...take(6, 2), ...take(9, 2)];
    const planner = createHandRoutePlanner(hand, structuralLegalMoves(hand, profile), profile);
    expect(planner.whole()).toMatchObject({ turns: 2, singles: 0, exact: true });
    expect(planner.after([hand[1]])).toMatchObject({ turns: 2, singles: 1 });
    expect(planner.after(hand.slice(0, 2))).toMatchObject({ turns: 1, singles: 0 });
  });

  it('agrees with exhaustive partitions for small hands and keeps a deterministic node budget', () => {
    const random = createSeededRandom(501);
    const brute = (cards: Card[]): number => {
      if (!cards.length) return 0;
      return 1 + Math.min(...structuralLegalMoves(cards, profile)
        .filter(move => move.some(card => card.id === cards[0].id))
        .map(move => brute(cards.filter(card => !move.some(played => played.id === card.id)))));
    };
    for (let index = 0; index < 20; index++) {
      const hand = shuffleDeck(deck, random).slice(0, 7);
      const moves = structuralLegalMoves(hand, profile);
      const planner = createHandRoutePlanner(hand, moves, profile);
      expect(planner.whole().turns).toBe(brute(hand));
      for (const move of moves) {
        expect(canPlay(move, null, profile)).toBe(true);
        expect(planner.after(move).turns, JSON.stringify({ hand, move })).toBe(brute(hand.filter(card => !move.some(played => played.id === card.id))));
      }
      expect(planner.nodes()).toBeLessThanOrEqual(1600);
    }
  });
});

describe('seat-order first-place race', () => {
  it('ends the race at a finishing ally rather than penalizing a later enemy', () => {
    const initial = view(take(6, 2));
    const info = { type: PlayType.Single, maxValue: 5 };
    const probability = () => 1;
    const allyFirst = estimateTableOutlook({ ...initial, order: ['p1', 'p3', 'p2', 'p4'] }, info, 1, probability);
    expect(allyFirst).toMatchObject({ allyFinish: 1, enemyFinish: 0 });
    const enemyFirst = estimateTableOutlook(initial, info, 1, probability);
    expect(enemyFirst).toMatchObject({ allyFinish: 0, enemyFinish: 1 });
  });
});
