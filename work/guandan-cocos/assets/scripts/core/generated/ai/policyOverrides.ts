import type { RuleProfile } from '../lib/rules';
import type { Card, PlayAction, Player, PlayerId, Team } from '../types/game';
import type { CandidateService } from './candidates';
import type { createDecisionSupport } from './decisionSupport';
import type { RuntimeIntelState } from './runtimeIntel';
import type { CachedPlayInfo } from './scoring';
import { getRankCounts, isBombType } from './scoring';
import type { SearchService } from './search';
import { hardTacticalOverride as hardTacticalOverrideImpl } from './strategies/hard';
import { chooseMasterOverride as chooseMasterOverrideImpl } from './strategies/master';
import { chooseMediumOverride as chooseMediumOverrideImpl } from './strategies/medium';
import type {
  AIContext,
  AdvancedRole,
  Difficulty,
  HardRuntimeTuning,
  MasterRuntimeTuning,
} from './types';

export type DecisionRuntimeContext = {
  difficulty: Difficulty;
  role: AdvancedRole;
  ruleProfile: RuleProfile;
};

type DecisionSupport = ReturnType<typeof createDecisionSupport>;

export type PolicyOverrideServiceOptions = Readonly<{
  runtimeContext: DecisionRuntimeContext;
  runtimeIntel: RuntimeIntelState;
  hardTuning: HardRuntimeTuning;
  masterTuning: MasterRuntimeTuning;
  support: DecisionSupport;
  search: SearchService;
  getPlayInfo: (cards: Card[]) => CachedPlayInfo;
  getPossiblePlays: CandidateService['getPossiblePlays'];
}>;

export type PolicyOverrides = {
  chooseMaster: (
    role: AdvancedRole,
    hand: Card[],
    possiblePlays: Card[][],
    lastPlay: PlayAction | null,
    players: Record<PlayerId, Player>,
    myTeam: Team,
    teammateId: PlayerId,
    myPlayerId: PlayerId,
    aiContext?: AIContext,
  ) => Card[] | null | undefined;
  chooseHard: (
    hand: Card[],
    possiblePlays: Card[][],
    lastPlay: PlayAction | null,
    players: Record<PlayerId, Player>,
    myTeam: Team,
    teammateId: PlayerId,
    myPlayerId: PlayerId,
    myHandCount: number,
    difficulty: Difficulty,
    aiContext?: AIContext,
  ) => Card[] | null | undefined;
  chooseMedium: (
    hand: Card[],
    possiblePlays: Card[][],
    lastPlay: PlayAction | null,
    players: Record<PlayerId, Player>,
    myTeam: Team,
    aiContext?: AIContext,
  ) => Card[] | null | undefined;
};

const HARD_FORCE_CONTEST_FLOOR = 7;

/** Adapts engine-scoped state and ports to the difficulty policy modules. */
export const createPolicyOverrides = ({
  runtimeContext,
  runtimeIntel,
  hardTuning,
  masterTuning,
  support,
  search,
  getPlayInfo,
  getPossiblePlays,
}: PolicyOverrideServiceOptions): PolicyOverrides => ({
  chooseMaster: (
    role,
    hand,
    possiblePlays,
    lastPlay,
    players,
    myTeam,
    teammateId,
    myPlayerId,
    aiContext,
  ) => chooseMasterOverrideImpl(
    {
      role,
      hand,
      possiblePlays,
      lastPlay,
      players,
      myTeam,
      teammateId,
      myPlayerId,
      runtimeIntelState: {
        lastTypeByPlayer: runtimeIntel.lastTypeByPlayer,
        singlePairStreakByPlayer: runtimeIntel.singlePairStreakByPlayer,
      },
      masterRuntimeTuning: masterTuning,
      aiContext,
    },
    {
      getMinEnemyHand: support.getMinEnemyHand,
      getEnemyPressureModel: support.getEnemyPressureModel,
      getRankCounts,
      getPlayResourceDamage: support.getPlayResourceDamage,
      memoGetPlayInfo: getPlayInfo,
      isBombType,
      chooseLowestComplexPlay: support.chooseLowestComplexPlay,
      pickLowestWinningPlay: support.pickLowestWinningPlay,
      chooseByType: support.chooseByType,
      chooseFeedPlayByScore: support.chooseFeedPlayByScore,
      chooseByTypeOrder: support.chooseByTypeOrder,
      chooseSmallProbeFollow: support.chooseSmallProbeFollow,
      chooseSmallProbeLead: support.chooseSmallProbeLead,
      planGlobalGroupingV1: search.planGlobalGrouping,
      isComplexPlayType: support.isComplexPlayType,
      chooseOpeningDecomposeLead: support.chooseOpeningDecomposeLead,
      chooseLeadByStructure: support.chooseLeadByStructure,
      chooseAggressiveComboLead: support.chooseAggressiveComboLead,
    },
  ),
  chooseHard: (
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
  ) => hardTacticalOverrideImpl(
    {
      hand,
      possiblePlays,
      lastPlay,
      players,
      myTeam,
      teammateId,
      myPlayerId,
      myHandCount,
      difficulty,
      runtimeIntelState: { lastTypeByPlayer: runtimeIntel.lastTypeByPlayer },
      hardRuntimeTuning: hardTuning,
      hardForceContestFloor: HARD_FORCE_CONTEST_FLOOR,
      aiContext,
    },
    {
      getMinEnemyHand: support.getMinEnemyHand,
      memoGetPlayInfo: getPlayInfo,
      isBombType,
      chooseSmallProbeFollow: support.chooseSmallProbeFollow,
      getPossiblePlays: (candidateHand, candidateLastPlay, candidateDifficulty) => getPossiblePlays(
        candidateHand,
        candidateLastPlay,
        candidateDifficulty,
        runtimeContext.ruleProfile,
      ),
    },
  ),
  chooseMedium: (
    hand,
    possiblePlays,
    lastPlay,
    players,
    myTeam,
    aiContext,
  ) => chooseMediumOverrideImpl(
    { hand, possiblePlays, lastPlay, players, myTeam, aiContext },
    {
      memoGetPlayInfo: getPlayInfo,
      isBombType,
      pickLowestWinningPlay: support.pickLowestWinningPlay,
    },
  ),
});
