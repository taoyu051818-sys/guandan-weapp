import { _decorator, Component } from 'cc'
import { createGame, getPlayInfo, isRoundOver, passTurn, playCards, runAiTurns } from '../core/generated'
import type { Card, EngineState, PlayerId } from '../core/generated'

export type GameSnapshot = {
  state: EngineState
  selectedCardIds: string[]
  hint: string
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

  public startRound (dealer: PlayerId = 'p1'): void {
    this.state = createGame(2, dealer)
    this.selectedCardIds.clear()
    this.emitSnapshot('新对局开始，轮到你出牌')
  }

  public toggleCard (cardId: string): void {
    if (this.state.currentTurn !== 'p1' || this.state.finishedPlayers.length > 0) return
    if (this.selectedCardIds.has(cardId)) this.selectedCardIds.delete(cardId)
    else this.selectedCardIds.add(cardId)
    const cards = this.selectedCards()
    const info = cards.length ? getPlayInfo(cards) : null
    this.emitSnapshot(cards.length ? (info ? `牌型：${info.type}` : '当前组合不符合掼蛋牌型') : '请选择手牌')
  }

  public playSelected (): void {
    if (this.state.currentTurn !== 'p1') return
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
    if (this.state.currentTurn !== 'p1') return
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

  private selectedCards (): Card[] {
    return this.state.players.p1.hand.filter(card => this.selectedCardIds.has(card.id))
  }

  private finishHumanAction (): void {
    if (isRoundOver(this.state)) {
      this.emitSnapshot('本局结束，等待结算')
      return
    }
    this.state = runAiTurns(this.state, 'medium', 60)
    this.emitSnapshot(this.state.currentTurn === 'p1' ? '轮到你出牌' : '电脑正在思考')
  }

  private emitSnapshot (hint: string): void {
    this.node.emit('guandan:state', {
      state: this.state,
      selectedCardIds: [...this.selectedCardIds],
      hint,
    } satisfies GameSnapshot)
  }
}
