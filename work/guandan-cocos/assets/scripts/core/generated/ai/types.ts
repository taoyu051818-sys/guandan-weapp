import type { RuleProfile } from '../lib/rules';
import type {
  Card,
  PlayAction,
  Player,
  PlayerId,
  PlayType,
  Rank,
  RoundMeta,
  Team,
} from '../types/game';
import type { RandomSource, SeededRandomCheckpoint } from './random';

export type Difficulty = 'easy' | 'medium' | 'hard' | 'master';

export type HardRuntimeTuning = {
  interceptThreshold: number;
  pairProbeMin: number;
  pairProbeMax: number;
  straightFlushBombBreakPenalty: number;
};

export type MasterRuntimeTuning = {
  strikerEnemyPushThreshold: number;
  strikerComboPushBonus: number;
  // Legacy tuning names retained for serialized compatibility; search maps them to work units.
  strikerSearchBudgetMs: number;
  supportSearchBudgetMs: number;
  strikerBeam: number;
  supportBeam: number;
  strikerDepthLimit: number;
  supportDepthLimit: number;
  finishBySmall: boolean;
  preferOnlySinglesPairsWithSmallLate: boolean;
  earlySmallDumpWeight: number;
  routeStabilityWeight: number;
  endgameComplexLockThreshold: number;
  endgameForceComplexFinish: boolean;
  endgameRouteWinGuard: boolean;
  endgameStrictLockThreshold: number;
  endgameSinglePairPenalty: number;
};

export type StrategyProfile = {
  bombPenalty: number;
  wildcardPenalty: number;
  highCardPenalty: number;
  openBigCardPenalty: number;
  responseSmallCardBias: number;
  comboLeadBonus: number;
  leadLengthBonus: number;
  earlySmallDumpWeight: number;
  conservatism: number;
  humanizeJitter: number;
};

export type AdvancedRole = 'striker' | 'support';

export type AIDecisionMetrics = {
  elapsedMs: number;
  generatedPlays: number;
  validPlays: number;
  prunedPlays: number;
  endgameDepth: number;
  endgameNodes: number;
  cacheHitPlayInfo: number;
  cacheMissPlayInfo: number;
  cacheHitCanPlay: number;
  cacheMissCanPlay: number;
  cacheHitAllPlays: number;
  cacheMissAllPlays: number;
};

export type AIDecisionTrace = {
  passReason: string;
  difficulty: Difficulty;
  role: AdvancedRole;
};

export type AIContext = {
  currentLevel: Rank;
  teamLevels: Record<Team, Rank>;
  ruleProfile: RuleProfile;
  roundMeta: RoundMeta | null;
};

export type AIEngineConfig = {
  ruleProfile: RuleProfile;
  seed?: number;
  hardTuning?: Partial<HardRuntimeTuning>;
  masterTuning?: Partial<MasterRuntimeTuning>;
};

export type AIEngineOptions = AIEngineConfig & {
  random?: RandomSource;
};

export type AIEngineCheckpoint = {
  version: 1;
  engineRuleProfileKey: string;
  random: SeededRandomCheckpoint;
  hardTuning: HardRuntimeTuning;
  masterTuning: MasterRuntimeTuning;
  runtimeIntel: {
    prevTotalCards: number;
    lastObservedPlayKey: string;
    seenValueCounts: Array<[number, number]>;
    seenJokerCount: number;
    seenLevelCardCount: number;
    lastTypeByPlayer: Array<[PlayerId, PlayType]>;
    singlePairStreakByPlayer: Array<[PlayerId, number]>;
    recentPlaySamples: Array<{
      playerId: PlayerId;
      type: PlayType;
      maxValue: number;
      cardsLen: number;
    }>;
  };
  decisionContext: {
    difficulty: Difficulty;
    role: AdvancedRole;
    ruleProfile: RuleProfile;
  };
};

export type AIEngine = {
  readonly ruleProfile: RuleProfile;
  getHardRuntimeTuning: () => HardRuntimeTuning;
  setHardRuntimeTuning: (patch: Partial<HardRuntimeTuning>) => void;
  getMasterRuntimeTuning: () => MasterRuntimeTuning;
  setMasterRuntimeTuning: (patch: Partial<MasterRuntimeTuning>) => void;
  getLastMetrics: () => AIDecisionMetrics;
  getLastDecisionTrace: () => AIDecisionTrace;
  generateAllPlays: (hand: Card[]) => Card[][];
  getPossiblePlays: (
    hand: Card[],
    lastPlay: PlayAction | null,
    difficulty?: Difficulty,
  ) => Card[][];
  makeDecision: (
    hand: Card[],
    lastPlay: PlayAction | null,
    difficulty: Difficulty,
    myTeam: Team,
    players: Record<PlayerId, Player>,
    myPlayerId?: PlayerId,
    aiContext?: AIContext,
  ) => Card[] | null;
  checkpoint: () => AIEngineCheckpoint;
  restore: (checkpoint: AIEngineCheckpoint) => void;
  reset: () => void;
};
