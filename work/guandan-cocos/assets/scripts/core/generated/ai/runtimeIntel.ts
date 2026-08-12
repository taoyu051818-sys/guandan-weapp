import type { PlayAction, Player, PlayerId, PlayType } from '../types/game';
import { PlayType as PlayTypeValue } from '../types/game';
import type { AIEngineCheckpoint } from './types';

export type RuntimeIntelState = {
  prevTotalCards: number;
  lastObservedPlayKey: string;
  seenValueCounts: Map<number, number>;
  seenJokerCount: number;
  seenLevelCardCount: number;
  lastTypeByPlayer: Map<PlayerId, PlayType>;
  singlePairStreakByPlayer: Map<PlayerId, number>;
  recentPlaySamples: Array<{
    playerId: PlayerId;
    type: PlayType;
    maxValue: number;
    cardsLen: number;
  }>;
};

export type RuntimeIntelCheckpoint = AIEngineCheckpoint['runtimeIntel'];

type ObservedPlayInfo = { maxValue: number } | null;

const cardsKey = (cards: PlayAction['cards']): string =>
  cards.map(card => card.id).sort().join(',');

export const createRuntimeIntelState = (): RuntimeIntelState => ({
  prevTotalCards: -1,
  lastObservedPlayKey: '',
  seenValueCounts: new Map(),
  seenJokerCount: 0,
  seenLevelCardCount: 0,
  lastTypeByPlayer: new Map(),
  singlePairStreakByPlayer: new Map(),
  recentPlaySamples: [],
});

export const resetRuntimeIntelState = (state: RuntimeIntelState): void => {
  state.prevTotalCards = -1;
  state.lastObservedPlayKey = '';
  state.seenValueCounts.clear();
  state.seenJokerCount = 0;
  state.seenLevelCardCount = 0;
  state.lastTypeByPlayer.clear();
  state.singlePairStreakByPlayer.clear();
  state.recentPlaySamples = [];
};

export const observeRuntimeIntel = (
  state: RuntimeIntelState,
  lastPlay: PlayAction | null,
  players: Record<PlayerId, Player>,
  getPlayInfo: (cards: PlayAction['cards']) => ObservedPlayInfo,
  onRoundReset: () => void,
): void => {
  const totalCards = Object.values(players)
    .reduce((sum, player) => sum + player.hand.length, 0);
  if (state.prevTotalCards >= 0 && totalCards > state.prevTotalCards) {
    resetRuntimeIntelState(state);
    onRoundReset();
  }
  state.prevTotalCards = totalCards;
  if (!lastPlay) return;
  if (lastPlay.type === PlayTypeValue.Pass) {
    state.lastTypeByPlayer.set(lastPlay.playerId, PlayTypeValue.Pass);
    state.singlePairStreakByPlayer.set(lastPlay.playerId, 0);
    return;
  }

  const key = `${lastPlay.playerId}|${lastPlay.type}|${cardsKey(lastPlay.cards)}`;
  if (key === state.lastObservedPlayKey) return;
  state.lastObservedPlayKey = key;
  state.lastTypeByPlayer.set(lastPlay.playerId, lastPlay.type);
  const previousStreak = state.singlePairStreakByPlayer.get(lastPlay.playerId) || 0;
  if (lastPlay.type === PlayTypeValue.Single || lastPlay.type === PlayTypeValue.Pair) {
    state.singlePairStreakByPlayer.set(lastPlay.playerId, previousStreak + 1);
  } else {
    state.singlePairStreakByPlayer.set(lastPlay.playerId, 0);
  }
  lastPlay.cards.forEach((card) => {
    state.seenValueCounts.set(card.value, (state.seenValueCounts.get(card.value) || 0) + 1);
    if (card.suit === 'joker') state.seenJokerCount += 1;
    if (card.isLevelCard) state.seenLevelCardCount += 1;
  });
  const playInfo = getPlayInfo(lastPlay.cards);
  state.recentPlaySamples.push({
    playerId: lastPlay.playerId,
    type: lastPlay.type,
    maxValue: playInfo?.maxValue ?? 0,
    cardsLen: lastPlay.cards.length,
  });
  if (state.recentPlaySamples.length > 18) state.recentPlaySamples.shift();
};

export const serializeRuntimeIntel = (
  state: RuntimeIntelState,
): RuntimeIntelCheckpoint => ({
  prevTotalCards: state.prevTotalCards,
  lastObservedPlayKey: state.lastObservedPlayKey,
  seenValueCounts: Array.from(state.seenValueCounts.entries()),
  seenJokerCount: state.seenJokerCount,
  seenLevelCardCount: state.seenLevelCardCount,
  lastTypeByPlayer: Array.from(state.lastTypeByPlayer.entries()),
  singlePairStreakByPlayer: Array.from(state.singlePairStreakByPlayer.entries()),
  recentPlaySamples: state.recentPlaySamples.map(sample => ({ ...sample })),
});

const assertInteger = (value: number, minimum: number, label: string): void => {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`Invalid AI engine checkpoint ${label}`);
  }
};

const assertFinite = (value: number, label: string): void => {
  if (!Number.isFinite(value)) throw new Error(`Invalid AI engine checkpoint ${label}`);
};

export const deserializeRuntimeIntel = (
  intel: RuntimeIntelCheckpoint,
): RuntimeIntelState => {
  const playerIds: readonly PlayerId[] = ['p1', 'p2', 'p3', 'p4'];
  const playTypes = new Set<PlayType>(Object.values(PlayTypeValue));
  const isPlayerId = (value: PlayerId): boolean => playerIds.includes(value);

  assertInteger(intel.prevTotalCards, -1, 'prevTotalCards');
  if (typeof intel.lastObservedPlayKey !== 'string') {
    throw new Error('Invalid AI engine checkpoint lastObservedPlayKey');
  }
  assertInteger(intel.seenJokerCount, 0, 'seenJokerCount');
  assertInteger(intel.seenLevelCardCount, 0, 'seenLevelCardCount');
  if (intel.recentPlaySamples.length > 18) {
    throw new Error('Invalid AI engine checkpoint recentPlaySamples');
  }

  const state = createRuntimeIntelState();
  state.prevTotalCards = intel.prevTotalCards;
  state.lastObservedPlayKey = intel.lastObservedPlayKey;
  state.seenJokerCount = intel.seenJokerCount;
  state.seenLevelCardCount = intel.seenLevelCardCount;

  for (const [value, count] of intel.seenValueCounts) {
    assertFinite(value, 'seenValueCounts key');
    assertInteger(count, 0, 'seenValueCounts value');
    if (state.seenValueCounts.has(value)) {
      throw new Error('Duplicate AI engine checkpoint value count');
    }
    state.seenValueCounts.set(value, count);
  }

  for (const [playerId, type] of intel.lastTypeByPlayer) {
    if (!isPlayerId(playerId) || !playTypes.has(type) || state.lastTypeByPlayer.has(playerId)) {
      throw new Error('Invalid AI engine checkpoint lastTypeByPlayer');
    }
    state.lastTypeByPlayer.set(playerId, type);
  }

  for (const [playerId, streak] of intel.singlePairStreakByPlayer) {
    if (!isPlayerId(playerId) || state.singlePairStreakByPlayer.has(playerId)) {
      throw new Error('Invalid AI engine checkpoint singlePairStreakByPlayer');
    }
    assertInteger(streak, 0, 'singlePairStreakByPlayer value');
    state.singlePairStreakByPlayer.set(playerId, streak);
  }

  state.recentPlaySamples = intel.recentPlaySamples.map((sample) => {
    if (!isPlayerId(sample.playerId) || !playTypes.has(sample.type)) {
      throw new Error('Invalid AI engine checkpoint recentPlaySamples');
    }
    assertFinite(sample.maxValue, 'recentPlaySamples maxValue');
    assertInteger(sample.cardsLen, 0, 'recentPlaySamples cardsLen');
    return { ...sample };
  });
  return state;
};

export const restoreRuntimeIntelState = (
  target: RuntimeIntelState,
  source: RuntimeIntelState,
): void => {
  target.prevTotalCards = source.prevTotalCards;
  target.lastObservedPlayKey = source.lastObservedPlayKey;
  target.seenValueCounts = source.seenValueCounts;
  target.seenJokerCount = source.seenJokerCount;
  target.seenLevelCardCount = source.seenLevelCardCount;
  target.lastTypeByPlayer = source.lastTypeByPlayer;
  target.singlePairStreakByPlayer = source.singlePairStreakByPlayer;
  target.recentPlaySamples = source.recentPlaySamples;
};
