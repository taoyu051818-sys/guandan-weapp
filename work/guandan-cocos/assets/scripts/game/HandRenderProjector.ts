import type { Card } from '../core/generated'
import type { HandGroupingSnapshot } from './HandGrouping'
import type { HandInteractionMode } from './HandInteractionState'
import type { HandSortDirection, StraightFlushSuit } from './HandArrangement'
import type { HandWorkspaceLockAction } from './HandWorkspace'

export type HandRenderModel = Readonly<{
  hand: Card[]
  interactionMode: HandInteractionMode
  playSelectedCardIds: string[]
  lockDraftCardIds: string[]
  sortOrder: HandSortDirection
  interactive: boolean
  displayCardIds: string[]
  groups: HandGroupingSnapshot['groups']
  lockedCardIds: string[]
  availableSuits: StraightFlushSuit[]
  selectedSuit: StraightFlushSuit | null
  lockAction: HandWorkspaceLockAction
  arrangeRestoreAvailable: boolean
}>

export const projectHandRenderModel = (input: Readonly<{
  hand: Card[]
  mode: HandInteractionMode
  playSelectedCardIds: readonly string[]
  lockDraftCardIds: readonly string[]
  sortOrder: HandSortDirection
  interactive: boolean
  grouping: HandGroupingSnapshot
  lockedCardIds: readonly string[]
  availableSuits: readonly StraightFlushSuit[]
  selectedSuit: StraightFlushSuit | null
  lockAction: HandWorkspaceLockAction
  arrangeRestoreAvailable: boolean
}>): HandRenderModel => ({
  hand: input.hand,
  interactionMode: input.mode,
  playSelectedCardIds: input.mode === 'play' || input.mode === 'tribute' ? [...input.playSelectedCardIds] : [],
  lockDraftCardIds: input.mode === 'lock-create' || input.mode === 'lock-unlock' ? [...input.lockDraftCardIds] : [],
  sortOrder: input.sortOrder,
  interactive: input.interactive,
  displayCardIds: input.grouping.displayCardIds,
  groups: input.grouping.groups,
  lockedCardIds: [...input.lockedCardIds],
  availableSuits: [...input.availableSuits],
  selectedSuit: input.selectedSuit,
  lockAction: input.lockAction,
  arrangeRestoreAvailable: input.arrangeRestoreAvailable,
})
