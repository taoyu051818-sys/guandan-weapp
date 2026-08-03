import { Card, PlayAction, PlayType, Player, PlayerId, Team } from '../types/game';
import type { AIContext } from './ai';

type MediumDeps = {
  getMinEnemyHand: (players: Record<PlayerId, Player>, myTeam: Team) => number;
  memoGetPlayInfo: (play: Card[]) => { type: PlayType; maxValue: number } | undefined;
  isBombType: (type: PlayType) => boolean;
  pickLowestWinningPlay: (plays: Card[][]) => Card[] | null;
};

type MediumArgs = {
  hand: Card[];
  possiblePlays: Card[][];
  lastPlay: PlayAction | null;
  players: Record<PlayerId, Player>;
  myTeam: Team;
  aiContext?: AIContext;
};

const isComplexType = (type: PlayType) =>
  type === PlayType.Tube
  || type === PlayType.Plate
  || type === PlayType.TripleWithPair
  || type === PlayType.Straight
  || type === PlayType.Triple;

const chooseTailSafeLead = (
  hand: Card[],
  plays: Card[][],
  memoGetPlayInfo: (play: Card[]) => { type: PlayType; maxValue: number } | undefined,
  isBombType: (type: PlayType) => boolean
) => {
  const candidates = plays.filter((p) => {
    const info = memoGetPlayInfo(p);
    return !!info && !isBombType(info.type);
  });
  if (candidates.length === 0) return null;
  let best: Card[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const p of candidates) {
    const info = memoGetPlayInfo(p);
    if (!info) continue;
    const remaining = hand.length - p.length;
    let score = info.maxValue * 0.75 + remaining * 5.5 - p.length;
    if (isComplexType(info.type)) score -= 4;
    if ((info.type === PlayType.Single || info.type === PlayType.Pair) && info.maxValue <= 10) score += 5;
    if (score < bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
};

export const chooseMediumOverride = (args: MediumArgs, deps: MediumDeps): Card[] | null | undefined => {
  const { hand, possiblePlays, lastPlay, players, myTeam, aiContext } = args;
  const enemyMin = deps.getMinEnemyHand(players, myTeam);
  const myLevel = aiContext?.teamLevels?.[myTeam];
  const isAChallenge = myLevel === 'A';
  const tributeAggressiveLead = !!aiContext?.roundMeta?.fromTribute && !aiContext.roundMeta.isAntiTribute;
  const tributeDefensive = !!aiContext?.roundMeta?.fromTribute && aiContext.roundMeta.isAntiTribute;
  if (possiblePlays.length === 0) return null;

  const nonBombs = possiblePlays.filter((p) => {
    const info = deps.memoGetPlayInfo(p);
    return !!info && !deps.isBombType(info.type);
  });

  if (lastPlay && lastPlay.type !== PlayType.Pass && players[lastPlay.playerId].team === myTeam) {
    if (enemyMin <= 5) {
      const fastClose = nonBombs.find((p) => hand.length - p.length <= 1);
      if (fastClose) return fastClose;
    }
    return null;
  }

  if (!lastPlay || lastPlay.type === PlayType.Pass) {
    if (tributeAggressiveLead) {
      const pressureLead = candidatesByType(possiblePlays, deps.memoGetPlayInfo, [PlayType.Tube, PlayType.Plate, PlayType.Straight, PlayType.TripleWithPair]);
      if (pressureLead) return pressureLead;
    }
    if (hand.length <= 8) {
      const tailSafe = chooseTailSafeLead(hand, possiblePlays, deps.memoGetPlayInfo, deps.isBombType);
      if (tailSafe) return tailSafe;
    }
    return undefined;
  }

  const lastPlayer = players[lastPlay.playerId];
  if (lastPlayer.team !== myTeam) {
    if (isAChallenge && lastPlayer.hand.length <= 8) {
      return deps.pickLowestWinningPlay(nonBombs.length > 0 ? nonBombs : possiblePlays);
    }
    if (tributeDefensive && lastPlayer.hand.length <= 7) {
      return deps.pickLowestWinningPlay(nonBombs.length > 0 ? nonBombs : possiblePlays);
    }
    if (lastPlayer.hand.length <= 4) {
      return deps.pickLowestWinningPlay(nonBombs.length > 0 ? nonBombs : possiblePlays);
    }
    const top = possiblePlays[0];
    const topInfo = top ? deps.memoGetPlayInfo(top) : null;
    if (topInfo && deps.isBombType(topInfo.type) && lastPlayer.hand.length > 6) {
      if (nonBombs.length > 0) return deps.pickLowestWinningPlay(nonBombs);
      return null;
    }
  }

  return undefined;
};

const candidatesByType = (
  plays: Card[][],
  memoGetPlayInfo: (play: Card[]) => { type: PlayType; maxValue: number } | undefined,
  order: PlayType[]
) => {
  for (const t of order) {
    const hit = plays.find((p) => memoGetPlayInfo(p)?.type === t);
    if (hit) return hit;
  }
  return null;
};
