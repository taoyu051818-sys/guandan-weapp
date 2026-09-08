import type { GameEvent, MatchPhase, MatchState } from './lib/engine';
import type { SettlementResult } from './lib/settlement';
import type { MatchTributeState, TributeExchange } from './lib/tribute';
import type { Card, Player, PlayerId } from './types/game';

export const MUTATING_COMMAND_TYPES = [
  'createRoom',
  'joinRoom',
  'rejoinRoom',
  'startGame',
  'setLobbyReady',
  'cancelLobbyReady',
  'kickMember',
  'addBot',
  'removeBot',
  'standUp',
  'sitDown',
  'watchPlayer',
  'play',
  'pass',
  'nextRound',
  'readyNextRound',
  'roundReady',
  'ready',
  'cancelRoundReady',
  'cancelReady',
  'setTrustee',
  'cancelTrustee',
  'proposeDissolve',
  'dissolveVote',
  'voteDissolve',
  'tribute',
  'returnTribute',
  'finishTribute',
  'chat',
  'leaveRoom',
  'safeExit',
] as const;

export const VERSIONED_ROOM_COMMAND_TYPES = [
  'startGame',
  'play',
  'pass',
  'tribute',
  'returnTribute',
  'finishTribute',
] as const;

export type MutatingCommandType = typeof MUTATING_COMMAND_TYPES[number];
export type VersionedRoomCommandType = typeof VERSIONED_ROOM_COMMAND_TYPES[number];

export type ClientCommandEnvelope<TPayload = unknown> = Readonly<{
  type: string;
  requestId: number;
  payload?: TPayload;
}>;

export type VersionedCommandPayload = Readonly<{
  expectedVersion: number;
}>;

type RoomIntent<TType extends string, TPayload extends object = Record<never, never>> = Readonly<{
  type: TType;
  requestId: number;
  payload: Readonly<{ roomId: string } & TPayload>;
}>;

type VersionedRoomIntent<TType extends string, TPayload extends object = Record<never, never>> = RoomIntent<
  TType,
  TPayload & VersionedCommandPayload
>;

export type NextRoundReadyCommandType =
  | 'nextRound'
  | 'readyNextRound'
  | 'roundReady'
  | 'ready'
  | 'cancelRoundReady'
  | 'cancelReady';

/** Wire intents never accept an actor or round id; the authoritative session derives both. */
export type ClientGameIntent =
  | VersionedRoomIntent<'startGame'>
  | VersionedRoomIntent<'play', { cardIds: string[] }>
  | VersionedRoomIntent<'pass'>
  | VersionedRoomIntent<'tribute', { cardId: string }>
  | VersionedRoomIntent<'returnTribute', { cardId: string }>
  | VersionedRoomIntent<'finishTribute'>
  | RoomIntent<NextRoundReadyCommandType>;

export type HiddenCard = Readonly<{ id: string }>;
export type ViewerCard = Card | HiddenCard;
export type ViewerPlayer = Omit<Player, 'hand'> & Readonly<{ hand: ViewerCard[] }>;
export type ViewerTributeExchange = Omit<TributeExchange, 'tributeCardId' | 'returnCardId'> & Readonly<{
  tributeCardId: string | null;
  returnCardId: string | null;
}>;
export type ViewerTributeState = Omit<MatchTributeState, 'exchanges'> & Readonly<{
  exchanges: ViewerTributeExchange[];
}>;
export type ViewerMatchState = Omit<MatchState, 'players' | 'tribute'> & Readonly<{
  players: Record<PlayerId, ViewerPlayer>;
  tribute: ViewerTributeState | null;
}>;

/** Domain events intentionally omit private selection ids until an atomic transfer completes. */
export type ViewerGameEvent = GameEvent;
export type ViewerSnapshotPhase = Exclude<MatchPhase, 'settled'> | 'settlement' | 'lobby';
export type ViewerSnapshot = Readonly<{
  roomId: string;
  state: ViewerMatchState | null;
  phase: ViewerSnapshotPhase;
  roundResult: SettlementResult | null;
  version: number;
  gameVersion: number;
  events?: ViewerGameEvent[];
}>;

export type ServerMessageEnvelope = Readonly<{
  type: string;
  requestId?: number;
  version?: number;
  gameVersion?: number;
  [key: string]: unknown;
}>;

export type ProtocolValidationError = Readonly<{
  code: 'invalid-request-id' | 'missing-version' | 'stale-version';
  message: string;
  actualVersion?: number;
}>;

const mutatingCommands = new Set<string>(MUTATING_COMMAND_TYPES);
const versionedRoomCommands = new Set<string>(VERSIONED_ROOM_COMMAND_TYPES);

export const commandRequiresRequestId = (type: string): type is MutatingCommandType => (
  mutatingCommands.has(type)
);

export const commandRequiresExpectedVersion = (type: string): type is VersionedRoomCommandType => (
  versionedRoomCommands.has(type)
);

export const isSafeRequestId = (value: unknown): value is number => (
  Number.isSafeInteger(value) && Number(value) > 0
);

export const isSafeVersion = (value: unknown): value is number => (
  Number.isSafeInteger(value) && Number(value) >= 0
);

export const validateCommandRequestId = (type: string, requestId: unknown): ProtocolValidationError | null => {
  if (!commandRequiresRequestId(type) || isSafeRequestId(requestId)) return null;
  return { code: 'invalid-request-id', message: '可变命令必须携带有效的 requestId' };
};

export const validateExpectedVersion = (
  type: string,
  suppliedVersion: unknown,
  actualVersion: number,
): ProtocolValidationError | null => {
  if (!commandRequiresExpectedVersion(type)) return null;
  if (!isSafeVersion(suppliedVersion)) {
    return { code: 'missing-version', message: '命令缺少有效的 expectedVersion', actualVersion };
  }
  if (suppliedVersion !== actualVersion) {
    return { code: 'stale-version', message: '牌局状态已更新，请同步后重试', actualVersion };
  }
  return null;
};
