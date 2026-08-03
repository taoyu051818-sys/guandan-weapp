import type { GameState } from '../types/game';

export type SyncedGameState = Pick<
  GameState,
  | 'status'
  | 'gameMode'
  | 'isMultiplayer'
  | 'roomId'
  | 'currentLevel'
  | 'levelTeam'
  | 'teamLevels'
  | 'aFailStreaks'
  | 'dealerId'
  | 'players'
  | 'turnOrder'
  | 'currentTurn'
  | 'playArea'
  | 'lastValidPlay'
  | 'scores'
  | 'difficulty'
  | 'finishedPlayers'
  | 'lastRoundRank'
  | 'tributeState'
  | 'aiRoundMeta'
  | 'settlementInfo'
  | 'recentMatch'
  | 'campaignProgress'
>;

export interface StateSyncPacket {
  state: SyncedGameState;
  version: number;
}

export interface JoinedRoomPayload {
  state: SyncedGameState;
  roomId: string;
  myPlayerId: 'p1' | 'p2' | 'p3' | 'p4';
  playerCount: number;
  memberPlayerIds?: Array<'p1' | 'p2' | 'p3' | 'p4'>;
  version?: number;
}

export const toSyncedGameState = (state: GameState): SyncedGameState => ({
  status: state.status,
  gameMode: state.gameMode,
  isMultiplayer: state.isMultiplayer,
  roomId: state.roomId,
  currentLevel: state.currentLevel,
  levelTeam: state.levelTeam,
  teamLevels: state.teamLevels,
  aFailStreaks: state.aFailStreaks,
  dealerId: state.dealerId,
  players: state.players,
  turnOrder: state.turnOrder,
  currentTurn: state.currentTurn,
  playArea: state.playArea,
  lastValidPlay: state.lastValidPlay,
  scores: state.scores,
  difficulty: state.difficulty,
  finishedPlayers: state.finishedPlayers,
  lastRoundRank: state.lastRoundRank,
  tributeState: state.tributeState,
  aiRoundMeta: state.aiRoundMeta,
  settlementInfo: state.settlementInfo,
  recentMatch: state.recentMatch,
  campaignProgress: state.campaignProgress,
});
