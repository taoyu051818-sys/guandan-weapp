/**
 * Stable hand-arrangement facade. Keep callers on this module while the pure
 * model, display ordering, and suggestion discovery evolve independently.
 */
export {
  DEFAULT_HAND_ARRANGEMENT,
  DEFAULT_HAND_SUGGESTIONS,
  STRAIGHT_FLUSH_SUITS,
  arrangeHandCardIds,
  assertUniqueCardIds,
  compareCardsForArrangement,
  getArrangementRankValue,
  getPhysicalRankValue,
  isHeartLevelWildcard,
  normalizeHandArrangementOptions,
  reconcileCardIdOrder,
} from './HandArrangementModel'
export type {
  CardId,
  HandArrangementOptions,
  HandDisplayUnit,
  HandGroupKind,
  HandGroupOrigin,
  HandGroupSuggestion,
  HandLayoutMode,
  HandSortDirection,
  HandSortMode,
  HandSuggestionOptions,
  LevelCardPlacement,
  StraightFlushSuit,
  StraightFlushSuitAvailability,
  SuggestedWildcardUsage,
} from './HandArrangementModel'

export { arrangeHandGroupCardIds, sortHandDisplayUnits } from './HandDisplayOrdering'
export {
  getStraightFlushSuitAvailability,
  recognizeHandGroup,
  selectNonOverlappingSuggestions,
  selectStraightFlushForSuit,
  suggestHandGroups,
  suggestStraightFlushGroups,
} from './HandGroupSuggestions'
