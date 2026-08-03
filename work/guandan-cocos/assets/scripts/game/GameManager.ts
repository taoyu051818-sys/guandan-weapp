import { _decorator, Component } from 'cc'
import { createGame, createTribute, dealNextRound, getPlayInfo, giveTribute, highestCard, isRoundOver, lowestCard, passTurn, playCards, returnTribute, runAiTurns, settle, tributeLeader } from '../core/generated'
import type { Card, EngineState, PlayerId, Rank, SettlementResult, Team, TributeState } from '../core/generated'

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

const { ccclass } = _decorator

/**
 * Cocos side's single source of interactive round state.  Network clients
 * replace `state` only with snapshots validated by the server.
 */
@ccclass('GameManager')
export class GameManager extends Component {
  public state!: EngineState
  public selectedCardIds = new Set<string>()
  public phase: 'playing' | 'tribute' | 'settlement' = 'playing'
  public teamLevels: Record<Team, Rank> = { teamA: 2, teamB: 2 }
  public aFailStreaks: Record<Team, number> = { teamA: 0, teamB: 0 }
  public scores: Record<Team, number> = { teamA: 0, teamB: 0 }
  public lastRoundRank: PlayerId[] = []
  public tribute: TributeState | null = null
  public settlement: SettlementResult | null = null

  public startRound (dealer: PlayerId = 'p1'): void {
    this.state = createGame(2, dealer)
    this.selectedCardIds.clear()
    this.phase = 'playing'
    this.teamLevels = { teamA: 2, teamB: 2 }
    this.aFailStreaks = { teamA: 0, teamB: 0 }
    this.scores = { teamA: 0, teamB: 0 }
    this.lastRoundRank = []
    this.tribute = null
    this.settlement = null
    this.emitSnapshot('新对局开始，轮到你出牌')
  }

  public toggleCard (cardId: string): void {
    if (this.phase !== 'playing' && this.phase !== 'tribute') return
    if (this.phase === 'playing' && (this.state.currentTurn !== 'p1' || this.state.finishedPlayers.length > 0)) return
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
    if (this.phase !== 'playing' || this.state.currentTurn !== 'p1') return
    const cards = this.selectedCards()
    try {
      this.state = playCards(this.state, 'p1', cards)
      this.selectedCardIds.clear()
      this.finishHumanAction()
    } catch (error) {
      this.emitSnapshot(error instanceof Error ? error.message : '出牌失败')
    }
  }

  public pass (): void {
    if (this.phase !== 'playing' || this.state.currentTurn !== 'p1') return
    try {
      this.state = passTurn(this.state, 'p1')
      this.selectedCardIds.clear()
      this.finishHumanAction()
    } catch (error) {
      this.emitSnapshot(error instanceof Error ? error.message : '当前不能不要')
    }
  }

  /** Called by the WebSocket adapter after service-authoritative state sync. */
  public applyServerState (state: EngineState, hint = '已同步服务器状态'): void {
    this.state = state
    this.selectedCardIds.clear()
    this.emitSnapshot(hint)
  }

  public nextRound (): void {
    if (this.phase !== 'settlement' || !this.settlement) return
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
      this.finishHumanAction()
      return
    }
    this.phase = 'tribute'
    this.runTributeAi()
    this.emitSnapshot(this.tribute.isAntiTribute ? '抗贡成立，请开始本局' : '请完成进贡与还贡')
  }

  public confirmTribute (): void {
    if (this.phase !== 'tribute' || !this.tribute || this.tribute.isAntiTribute) return
    try {
      const cards = this.selectedCards()
      if (cards.length !== 1) throw new Error('请选择一张牌')
      const action = this.tribute.phase === 'tributing'
        ? this.tribute.actions.find(item => item.from === 'p1' && !item.card)
        : this.tribute.actions.find(item => item.to === 'p1' && !item.returnCard)
      if (!action) throw new Error('当前等待其他玩家操作')
      const result = this.tribute.phase === 'tributing'
        ? giveTribute(this.state, this.tribute, 'p1', cards[0].id)
        : returnTribute(this.state, this.tribute, 'p1', cards[0].id)
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
    this.state = { ...this.state, currentTurn: tributeLeader(this.tribute, this.lastRoundRank, this.lastRoundRank[0] ?? 'p1'), lastValidPlay: null }
    this.tribute = null
    this.phase = 'playing'
    this.selectedCardIds.clear()
    this.finishHumanAction()
  }

  private selectedCards (): Card[] {
    return this.state.players.p1.hand.filter(card => this.selectedCardIds.has(card.id))
  }

  private finishHumanAction (): void {
    if (this.maybeSettle()) return
    this.state = runAiTurns(this.state, 'medium', 60)
    if (this.maybeSettle()) return
    this.emitSnapshot(this.state.currentTurn === 'p1' ? '轮到你出牌' : '电脑正在思考')
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
}
