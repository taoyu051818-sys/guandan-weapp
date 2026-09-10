import type { PlayerId, TributeState } from '../core/generated'
import { handInteractionContext, resolveHandInteraction } from './HandInteractionState'

export type PlayingHandInteractionState = Readonly<{
  finishedPlayers: readonly string[]
}>

/** Selection is local preparation; only submitting a play requires the player's turn. */
export const canSelectPlayingHand = (
  state: PlayingHandInteractionState,
  humanId: string,
  actionPending: boolean,
): boolean => resolveHandInteraction(handInteractionContext({
  phase: 'playing', actionPending, trustee: false, humanId, finishedPlayers: state.finishedPlayers,
})).mode === 'play'

export const canSelectTributeHand = (tribute: TributeState | null | undefined, humanId: PlayerId): boolean => {
  if (!tribute || tribute.isAntiTribute || tribute.phase === 'done') return false
  return tribute.phase === 'tributing'
    ? tribute.actions.some(action => action.from === humanId && !action.card)
    : tribute.actions.some(action => action.to === humanId && !action.returnCard)
}

type HandInteractionSnapshot = Readonly<{
  phase: 'playing' | 'tribute' | 'settlement'
  actionPending: boolean
  state: PlayingHandInteractionState & Readonly<{ currentTurn: PlayerId }>
  tribute?: TributeState | null
}>

/** Shared eligibility for both rendering and commands; turn ownership only gates play/hint. */
export const resolveHandCapabilities = (
  snapshot: HandInteractionSnapshot,
  humanId: PlayerId,
  settings: Readonly<{ trustee: boolean, multiplayer?: boolean, deadlinePlayerId?: PlayerId | null }>,
) => {
  const interaction = resolveHandInteraction(handInteractionContext({
    phase: snapshot.phase, actionPending: snapshot.actionPending,
    finishedPlayers: snapshot.state.finishedPlayers, humanId, trustee: settings.trustee,
  }))
  const canGroup = interaction.mode === 'play'
  const canSubmit = canGroup && snapshot.state.currentTurn === humanId
  return {
    interaction,
    canGroup,
    canSelect: canGroup || (interaction.mode === 'tribute' && canSelectTributeHand(snapshot.tribute, humanId) &&
      (!settings.multiplayer || settings.deadlinePlayerId === humanId)),
    // Layout preparation remains available while waiting for another player's tribute.
    canArrange: interaction.mode !== 'blocked',
    canPlay: canSubmit,
    canHint: canSubmit,
  } as const
}
