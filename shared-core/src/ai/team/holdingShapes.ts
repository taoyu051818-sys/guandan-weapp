import { getBaseValue } from '../../lib/deck';
import { compareBombResolutions, type RuleProfile } from '../../lib/rules';
import { PlayType, type Card, type PlayResolution } from '../../types/game';
import { isBombType } from '../scoring';

export type HoldingShapes = Map<string, PlayResolution>;
const key = (type: PlayType, size: number) => `${type}:${size}`;

/** Count-based capability summary, not a claim about what a player will play.
 * No physical-combination enumeration; bounded by 17 ranks and 4 suits.
 * Kept in parity tests with the authoritative legal-move generator.
 */
export const summarizeHolding = (hand: readonly Card[], profile: RuleProfile): HoldingShapes => {
  const result: HoldingShapes = new Map();
  const add = (type: PlayType, size: number, maxValue: number) => {
    const id = key(type, size);
    if ((result.get(id)?.maxValue ?? -1) < maxValue) {
      result.set(id, { type, length: size, maxValue });
    }
  };
  const counts = new Array<number>(18).fill(0);
  const faces = new Array<number>(15).fill(0);
  const suits = new Map<string, number[]>();
  let wild = 0;
  for (const card of hand) {
    add(PlayType.Single, 1, card.value);
    if (card.isRedJoker) { wild++; continue; }
    counts[card.value]++;
    if (!card.isLevelCard && card.suit !== 'joker') {
      const face = getBaseValue(card.rank);
      faces[face]++;
      const bySuit = suits.get(card.suit) ?? new Array<number>(15).fill(0);
      bySuit[face]++;
      suits.set(card.suit, bySuit);
    }
  }
  for (let value = 2; value <= 17; value++) {
    // A heart-level wildcard can never stand for a joker.
    const available = counts[value] + (value <= 15 ? wild : 0);
    if (available >= 2) add(PlayType.Pair, 2, value);
    if (available >= 3) add(PlayType.Triple, 3, value);
    for (let size = 4; size <= available; size++) add(PlayType.Bomb, size, size * 1000 + value);
    if (!profile.enableTripleWithPair || value > 15) continue;
    const tripleDeficit = Math.max(0, 3 - counts[value]);
    if (tripleDeficit > wild) continue;
    for (let pair = 2; pair <= 17; pair++) {
      if (pair === value) continue;
      const pairDeficit = Math.max(0, 2 - counts[pair]);
      if ((pair <= 15 || pairDeficit === 0) && tripleDeficit + pairDeficit <= wild) {
        add(PlayType.TripleWithPair, 5, value);
      }
    }
  }
  if (counts[16] + counts[17] === 4) add(PlayType.Rocket, 4, 10000);
  const sequence = (ranks: number[], copies: number, type: PlayType, source: number[]) => {
    const deficit = ranks.reduce((sum, rank) => sum + Math.max(0, copies - source[rank]), 0);
    if (deficit <= wild) {
      // With no wildcard or alternative suit, a natural flush is exclusively
      // a bomb in classic rules, not also an ordinary straight.
      if (type === PlayType.Straight && profile.straightFlushAsBomb && wild === 0
        && Array.from(suits.values()).filter(suit => ranks.some(rank => suit[rank] > 0)).length <= 1) return;
      const high = ranks[ranks.length - 1];
      add(type, ranks.length * copies, type === PlayType.StraightFlush ? 5500 + high : high);
    }
  };
  for (let start = 2; start <= 13; start++) {
    if (start <= 10) {
      const ranks = Array.from({ length: 5 }, (_, index) => start + index);
      sequence(ranks, 1, PlayType.Straight, faces);
      if (profile.straightFlushAsBomb) {
        for (const suit of suits.values()) sequence(ranks, 1, PlayType.StraightFlush, suit);
      }
    }
    if (start <= 12) sequence([start, start + 1, start + 2], 2, PlayType.Tube, faces);
    sequence([start, start + 1], 3, PlayType.Plate, faces);
  }
  if (profile.allowA2345Straight) {
    sequence([14, 2, 3, 4, 5], 1, PlayType.Straight, faces);
    if (profile.straightFlushAsBomb) {
      for (const suit of suits.values()) sequence([14, 2, 3, 4, 5], 1, PlayType.StraightFlush, suit);
    }
  }
  return result;
};

export const holdingCanBeat = (
  shapes: HoldingShapes,
  target: PlayResolution,
  size: number,
  wholeHandSize?: number,
): boolean => {
  for (const candidate of shapes.values()) {
    if (wholeHandSize !== undefined && candidate.length !== wholeHandSize) continue;
    if (isBombType(candidate.type)) {
      if (!isBombType(target.type) || compareBombResolutions(candidate, target) > 0) return true;
    } else if (!isBombType(target.type) && candidate.type === target.type
      && candidate.length === size && candidate.maxValue > target.maxValue) return true;
  }
  return false;
};
