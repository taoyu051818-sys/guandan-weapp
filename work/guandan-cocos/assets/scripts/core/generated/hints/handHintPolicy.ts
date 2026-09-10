import { chooseTeamPlay } from '../ai/team/policy'
import { createSeededRandom } from '../ai/random'
import type { TeamObservation } from '../ai/team/types'
import { legalMoves, structuralLegalMoves } from '../lib/legalMoves'
import { getPlayInfo, resolvePlayForContext } from '../lib/rules'
import { PlayType, type Card } from '../types/game'
import type { HintDamage, HintProtectedGroup, HintRequest, RankedHintMove } from './model'

const partiallyUses = (moveIds: ReadonlySet<string>, group: HintProtectedGroup): boolean => {
  const usedCount = group.cardIds.reduce((count, cardId) => count + Number(moveIds.has(cardId)), 0)
  return usedCount > 0 && usedCount < group.cardIds.length
}

const countPartialGroups = (
  moveIds: ReadonlySet<string>,
  groups: readonly HintProtectedGroup[],
  kind: HintProtectedGroup['kind'],
): number => groups.reduce(
  (count, group) => count + Number(group.kind === kind && partiallyUses(moveIds, group)),
  0,
)

const calculateDamage = (
  cards: readonly Card[],
  request: HintRequest,
): HintDamage => {
  const moveIds = new Set(cards.map(card => card.id))
  const info = resolvePlayForContext([...cards], request.lastPlay, request.ruleProfile)
  const lastInfo = request.lastPlay?.resolution ??
    (request.lastPlay ? getPlayInfo(request.lastPlay.cards, request.ruleProfile) : null)
  const splitsLockedGroup = request.protectedGroups.some(
    group => group.kind === 'locked' && partiallyUses(moveIds, group),
  )
  const splitRocketCount = countPartialGroups(moveIds, request.protectedGroups, 'rocket')
  const splitBombCount = countPartialGroups(moveIds, request.protectedGroups, 'bomb')
  const splitStructuredCount = countPartialGroups(moveIds, request.protectedGroups, 'structured')
  const splitTripleCount = countPartialGroups(moveIds, request.protectedGroups, 'triple')
  const splitPairCount = countPartialGroups(moveIds, request.protectedGroups, 'pair')
  const usesRocket = info?.type === PlayType.Rocket
  const usesBomb = info?.type === PlayType.Bomb ||
    (info?.type === PlayType.StraightFlush && request.ruleProfile.straightFlushAsBomb)
  const wildcardCount = cards.reduce((count, card) => count + Number(card.isRedJoker === true), 0)
  const normalizedLeadValue = info && (
    info.type === PlayType.Bomb ||
    info.type === PlayType.Rocket ||
    info.type === PlayType.StraightFlush
  ) ? info.maxValue % 1_000 : info?.maxValue ?? 0
  const beatMargin = info && lastInfo && info.type === lastInfo.type
    ? Math.max(0, info.maxValue - lastInfo.maxValue)
    : request.lastPlay ? 0 : normalizedLeadValue
  return {
    splitsLockedGroup,
    splitRocketCount,
    splitBombCount,
    usesRocket,
    usesBomb,
    splitStructuredCount,
    splitTripleCount,
    splitPairCount,
    wildcardCount,
    beatMargin,
    score: 0, // populated with the highest-strength policy rank below
  }
}

/** Hints use the same team policy as trustees/bots. Locks are physical input
 * constraints, not a weaker difficulty or a second strategic ranking.
 */
export const rankHintMoves = (request: HintRequest): readonly RankedHintMove[] => {
  const hasLocks = request.protectedGroups.some(group => group.kind === 'locked')
  const moves = hasLocks ? legalMoves(request.hand, request.lastPlay, request.ruleProfile)
    : structuralLegalMoves([...request.hand], request.ruleProfile)
      .filter(cards => resolvePlayForContext(cards, request.lastPlay, request.ruleProfile))
  const candidates = moves.filter(cards => !calculateDamage(cards, request).splitsLockedGroup)
  if (!candidates.length) return []
  const self = request.observation?.self ?? 'p1'
  const team = request.observation?.team ?? 'teamA'
  const observation: TeamObservation = {
    self, team, order: ['p1', 'p2', 'p3', 'p4'],
    seats: [
      { id: 'p1', team: 'teamA', count: request.hand.length },
      { id: 'p2', team: 'teamB', count: 27 },
      { id: 'p3', team: 'teamA', count: 27 },
      { id: 'p4', team: 'teamB', count: 27 },
    ],
    history: request.lastPlay ? [request.lastPlay] : [], historyComplete: false,
    level: request.hand.find(card => card.isLevelCard)?.rank ?? 2, finishedPlayers: [],
    ...request.observation,
    hand: [...request.hand], lastPlay: request.lastPlay, profile: request.ruleProfile,
  }
  const seed = request.seed ?? [...request.hand.map(card => card.id).sort().join(',')]
    .reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619), 2166136261)
  const decision = chooseTeamPlay(observation, candidates,
    () => structuralLegalMoves([...request.hand], request.ruleProfile), createSeededRandom(seed))
  return decision.ranked.map((cards, index) => ({
    cards, damage: { ...calculateDamage(cards, request), score: index }, warning: null,
  }))
}
