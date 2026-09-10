import { describe, expect, it } from 'vitest';
import { createDeck, getRuleProfile, getPlayInfo, planHandArrangement, prepareHandArrangement,
  DEFAULT_ARRANGEMENT_WEIGHTS, PlayType, type Card } from '../src';
import { enumerateCandidateMoves } from '../src/lib/legalMoves';
import { createGroupFeatures, groupCost } from '../src/arrangement/features';
import { createSeededRandom } from '../src/ai/random';
import { shuffleDeck } from '../src/lib/deck';

const profile = getRuleProfile('classic');
const handOf = (ranks: Card['rank'][], level: Card['rank'] = 9): Card[] => {
  const deck = createDeck(level), used = new Set<string>();
  return ranks.map((rank, index) => {
    const card = deck.find(c => c.rank === rank && !used.has(c.id) && c.suit === ['spade', 'club', 'diamond', 'heart'][index % 4])
      ?? deck.find(c => c.rank === rank && !used.has(c.id))!;
    used.add(card.id); return card;
  });
};
const wild = (copy = 0) => createDeck(9).filter(c => c.isRedJoker)[copy];
const signature = (plan: ReturnType<typeof planHandArrangement>) => plan.groups.map(g => g.cards.map(c => c.id).sort().join(',')).sort();
const verify = (hand: Card[], result = planHandArrangement(hand, profile)) => {
  expect(result.groups.flatMap(g => g.cards.map(c => c.id)).sort()).toEqual(hand.map(c => c.id).sort());
  result.groups.forEach(g => expect(getPlayInfo(g.cards, profile)).toEqual(g.resolution));
  return result;
};

describe('whole hand arrangement', () => {
  it('groups a natural ordinary straight, not just straight flushes', () => {
    expect(verify(handOf([3, 4, 5, 6, 7])).groups.map(g => g.resolution.type)).toEqual([PlayType.Straight]);
  });
  it('breaks a low pair when the remaining single plus straight substantially improves the hand', () => {
    const result = verify(handOf([3, 3, 4, 5, 6, 7]));
    expect(result.metrics.turns).toBe(2);
    expect(result.groups.some(g => g.resolution.type === PlayType.Straight)).toBe(true);
  });
  it('preserves a complete three-pair run', () => {
    expect(verify(handOf([3, 3, 4, 4, 5, 5])).groups[0].resolution.type).toBe(PlayType.Tube);
  });
  it('uses a wildcard to finish rather than reserving it at all costs', () => {
    const result = verify([...handOf([3, 4, 5, 6]), wild()]);
    expect(result.metrics.turns).toBe(1);
    expect(result.groups[0].resolution.wildcardUsages?.[0].representedValue).toBeLessThanOrEqual(15);
  });
  it('preserves a natural bomb when an alternative straight uses the loose cards', () => {
    const result = verify(handOf([3, 3, 3, 3, 4, 5, 6, 7, 8, 'A']));
    expect(result.groups.some(g => g.resolution.type === PlayType.Bomb && g.cards.every(c => c.rank === 3))).toBe(true);
  });
  it('can use both copies of an identical face in different complete groups', () => {
    const deck = createDeck(9), hand = deck.filter(c => c.suit === 'spade' && [3, 4, 5, 6, 7].includes(Number(c.rank)));
    const result = verify(hand);
    expect(result.groups.filter(g => g.resolution.type === PlayType.StraightFlush)).toHaveLength(2);
  });
  it('compares the same wildcard across competing controls and ordinary sequences', () => {
    const deck = createDeck(7);
    const take = (rank: Card['rank'], suit: Card['suit']) => deck.find(c => c.rank === rank && c.suit === suit)!;
    const hand = [take(5, 'spade'), take(6, 'spade'), take(8, 'spade'), take(9, 'spade'),
      take(9, 'heart'), take(9, 'club'), take(7, 'heart')];
    const result = verify(hand);
    expect(result.metrics.turns).toBe(2);
    expect(result.groups.some(g => g.resolution.type === PlayType.StraightFlush)).toBe(true);
    const ordinaryFlushProfile = { ...profile, straightFlushAsBomb: false };
    const other = planHandArrangement(hand, ordinaryFlushProfile);
    expect(other.groups.some(g => g.resolution.type === PlayType.Bomb)).toBe(true);
    expect(other.groups.flatMap(g => g.cards).filter(c => c.isRedJoker)).toHaveLength(1);
  });
  it('does not turn heart wildcards into jokers', () => {
    const result = verify([...handOf(['Small', 'Small']), wild(), wild(1)]);
    expect(result.groups.some(g => g.resolution.type === PlayType.Rocket || g.resolution.type === PlayType.Bomb)).toBe(false);
    result.groups.forEach(g => g.resolution.wildcardUsages?.forEach(u => expect(u.representedValue).toBeLessThanOrEqual(15)));
  });
  it('follows profile semantics for natural level cards and ace-low sequences', () => {
    const levelHand = handOf([3, 4, 5, 6, 7], 5);
    expect(verify(levelHand).metrics.turns).toBeGreaterThan(1);
    const aceLow = handOf(['A', 2, 3, 4, 5]);
    expect(verify(aceLow).metrics.turns).toBe(1);
    expect(planHandArrangement(aceLow, { ...profile, allowA2345Straight: false }).metrics.turns).toBeGreaterThan(1);
  });
  it('is stable under input reorder and isolates returned data', () => {
    const hand = handOf([3, 3, 4, 5, 6, 7, 'A']), original = JSON.stringify(hand);
    const prepared = prepareHandArrangement(hand, profile), first = prepared(), expected = signature(first);
    first.groups[0].cards[0].rank = 'Big';
    expect(signature(prepared())).toEqual(expected);
    expect(signature(planHandArrangement([...hand].reverse(), profile))).toEqual(expected);
    expect(JSON.stringify(hand)).toBe(original);
  });
  it('supports tribute hands above 27 and rejects invalid physical identity', () => {
    const hand = shuffleDeck(createDeck(9), createSeededRandom(898)).filter(c => !c.isRedJoker).slice(0, 29);
    verify(hand);
    expect(() => planHandArrangement([hand[0], hand[0]], profile)).toThrow();
    expect(() => prepareHandArrangement(hand, profile)({ ...DEFAULT_ARRANGEMENT_WEIGHTS, control: NaN })).toThrow();
    expect(planHandArrangement([], profile).groups).toEqual([]);
  });
  it('matches an independent exhaustive physical-card partition oracle on small hands', () => {
    for (let seed = 1; seed <= 24; seed++) {
      const hand = shuffleDeck(createDeck(9), createSeededRandom(seed)).slice(0, 8);
      const feature = createGroupFeatures(hand, profile), memo = new Map<string, number>();
      const solve = (rest: Card[]): number => {
        if (!rest.length) return 0;
        const key = rest.map(c => c.id).sort().join(',');
        if (memo.has(key)) return memo.get(key)!;
        const scores = enumerateCandidateMoves(rest).filter(m => m.some(c => c.id === rest[0].id)).flatMap(move => {
          const info = getPlayInfo(move, profile);
          return info ? [groupCost(feature(move, info), DEFAULT_ARRANGEMENT_WEIGHTS) + solve(rest.filter(c => !move.includes(c)))] : [];
        });
        const best = Math.min(...scores); memo.set(key, best); return best;
      };
      const result = verify(hand);
      expect(result.exact).toBe(true);
      expect(result.score).toBeCloseTo(solve(hand), 6);
    }
  });
});
