import type { RuleProfile } from '../lib/rules';
import type {
  Card,
  PlayAction,
  Player,
  PlayerId,
  Rank,
  RoundMeta,
  Team,
} from '../types/game';
import type { RandomSource, SeededRandomCheckpoint } from './random';
import type { TeamDecisionRecord } from './team/types';

export type Difficulty = 'master';

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
  team?: TeamDecisionRecord;
};

export type AIContext = {
  turnOrder?: readonly PlayerId[];
  /** Complete public play/pass history for this round; no hidden hands. */
  publicHistory?: readonly PlayAction[];
  finishedPlayers?: readonly PlayerId[];
  roundId?: number;
  revision?: number;
  currentLevel: Rank;
  teamLevels: Record<Team, Rank>;
  ruleProfile: RuleProfile;
  roundMeta: RoundMeta | null;
};

export type AIEngineConfig = {
  ruleProfile: RuleProfile;
  seed?: number;
};

export type AIEngineOptions = AIEngineConfig & {
  random?: RandomSource;
};

/** Version 1 is accepted by restore solely for migration; only v2 is written. */
export type AIEngineCheckpoint = {
  version: 2;
  teamDecisions: TeamDecisionRecord[];
  engineRuleProfileKey: string;
  random: SeededRandomCheckpoint;
};

export type AIEngine = {
  readonly ruleProfile: RuleProfile;
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
  restore: (checkpoint: unknown) => void;
  reset: () => void;
};
