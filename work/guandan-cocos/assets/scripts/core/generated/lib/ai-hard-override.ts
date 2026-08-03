import { Card, PlayAction, PlayType, Player, PlayerId, Team } from '../types/game';
import { Difficulty, HardRuntimeTuning } from './ai-core-types';
import type { AIContext } from './ai';

type RuntimeIntelLike = {
  lastTypeByPlayer: Map<PlayerId, PlayType>;
};

type HardDeps = {
  getMinEnemyHand: (players: Record<PlayerId, Player>, myTeam: Team) => number;
  memoGetPlayInfo: (play: Card[]) => { type: PlayType; maxValue: number } | undefined;
  isBombType: (type: PlayType) => boolean;
  chooseSmallProbeFollow: (plays: Card[][], lastPlay: PlayAction | null, maxValue: number) => Card[] | null;
  getPossiblePlays: (hand: Card[], lastPlay: PlayAction | null, difficulty: Difficulty) => Card[][];
};

type HardArgs = {
  hand: Card[];
  possiblePlays: Card[][];
  lastPlay: PlayAction | null;
  players: Record<PlayerId, Player>;
  myTeam: Team;
  teammateId: PlayerId;
  myPlayerId: PlayerId;
  myHandCount: number;
  difficulty: Difficulty;
  runtimeIntelState: RuntimeIntelLike;
  hardRuntimeTuning: HardRuntimeTuning;
  hardForceContestFloor: number;
  aiContext?: AIContext;
};

export const hardTacticalOverride = (args: HardArgs, deps: HardDeps): Card[] | null | undefined => {
  const { hand, possiblePlays, lastPlay, players, myTeam, teammateId, myPlayerId, myHandCount, difficulty, runtimeIntelState, hardRuntimeTuning, hardForceContestFloor, aiContext } = args;
  const enemyMin = deps.getMinEnemyHand(players, myTeam);
  const forceContest = enemyMin <= Math.max(hardForceContestFloor, hardRuntimeTuning.interceptThreshold - 1);
  const myLevel = aiContext?.teamLevels?.[myTeam];
  const isAChallenge = myLevel === 'A';
  const tributeAggressiveLead = !!aiContext?.roundMeta?.fromTribute && !aiContext.roundMeta.isAntiTribute;
  const tributeDefensive = !!aiContext?.roundMeta?.fromTribute && aiContext.roundMeta.isAntiTribute;
  const isComplexType = (type: PlayType) =>
    type === PlayType.Tube
    || type === PlayType.Plate
    || type === PlayType.TripleWithPair
    || type === PlayType.Straight
    || type === PlayType.Triple;

  const pickTailSafeLead = (plays: Card[][]): Card[] | null => {
    const candidates = plays.filter((p) => {
      const info = deps.memoGetPlayInfo(p);
      return !!info && !deps.isBombType(info.type);
    });
    if (candidates.length === 0) return null;
    let best: Card[] | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const p of candidates) {
      const info = deps.memoGetPlayInfo(p);
      if (!info) continue;
      const remaining = myHandCount - p.length;
      let score = info.maxValue * 0.8 + remaining * 6 - p.length * 1.3;
      if (isComplexType(info.type)) score -= 5;
      if ((info.type === PlayType.Single || info.type === PlayType.Pair) && info.maxValue <= 10) score += 6;
      if ((info.type === PlayType.Single || info.type === PlayType.Pair) && remaining <= 3) score += 4;
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  };

  const chooseLeadBy2Ply = (plays: Card[][]): Card[] | null => {
    const order: PlayerId[] = ['p1', 'p2', 'p3', 'p4'];
    const myIndex = order.indexOf(myPlayerId);
    const nextPlayerId = order[(myIndex + 1) % 4];
    const enemyHand = players[nextPlayerId].hand;
    const leads = plays.slice(0, 10).filter((p) => {
      const info = deps.memoGetPlayInfo(p);
      return !!info && !deps.isBombType(info.type);
    });
    if (leads.length === 0) return null;
    let best: Card[] | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const lead of leads) {
      const leadInfo = deps.memoGetPlayInfo(lead);
      if (!leadInfo) continue;
      const afterMyLead = hand.filter((c) => !lead.some((p) => p.id === c.id));
      const action: PlayAction = { playerId: myPlayerId, cards: lead, type: leadInfo.type };
      const enemyResponses = deps.getPossiblePlays(enemyHand, action, difficulty).slice(0, 4);
      const replyScore = enemyResponses.length === 0
        ? 12
        : enemyResponses.reduce((acc, enemyPlay) => {
            const enemyInfo = deps.memoGetPlayInfo(enemyPlay);
            if (!enemyInfo) return acc;
            const enemyAction: PlayAction = { playerId: nextPlayerId, cards: enemyPlay, type: enemyInfo.type };
            const myReplies = deps.getPossiblePlays(afterMyLead, enemyAction, difficulty);
            return acc + (myReplies.length > 0 ? 2.4 : -3.5);
          }, 0) / enemyResponses.length;
      const leadShapeScore = isComplexType(leadInfo.type) ? 3 : 0;
      const score = replyScore + leadShapeScore - leadInfo.maxValue * 0.08;
      if (score > bestScore) {
        bestScore = score;
        best = lead;
      }
    }
    return best;
  };

  if (!lastPlay || lastPlay.type === PlayType.Pass) {
    if (tributeAggressiveLead || isAChallenge) {
      const twoPlyLead = chooseLeadBy2Ply(possiblePlays);
      if (twoPlyLead) return twoPlyLead;
    }
    const pairs = possiblePlays.filter(p => deps.memoGetPlayInfo(p)?.type === PlayType.Pair);
    const singles = possiblePlays.filter(p => p.length === 1);
    const pairLeadStreakHint = runtimeIntelState.lastTypeByPlayer.get(myPlayerId) === PlayType.Pair ? 1 : 0;
    const probeSingle = singles.find((p) => {
      const info = deps.memoGetPlayInfo(p);
      return !!info && info.maxValue <= 11 && !p.some(c => c.isRedJoker);
    });
    const complexLead = possiblePlays.find(p => {
      const info = deps.memoGetPlayInfo(p);
      return !!info && (info.type === PlayType.Triple || info.type === PlayType.TripleWithPair || info.type === PlayType.Straight || info.type === PlayType.Tube || info.type === PlayType.Plate);
    });
    const probePair = pairs.find((p) => {
      const info = deps.memoGetPlayInfo(p);
      return !!info && info.maxValue >= hardRuntimeTuning.pairProbeMin && info.maxValue <= Math.min(13, hardRuntimeTuning.pairProbeMax);
    });

    if (probeSingle && enemyMin > hardRuntimeTuning.interceptThreshold + 1 && (pairLeadStreakHint > 0 || myHandCount >= 14)) {
      return probeSingle;
    }
    if (probePair && enemyMin >= 12 && myHandCount >= 15 && pairLeadStreakHint > 0) {
      return probePair;
    }

    if (difficulty === 'master' && complexLead && enemyMin > hardRuntimeTuning.interceptThreshold) {
      return complexLead;
    }
    if (complexLead && enemyMin > hardRuntimeTuning.interceptThreshold + 1) {
      return complexLead;
    }

    if (enemyMin > 8 && pairs.length > 0 && difficulty !== 'master') {
      const mediumPair = pairs.find((p) => {
        const info = deps.memoGetPlayInfo(p);
        return !!info && info.maxValue >= hardRuntimeTuning.pairProbeMin && info.maxValue <= hardRuntimeTuning.pairProbeMax;
      });
      if (mediumPair) return mediumPair;
    }

    if (enemyMin <= hardRuntimeTuning.interceptThreshold) {
      if (pairs.length > 0) return pairs[pairs.length - 1];
      if (singles.length > 0) return singles[singles.length - 1];
    }
    if (myHandCount <= 8) {
      const tailSafe = pickTailSafeLead(possiblePlays);
      if (tailSafe) return tailSafe;
    }
    return undefined;
  }

  const lastPlayer = players[lastPlay.playerId];
  const nonBombs = possiblePlays.filter((p) => {
    const info = deps.memoGetPlayInfo(p);
    return !!info && !deps.isBombType(info.type);
  });

  if (lastPlayer.team === myTeam) {
    if (enemyMin <= 5) {
      const fastClose = nonBombs.find((p) => myHandCount - p.length <= 1);
      if (fastClose) return fastClose;
    }
    const teammateCount = players[teammateId].hand.length;
    const lastInfo = deps.memoGetPlayInfo(lastPlay.cards);
    const contestNeeded = forceContest || enemyMin <= hardRuntimeTuning.interceptThreshold + 1;
    if (teammateCount <= 8) return null;
    if (teammateCount <= 10 && !contestNeeded) return null;
    if (teammateCount <= 7 && lastInfo && lastInfo.maxValue <= 9 && nonBombs.length > 0) return nonBombs[0];
    return undefined;
  }

  if (difficulty !== 'master' && enemyMin > hardRuntimeTuning.interceptThreshold + 3 && myHandCount >= 15) {
    const probeFollow = deps.chooseSmallProbeFollow(nonBombs.length > 0 ? nonBombs : possiblePlays, lastPlay, 11);
    if (probeFollow) return probeFollow;
  }

  if (enemyMin <= hardRuntimeTuning.interceptThreshold || forceContest) {
    if (nonBombs.length > 0) return nonBombs[0];
    return possiblePlays[0];
  }

  if ((isAChallenge || tributeDefensive) && lastPlayer.team !== myTeam && enemyMin <= 8) {
    const contestPick = nonBombs.length > 0 ? nonBombs[0] : possiblePlays[0];
    if (contestPick) return contestPick;
  }

  const top = possiblePlays[0];
  const topInfo = top ? deps.memoGetPlayInfo(top) : null;
  if (topInfo && deps.isBombType(topInfo.type) && enemyMin > Math.max(6, hardRuntimeTuning.interceptThreshold - 1)) {
    if (nonBombs.length > 0) return nonBombs[0];
    if (players[teammateId].hand.length > 4 && myHandCount > 6) return null;
  }

  const lastInfo = deps.memoGetPlayInfo(lastPlay.cards);
  if (lastPlayer.hand.length <= 2 && lastInfo?.type === PlayType.Single) {
    const singles = possiblePlays.filter(p => p.length === 1);
    if (singles.length > 0) return singles[singles.length - 1];
  }

  return undefined;
};
