import { PlayType, type Card, type PlayResolution } from '../types/game';
import type { ArrangementMetrics, ArrangementWeights } from './model';
import type { RuleProfile } from '../lib/rules';

export interface GroupFeatures extends ArrangementMetrics { splitTriples: number; singleCost: number; pairCost: number }
export const emptyFeatures = (): GroupFeatures => ({ turns: 0, singles: 0, splitPairs: 0,
  splitTriples: 0, splitBombs: 0, ordinaryWildcards: 0, controlWildcards: 0, controls: 0, singleCost: 0, pairCost: 0 });

export const createGroupFeatures = (hand: readonly Card[], profile: RuleProfile) => {
  const counts = new Map<number, number>();
  hand.filter(card => !card.isRedJoker).forEach(card => counts.set(card.value, (counts.get(card.value) ?? 0) + 1));
  return (cards: readonly Card[], info: PlayResolution): GroupFeatures => {
    const result = emptyFeatures();
    result.turns = 1;
    result.singles = Number(info.type === PlayType.Single);
    // An isolated low card is harder to clear than a retained high controller.
    result.singleCost = result.singles * (cards[0].value >= 14 ? 0.3 : 1);
    const bomb = info.type === PlayType.Bomb || info.type === PlayType.Rocket ||
      (info.type === PlayType.StraightFlush && profile.straightFlushAsBomb);
    result.controls = info.type === PlayType.Rocket ? 2 : info.type === PlayType.Bomb
      ? 1 + Math.min(4, cards.length - 4) * 0.2 : bomb ? 1.3 : 0;
    const wild = cards.filter(card => card.isRedJoker).length;
    // A retained single wildcard or natural level pair keeps its flexibility.
    const spentWild = info.type === PlayType.Single ||
      (info.type === PlayType.Pair && cards.every(card => card.isLevelCard)) ? 0 : wild;
    result.ordinaryWildcards = bomb ? 0 : spentWild;
    result.controlWildcards = bomb ? spentWild : 0;
    const used = new Map<number, number>();
    cards.filter(card => !card.isRedJoker).forEach(card => used.set(card.value, (used.get(card.value) ?? 0) + 1));
    for (const [value, count] of used) {
      const total = counts.get(value)!;
      if (count >= total) continue;
      // Fractions add up once across the partition, not once per overlapping candidate.
      const fraction = count / total;
      if (total === 2) {
        result.splitPairs += fraction;
        result.pairCost += fraction * (value >= 14 ? 1.8 : value >= 10 ? 1.3 : 1);
      }
      if (total === 3) result.splitTriples += fraction;
      if (total >= 4) result.splitBombs += fraction;
    }
    return result;
  };
};

export const groupCost = (f: GroupFeatures, w: Readonly<ArrangementWeights>): number =>
  100 + f.singleCost * w.single + f.pairCost * w.splitPair + f.splitTriples * w.splitTriple +
  f.splitBombs * w.splitBomb + f.ordinaryWildcards * w.wildOrdinary +
  f.controlWildcards * w.wildControl - f.controls * w.control;

export const sumFeatures = (features: readonly GroupFeatures[]): GroupFeatures => {
  const result = emptyFeatures();
  for (const feature of features) for (const key of Object.keys(result) as Array<keyof GroupFeatures>) result[key] += feature[key];
  return result;
};
