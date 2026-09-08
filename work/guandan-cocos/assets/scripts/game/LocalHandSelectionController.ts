import { diagnosePlay, getPlayInfo, rankHintMoves } from '../core/generated'
import type { Card, EngineState, HintProtectedGroup, HintRequest, MatchState, PlayerId, PlayValidation, RankedHintMove, TributeState } from '../core/generated'
import { canSelectPlayingHand } from './HandInteractionPolicy'

export type LocalHandSelectionContext = Readonly<{
  state: EngineState & Partial<Pick<MatchState, 'roundId' | 'revision'>>
  humanId: PlayerId
  actionPending: boolean
  phase: 'playing' | 'tribute' | 'settlement'
  tribute: TributeState | null
}>

const playTypeNames: Readonly<Record<string, string>> = {
  Single: '单牌', Pair: '对子', Triple: '三张', Straight: '顺子', TripleWithPair: '三带二',
  Tube: '三连对', Plate: '钢板', StraightFlush: '同花顺', Bomb: '炸弹', Rocket: '天王炸', Pass: '不要',
}

export const playValidationHint = (validation: PlayValidation): string => {
  const typeName = validation.resolution ? (playTypeNames[validation.resolution.type] ?? validation.resolution.type) : ''
  switch (validation.code) {
    case 'valid': return `可出 · ${typeName}`
    case 'empty': return '请选择手牌'
    case 'invalid-combination': return '牌型不合法'
    case 'type-mismatch': return '牌型不匹配，需同牌型或炸弹'
    case 'card-count-mismatch': return '张数不匹配，需同牌型同张数'
    case 'not-high-enough': return '点数压不过'
    case 'requires-bomb': return '压不过，需要更大的炸弹'
    case 'bomb-too-small': return '炸弹不够大'
    case 'rocket-unbeatable': return '天王炸无法压过'
  }
}

/** Owns playable hand selection and hint cycling independently from Cocos nodes. */
export class LocalHandSelectionController {
  public readonly selectedCardIds = new Set<string>()
  private hintIndex = 0
  private hintSignature = ''
  private hintChoices: readonly RankedHintMove[] = []

  public constructor (
    private readonly rankHints: (request: HintRequest) => readonly RankedHintMove[] = rankHintMoves,
  ) {}

  public clear (): void { this.selectedCardIds.clear() }

  public replace (cardIds: readonly string[]): void {
    this.selectedCardIds.clear()
    cardIds.forEach(cardId => this.selectedCardIds.add(cardId))
  }

  public selectedCards (state: EngineState, humanId: PlayerId): Card[] {
    return state.players[humanId].hand.filter(card => this.selectedCardIds.has(card.id))
  }

  public toggle (cardId: string, context: LocalHandSelectionContext): string {
    const blocked = this.blockedHint(context)
    if (blocked !== null) return blocked
    if (!context.state.players[context.humanId].hand.some(card => card.id === cardId)) {
      this.selectedCardIds.delete(cardId)
      return '手牌已更新，请重新选择'
    }
    if (this.selectedCardIds.has(cardId)) this.selectedCardIds.delete(cardId)
    else {
      if (context.phase === 'tribute') this.clear()
      this.selectedCardIds.add(cardId)
    }
    return this.selectionHint(context)
  }

  public replaceFromInput (cardIds: readonly string[], context: LocalHandSelectionContext): string {
    const blocked = this.blockedHint(context)
    if (blocked !== null) return blocked
    const requested = Array.from(new Set(cardIds))
    const handIds = new Set(context.state.players[context.humanId].hand.map(card => card.id))
    if (requested.some(cardId => !handIds.has(cardId))) {
      this.clear()
      return '手牌已更新，请重新选择'
    }
    if (context.phase === 'tribute' && requested.length > 1) return '进贡或还贡只能选择一张牌'
    this.replace(requested)
    return this.selectionHint(context)
  }

  public hint (
    context: LocalHandSelectionContext,
    protectedGroups: readonly HintProtectedGroup[] = [],
  ): string | null {
    if (context.actionPending || context.phase !== 'playing' || context.state.currentTurn !== context.humanId) return null
    const signature = this.createHintSignature(context, protectedGroups)
    if (signature !== this.hintSignature) {
      this.hintSignature = signature
      this.hintIndex = 0
      this.hintChoices = this.rankHints({
        hand: context.state.players[context.humanId].hand,
        lastPlay: context.state.lastValidPlay,
        ruleProfile: context.state.ruleProfile,
        protectedGroups,
      })
    }
    const choices = this.hintChoices
    if (!choices.length) return '没有可用提示，请选择不要'
    const choice = choices[this.hintIndex++ % choices.length]
    const cards = [...choice.cards]
    this.replace(cards.map(card => card.id))
    const validation = diagnosePlay(cards, context.state.lastValidPlay, context.state.ruleProfile)
    const info = validation.resolution ?? getPlayInfo(cards, context.state.ruleProfile)
    if (choice.warning === 'splits-locked-group') return '没有其他合法牌，将拆锁牌组'
    return info ? `提示：${playTypeNames[info.type] ?? info.type} · 可出` : playValidationHint(validation)
  }

  private createHintSignature (
    context: LocalHandSelectionContext,
    protectedGroups: readonly HintProtectedGroup[],
  ): string {
    const state = context.state
    const lastPlay = state.lastValidPlay
    const profile = state.ruleProfile
    const groupKey = protectedGroups
      .map(group => `${group.id}:${group.kind}:${[...group.cardIds].sort().join(',')}`)
      .sort()
      .join('|')
    return [
      state.roundId ?? 0,
      state.revision ?? state.playArea.length,
      state.currentTurn,
      state.finishedPlayers.join(','),
      state.players[context.humanId].hand.map(card => card.id).sort().join(','),
      lastPlay ? `${lastPlay.type}:${lastPlay.cards.map(card => card.id).sort().join(',')}` : 'lead',
      `${Number(profile.allowA2345Straight)}${Number(profile.straightFlushAsBomb)}${Number(profile.enableTripleWithPair)}`,
      groupKey,
    ].join(';')
  }

  private blockedHint (context: LocalHandSelectionContext): string | null {
    if (context.actionPending) return ''
    if (context.phase !== 'playing' && context.phase !== 'tribute') return '当前不能选择手牌'
    if (context.phase === 'playing' && !canSelectPlayingHand(context.state, context.humanId, context.actionPending)) {
      return ''
    }
    if (context.phase === 'tribute' && !this.canActInTribute(context)) return '当前等待其他玩家操作'
    return null
  }

  private selectionHint (context: LocalHandSelectionContext): string {
    const cards = this.selectedCards(context.state, context.humanId)
    if (context.phase === 'tribute') return cards.length === 1 ? '确认这张牌' : '请选择一张牌'
    if (context.state.currentTurn !== context.humanId) return ''
    return playValidationHint(diagnosePlay(cards, context.state.lastValidPlay, context.state.ruleProfile))
  }

  private canActInTribute (context: LocalHandSelectionContext): boolean {
    const tribute = context.tribute
    if (!tribute || tribute.isAntiTribute || tribute.phase === 'done') return false
    return tribute.phase === 'tributing'
      ? tribute.actions.some(action => action.from === context.humanId && !action.card)
      : tribute.actions.some(action => action.to === context.humanId && !action.returnCard)
  }
}
