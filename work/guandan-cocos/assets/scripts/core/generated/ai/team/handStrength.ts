import { PlayType, type Card } from '../../types/game';
import type { RouteEstimate } from './types';

export type HandStrength = {
  tier: 'strong' | 'balanced' | 'weak';
  plan: 'close' | 'attack' | 'support' | 'develop';
  controls: number;
  turns: number;
  singles: number;
};

/** Own-hand structure, not a claim to know opponents' holdings. Natural bombs
 * are counted once per rank (never once per overlapping candidate). Route is
 * only a shedding estimate; public response probabilities evaluate control.
 */
export const assessHandStrength = (hand: readonly Card[], route: RouteEstimate, allyCount: number): HandStrength => {
  const counts = new Map<number, number>();
  hand.filter(card => !card.isRedJoker && card.suit !== 'joker')
    .forEach(card => counts.set(card.value, (counts.get(card.value) ?? 0) + 1));
  const naturalBombs = [...counts.values()].filter(count => count >= 4).length;
  const routeBombs = route.types.filter(type => type === PlayType.Bomb || type === PlayType.StraightFlush).length;
  // Do not sum overlapping natural/flush alternatives. The chosen partition
  // also recognizes intact straight-flush controls without counting variants.
  const bombs = Math.max(naturalBombs, routeBombs);
  const jokers = hand.filter(card => card.suit === 'joker').length;
  const high = hand.filter(card => card.suit !== 'joker' && card.value >= 14 && !card.isRedJoker).length;
  const wild = hand.filter(card => card.isRedJoker).length;
  const controls = Number((bombs + jokers * 0.65 + high * 0.2 + wild * 0.35).toFixed(2));
  const compact = route.turns <= Math.max(2, Math.ceil(hand.length / 4));
  const tier = controls >= 1.5 && compact ? 'strong'
    : controls < 1 && route.singles >= Math.max(2, route.turns / 2) ? 'weak' : 'balanced';
  const allySoon = allyCount > 0 && allyCount <= 10;
  const plan = route.turns <= 2 && (controls >= 1 || !allySoon) ? 'close'
    : allySoon && (tier === 'weak' || allyCount + 4 < hand.length) ? 'support'
      : tier === 'strong' ? 'attack' : 'develop';
  return { tier, plan, controls, turns: route.turns, singles: route.singles };
};

/** All plans use the same highest-strength search. These are tactical weights,
 * never a difficulty switch; hard team/finish/urgent gates still dominate.
 */
export const strengthWeights = (strength: HandStrength) => ({
  route: strength.plan === 'close' ? 125 : strength.plan === 'support' ? 75 : 95,
  control: strength.plan === 'close' ? 125 : strength.plan === 'attack' ? 55 : 18,
  allyFeed: strength.plan === 'support' ? 95 : strength.tier === 'weak' ? 60 : 35,
  allyFinish: strength.plan === 'support' ? 900 : 720,
  resource: strength.plan === 'close' ? 0.65 : strength.tier === 'weak' ? 1.2 : 1,
});
