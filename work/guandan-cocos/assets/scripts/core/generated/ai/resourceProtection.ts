import { PlayType, type Card } from '../types/game';
import { isBombType, type CachedPlayInfo } from './scoring';

export type PlayResourceDamage = {
  bombSplits: number;
  groupSplits: number;
  wildcardCount: number;
  score: number;
};

type ResourceProtectionDeps = Readonly<{
  getPlayInfo: (cards: Card[]) => CachedPlayInfo;
  pickLowestWinningPlay: (plays: Card[][]) => Card[] | null;
}>;

export const removePlayedCards = (hand: Card[], play: Card[]): Card[] => {
  const used = new Set(play.map(card => card.id));
  return hand.filter(card => !used.has(card.id));
};

export const haveSameCardIds = (left: Card[] | null, right: Card[] | null): boolean => {
  if (!left || !right || left.length !== right.length) return false;
  const leftIds = [...left].map(card => card.id).sort().join(',');
  const rightIds = [...right].map(card => card.id).sort().join(',');
  return leftIds === rightIds;
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

export const createResourceProtection = ({
  getPlayInfo,
  pickLowestWinningPlay,
}: ResourceProtectionDeps) => {
  /** Prefer the strongest intact response when an enemy is about to finish. */
  const chooseUrgentBlock = (hand: Card[], possiblePlays: Card[][]): Card[] | null => {
    const nonBombs = possiblePlays.filter((play) => {
      const info = getPlayInfo(play);
      return Boolean(info && !isBombType(info.type));
    });
    if (nonBombs.length === 0) return pickLowestWinningPlay(possiblePlays);
    const intactNonBombs = nonBombs.filter(
      play => getPlayResourceDamage(hand, play).bombSplits === 0,
    );
    if (intactNonBombs.length === 0) {
      const intactBombs = possiblePlays.filter((play) => {
        const info = getPlayInfo(play);
        return Boolean(info && isBombType(info.type)
          && getPlayResourceDamage(hand, play).bombSplits === 0);
      });
      if (intactBombs.length > 0) return pickLowestWinningPlay(intactBombs);
    }
    const pool = intactNonBombs.length > 0 ? intactNonBombs : nonBombs;
    return [...pool].sort((left, right) => {
      const damageDelta = getPlayResourceDamage(hand, left).score
        - getPlayResourceDamage(hand, right).score;
      if (damageDelta !== 0) return damageDelta;
      const leftInfo = getPlayInfo(left);
      const rightInfo = getPlayInfo(right);
      if (!leftInfo || !rightInfo) return 0;
      if (leftInfo.maxValue !== rightInfo.maxValue) return rightInfo.maxValue - leftInfo.maxValue;
      return right.length - left.length;
    })[0] ?? null;
  };

  /** Avoid leading exactly the shape that lets a one- or two-card enemy go out. */
  const choosePressureLead = (
    hand: Card[],
    possiblePlays: Card[][],
    minEnemyHand: number,
  ): Card[] | null => {
    if (minEnemyHand > 2) return null;
    const nonBombs = possiblePlays.filter((play) => {
      const info = getPlayInfo(play);
      return Boolean(info && !isBombType(info.type));
    });
    if (nonBombs.length === 0) return null;
    const unsafeType = minEnemyHand === 1 ? PlayType.Single : PlayType.Pair;
    const safer = nonBombs.filter(play => getPlayInfo(play)?.type !== unsafeType);
    const pool = safer.length > 0 ? safer : nonBombs;
    return [...pool].sort((left, right) => {
      const damageDelta = getPlayResourceDamage(hand, left).score
        - getPlayResourceDamage(hand, right).score;
      if (damageDelta !== 0) return damageDelta;
      const leftInfo = getPlayInfo(left);
      const rightInfo = getPlayInfo(right);
      if (!leftInfo || !rightInfo) return 0;
      // A long pattern cannot be answered by a one/two-card hand and sheds
      // more of our cards. If only singles remain, lead the strongest one.
      if (leftInfo.type === PlayType.Single && rightInfo.type === PlayType.Single) {
        return rightInfo.maxValue - leftInfo.maxValue;
      }
      if (left.length !== right.length) return right.length - left.length;
      return leftInfo.maxValue - rightInfo.maxValue;
    })[0] ?? null;
  };

  return { choosePressureLead, chooseUrgentBlock };
};
