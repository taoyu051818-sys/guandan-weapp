import { legalMoves } from '../lib/legalMoves'
import { getPlayInfo, resolvePlayForContext } from '../lib/rules'
import { PlayType, type Card } from '../types/game'
import type { HintDamage, HintProtectedGroup, HintRequest, RankedHintMove } from './model'

const DAMAGE_WEIGHT = Object.freeze({
  splitRocket: 10_000,
  splitBomb: 5_000,
  useRocket: 3_500,
  useBomb: 2_500,
  splitStructured: 800,
  splitTriple: 300,
  splitPair: 100,
  wildcard: 20,
})

const cardsKey = (cards: readonly Card[]): string => cards.map(card => card.id).sort().join(',')

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
  const score =
    splitRocketCount * DAMAGE_WEIGHT.splitRocket +
    splitBombCount * DAMAGE_WEIGHT.splitBomb +
    Number(usesRocket) * DAMAGE_WEIGHT.useRocket +
    Number(usesBomb) * DAMAGE_WEIGHT.useBomb +
    splitStructuredCount * DAMAGE_WEIGHT.splitStructured +
    splitTripleCount * DAMAGE_WEIGHT.splitTriple +
    splitPairCount * DAMAGE_WEIGHT.splitPair +
    wildcardCount * DAMAGE_WEIGHT.wildcard +
    beatMargin
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
    score,
  }
}

/**
 * Ranks legal physical moves without changing legality. Partial locked-group
 * moves are excluded whenever any intact-lock alternative exists.
 */
export const rankHintMoves = (request: HintRequest): readonly RankedHintMove[] => {
  const ranked = legalMoves(request.hand, request.lastPlay, request.ruleProfile).map(cards => {
    const damage = calculateDamage(cards, request)
    return {
      cards,
      damage,
      warning: damage.splitsLockedGroup ? 'splits-locked-group' as const : null,
    }
  })
  const intactLockMoves = ranked.filter(move => !move.damage.splitsLockedGroup)
  const candidates = intactLockMoves.length > 0 ? intactLockMoves : ranked
  return candidates.sort((left, right) =>
    left.damage.score - right.damage.score ||
    left.cards.length - right.cards.length ||
    cardsKey(left.cards).localeCompare(cardsKey(right.cards)))
}
