import type { Card } from '../types/game';

export type PlayResourceDamage = {
  bombSplits: number;
  groupSplits: number;
  wildcardCount: number;
  score: number;
};

export const getPlayResourceDamage = (hand: Card[], play: Card[]): PlayResourceDamage => {
  const handCounts = new Map<number, number>();
  const playCounts = new Map<number, number>();
  // Wildcards are a separate scarce resource; do not let their physical
  // level-card value make an otherwise intact natural group look partial.
  hand.filter(card => !card.isRedJoker)
    .forEach(card => handCounts.set(card.value, (handCounts.get(card.value) ?? 0) + 1));
  play.filter(card => !card.isRedJoker)
    .forEach(card => playCounts.set(card.value, (playCounts.get(card.value) ?? 0) + 1));

  let bombSplits = 0;
  let groupSplits = 0;
  playCounts.forEach((played, value) => {
    const held = handCounts.get(value) ?? 0;
    if (played >= held) return;
    if (held >= 4) bombSplits += 1;
    else if (held === 3) groupSplits += 2;
    else if (held === 2) groupSplits += 1;
  });
  const wildcardCount = play.filter(card => card.isRedJoker).length;
  return {
    bombSplits,
    groupSplits,
    wildcardCount,
    // Bomb and wildcard damage are deliberately lexically dominant. The
    // caller can still use them when no intact alternative is legal.
    score: bombSplits * 10_000 + wildcardCount * 1_000 + groupSplits * 80,
  };
};
