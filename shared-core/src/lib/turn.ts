import { PlayType } from '../types/game'
import type { Card, PlayAction, PlayResolution, PlayerId } from '../types/game'
import type { EngineState, GameEvent, MatchState } from './engine'

export interface TurnResult {
  state: MatchState
  events: GameEvent[]
}

export type TurnOperationResult =
  | { ok: true; result: TurnResult }
  | { ok: false; reason: string }

const cloneResolution = (resolution: PlayResolution): PlayResolution => ({
  ...resolution,
  wildcardUsages: resolution.wildcardUsages?.map(usage => ({ ...usage })),
})

const cloneAction = (action: PlayAction): PlayAction => ({
  ...action,
  cards: action.cards.map(card => ({ ...card })),
  resolution: action.resolution ? cloneResolution(action.resolution) : undefined,
})

export const nextActivePlayer = (state: EngineState, afterPlayerId: PlayerId): PlayerId | null => {
  const startIndex = state.turnOrder.indexOf(afterPlayerId)
  if (startIndex < 0) return null
  for (let offset = 1; offset <= state.turnOrder.length; offset += 1) {
    const candidate = state.turnOrder[(startIndex + offset) % state.turnOrder.length]
    if (state.players[candidate].hand.length > 0) return candidate
  }
  return null
}

export const teammateOf = (state: EngineState, playerId: PlayerId): PlayerId | null =>
  state.turnOrder.find(candidate => (
    candidate !== playerId && state.players[candidate].team === state.players[playerId].team
  )) ?? null

export const recordPlay = (
  state: MatchState,
  playerId: PlayerId,
  cards: Card[],
  resolution: PlayResolution,
): TurnResult => {
  const player = state.players[playerId]
  const playedIds = new Set(cards.map(card => card.id))
  const nextHand = player.hand.filter(card => !playedIds.has(card.id))
  const action: PlayAction = {
    playerId,
    cards: cards.map(card => ({ ...card })),
    type: resolution.type,
    resolution: cloneResolution(resolution),
  }
  const didFinish = nextHand.length === 0 && !state.finishedPlayers.includes(playerId)
  const finishedPlayers = didFinish
    ? [...state.finishedPlayers, playerId]
    : state.finishedPlayers
  // Events cross the domain boundary. Give them their own payload so an
  // animation/audio consumer cannot mutate the committed match state.
  const events: GameEvent[] = [{ type: 'CARDS_PLAYED', action: cloneAction(action) }]
  if (didFinish) {
    events.push({ type: 'PLAYER_FINISHED', playerId, place: finishedPlayers.length })
  }
  return {
    state: {
      ...state,
      players: { ...state.players, [playerId]: { ...player, hand: nextHand } },
      trick: { winningPlay: cloneAction(action), passedPlayerIds: [] },
      playArea: [...state.playArea, cloneAction(action)],
      playHistory: [...state.playHistory, cloneAction(action)],
      lastValidPlay: cloneAction(action),
      finishedPlayers,
    },
    events,
  }
}

export const advanceAfterPlay = (state: MatchState, playerId: PlayerId): TurnOperationResult => {
  const nextPlayerId = nextActivePlayer(state, playerId)
  if (!nextPlayerId) return { ok: false, reason: 'NO_ACTIVE_PLAYER' }
  return {
    ok: true,
    result: {
      state: { ...state, currentTurn: nextPlayerId },
      events: [{ type: 'TURN_ADVANCED', fromPlayerId: playerId, toPlayerId: nextPlayerId }],
    },
  }
}

export const passAndAdvance = (state: MatchState, playerId: PlayerId): TurnOperationResult => {
  const winningPlay = state.trick.winningPlay
  if (!winningPlay) return { ok: false, reason: 'CANNOT_PASS_ON_LEAD' }
  const passedPlayerIds = [...state.trick.passedPlayerIds, playerId]
  const passAction: PlayAction = { playerId, cards: [], type: PlayType.Pass }
  const passed: MatchState = {
    ...state,
    trick: { ...state.trick, passedPlayerIds },
    playArea: [...state.playArea, cloneAction(passAction)],
    playHistory: [...state.playHistory, cloneAction(passAction)],
  }
  const events: GameEvent[] = [{ type: 'PLAYER_PASSED', playerId }]
  const requiredPassers = state.turnOrder.filter(candidate => (
    state.players[candidate].hand.length > 0 && candidate !== winningPlay.playerId
  ))
  const complete = requiredPassers.every(candidate => passedPlayerIds.includes(candidate))
  if (!complete) {
    const nextPlayerId = nextActivePlayer(passed, playerId)
    if (!nextPlayerId) return { ok: false, reason: 'NO_ACTIVE_PLAYER' }
    return {
      ok: true,
      result: {
        state: { ...passed, currentTurn: nextPlayerId },
        events: [
          ...events,
          { type: 'TURN_ADVANCED', fromPlayerId: playerId, toPlayerId: nextPlayerId },
        ],
      },
    }
  }

  const winnerActive = passed.players[winningPlay.playerId].hand.length > 0
  const teammate = teammateOf(passed, winningPlay.playerId)
  const fallback = nextActivePlayer(passed, playerId)
  const nextLeaderId = winnerActive
    ? winningPlay.playerId
    : teammate && passed.players[teammate].hand.length > 0
      ? teammate
      : fallback
  if (!nextLeaderId) return { ok: false, reason: 'NO_ACTIVE_PLAYER' }
  return {
    ok: true,
    result: {
      state: {
        ...passed,
        currentTurn: nextLeaderId,
        trick: { winningPlay: null, passedPlayerIds: [] },
        lastValidPlay: null,
      },
      events: [
        ...events,
        {
          type: 'TRICK_COMPLETED',
          winnerId: winningPlay.playerId,
          nextLeaderId,
          isContact: !winnerActive && nextLeaderId !== winningPlay.playerId,
        },
        { type: 'TURN_ADVANCED', fromPlayerId: playerId, toPlayerId: nextLeaderId },
      ],
    },
  }
}
