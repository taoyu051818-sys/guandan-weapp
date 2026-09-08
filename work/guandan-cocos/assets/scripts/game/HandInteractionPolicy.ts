export type PlayingHandInteractionState = Readonly<{
  currentTurn: string
  finishedPlayers: readonly string[]
}>

/** Selection is local preparation; only submitting a play requires the player's turn. */
export const canSelectPlayingHand = (
  state: PlayingHandInteractionState,
  humanId: string,
  actionPending: boolean,
): boolean => !actionPending && !state.finishedPlayers.includes(humanId)
