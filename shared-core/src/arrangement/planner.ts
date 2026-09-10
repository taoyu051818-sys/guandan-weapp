import { getPlayInfo, type RuleProfile } from '../lib/rules';
import type { Card } from '../types/game';
import { prepareArrangementCandidates, subtractArrangementMove, type ArrangementMove } from './candidates';
import { groupCost, sumFeatures } from './features';
import { DEFAULT_ARRANGEMENT_WEIGHTS, type ArrangementPlan, type ArrangementWeights } from './model';

interface Route { cost: number; moves: ArrangementMove[]; exact: boolean }
/** Only offline experiments override weights. Runtime uses one stable policy.
 * No opponent state, RNG or scene objects: repeating Arrange cannot shuffle a layout.
 */
export const prepareHandArrangement = (hand: readonly Card[], profile: RuleProfile) => {
  const source = prepareArrangementCandidates(hand, profile);
  return (weights: Readonly<ArrangementWeights> = DEFAULT_ARRANGEMENT_WEIGHTS): ArrangementPlan => {
    if ((Object.keys(DEFAULT_ARRANGEMENT_WEIGHTS) as Array<keyof ArrangementWeights>)
      .some(key => !Number.isFinite(weights[key]) || weights[key] < 0)) throw new Error('Invalid arrangement weights');
    const costs = new Map(source.moves.map(move => [move, groupCost(move.features, weights)]));
    const ordered = source.moves.slice().sort((a, b) => costs.get(a)! / a.size - costs.get(b)! / b.size || a.key.localeCompare(b.key));
    const byBucket = new Map(source.buckets.map(bucket => [bucket, ordered.filter(move => move.needs.some(need => need.bucket === bucket))]));
    const pivots = source.buckets.slice().sort((a, b) => byBucket.get(a)!.length - byBucket.get(b)!.length || a.shift - b.shift);
    const available = (state: number) => byBucket.get(pivots.find(bucket => (state >>> bucket.shift) & bucket.mask)!)!
      .filter(move => subtractArrangementMove(state, move) >= 0);
    const empty: Route = { cost: 0, moves: [], exact: true };
    const memo = new Map<number, Route>([[0, empty]]);
    const greedyMemo = new Map<number, Route>([[0, empty]]);
    let nodes = 0;
    const budget = hand.length <= 10 ? 12000 : 1800;
    const branchLimit = hand.length <= 10 ? Infinity : 40;
    const extend = (move: ArrangementMove, tail: Route): Route => ({
      cost: costs.get(move)! + tail.cost, moves: [move, ...tail.moves], exact: tail.exact,
    });
    const greedy = (state: number): Route => {
      const cached = greedyMemo.get(state);
      if (cached) return cached;
      const move = available(state)[0];
      const route = { ...extend(move, greedy(subtractArrangementMove(state, move))), exact: false };
      greedyMemo.set(state, route);
      return route;
    };
    const solve = (state: number): Route => {
      const cached = memo.get(state);
      if (cached) return cached;
      if (nodes >= budget) return greedy(state);
      nodes++;
      const options = available(state);
      let best = greedy(state);
      let exact = options.length <= branchLimit;
      for (const move of options.slice(0, branchLimit)) {
        const tail = solve(subtractArrangementMove(state, move));
        exact &&= tail.exact;
        const route = extend(move, tail);
        if (route.cost < best.cost - 1e-7 || (Math.abs(route.cost - best.cost) < 1e-7 && route.moves.length < best.moves.length)) best = route;
      }
      best = { ...best, exact };
      memo.set(state, best);
      return best;
    };
    // A legal whole hand is ready to finish; do not preserve a wildcard instead.
    const finish = source.moves.find(move => move.size === hand.length);
    const result = finish ? extend(finish, empty) : solve(source.full);
    const remaining = new Map(source.buckets.map(bucket => [bucket, bucket.cards.slice()]));
    const groups = result.moves.map(move => {
      const cards = move.needs.flatMap(({ bucket, count }) => remaining.get(bucket)!.splice(0, count)).map(card => ({ ...card }));
      return { cards, resolution: getPlayInfo(cards, profile)! };
    });
    return { groups, metrics: sumFeatures(result.moves.map(move => move.features)), score: result.cost, nodes, exact: result.exact };
  };
};

export const planHandArrangement = (hand: readonly Card[], profile: RuleProfile): ArrangementPlan =>
  prepareHandArrangement(hand, profile)();
