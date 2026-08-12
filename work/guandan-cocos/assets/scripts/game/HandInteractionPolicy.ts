export type PlayingHandInteractionState = Readonly<{
  currentTurn: string
  finishedPlayers: readonly string[]
}>

/** Pure policy shared by the manager and scene so input cannot stay disabled after a turn cycles back. */
export const canSelectPlayingHand = (
  state: PlayingHandInteractionState,
  humanId: string,
  actionPending: boolean,
): boolean => !actionPending && state.currentTurn === humanId && !state.finishedPlayers.includes(humanId)
