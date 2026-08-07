export type PlayingHandInteractionState = Readonly<{
  currentTurn: string
  finishedPlayers: readonly string[]
}>

export type PlayingHandTapMode = 'play' | 'grouping' | 'blocked'

/** Pure policy shared by the manager and scene so input cannot stay disabled after a turn cycles back. */
export const canSelectPlayingHand = (
  state: PlayingHandInteractionState,
  humanId: string,
  actionPending: boolean,
): boolean => !actionPending && state.currentTurn === humanId && !state.finishedPlayers.includes(humanId)

/**
 * Keeps rule selection and presentation-only grouping on separate paths.
 * Off-turn cards remain available for arranging, while an in-flight action or
 * a finished hand cannot be used to enter grouping mode.
 */
export const resolvePlayingHandTapMode = (
  state: PlayingHandInteractionState,
  humanId: string,
  actionPending: boolean,
  manualGroupingMode: boolean,
): PlayingHandTapMode => {
  if (actionPending || state.finishedPlayers.includes(humanId)) return 'blocked'
  if (manualGroupingMode || state.currentTurn !== humanId) return 'grouping'
  return 'play'
}
