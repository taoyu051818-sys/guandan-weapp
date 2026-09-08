import {
  PlayType,
  type Card,
  type PlayAction,
  type Player,
  type PlayerId,
  type Team,
} from '../types/game';
import type { createDecisionSupport, TeamIntent } from './decisionSupport';
import type { RandomSource } from './random';
import type { RuntimeIntelState } from './runtimeIntel';
import { isBombType, type CachedPlayInfo } from './scoring';
import { STRATEGY_BY_DIFFICULTY } from './strategies/profiles';
import type { Difficulty } from './types';

type DecisionSupport = ReturnType<typeof createDecisionSupport>;

export type FallbackDecisionOptions = Readonly<{
  random: RandomSource;
  runtimeIntel: RuntimeIntelState;
  support: DecisionSupport;
  getPlayInfo: (cards: Card[]) => CachedPlayInfo;
}>;

export type FallbackDecisionInput = Readonly<{
  hand: Card[];
  possiblePlays: Card[][];
  lastPlay: PlayAction | null;
  difficulty: Difficulty;
  myTeam: Team;
  players: Record<PlayerId, Player>;
  teammateId: PlayerId;
  intent: TeamIntent;
  hardThreatMode: boolean;
  isAdvancedAI: boolean;
  isAChallenge: boolean;
  tributeAggressiveLead: boolean;
  markPass: (reason: string) => null;
}>;

const HARD_CRITICAL_INTERCEPT_THRESHOLD = 5;

/** Selects ordinary follow/lead and humanized fallback plays after tactical gates decline. */
export const createFallbackDecision = ({
  random,
  runtimeIntel,
  support,
  getPlayInfo,
}: FallbackDecisionOptions) => (input: FallbackDecisionInput): Card[] | null => {
  const {
    hand,
    possiblePlays,
    lastPlay,
    difficulty,
    myTeam,
  players,
  teammateId,
  intent,
    hardThreatMode,
    isAdvancedAI,
    isAChallenge,
    tributeAggressiveLead,
    markPass,
  } = input;
  const profile = STRATEGY_BY_DIFFICULTY[difficulty];
  const teammate = players[teammateId];
  const enemyCounts = Object.values(players)
    .filter(player => player.team !== myTeam)
    .map(player => player.hand.length)
    .filter(length => length > 0);
  const nearestEnemy = enemyCounts.length ? Math.min(...enemyCounts) : 99;

  if (lastPlay && lastPlay.type !== PlayType.Pass) {
    const lastPlayer = players[lastPlay.playerId];
    const nonBombs = possiblePlays.filter((play) => {
      const info = getPlayInfo(play);
      return info && !isBombType(info.type);
    });
    if (isAdvancedAI && lastPlayer.hand.length <= HARD_CRITICAL_INTERCEPT_THRESHOLD) {
      const criticalPick = support.pickLowestWinningPlay(
        nonBombs.length > 0 ? nonBombs : possiblePlays,
      );
      if (criticalPick) return criticalPick;
    }
    if (lastPlayer.hand.length <= 2) {
      const singles = possiblePlays.filter(play => play.length === 1);
      if (singles.length > 0) return singles[singles.length - 1];
    }
    if (difficulty === 'master' && lastPlayer.hand.length > 6) {
      if (nonBombs.length > 0) return nonBombs[0];
      const onlyInfo = possiblePlays[0] ? getPlayInfo(possiblePlays[0]) : null;
      if (onlyInfo && isBombType(onlyInfo.type)) return markPass('master_pre6_bomb_hold');
    }
    if (intent === 'block_enemy') return nonBombs[0] ?? possiblePlays[0];
    const best = possiblePlays[0];
    const bestInfo = getPlayInfo(best);
    if (bestInfo && isBombType(bestInfo.type) && nearestEnemy > 5
      && !hardThreatMode && difficulty !== 'master') {
      const passRate = 0.75 * profile.conservatism;
      if (random() < Math.min(0.95, passRate)) return markPass('bomb_conservation');
    }
    return best;
  }

  if (intent === 'assist_teammate') {
    const singles = possiblePlays.filter(play => play.length === 1);
    if (singles.length > 0) return singles[0];
    const pairs = possiblePlays.filter(play => getPlayInfo(play)?.type === PlayType.Pair);
    if (pairs.length > 0) return pairs[0];
  }
  if (isAChallenge || tributeAggressiveLead) {
    const controlLead = support.chooseByTypeOrder(possiblePlays, [
      PlayType.Tube,
      PlayType.Plate,
      PlayType.TripleWithPair,
      PlayType.Straight,
      PlayType.Triple,
    ]);
    if (controlLead) return controlLead;
  }
  if (intent === 'block_enemy') {
    const singles = possiblePlays.filter(play => play.length === 1);
    if (singles.length > 0) return singles[singles.length - 1];
    const pairs = possiblePlays.filter(play => getPlayInfo(play)?.type === PlayType.Pair);
    if (pairs.length > 0) return pairs[pairs.length - 1];
  }
  if (isAdvancedAI) {
    const proactiveLongLead = possiblePlays.find((play) => {
      const info = getPlayInfo(play);
      return !!info && (info.type === PlayType.Straight
        || info.type === PlayType.Tube
        || info.type === PlayType.Plate) && info.maxValue <= 13;
    });
    if (proactiveLongLead && nearestEnemy > 7 && hand.length >= 14) return proactiveLongLead;
    const teammateFeedType = runtimeIntel.lastTypeByPlayer.get(teammateId);
    if (teammate.hand.length > 0 && teammate.hand.length <= 6 && teammateFeedType
      && teammateFeedType !== PlayType.Bomb
      && teammateFeedType !== PlayType.StraightFlush
      && teammateFeedType !== PlayType.Rocket) {
      const feedPlay = support.chooseByType(possiblePlays, teammateFeedType, true);
      if (feedPlay) return feedPlay;
    }
    const structuredLead = support.chooseLeadByStructure(hand, possiblePlays);
    if (structuredLead) return structuredLead;
    const topInfo = getPlayInfo(possiblePlays[0]);
    const diverseLead = possiblePlays.find((play) => {
      const info = getPlayInfo(play);
      return !!info && (info.type === PlayType.Triple
        || info.type === PlayType.TripleWithPair
        || info.type === PlayType.Straight
        || info.type === PlayType.Tube
        || info.type === PlayType.Plate);
    });
    if (topInfo?.type === PlayType.Pair && diverseLead && nearestEnemy > 4) return diverseLead;
  }

  const complex = possiblePlays.find((play) => {
    const info = getPlayInfo(play);
    return !!info && (play.length >= 5 || info.type === PlayType.Triple
      || info.type === PlayType.TripleWithPair
      || info.type === PlayType.Tube
      || info.type === PlayType.Plate);
  });
  if (difficulty === 'medium' && possiblePlays.length > 2 && random() < 0.8) {
    return possiblePlays[Math.min(
      possiblePlays.length - 1,
      Math.floor(random() * Math.min(4, possiblePlays.length)),
    )];
  }
  if (difficulty === 'easy' && possiblePlays.length > 2 && random() < 0.95) {
    return possiblePlays[Math.min(
      possiblePlays.length - 1,
      Math.floor(random() * Math.min(5, possiblePlays.length)),
    )];
  }
  if (difficulty === 'hard' && possiblePlays.length > 2 && random() < 0.35) {
    return possiblePlays[Math.min(
      possiblePlays.length - 1,
      Math.floor(random() * Math.min(4, possiblePlays.length)),
    )];
  }
  if (complex && random() > profile.humanizeJitter) return complex;
  return possiblePlays[0];
};
