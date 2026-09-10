import { getPlayInfo, type RuleProfile } from '../../lib/rules';
import { PlayType, type Card } from '../../types/game';
import { faceKey } from './belief';
import type { RouteEstimate } from './types';

type Group = { shift: number; mask: number; count: number };
type Move = { needs: Array<{ group: Group; count: number }>; size: number; type: PlayType; value: number };
const bitCount = (input: number): number => {
  let value = input;
  let count = 0;
  while (value) { value &= value - 1; count++; }
  return count;
};

/** Bounded whole-hand partition search. An estimate is a legal shedding route,
 * not a forced win: opponents may regain the lead. Duplicate copies of the
 * same face are interchangeable, so states are normalized by face counts.
 */
export const createHandRoutePlanner = (
  hand: Card[], legalLeads: Card[][], profile: RuleProfile,
  resolve: (cards: Card[]) => ReturnType<typeof getPlayInfo> = cards => getPlayInfo(cards, profile),
) => {
  const groups = new Map<string, Group>();
  for (const card of hand) {
    const id = faceKey(card);
    const group = groups.get(id) ?? { shift: 0, mask: 0, count: 0 };
    group.count++;
    groups.set(id, group);
  }
  let shift = 0;
  for (const group of groups.values()) {
    group.shift = shift;
    group.mask = (1 << group.count) - 1;
    shift += group.count;
  }
  const full = (1 << hand.length) - 1;
  const orderedGroups = [...groups.values()];
  const requirements = (cards: Card[]) => {
    const counts = new Map<string, number>();
    cards.forEach(card => counts.set(faceKey(card), (counts.get(faceKey(card)) ?? 0) + 1));
    return [...counts].map(([id, count]) => ({ group: groups.get(id)!, count }));
  };
  const moves: Move[] = [];
  const seen = new Set<string>();
  for (const cards of [...legalLeads, ...hand.map(card => [card])]) {
    const needs = requirements(cards);
    const key = needs.map(({ group, count }) => `${group.shift}:${count}`).sort().join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    const info = resolve(cards);
    if (info) moves.push({ needs, size: cards.length, type: info.type, value: info.maxValue });
  }
  moves.sort((a, b) => b.size - a.size || a.value - b.value);
  const byGroup = new Map([...groups.values()].map(group => [group, moves.filter(move =>
    move.needs.some(need => need.group === group))]));
  const subtract = (state: number, needs: Move['needs']): number => {
    let result = state;
    for (const { group, count } of needs) {
      const bits = (state >>> group.shift) & group.mask;
      if (bits < (1 << count) - 1) return -1;
      const remove = (bits + 1) - (bits + 1) / (1 << count);
      result -= remove * (1 << group.shift);
    }
    return result;
  };
  const memo = new Map<number, RouteEstimate>();
  const greedyCache = new Map<number, RouteEstimate>();
  const empty: RouteEstimate = { turns: 0, singles: 0, types: [], exact: true };
  memo.set(0, empty);
  let nodes = 0;
  const budget = hand.length <= 10 ? 1600 : 350;
  const extend = (move: Move, tail: RouteEstimate, exact: boolean): RouteEstimate => ({
    turns: tail.turns + 1,
    singles: tail.singles + Number(move.type === PlayType.Single),
    types: [move.type, ...tail.types],
    exact: exact && tail.exact,
  });
  const greedy = (state: number): RouteEstimate => {
    if (!state) return empty;
    const cached = greedyCache.get(state);
    if (cached) return cached;
    const pivot = orderedGroups.find(group => (state >>> group.shift) & group.mask)!;
    const move = byGroup.get(pivot)!.find(candidate => subtract(state, candidate.needs) >= 0)!;
    const result = extend(move, greedy(subtract(state, move.needs)), false);
    greedyCache.set(state, result);
    return result;
  };
  const solve = (state: number): RouteEstimate => {
    const cached = memo.get(state);
    if (cached) return cached;
    if (nodes >= budget) {
      const result = greedy(state);
      memo.set(state, result);
      return result;
    }
    nodes++;
    const pivot = orderedGroups.find(group => (state >>> group.shift) & group.mask)!;
    const options = byGroup.get(pivot)!.filter(move => subtract(state, move.needs) >= 0);
    const complete = options.find(move => move.size === bitCount(state));
    if (complete) {
      const result = extend(complete, empty, true);
      memo.set(state, result);
      return result;
    }
    let best = greedy(state);
    const branchLimit = hand.length <= 10 ? 32 : 12;
    let exact = options.length <= branchLimit;
    for (const move of options.slice(0, branchLimit)) {
      const tail = solve(subtract(state, move.needs));
      exact &&= tail.exact;
      const candidate = extend(move, tail, exact);
      if (candidate.turns < best.turns || (candidate.turns === best.turns && candidate.singles < best.singles)) best = candidate;
    }
    best = { ...best, exact };
    memo.set(state, best);
    return best;
  };
  return {
    after: (play: Card[]) => solve(subtract(full, requirements(play))),
    whole: () => solve(full),
    nodes: () => nodes,
  };
};
