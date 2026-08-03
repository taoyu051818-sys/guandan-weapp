import { _decorator, Component } from 'cc'
import { createGame, createTribute, dealNextRound, getPlayInfo, getPossiblePlays, giveTribute, highestCard, isRoundOver, lowestCard, passTurn, playCards, returnTribute, runAiTurns, settle, tributeLeader } from '../core/generated'
import type { Card, EngineState, PlayerId, Rank, SettlementResult, Team, TributeState } from '../core/generated'
import { GameSession } from '../session/GameSession'
import { CocosAudioController } from '../audio/CocosAudioController'
import { LobbyController } from '../network/LobbyController'

export type GameSnapshot = {
  state: EngineState
  selectedCardIds: string[]
  hint: string
  phase: 'playing' | 'tribute' | 'settlement'
  teamLevels: Record<Team, Rank>
  scores: Record<Team, number>
  tribute: TributeState | null
  settlement: SettlementResult | null
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
  private hintIndex = 0

  public startRound (dealer?: PlayerId): void {
    const session = this.session ?? this.getComponent(GameSession)
    const level = session?.snapshot.currentLevel ?? 2
    const roundDealer = dealer ?? session?.snapshot.dealerId ?? 'p1'
    this.state = createGame(level, roundDealer)
    this.selectedCardIds.clear()
    this.phase = 'playing'
    this.teamLevels = session?.snapshot.teamLevels ?? { teamA: 2, teamB: 2 }
    this.aFailStreaks = { teamA: 0, teamB: 0 }
    this.scores = { teamA: 0, teamB: 0 }
    this.lastRoundRank = []
    this.tribute = null
    this.settlement = null
    session?.beginPlay()
    this.emitSnapshot('新对局开始，轮到你出牌')
  }

  public toggleCard (cardId: string): void {
    if (this.phase !== 'playing' && this.phase !== 'tribute') return
    if (this.phase === 'playing' && (this.state.currentTurn !== this.humanId || this.state.finishedPlayers.length > 0)) return
    if (this.selectedCardIds.has(cardId)) this.selectedCardIds.delete(cardId)
    else this.selectedCardIds.add(cardId)
    const cards = this.selectedCards()
    if (this.phase === 'tribute') {
      this.emitSnapshot(cards.length === 1 ? '确认这张牌' : '进贡或还贡只能选择一张牌')
      return
    }
    const info = cards.length ? getPlayInfo(cards) : null
    this.emitSnapshot(cards.length ? (info ? `牌型：${info.type}` : '当前组合不符合掼蛋牌型') : '请选择手牌')
  }

  public playSelected (): void {
    if (this.phase !== 'playing' || this.state.currentTurn !== this.humanId) return
    const cards = this.selectedCards()
    if (this.session?.snapshot.isMultiplayer) {
      if (!cards.length) return this.emitSnapshot('请选择要出的牌')
      this.lobby?.play(cards.map(card => card.id))
      this.selectedCardIds.clear()
      return
    }
    try {
      const info = getPlayInfo(cards)
      this.state = playCards(this.state, this.humanId, cards)
      this.selectedCardIds.clear()
      if (info?.type === 'Bomb' || info?.type === 'StraightFlush' || info?.type === 'Rocket') this.audio?.playBomb()
      else this.audio?.playCard()
      this.finishHumanAction()
    } catch (error) {
      this.emitSnapshot(error instanceof Error ? error.message : '出牌失败')
    }
  }

  public pass (): void {
    if (this.phase !== 'playing' || this.state.currentTurn !== this.humanId) return
    if (this.session?.snapshot.isMultiplayer) {
      this.lobby?.pass()
      this.selectedCardIds.clear()
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
    if (this.phase !== 'playing' || this.state.currentTurn !== this.humanId) return
    const choices = getPossiblePlays(this.state.players[this.humanId].hand, this.state.lastValidPlay, this.session?.snapshot.difficulty ?? 'medium')
    if (!choices.length) return this.emitSnapshot('没有可用提示，请选择不要')
    const choice = choices[this.hintIndex++ % choices.length]
    this.selectedCardIds = new Set(choice.map(card => card.id))
    const info = getPlayInfo(choice)
    this.emitSnapshot(info ? `提示：${info.type}` : '已选择可出牌组')
  }

  public clearSelected (): void {
    this.selectedCardIds.clear()
    this.emitSnapshot('已重置选择')
  }

  /** Called by the WebSocket adapter after service-authoritative state sync. */
  public applyServerState (state: EngineState, hint = '已同步服务器状态'): void {
    this.state = state
    this.selectedCardIds.clear()
    this.emitSnapshot(hint)
  }

  public applyNetworkRoundPrepared (state: EngineState, tribute: TributeState | null): void {
    this.state = state
    this.tribute = tribute
    this.phase = tribute ? 'tribute' : 'playing'
    this.settlement = null
    this.selectedCardIds.clear()
    if (tribute) this.session?.beginTribute()
    else this.session?.beginPlay()
    this.emitSnapshot(tribute ? (tribute.isAntiTribute ? '抗贡成立，等待开始本局' : '请完成进贡与还贡') : '本局开始')
  }

  public applyNetworkRoundEnded (result: SettlementResult): void {
    this.teamLevels = result.teamLevels
    this.aFailStreaks = result.aFailStreaks
    this.lastRoundRank = result.fullRank
    this.scores = { ...this.scores, [result.winnerTeam]: this.scores[result.winnerTeam] + result.levelUp }
    this.settlement = result
    this.phase = 'settlement'
    this.selectedCardIds.clear()
    this.session?.setRoundLevels(result.teamLevels, result.currentLevel)
    this.session?.recordRound(result.winnerTeam, result.fullRank[0] === this.humanId, 0)
    this.session?.beginSettlement()
    this.emitSnapshot(result.message)
  }

  public nextRound (): void {
    if (this.phase !== 'settlement' || !this.settlement) return
    if (this.session?.snapshot.isMultiplayer) { this.lobby?.nextRound(); return }
    if (this.settlement.isGameWon) {
      this.startRound()
      return
    }
    const dealer = this.lastRoundRank[0] ?? 'p1'
    this.state = dealNextRound(this.state, this.settlement.currentLevel, dealer)
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
    if (this.phase !== 'tribute' || !this.tribute || this.tribute.isAntiTribute) return
    try {
      const cards = this.selectedCards()
      if (cards.length !== 1) throw new Error('请选择一张牌')
      const action = this.tribute.phase === 'tributing'
        ? this.tribute.actions.find(item => item.from === this.humanId && !item.card)
        : this.tribute.actions.find(item => item.to === this.humanId && !item.returnCard)
      if (!action) throw new Error('当前等待其他玩家操作')
      if (this.session?.snapshot.isMultiplayer) {
        if (this.tribute.phase === 'tributing') this.lobby?.tribute(cards[0].id)
        else this.lobby?.returnTribute(cards[0].id)
        this.selectedCardIds.clear()
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
    if (this.phase !== 'tribute' || !this.tribute || (!this.tribute.isAntiTribute && this.tribute.phase !== 'done')) return
    if (this.session?.snapshot.isMultiplayer) { this.lobby?.finishTribute(); return }
    this.state = { ...this.state, currentTurn: tributeLeader(this.tribute, this.lastRoundRank, this.lastRoundRank[0] ?? 'p1'), lastValidPlay: null }
    this.tribute = null
    this.phase = 'playing'
    this.session?.beginPlay()
    this.selectedCardIds.clear()
    this.finishHumanAction()
  }

  private selectedCards (): Card[] {
    return this.state.players[this.humanId].hand.filter(card => this.selectedCardIds.has(card.id))
  }

  private finishHumanAction (): void {
    if (this.maybeSettle()) return
    this.state = runAiTurns(this.state, this.session?.snapshot.difficulty ?? 'medium', 60)
    if (this.maybeSettle()) return
    this.emitSnapshot(this.state.currentTurn === this.humanId ? '轮到你出牌' : '电脑正在思考')
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
    this.session?.setRoundLevels(this.teamLevels, result.currentLevel)
    this.session?.recordRound(result.winnerTeam, result.fullRank[0] === 'p1', this.state.playArea.filter(action => action.type === 'Bomb' || action.type === 'StraightFlush' || action.type === 'Rocket').length)
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
    this.node.emit('guandan:state', {
      state: this.state,
      selectedCardIds: [...this.selectedCardIds],
      hint,
      phase: this.phase,
      teamLevels: this.teamLevels,
      scores: this.scores,
      tribute: this.tribute,
      settlement: this.settlement,
    } satisfies GameSnapshot)
  }

  private get humanId (): PlayerId { return this.session?.snapshot.myPlayerId ?? 'p1' }
}
