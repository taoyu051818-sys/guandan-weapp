import { ruleProfileKey, type RuleProfile } from '../lib/rules';
import {
  PlayType,
  type Card,
  type PlayAction,
  type Player,
  type PlayerId,
  type Team,
} from '../types/game';
import type { CandidateService } from './candidates';
import type { createDecisionSupport } from './decisionSupport';
import { createFallbackDecision } from './fallbackDecision';
import type { DecisionRuntimeContext, PolicyOverrides } from './policyOverrides';
import type { RandomSource } from './random';
import type { RuntimeIntelState } from './runtimeIntel';
import { isBombType, type CachedPlayInfo } from './scoring';
import type { SearchService } from './search';
import type {
  AIContext,
  AIDecisionMetrics,
  AIDecisionTrace,
  AIEngine,
  Difficulty,
} from './types';

type DecisionSupport = ReturnType<typeof createDecisionSupport>;

export type DecisionRunnerOptions = Readonly<{
  engineRuleProfile: RuleProfile;
  random: RandomSource;
  metrics: AIDecisionMetrics;
  trace: AIDecisionTrace;
  runtimeContext: DecisionRuntimeContext;
  runtimeIntel: RuntimeIntelState;
  support: DecisionSupport;
  search: SearchService;
  overrides: PolicyOverrides;
  getPlayInfo: (cards: Card[]) => CachedPlayInfo;
  getPossiblePlays: CandidateService['getPossiblePlays'];
  observeRuntimeIntel: (
    lastPlay: PlayAction | null,
    players: Record<PlayerId, Player>,
  ) => void;
  resetMetrics: () => void;
}>;

const THREAT_MODE_THRESHOLD: Readonly<Record<Difficulty, number>> = Object.freeze({
  easy: 4,
  medium: 6,
  hard: 8,
  master: 9,
});
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Runs one decision through policy gates while the engine retains all mutable state. */
export const createDecisionRunner = ({
  engineRuleProfile,
  random,
  metrics,
  trace,
  runtimeContext,
  runtimeIntel,
  support,
  search,
  overrides,
  getPlayInfo,
  getPossiblePlays,
  observeRuntimeIntel,
  resetMetrics,
}: DecisionRunnerOptions): Pick<AIEngine, 'makeDecision'> => {
  const chooseFallback = createFallbackDecision({
    random,
    runtimeIntel,
    support,
    getPlayInfo,
  });
  const makeDecision = (
    hand: Card[],
    lastPlay: PlayAction | null,
    difficulty: Difficulty,
    myTeam: Team,
    players: Record<PlayerId, Player>,
    myPlayerId: PlayerId = 'p2',
    aiContext?: AIContext,
  ): Card[] | null => {
    const markPass = (reason: string): null => {
      trace.passReason = reason;
      return null;
    };
    resetMetrics();
    const startedAt = nowMs();
    try {
      observeRuntimeIntel(lastPlay, players);
      const advancedRole = support.getAdvancedRole(difficulty, players, myPlayerId);
      trace.difficulty = difficulty;
      trace.role = advancedRole;
      trace.passReason = '';
      runtimeContext.difficulty = difficulty;
      runtimeContext.role = advancedRole;
      if (
        aiContext
        && ruleProfileKey(aiContext.ruleProfile) !== ruleProfileKey(engineRuleProfile)
      ) {
        throw new Error('AI decision rule profile is incompatible with this engine');
      }
      runtimeContext.ruleProfile = engineRuleProfile;
      const myHandCount = hand.length;
      const order: PlayerId[] = ['p1', 'p2', 'p3', 'p4'];
      const myIndex = order.indexOf(myPlayerId);
      const nextPlayerId = order[(myIndex + 1) % 4];
      const teammateId = support.getTeammateId(players, myPlayerId, myTeam);
      const teammate = players[teammateId];
      const enemyHandCounts = Object.values(players)
        .filter((player) => player.team !== myTeam)
        .map((player) => player.hand.length)
        .filter(length => length > 0);
      const minEnemyHandCount = Math.min(...enemyHandCounts);
      const myLevel = aiContext?.teamLevels?.[myTeam];
      const isAChallenge = myLevel === 'A';
      const tributeAggressiveLead = !!aiContext?.roundMeta?.fromTribute
        && !aiContext.roundMeta.isAntiTribute;
      const isAdvancedAI = difficulty === 'hard' || difficulty === 'master';
      const hardThreatMode = isAdvancedAI
        && minEnemyHandCount <= THREAT_MODE_THRESHOLD[difficulty];
      const intent = support.getIntent(
        lastPlay,
        teammateId,
        teammate.hand.length,
        minEnemyHandCount,
      );
      const possiblePlays = getPossiblePlays(
        hand,
        lastPlay,
        difficulty,
        runtimeContext.ruleProfile,
      );
      if (possiblePlays.length === 0) return markPass('no_playable');

      const canFinish = possiblePlays.find(play => play.length === myHandCount);
      if (canFinish) return canFinish;

      // Team control is authoritative after the explicit whole-hand finish above.
      if (lastPlay && lastPlay.type !== PlayType.Pass
        && players[lastPlay.playerId].team === myTeam) {
        return markPass('teammate_yield');
      }

      if (difficulty === 'master' && lastPlay && lastPlay.type !== PlayType.Pass) {
        const lastPlayer = players[lastPlay.playerId];
        if (lastPlayer.team !== myTeam && lastPlayer.hand.length > 6) {
          const nonBombFollow = possiblePlays.filter((play) => {
            const info = getPlayInfo(play);
            return !!info && !isBombType(info.type);
          });
          if (nonBombFollow.length > 0) return nonBombFollow[0];
          if (advancedRole === 'striker' && (myHandCount <= 8 || minEnemyHandCount <= 9)) {
            return possiblePlays[0];
          }
          return markPass('master_pre6_no_nonbomb_follow');
        }
      }

      if (difficulty === 'hard') {
        if (lastPlay && lastPlay.type !== PlayType.Pass && random() < 0.1) {
          return markPass('hard_random_follow_pass');
        }
        if (!lastPlay || lastPlay.type === PlayType.Pass) {
          const weakLead = support.chooseByTypeOrder(
            possiblePlays,
            [PlayType.Single, PlayType.Pair],
          ) || possiblePlays[Math.floor(random() * Math.min(3, possiblePlays.length))];
          if (weakLead && random() < 0.2) return weakLead;
        }
      }

      if (difficulty === 'medium' && lastPlay && lastPlay.type !== PlayType.Pass) {
        const enemyLed = players[lastPlay.playerId].team !== myTeam;
        if (enemyLed && possiblePlays.length > 0 && random() < 0.2) {
          return markPass('medium_random_follow_pass');
        }
      }
      if (difficulty === 'easy' && lastPlay && lastPlay.type !== PlayType.Pass) {
        const enemyLed = players[lastPlay.playerId].team !== myTeam;
        if (enemyLed && possiblePlays.length > 0 && random() < 0.35) {
          return markPass('easy_random_follow_pass');
        }
      }
      if (difficulty === 'hard' && lastPlay && lastPlay.type !== PlayType.Pass) {
        const enemyLed = players[lastPlay.playerId].team !== myTeam;
        if (enemyLed && possiblePlays.length > 0 && random() < 0.08) {
          return markPass('hard_enemy_led_random_pass');
        }
      }

      const lockedEndgamePick = search.chooseLockedEndgameRoute(
        hand,
        possiblePlays,
        difficulty,
        players,
        myTeam,
        lastPlay,
      );
      if (lockedEndgamePick) return lockedEndgamePick;

      const endgamePick = search.chooseEndgamePlay(
        hand,
        possiblePlays,
        lastPlay,
        difficulty,
        players,
        myTeam,
        myPlayerId,
        nextPlayerId,
        teammateId,
        advancedRole,
      );
      if (endgamePick) return endgamePick;

      if (difficulty === 'master') {
        const masterPick = overrides.chooseMaster(
          advancedRole,
          hand,
          possiblePlays,
          lastPlay,
          players,
          myTeam,
          teammateId,
          myPlayerId,
          aiContext,
        );
        if (masterPick !== undefined) {
          if (masterPick === null) {
            const enemyLed = !!lastPlay && lastPlay.type !== PlayType.Pass
              && players[lastPlay.playerId].team !== myTeam;
            if (enemyLed && possiblePlays.length > 0) {
              const nonBombs = possiblePlays.filter((play) => {
                const info = getPlayInfo(play);
                return !!info && !isBombType(info.type);
              });
              const fallback = support.pickLowestWinningPlay(
                nonBombs.length > 0 ? nonBombs : possiblePlays,
              );
              if (fallback) return fallback;
            }
            return markPass('master_override');
          }
          return masterPick;
        }
      }

      if (difficulty === 'medium') {
        const mediumPick = overrides.chooseMedium(
          hand,
          possiblePlays,
          lastPlay,
          players,
          myTeam,
          aiContext,
        );
        if (mediumPick !== undefined) {
          if (mediumPick === null) return markPass('medium_override');
          return mediumPick;
        }
      }

      if (advancedRole === 'support') {
        const supportPick = support.chooseSupportOverride(
          possiblePlays,
          lastPlay,
          players,
          myTeam,
          teammateId,
        );
        if (supportPick !== undefined) {
          if (supportPick === null) return markPass('support_override');
          return supportPick;
        }
      }

      if (isAdvancedAI) {
        const hardOverride = overrides.chooseHard(
          hand,
          possiblePlays,
          lastPlay,
          players,
          myTeam,
          teammateId,
          myPlayerId,
          myHandCount,
          difficulty,
          aiContext,
        );
        if (hardOverride !== undefined) {
          if (hardOverride === null) return markPass('hard_override');
          return hardOverride;
        }

        const enemyLed = !!lastPlay && players[lastPlay.playerId].team !== myTeam;
        if (hardThreatMode && enemyLed) {
          const topCandidates = possiblePlays.slice(0, 10);
          let bestGain = Number.NEGATIVE_INFINITY;
          let bestPlay: Card[] | null = null;
          for (const play of topCandidates) {
            const gain = support.evaluateControlGain(
              play,
              hand,
              myPlayerId,
              nextPlayerId,
              players,
              difficulty,
            );
            if (gain > bestGain) {
              bestGain = gain;
              bestPlay = play;
            }
          }
          if (bestPlay) return bestPlay;
        }
      }

      return chooseFallback({
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
      });
    } finally {
      metrics.elapsedMs = Number((nowMs() - startedAt).toFixed(3));
    }
  };

  return { makeDecision };
};
