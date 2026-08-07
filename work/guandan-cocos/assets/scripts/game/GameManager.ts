import { _decorator, Component } from 'cc'
import { createGame, createTribute, dealNextRound, diagnosePlay, getPlayInfo, getPossiblePlays, giveTribute, highestCard, isRoundOver, lowestCard, makeDecision, passTurn, playCards, returnTribute, settle, tributeLeader } from '../core/generated'
import type { Card, EngineState, PlayerId, PlayValidation, Rank, SettlementResult, Team, TributeState } from '../core/generated'
import { APPLICATION_AI_DIFFICULTY, GameSession } from '../session/GameSession'
import { CocosAudioController } from '../audio/CocosAudioController'
import { LobbyController, type LobbyNetworkResult } from '../network/LobbyController'
import { canSelectPlayingHand } from './HandInteractionPolicy'

export type GameSnapshot = {
  state: EngineState
  selectedCardIds: string[]
  actionPending: boolean
  hint: string
  playValidation: PlayValidation
  phase: 'playing' | 'tribute' | 'settlement'
  teamLevels: Record<Team, Rank>
  scores: Record<Team, number>
  tribute: TributeState | null
  settlement: SettlementResult | null
}

const playTypeNames: Record<string, string> = {
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

const { ccclass, property } = _decorator

/**
 * Cocos side's single source of interactive round state.  Network clients
 * replace `state` only with snapshots validated by the server.
 */
@ccclass('GameManager')
export class GameManager extends Component {
  @property(GameSession)
  public session: GameSession | null = null

  @property(CocosAudioController)
  public audio: CocosAudioController | null = null

  @property(LobbyController)
  public lobby: LobbyController | null = null
  public state!: EngineState
  public selectedCardIds = new Set<string>()
  public phase: 'playing' | 'tribute' | 'settlement' = 'playing'
  public teamLevels: Record<Team, Rank> = { teamA: 2, teamB: 2 }
  public aFailStreaks: Record<Team, number> = { teamA: 0, teamB: 0 }
  public scores: Record<Team, number> = { teamA: 0, teamB: 0 }
  public lastRoundRank: PlayerId[] = []
  public tribute: TributeState | null = null
  public settlement: SettlementResult | null = null
  public actionPending = false
  private hintIndex = 0
  private aiTurnToken = 0
  private networkActionToken = 0
  private activeNetworkRequestId: number | null = null
  private activeNetworkRequestType: string | null = null
  private developmentFixtureActive = false

  public startRound (dealer?: PlayerId): void {
    this.developmentFixtureActive = false
    this.aiTurnToken += 1
    const session = this.session ?? this.getComponent(GameSession)
    const level = session?.snapshot.currentLevel ?? 2
    const roundDealer = dealer ?? session?.snapshot.dealerId ?? 'p1'
    this.state = createGame(level, roundDealer)
    this.selectedCardIds.clear()
    this.networkActionToken += 1
    this.actionPending = false
    this.clearActiveNetworkRequest()
    this.phase = 'playing'
    this.teamLevels = session?.snapshot.teamLevels ?? { teamA: 2, teamB: 2 }
    this.aFailStreaks = { teamA: 0, teamB: 0 }
    this.scores = { teamA: 0, teamB: 0 }
    this.lastRoundRank = []
    this.tribute = null
    this.settlement = null
    this.audio?.playRoundStart()
    session?.beginPlay()
    this.emitSnapshot(this.state.currentTurn === this.humanId ? '新对局开始，轮到你出牌' : '新对局开始，电脑正在思考…')
    if (this.state.currentTurn !== this.humanId) this.runNextAiTurn()
  }

  public toggleCard (cardId: string): void {
    if (this.actionPending) return this.emitSnapshot('正在等待服务器确认')
    if (this.phase !== 'playing' && this.phase !== 'tribute') return this.emitSnapshot('当前不能选择手牌')
    if (this.phase === 'playing' && !canSelectPlayingHand(this.state, this.humanId, this.actionPending)) {
      return this.emitSnapshot('请等待其他玩家出牌')
    }
    if (this.phase === 'tribute' && !this.canHumanActInTribute()) return this.emitSnapshot('当前等待其他玩家操作')
    if (!this.state.players[this.humanId].hand.some(card => card.id === cardId)) {
      this.selectedCardIds.delete(cardId)
      return this.emitSnapshot('手牌已更新，请重新选择')
    }
    if (this.selectedCardIds.has(cardId)) {
      this.selectedCardIds.delete(cardId)
    } else {
      if (this.phase === 'tribute') this.selectedCardIds.clear()
      this.selectedCardIds.add(cardId)
    }
    const cards = this.selectedCards()
    if (this.phase === 'tribute') {
      this.emitSnapshot(cards.length === 1 ? '确认这张牌' : '进贡或还贡只能选择一张牌')
      return
    }
    this.emitSnapshot(playValidationHint(diagnosePlay(cards, this.state.lastValidPlay)))
  }

  /** Replaces the current choice in one snapshot, used by locked hand stacks. */
  public replaceSelectedCards (cardIds: readonly string[]): void {
    if (this.actionPending) return this.emitSnapshot('正在等待服务器确认')
    if (this.phase !== 'playing' && this.phase !== 'tribute') return this.emitSnapshot('当前不能选择手牌')
    if (this.phase === 'playing' && !canSelectPlayingHand(this.state, this.humanId, this.actionPending)) {
      return this.emitSnapshot('请等待其他玩家出牌')
    }
    if (this.phase === 'tribute' && !this.canHumanActInTribute()) return this.emitSnapshot('当前等待其他玩家操作')

    const requested = Array.from(new Set(cardIds))
    const handIds = new Set(this.state.players[this.humanId].hand.map(card => card.id))
    if (requested.some(cardId => !handIds.has(cardId))) {
      this.selectedCardIds.clear()
      return this.emitSnapshot('手牌已更新，请重新选择')
    }
    if (this.phase === 'tribute' && requested.length > 1) {
      return this.emitSnapshot('进贡或还贡只能选择一张牌')
    }

    this.selectedCardIds = new Set(requested)
    const cards = this.selectedCards()
    if (this.phase === 'tribute') {
      this.emitSnapshot(cards.length === 1 ? '确认这张牌' : '请选择一张牌')
      return
    }
    this.emitSnapshot(playValidationHint(diagnosePlay(cards, this.state.lastValidPlay)))
  }

  public playSelected (): void {
    if (this.actionPending || this.phase !== 'playing' || this.state.currentTurn !== this.humanId) return
    const cards = this.selectedCards()
    const validation = diagnosePlay(cards, this.state.lastValidPlay)
    if (!validation.canPlay) return this.emitSnapshot(playValidationHint(validation))
    if (this.session?.snapshot.isMultiplayer) {
      this.beginNetworkAction('正在等待服务器确认出牌…', 'play', () => this.lobby?.play(cards.map(card => card.id)) ?? null)
      return
    }
    try {
      this.state = playCards(this.state, this.humanId, cards)
      this.selectedCardIds.clear()
      this.finishHumanAction()
    } catch (error) {
      this.emitSnapshot(error instanceof Error ? error.message : '出牌失败')
    }
  }

  public pass (): void {
    if (this.actionPending || this.phase !== 'playing' || this.state.currentTurn !== this.humanId) return
    if (this.session?.snapshot.isMultiplayer) {
      if (!this.state.lastValidPlay) return this.emitSnapshot('当前不能不要')
      this.beginNetworkAction('正在等待服务器确认不要…', 'pass', () => this.lobby?.pass() ?? null)
      return
    }
    try {
      this.state = passTurn(this.state, this.humanId)
      this.selectedCardIds.clear()
      this.audio?.playPass()
      this.finishHumanAction()
    } catch (error) {
      this.emitSnapshot(error instanceof Error ? error.message : '当前不能不要')
    }
  }

  /** Cycles legal human plays, preserving the desktop HandArea hint behavior. */
  public hint (): void {
    if (this.actionPending || this.phase !== 'playing' || this.state.currentTurn !== this.humanId) return
    const choices = getPossiblePlays(this.state.players[this.humanId].hand, this.state.lastValidPlay, APPLICATION_AI_DIFFICULTY)
    if (!choices.length) return this.emitSnapshot('没有可用提示，请选择不要')
    const choice = choices[this.hintIndex++ % choices.length]
    this.selectedCardIds = new Set(choice.map(card => card.id))
    const validation = diagnosePlay(choice, this.state.lastValidPlay)
    const info = validation.resolution ?? getPlayInfo(choice)
    this.emitSnapshot(info ? `提示：${playTypeNames[info.type] ?? info.type} · 可出` : playValidationHint(validation))
  }

  /** Clears a live rule selection when switching into a presentation-only grouping mode. */
  public clearRuleSelection (): void {
    if (this.actionPending) return
    this.selectedCardIds.clear()
    this.emitSnapshot('')
  }

  /** Stops delayed local actions before leaving the table. */
  public abortRound (): void {
    this.aiTurnToken += 1
    this.unscheduleAllCallbacks()
    this.selectedCardIds.clear()
    this.networkActionToken += 1
    this.actionPending = false
    this.clearActiveNetworkRequest()
    this.developmentFixtureActive = false
  }

  /** Development-only caller entry: fixed scenarios never write local progression or stats. */
  public applyDevelopmentFixtureState (state: EngineState, label: string): void {
    this.aiTurnToken += 1
    this.session?.beginLocalGame('standard')
    this.state = state
    this.selectedCardIds.clear()
    this.networkActionToken += 1
    this.actionPending = false
    this.clearActiveNetworkRequest()
    this.phase = 'playing'
    this.teamLevels = { teamA: state.currentLevel, teamB: state.currentLevel }
    this.aFailStreaks = { teamA: 0, teamB: 0 }
    this.scores = { teamA: 0, teamB: 0 }
    this.lastRoundRank = []
    this.tribute = null
    this.settlement = null
    this.developmentFixtureActive = true
    this.session?.beginPlay()
    this.emitSnapshot(`固定测试牌局：${label}`)
  }

  /** Called by the WebSocket adapter after service-authoritative state sync. */
  public applyServerState (state: EngineState, hint = '已同步服务器状态'): void {
    this.developmentFixtureActive = false
    this.aiTurnToken += 1
    this.state = state
    // A server snapshot is a turn boundary or a recovery snapshot. Keeping a
    // selection by card id can resurrect a choice from the previous turn when
    // a reconnect happens to return control to the same player.
    this.selectedCardIds.clear()
    this.networkActionToken += 1
    this.actionPending = false
    this.clearActiveNetworkRequest()
    this.phase = 'playing'
    this.tribute = null
    this.settlement = null
    this.session?.beginPlay()
    this.emitSnapshot(hint)
  }

  public applyNetworkRoundPrepared (state: EngineState, tribute: TributeState | null): void {
    this.developmentFixtureActive = false
    this.aiTurnToken += 1
    this.state = state
    this.tribute = tribute
    this.phase = tribute ? 'tribute' : 'playing'
    this.settlement = null
    this.networkActionToken += 1
    this.actionPending = false
    this.clearActiveNetworkRequest()
    this.selectedCardIds.clear()
    if (tribute) this.session?.beginTribute()
    else this.session?.beginPlay()
    this.emitSnapshot(tribute ? (tribute.isAntiTribute ? '抗贡成立，等待开始本局' : '请完成进贡与还贡') : '本局开始')
  }

  public applyNetworkRoundEnded (result: SettlementResult): void {
    this.developmentFixtureActive = false
    this.aiTurnToken += 1
    this.teamLevels = result.teamLevels
    this.aFailStreaks = result.aFailStreaks
    this.lastRoundRank = result.fullRank
    this.scores = { ...this.scores, [result.winnerTeam]: this.scores[result.winnerTeam] + result.levelUp }
    this.settlement = result
    this.phase = 'settlement'
    this.selectedCardIds.clear()
    this.networkActionToken += 1
    this.actionPending = false
    this.clearActiveNetworkRequest()
    this.session?.setRoundLevels(result.teamLevels, result.currentLevel)
    this.session?.recordRound(result.winnerTeam, result.fullRank[0] === this.humanId, 0, { levelUp: result.levelUp, currentLevel: result.currentLevel, teamLevels: result.teamLevels, scores: this.scores })
    this.session?.beginSettlement()
    this.emitSnapshot(result.message)
  }

  public nextRound (): void {
    if (this.actionPending || this.phase !== 'settlement' || !this.settlement) return
    if (this.session?.snapshot.isMultiplayer) {
      if (this.settlement.isGameWon) return this.emitSnapshot('本场已结束，请返回大厅重新开局')
      const requestId = this.lobby?.readyNextRound() ?? null
      this.emitSnapshot(requestId === null ? '准备请求发送失败，请检查网络' : '已准备，等待其他玩家')
      return
    }
    if (this.settlement.isGameWon) {
      this.startRound()
      return
    }
    const dealer = this.lastRoundRank[0] ?? 'p1'
    this.state = dealNextRound(this.state, this.settlement.currentLevel, dealer)
    this.audio?.playRoundStart()
    this.tribute = createTribute(this.state, this.lastRoundRank)
    this.settlement = null
    this.selectedCardIds.clear()
    if (!this.tribute) {
      this.phase = 'playing'
      this.session?.beginPlay()
      this.finishHumanAction()
      return
    }
    this.phase = 'tribute'
    this.session?.beginTribute()
    this.runTributeAi()
    this.emitSnapshot(this.tribute.isAntiTribute ? '抗贡成立，请开始本局' : '请完成进贡与还贡')
  }

  public confirmTribute (): void {
    if (this.actionPending || this.phase !== 'tribute' || !this.tribute || this.tribute.isAntiTribute) return
    try {
      const cards = this.selectedCards()
      if (cards.length !== 1) throw new Error('请选择一张牌')
      const action = this.tribute.phase === 'tributing'
        ? this.tribute.actions.find(item => item.from === this.humanId && !item.card)
        : this.tribute.actions.find(item => item.to === this.humanId && !item.returnCard)
      if (!action) throw new Error('当前等待其他玩家操作')
      if (this.session?.snapshot.isMultiplayer) {
        const requestType = this.tribute.phase === 'tributing' ? 'tribute' : 'returnTribute'
        const hint = this.tribute.phase === 'tributing' ? '正在等待服务器确认进贡…' : '正在等待服务器确认还贡…'
        this.beginNetworkAction(hint, requestType, () => requestType === 'tribute'
          ? this.lobby?.tribute(cards[0].id) ?? null
          : this.lobby?.returnTribute(cards[0].id) ?? null)
        return
      }
      const result = this.tribute.phase === 'tributing'
        ? giveTribute(this.state, this.tribute, this.humanId, cards[0].id)
        : returnTribute(this.state, this.tribute, this.humanId, cards[0].id)
      this.state = result.state
      this.tribute = result.tribute
      this.selectedCardIds.clear()
      this.runTributeAi()
      this.emitSnapshot(this.tribute.phase === 'done' ? '贡还完成，请开始本局' : '等待下一步贡还')
    } catch (error) {
      this.emitSnapshot(error instanceof Error ? error.message : '贡还失败')
    }
  }

  public finishTribute (): void {
    if (this.actionPending || this.phase !== 'tribute' || !this.tribute || (!this.tribute.isAntiTribute && this.tribute.phase !== 'done')) return
    if (this.session?.snapshot.isMultiplayer) {
      this.beginNetworkAction('正在等待服务器开始本局…', 'finishTribute', () => this.lobby?.finishTribute() ?? null)
      return
    }
    this.state = { ...this.state, currentTurn: tributeLeader(this.tribute, this.lastRoundRank, this.lastRoundRank[0] ?? 'p1'), lastValidPlay: null }
    this.tribute = null
    this.phase = 'playing'
    this.session?.beginPlay()
    this.selectedCardIds.clear()
    this.finishHumanAction()
  }

  /** Restores interaction after a rejected or failed network intent. */
  public applyNetworkError (message: string): void {
    this.networkActionToken += 1
    this.actionPending = false
    this.clearActiveNetworkRequest()
    this.emitSnapshot(message || '网络操作失败，请重试')
  }

  /** Only the rejection matching the active request may unlock its UI. */
  public applyNetworkResult (result: LobbyNetworkResult): void {
    if (!this.actionPending || result.ok) return
    const sameType = result.requestType === this.activeNetworkRequestType
    const sameRequest = this.activeNetworkRequestId === null
      ? result.requestId === null && sameType
      : result.requestId === this.activeNetworkRequestId
    if (sameRequest) this.applyNetworkError(result.message || '服务器拒绝了操作，请重试')
  }

  /** Applies the default 20-second timeout policy without duplicating UI logic. */
  public actOnTimeout (): void {
    if (this.actionPending || this.phase !== 'playing' || this.state.currentTurn !== this.humanId) return
    if (this.state.lastValidPlay) {
      this.pass()
      return
    }
    const choice = getPossiblePlays(this.state.players[this.humanId].hand, null, APPLICATION_AI_DIFFICULTY)[0]
    if (!choice?.length) return this.emitSnapshot('没有可自动出的牌，请返回大厅重开')
    this.selectedCardIds = new Set(choice.map(card => card.id))
    this.playSelected()
  }

  private selectedCards (): Card[] {
    return this.state.players[this.humanId].hand.filter(card => this.selectedCardIds.has(card.id))
  }

  private canHumanActInTribute (): boolean {
    if (!this.tribute || this.tribute.isAntiTribute || this.tribute.phase === 'done') return false
    return this.tribute.phase === 'tributing'
      ? this.tribute.actions.some(action => action.from === this.humanId && !action.card)
      : this.tribute.actions.some(action => action.to === this.humanId && !action.returnCard)
  }

  private beginNetworkAction (hint: string, requestType: string, submit: () => number | null): boolean {
    if (!this.lobby?.snapshot.connected || !this.lobby.snapshot.roomId || this.lobby.snapshot.roomStatus !== 'ready') {
      this.emitSnapshot(this.lobby?.snapshot.roomStatus === 'rejoining' ? '正在恢复房间，请稍后操作' : '网络未连接，请稍后重试')
      return false
    }
    this.actionPending = true
    const token = ++this.networkActionToken
    this.activeNetworkRequestType = requestType
    this.activeNetworkRequestId = null
    this.emitSnapshot(hint)
    const requestId = submit()
    if (requestId === null) {
      this.applyNetworkError('操作未发送，请检查网络后重试')
      return false
    }
    this.activeNetworkRequestId = requestId
    this.scheduleOnce(() => {
      if (this.actionPending && token === this.networkActionToken) this.applyNetworkError('服务器响应超时，请重试')
    }, 8)
    return true
  }

  private clearActiveNetworkRequest (): void {
    this.activeNetworkRequestId = null
    this.activeNetworkRequestType = null
  }

  private finishHumanAction (): void {
    if (this.maybeSettle()) return
    this.runNextAiTurn()
  }

  /** One scheduled AI action at a time, matching the desktop game's visible thinking rhythm. */
  private runNextAiTurn (): void {
    if (this.session?.snapshot.isMultiplayer) return
    if (this.maybeSettle()) return
    if (this.state.currentTurn === this.humanId) {
      this.emitSnapshot('轮到你出牌')
      return
    }
    const token = ++this.aiTurnToken
    const aiId = this.state.currentTurn
    this.emitSnapshot(`${this.state.players[aiId].name} 正在思考…`)
    this.scheduleOnce(() => {
      if (token !== this.aiTurnToken || this.phase !== 'playing' || this.state.currentTurn !== aiId) return
      try {
        this.state = this.resolveAiAction(aiId)
      } catch (error) {
        this.emitSnapshot(error instanceof Error ? error.message : '电脑出牌失败')
        // A transient AI decision failure must not permanently strand the turn.
        this.scheduleOnce(() => {
          if (token === this.aiTurnToken && this.phase === 'playing' && this.state.currentTurn === aiId) this.runNextAiTurn()
        }, 0.25)
        return
      }
      if (this.maybeSettle()) return
      this.runNextAiTurn()
    }, 0.72)
  }

  private resolveAiAction (aiId: PlayerId): EngineState {
    const ai = this.state.players[aiId]
    const decision = makeDecision(ai.hand, this.state.lastValidPlay, APPLICATION_AI_DIFFICULTY, ai.team, this.state.players, aiId, { currentLevel: this.state.currentLevel, teamLevels: this.teamLevels, roundMeta: null })
    if (decision?.length && getPlayInfo(decision)) {
      try { return playCards(this.state, aiId, decision) } catch { /* fall through to a verified legal choice */ }
    }
    const legal = getPossiblePlays(ai.hand, this.state.lastValidPlay, APPLICATION_AI_DIFFICULTY)[0]
    if (legal?.length) return playCards(this.state, aiId, legal)
    if (this.state.lastValidPlay) {
      this.audio?.playPass()
      return passTurn(this.state, aiId)
    }
    const lowest = ai.hand.reduce<Card | null>((best, card) => !best || card.value < best.value ? card : best, null)
    if (!lowest) throw new Error('电脑手牌状态异常，请返回大厅重新开始')
    return playCards(this.state, aiId, [lowest])
  }

  private maybeSettle (): boolean {
    if (!isRoundOver(this.state)) return false
    const result = settle(this.state, this.teamLevels, this.aFailStreaks)
    if (!result) return false
    this.teamLevels = result.teamLevels
    this.aFailStreaks = result.aFailStreaks
    this.scores = { ...this.scores, [result.winnerTeam]: this.scores[result.winnerTeam] + result.levelUp }
    this.lastRoundRank = result.fullRank
    this.settlement = result
    this.phase = 'settlement'
    this.selectedCardIds.clear()
    if (!this.developmentFixtureActive) {
      this.session?.setRoundLevels(this.teamLevels, result.currentLevel)
      this.session?.recordRound(result.winnerTeam, result.fullRank[0] === this.humanId, this.state.playArea.filter(action => action.type === 'Bomb' || action.type === 'StraightFlush' || action.type === 'Rocket').length, { levelUp: result.levelUp, currentLevel: result.currentLevel, teamLevels: result.teamLevels, scores: this.scores })
    }
    this.session?.beginSettlement()
    this.emitSnapshot(result.message)
    return true
  }

  private runTributeAi (): void {
    if (!this.tribute || this.tribute.isAntiTribute) return
    if (this.tribute.phase === 'tributing') {
      this.tribute.actions.filter(action => this.state.players[action.from].isAI && !action.card).forEach(action => {
        const hand = this.state.players[action.from].hand
        const eligible = hand.filter(card => !(card.isLevelCard && card.suit === 'heart'))
        const result = giveTribute(this.state, this.tribute!, action.from, highestCard(eligible.length ? eligible : hand).id)
        this.state = result.state
        this.tribute = result.tribute
      })
    }
    if (this.tribute.phase === 'returning') {
      this.tribute.actions.filter(action => this.state.players[action.to].isAI && !action.returnCard).forEach(action => {
        const card = lowestCard(this.state.players[action.to].hand.filter(item => item.value <= 10))
        if (!card) throw new Error('电脑没有可还贡的牌')
        const result = returnTribute(this.state, this.tribute!, action.to, card.id)
        this.state = result.state
        this.tribute = result.tribute
      })
    }
  }

  private emitSnapshot (hint: string): void {
    const playValidation = diagnosePlay(this.phase === 'playing' ? this.selectedCards() : [], this.state.lastValidPlay)
    this.node.emit('guandan:state', {
      state: this.state,
      selectedCardIds: Array.from(this.selectedCardIds),
      actionPending: this.actionPending,
      hint,
      playValidation,
      phase: this.phase,
      teamLevels: this.teamLevels,
      scores: this.scores,
      tribute: this.tribute,
      settlement: this.settlement,
    } satisfies GameSnapshot)
  }

  private get humanId (): PlayerId { return this.session?.snapshot.myPlayerId ?? 'p1' }
}
