import type { Card } from '../core/generated'
import type { HandGroupingSnapshot } from './HandGrouping'
import type { HandInteractionMode } from './HandInteractionState'
import type { HandSortDirection, StraightFlushSuit } from './HandArrangement'
import type { HandLockDecision } from './HandWorkspace'
import type { HandStackGroup } from './HandStackLayout'
import { HandGroupPresentationCache } from './HandGroupPresentationCache'
export { resolveHandGroupBadge } from './HandGroupPresentationCache'

export type HandRenderModel = Readonly<{
  hand: Card[]
  interactionMode: HandInteractionMode
  playSelectedCardIds: string[]
  sortOrder: HandSortDirection
  interactive: boolean
  displayCardIds: string[]
  groups: Array<HandGroupingSnapshot['groups'][number] & HandStackGroup>
  lockedCardIds: string[]
  availableSuits: StraightFlushSuit[]
  selectedSuit: StraightFlushSuit | null
  lockDecision: HandLockDecision
  arrangeRestoreAvailable: boolean
}>

export const projectHandRenderModel = (input: Readonly<{
  hand: Card[]
  mode: HandInteractionMode
  playSelectedCardIds: readonly string[]
  sortOrder: HandSortDirection
  interactive: boolean
  grouping: HandGroupingSnapshot
  lockedCardIds: readonly string[]
  availableSuits: readonly StraightFlushSuit[]
  selectedSuit: StraightFlushSuit | null
  lockDecision: HandLockDecision
  arrangeRestoreAvailable: boolean
}>, presentation = new HandGroupPresentationCache()): HandRenderModel => ({
  hand: input.hand,
  interactionMode: input.mode,
  playSelectedCardIds: input.mode === 'play' || input.mode === 'tribute' ? [...input.playSelectedCardIds] : [],
  sortOrder: input.sortOrder,
  interactive: input.interactive,
  displayCardIds: input.grouping.displayCardIds,
  groups: presentation.project(input.hand, input.grouping),
  lockedCardIds: [...input.lockedCardIds],
  availableSuits: [...input.availableSuits],
  selectedSuit: input.selectedSuit,
  lockDecision: input.lockDecision,
  arrangeRestoreAvailable: input.arrangeRestoreAvailable,
})
