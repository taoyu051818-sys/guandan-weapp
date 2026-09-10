import {
  getPlayInfo,
  PlayType,
  type Card,
  type HintProtectedGroup,
  type PlayerId,
  type RuleProfile,
} from '../core/generated'
import type { HandGroupingSnapshot } from './HandGrouping'
import { resolveHandCapabilities } from './HandInteractionPolicy'
import type { HandWorkspace } from './HandWorkspace'

const classifyGroup = (
  cards: Card[],
  kind: HandGroupingSnapshot['groups'][number]['kind'],
  ruleProfile: RuleProfile,
): HintProtectedGroup['kind'] | null => {
  if (kind === 'king-bomb') return 'rocket'
  if (kind === 'bomb') return 'bomb'
  if (kind === 'straight-flush' || kind === 'plate' || kind === 'tube' || kind === 'triple-with-pair') {
    return 'structured'
  }
  const info = getPlayInfo(cards, ruleProfile)
  if (!info) return null
  if (info.type === PlayType.Rocket) return 'rocket'
  if (info.type === PlayType.Bomb) return 'bomb'
  if (info.type === PlayType.Pair) return 'pair'
  if (info.type === PlayType.Triple) return 'triple'
  if (info.type === PlayType.Single || info.type === PlayType.Pass) return null
  return 'structured'
}

/** Converts the current disjoint hand presentation into UI-agnostic hint protection groups. */
export const projectHintProtectedGroups = (
  hand: readonly Card[],
  groups: HandGroupingSnapshot['groups'],
  ruleProfile: RuleProfile,
): HintProtectedGroup[] => {
  const cardsById = new Map(hand.map(card => [card.id, card]))
  return groups.flatMap(group => {
    const cards = group.cardIds.map(cardId => cardsById.get(cardId)).filter((card): card is Card => Boolean(card))
    if (cards.length < 2) return []
    const kind = group.locked ? 'locked' : classifyGroup(cards, group.kind, ruleProfile)
    if (!kind) return []
    const projected: HintProtectedGroup = {
      id: group.id,
      kind,
      cardIds: cards.map(card => card.id),
    }
    return [projected]
  })
}

type HandHintSnapshot = Readonly<{
  phase: 'playing' | 'tribute' | 'settlement'
  actionPending: boolean
  state: Readonly<{
    players: Record<PlayerId, { hand: Card[] }>
    currentTurn: PlayerId
    finishedPlayers: PlayerId[]
  }>
}>

/** Keeps hint eligibility and presentation projection outside the scene/controller. */
export const requestTableHandHint = (
  snapshot: HandHintSnapshot | null,
  humanId: PlayerId,
  settings: Readonly<{ trustee: boolean, ruleProfile: RuleProfile }>,
  workspace: HandWorkspace,
  submit: (groups: readonly HintProtectedGroup[]) => void,
): void => {
  if (!snapshot || !resolveHandCapabilities(snapshot, humanId, settings).canHint) return
  submit(projectHintProtectedGroups(snapshot.state.players[humanId].hand, workspace.snapshot.groups, settings.ruleProfile))
}
