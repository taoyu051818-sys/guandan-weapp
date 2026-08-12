import type { RuleProfile } from '../lib/rules';
import {
  PlayType,
  type Card,
  type PlayAction,
  type Player,
  type PlayerId,
  type Team,
} from '../types/game';
import {
  getRankCounts,
  isBombType,
  pickLowestWinningPlayByResolution,
  type CachedPlayInfo,
} from './scoring';
import type { RuntimeIntelState } from './runtimeIntel';
import type { AdvancedRole, Difficulty } from './types';

export type TeamIntent = 'assist_teammate' | 'block_enemy' | 'tempo';

export type EnemyPressureModel = {
  minEnemyHand: number;
  doubleEnemyLow: boolean;
  teammateHand: number;
  enemySinglePairStreak: number;
  sprintRisk: number;
  bombRisk: number;
  baitRisk: number;
};

type DecisionSupportOptions = Readonly<{
  runtimeIntel: RuntimeIntelState;
  getRuleProfile: () => RuleProfile;
  getPlayInfo: (cards: Card[]) => CachedPlayInfo;
  generateAllPlays: (hand: Card[]) => Card[][];
  getPossiblePlays: (
    hand: Card[],
    lastPlay: PlayAction | null,
    difficulty: Difficulty,
    ruleProfile?: RuleProfile,
  ) => Card[][];
}>;

/** Pure decision helpers bound to one AI engine's injected state and rule ports. */
export const createDecisionSupport = ({
  runtimeIntel,
  getRuleProfile,
  getPlayInfo,
  generateAllPlays,
  getPossiblePlays,
}: DecisionSupportOptions) => {
  const pickLowestWinningPlay = (plays: Card[][]): Card[] | null =>
    pickLowestWinningPlayByResolution(plays, getPlayInfo);

  const getIntent = (
    lastPlay: PlayAction | null,
    teammateId: PlayerId,
    teammateCount: number,
    enemyMinCount: number,
  ): TeamIntent => {
    if (teammateCount <= 4) return 'assist_teammate';
    if (enemyMinCount <= 5) return 'block_enemy';
    if (lastPlay && lastPlay.type !== PlayType.Pass && lastPlay.playerId === teammateId) {
      return 'assist_teammate';
    }
    return 'tempo';
  };

  const getTeammateId = (
    players: Record<PlayerId, Player>,
    myPlayerId: PlayerId,
    myTeam: Team,
  ): PlayerId => {
    const teammate = (Object.keys(players) as PlayerId[])
      .find(id => id !== myPlayerId && players[id].team === myTeam);
    if (!teammate) throw new Error(`AI player ${myPlayerId} has no teammate on ${myTeam}`);
    return teammate;
  };

  const removeCards = (hand: Card[], play: Card[]): Card[] => {
    const used = new Set(play.map(card => card.id));
    return hand.filter(card => !used.has(card.id));
  };

  const chooseByType = (
    plays: Card[][],
    type: PlayType,
    nonBombOnly: boolean = false,
  ): Card[] | undefined => plays.find((play) => {
    const info = getPlayInfo(play);
    if (!info || info.type !== type) return false;
    return !nonBombOnly || !isBombType(info.type);
  });

  const chooseSmallProbeLead = (
    plays: Card[][],
    maxValue: number,
    preferPair: boolean = false,
  ): Card[] | null => {
    const candidates = plays.filter((play) => {
      const info = getPlayInfo(play);
      if (!info || isBombType(info.type)) return false;
      if (info.type !== PlayType.Single && info.type !== PlayType.Pair) return false;
      return info.maxValue <= maxValue;
    });
    if (candidates.length === 0) return null;
    if (preferPair) {
      const pairFirst = candidates.filter(play => getPlayInfo(play)?.type === PlayType.Pair);
      if (pairFirst.length > 0) return pickLowestWinningPlay(pairFirst);
    }
    return pickLowestWinningPlay(candidates);
  };

  const chooseSmallProbeFollow = (
    plays: Card[][],
    lastPlay: PlayAction | null,
    maxValue: number,
  ): Card[] | null => {
    if (!lastPlay || lastPlay.type === PlayType.Pass) return null;
    if (lastPlay.type !== PlayType.Single && lastPlay.type !== PlayType.Pair) return null;
    const sameType = plays.filter((play) => {
      const info = getPlayInfo(play);
      return Boolean(info && !isBombType(info.type)
        && info.type === lastPlay.type && info.maxValue <= maxValue);
    });
    return pickLowestWinningPlay(sameType);
  };

  const getSinglesPairsTailShape = (cards: Card[]) => {
    const rankCounts = getRankCounts(cards);
    return {
      onlySinglesPairs: rankCounts.every(rank => rank.count === 1 || rank.count === 2),
      hasSmall: rankCounts.some(rank => rank.value <= 10),
    };
  };

  const evaluateHandStructureScore = (remaining: Card[]): number => {
    const rankCounts = getRankCounts(remaining);
    const singleCount = rankCounts.filter(rank => rank.count === 1).length;
    const lowSingles = rankCounts.filter(rank => rank.count === 1 && rank.value <= 5).length;
    const bombs = rankCounts.filter(rank => rank.count >= 4).length;
    const allLeads = generateAllPlays(remaining);
    let complexCount = 0;
    let chainCount = 0;
    for (const play of allLeads) {
      const info = getPlayInfo(play);
      if (!info) continue;
      if (
        info.type === PlayType.Straight
        || info.type === PlayType.Tube
        || info.type === PlayType.Plate
        || info.type === PlayType.TripleWithPair
      ) complexCount += 1;
      if (
        info.type === PlayType.Tube
        || info.type === PlayType.Plate
        || info.type === PlayType.TripleWithPair
      ) chainCount += 1;
    }
    const tailShape = getSinglesPairsTailShape(remaining);
    const pureTailRisk = remaining.length <= 8 && tailShape.onlySinglesPairs
      ? (tailShape.hasSmall ? 8 : 4)
      : 0;
    return singleCount * 4.2 + lowSingles * 2.4 + pureTailRisk
      - bombs * 1.8 - Math.min(8, complexCount) * 0.9 - Math.min(6, chainCount) * 1.2;
  };

  const chooseLeadByStructure = (hand: Card[], possiblePlays: Card[][]): Card[] | null => {
    let best: Card[] | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const play of possiblePlays.slice(0, 10)) {
      const info = getPlayInfo(play);
      if (!info || isBombType(info.type)) continue;
      const score = evaluateHandStructureScore(removeCards(hand, play));
      if (score < bestScore) {
        bestScore = score;
        best = play;
      }
    }
    return best;
  };

  const isComplexPlayType = (type: PlayType): boolean =>
    type === PlayType.Tube
    || type === PlayType.Plate
    || type === PlayType.TripleWithPair
    || type === PlayType.Straight
    || type === PlayType.Triple;

  const chooseOpeningDecomposeLead = (
    hand: Card[],
    possiblePlays: Card[][],
  ): Card[] | null => {
    let best: Card[] | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const play of possiblePlays.slice(0, 18)) {
      const info = getPlayInfo(play);
      if (!info || isBombType(info.type)) continue;
      const remainScore = evaluateHandStructureScore(removeCards(hand, play));
      const shapeBonus = isComplexPlayType(info.type)
        ? -6
        : info.type === PlayType.Pair ? -1.5 : 0;
      const score = remainScore + info.maxValue * 0.35 - play.length * 0.2 + shapeBonus;
      if (score < bestScore) {
        bestScore = score;
        best = play;
      }
    }
    return best;
  };

  const getMinEnemyHand = (players: Record<PlayerId, Player>, myTeam: Team): number =>
    Object.values(players)
      .filter(player => player.team !== myTeam)
      .map(player => player.hand.length)
      .filter(length => length > 0)
      .reduce((minimum, length) => Math.min(minimum, length), 99);

  const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

  const getEnemyPressureModel = (
    players: Record<PlayerId, Player>,
    myTeam: Team,
    teammateId: PlayerId,
  ): EnemyPressureModel => {
    const enemyHands = Object.values(players)
      .filter(player => player.team !== myTeam)
      .map(player => player.hand.length)
      .filter(length => length > 0);
    const minEnemyHand = enemyHands.length ? Math.min(...enemyHands) : 99;
    const doubleEnemyLow = enemyHands.filter(length => length <= 10).length >= 2;
    const teammateHand = players[teammateId]?.team === myTeam
      ? players[teammateId].hand.length
      : 99;
    const enemySinglePairStreak = Math.max(
      ...Object.entries(players)
        .filter(([, player]) => player.team !== myTeam)
        .map(([id]) => runtimeIntel.singlePairStreakByPlayer.get(id as PlayerId) || 0),
      0,
    );

    let potentialBombRanks = 0;
    for (let value = 3; value <= 15; value += 1) {
      const unseen = Math.max(0, 8 - (runtimeIntel.seenValueCounts.get(value) || 0));
      if (unseen >= 4) potentialBombRanks += 1;
    }
    const enemyBombSignal = Object.entries(players).some(([id, player]) => {
      if (player.team === myTeam) return false;
      const lastType = runtimeIntel.lastTypeByPlayer.get(id as PlayerId);
      return lastType === PlayType.Bomb
        || lastType === PlayType.StraightFlush
        || lastType === PlayType.Rocket;
    });
    const sprintRisk = clamp01(
      (minEnemyHand <= 5 ? 1 : minEnemyHand <= 7 ? 0.8 : minEnemyHand <= 10 ? 0.5 : 0.2)
      + (doubleEnemyLow ? 0.1 : 0)
      + (teammateHand <= 4 ? 0.1 : 0)
      + (enemySinglePairStreak >= 2 ? 0.06 : 0),
    );
    const bombRisk = clamp01(
      potentialBombRanks * 0.055
      + (minEnemyHand <= 8 ? 0.18 : 0)
      + (enemyBombSignal ? 0.18 : 0)
      + (runtimeIntel.seenJokerCount <= 1 ? 0.12 : 0)
      + (runtimeIntel.seenLevelCardCount <= 2 ? 0.08 : 0),
    );
    const recentEnemySamples = runtimeIntel.recentPlaySamples
      .filter(sample => players[sample.playerId].team !== myTeam)
      .slice(-8);
    const suspiciousHighSingles = recentEnemySamples.filter(sample => (
      (sample.type === PlayType.Single || sample.type === PlayType.Pair)
      && sample.maxValue >= 13
    )).length;
    const suspiciousPattern = suspiciousHighSingles >= 2 && enemySinglePairStreak >= 2;
    const baitRisk = clamp01(
      (suspiciousPattern ? 0.45 : 0)
      + (enemySinglePairStreak >= 3 ? 0.2 : 0)
      + (minEnemyHand > 6 ? 0.15 : 0),
    );
    return {
      minEnemyHand,
      doubleEnemyLow,
      teammateHand,
      enemySinglePairStreak,
      sprintRisk,
      bombRisk,
      baitRisk,
    };
  };

  const getAdvancedRole = (
    difficulty: Difficulty,
    players: Record<PlayerId, Player>,
    myPlayerId: PlayerId,
  ): AdvancedRole => {
    if (difficulty === 'master') {
      return myPlayerId === 'p3' || myPlayerId === 'p4' ? 'support' : 'striker';
    }
    if (difficulty !== 'hard' || !players[myPlayerId]?.isAI) return 'striker';
    const humans = Object.values(players).filter(player => !player.isAI);
    if (humans.length !== 1) return 'striker';
    return players[myPlayerId].team === humans[0].team ? 'support' : 'striker';
  };

  const chooseByTypeOrder = (plays: Card[][], order: PlayType[]): Card[] | null => {
    for (const type of order) {
      const sameType = plays.filter(play => getPlayInfo(play)?.type === type);
      if (sameType.length > 0) return pickLowestWinningPlay(sameType);
    }
    return null;
  };

  const chooseFeedPlayByScore = (
    possiblePlays: Card[][],
    teammateType: PlayType | undefined,
  ): Card[] | null => {
    let best: Card[] | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const play of possiblePlays) {
      const info = getPlayInfo(play);
      if (!info || isBombType(info.type)) continue;
      let score = info.maxValue * 4 + play.length * 1.5;
      if (teammateType && info.type === teammateType) score -= 16;
      if (isComplexPlayType(info.type)) score -= 4;
      if (info.type === PlayType.Single || info.type === PlayType.Pair) score += 4;
      if (score < bestScore) {
        bestScore = score;
        best = play;
      }
    }
    return best;
  };

  const chooseLowestComplexPlay = (plays: Card[][]): Card[] | null =>
    pickLowestWinningPlay(plays.filter((play) => {
      const info = getPlayInfo(play);
      return Boolean(info && !isBombType(info.type) && isComplexPlayType(info.type));
    }));

  const chooseAggressiveComboLead = (
    plays: Card[][],
    order: PlayType[],
    pushBonus: number,
  ): Card[] | null => {
    let best: Card[] | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const type of order) {
      for (const play of plays.filter(candidate => getPlayInfo(candidate)?.type === type)) {
        const info = getPlayInfo(play);
        if (!info) continue;
        const score = info.maxValue * 10 + play.length * 2 + pushBonus * 6;
        if (score > bestScore) {
          bestScore = score;
          best = play;
        }
      }
      if (best) return best;
    }
    return null;
  };

  const chooseSupportOverride = (
    possiblePlays: Card[][],
    lastPlay: PlayAction | null,
    players: Record<PlayerId, Player>,
    myTeam: Team,
    teammateId: PlayerId,
  ): Card[] | null | undefined => {
    const teammate = players[teammateId];
    const enemyMin = getMinEnemyHand(players, myTeam);
    const enemyLed = Boolean(lastPlay && lastPlay.type !== PlayType.Pass
      && players[lastPlay.playerId].team !== myTeam);
    const nonBombs = possiblePlays.filter((play) => {
      const info = getPlayInfo(play);
      return Boolean(info && !isBombType(info.type));
    });
    if (enemyLed && (enemyMin <= 6 || possiblePlays.length > 4)) {
      const pick = pickLowestWinningPlay(nonBombs.length > 0 ? nonBombs : possiblePlays);
      if (pick) return pick;
    }
    if (!lastPlay || lastPlay.type === PlayType.Pass) {
      if (teammate.hand.length <= 6) {
        const teammateType = runtimeIntel.lastTypeByPlayer.get(teammateId);
        if (teammateType && teammateType !== PlayType.Bomb
          && teammateType !== PlayType.StraightFlush && teammateType !== PlayType.Rocket) {
          const feedPlay = chooseByType(possiblePlays, teammateType, true);
          if (feedPlay) return feedPlay;
        }
        if (nonBombs.length > 0) return pickLowestWinningPlay(nonBombs);
      }
      const orderedLead = chooseByTypeOrder(possiblePlays, [
        PlayType.Tube,
        PlayType.Straight,
        PlayType.Plate,
        PlayType.TripleWithPair,
      ]);
      if (orderedLead) return orderedLead;
    }
    return undefined;
  };

  const evaluateControlGain = (
    play: Card[],
    hand: Card[],
    myPlayerId: PlayerId,
    nextPlayerId: PlayerId,
    players: Record<PlayerId, Player>,
    difficulty: Difficulty,
  ): number => {
    const info = getPlayInfo(play);
    if (!info) return Number.NEGATIVE_INFINITY;
    const nextAction: PlayAction = { playerId: myPlayerId, cards: play, type: info.type };
    const remaining = removeCards(hand, play);
    const ruleProfile = getRuleProfile();
    const myLeadAfter = getPossiblePlays(remaining, null, difficulty, ruleProfile).length;
    const nextEnemyResponses = getPossiblePlays(
      players[nextPlayerId].hand,
      nextAction,
      difficulty,
      ruleProfile,
    ).length;
    let score = myLeadAfter * 1.8 - nextEnemyResponses * 2.4 - remaining.length * 0.2;
    if (nextEnemyResponses === 0) score += 10;
    if (remaining.length <= 3) score += 14;
    if (isBombType(info.type)) score -= 16;
    if (info.type === PlayType.StraightFlush) score -= 8;
    return score;
  };

  return {
    chooseAggressiveComboLead,
    chooseByType,
    chooseByTypeOrder,
    chooseFeedPlayByScore,
    chooseLeadByStructure,
    chooseLowestComplexPlay,
    chooseOpeningDecomposeLead,
    chooseSmallProbeFollow,
    chooseSmallProbeLead,
    chooseSupportOverride,
    evaluateControlGain,
    evaluateHandStructureScore,
    getAdvancedRole,
    getEnemyPressureModel,
    getIntent,
    getMinEnemyHand,
    getSinglesPairsTailShape,
    getTeammateId,
    isComplexPlayType,
    pickLowestWinningPlay,
  };
};
