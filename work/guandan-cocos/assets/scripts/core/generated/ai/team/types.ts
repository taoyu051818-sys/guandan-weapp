import type { Card, PlayAction, PlayerId, PlayType, Team } from '../../types/game';
import type { RuleProfile } from '../../lib/rules';
import type { HandStrength } from './handStrength';

/** The team policy never receives another player's card faces. */
export type PublicSeat = Readonly<{ id: PlayerId; team: Team; count: number }>;
export type TeamObservation = Readonly<{
  hand: Card[];
  self: PlayerId;
  team: Team;
  seats: readonly PublicSeat[];
  order: readonly PlayerId[];
  lastPlay: PlayAction | null;
  history: readonly PlayAction[];
  historyComplete: boolean;
  level: Card['rank'];
  profile: RuleProfile;
  roundId?: number;
  revision?: number;
  finishedPlayers: readonly PlayerId[];
}>;

export type RouteEstimate = {
  turns: number;
  singles: number;
  types: PlayType[];
  exact: boolean;
};

export type TeamDecisionRecord = {
  policy: 'team-first-v1';
  objective: 'team-first-place';
  player: PlayerId;
  roundId?: number;
  revision?: number;
  reason: string;
  priority: number;
  selected: string[];
  estimatedTurns: number;
  historyCoverage: number;
  sampleCount: number;
  strength?: HandStrength;
  beliefs: Array<{
    player: PlayerId;
    count: number;
    shapes: Partial<Record<PlayType, number>>;
  }>;
  candidates: Array<{
    cards: string[];
    type: PlayType;
    score: number;
    probability: number;
    turns: number;
    allyFinish: number;
    enemyFinish: number;
    control: number;
  }>;
};
