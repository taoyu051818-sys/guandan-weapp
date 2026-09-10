import { structuralLegalMoves } from '../lib/legalMoves';
import { getPlayInfo, type RuleProfile } from '../lib/rules';
import type { Card, PlayResolution } from '../types/game';
import { createGroupFeatures, type GroupFeatures } from './features';

export interface FaceBucket { shift: number; mask: number; cards: Card[] }
export interface ArrangementMove {
  needs: Array<{ bucket: FaceBucket; count: number }>;
  size: number;
  resolution: PlayResolution;
  features: GroupFeatures;
  key: string;
}
const faceKey = (card: Card): string => [card.value, card.rank, card.suit, +card.isLevelCard, +(card.isRedJoker === true)].join(':');

/** Counts merge interchangeable deck copies, never different suits or wildcards.
 * Physical ids are allocated only after choosing the entire partition.
 */
export const prepareArrangementCandidates = (input: readonly Card[], profile: RuleProfile) => {
  // Up to 30 accommodates temporary tribute/return hands above the dealt 27.
  if (input.length > 30 || new Set(input.map(card => card.id)).size !== input.length || input.some(card => !card.id)) {
    throw new Error('Arrangement requires at most 30 unique physical cards');
  }
  const hand = input.map(card => ({ ...card })).sort((a, b) => faceKey(a).localeCompare(faceKey(b)) || a.id.localeCompare(b.id));
  const buckets = new Map<string, FaceBucket>();
  for (const card of hand) {
    const key = faceKey(card);
    if (!buckets.has(key)) buckets.set(key, { shift: 0, mask: 0, cards: [] });
    buckets.get(key)!.cards.push(card);
  }
  let shift = 0;
  for (const bucket of buckets.values()) {
    bucket.shift = shift;
    bucket.mask = (1 << bucket.cards.length) - 1;
    shift += bucket.cards.length;
  }
  const featureOf = createGroupFeatures(hand, profile);
  const resolutions = new Map<string, PlayResolution | null>();
  const resolve = (cards: Card[]) => {
    const key = cards.map(card => card.id).sort().join(',');
    if (!resolutions.has(key)) resolutions.set(key, getPlayInfo(cards, profile));
    return resolutions.get(key)!;
  };
  const moves: ArrangementMove[] = structuralLegalMoves(hand, profile, resolve).map(cards => {
    const counts = new Map<string, number>();
    cards.forEach(card => counts.set(faceKey(card), (counts.get(faceKey(card)) ?? 0) + 1));
    const info = resolve(cards)!;
    return { needs: [...counts].map(([key, count]) => ({ bucket: buckets.get(key)!, count })),
      size: cards.length, resolution: info, features: featureOf(cards, info),
      key: cards.map(faceKey).sort().join(',') };
  });
  return { hand, buckets: [...buckets.values()], moves, full: (1 << hand.length) - 1 };
};

export const subtractArrangementMove = (state: number, move: ArrangementMove): number => {
  let next = state;
  for (const { bucket, count } of move.needs) {
    const bits = (state >>> bucket.shift) & bucket.mask;
    if (bits < (1 << count) - 1) return -1;
    next -= ((bits + 1) - (bits + 1) / (1 << count)) * (1 << bucket.shift);
  }
  return next;
};
