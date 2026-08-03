import type { Card, PlayerId, TributeAction, TributeState } from '../types/game'
import type { EngineState } from './engine'

const ids: PlayerId[] = ['p1','p2','p3','p4']
export const createTribute = (state: EngineState, lastRank: PlayerId[]): TributeState | null => {
  if (lastRank.length !== 4) return null
  const [first, second, third, last] = lastRank
  const doubleDown = state.players[first].team === state.players[second].team
  const losers = doubleDown ? [third, last] : [last]
  const jokers = losers.flatMap(id => state.players[id].hand).filter(card => card.suit === 'joker')
  const anti = doubleDown ? jokers.length >= 4 || jokers.filter(card => card.rank === 'Big').length >= 2 : jokers.length >= 2
  const actions: TributeAction[] = doubleDown ? [{ from: third, to: first, card: null, returnCard: null }, { from: last, to: second, card: null, returnCard: null }] : [{ from: last, to: first, card: null, returnCard: null }]
  return { isDoubleDown: doubleDown, isAntiTribute: anti, actions, phase: anti ? 'done' : 'tributing' }
}
const move = (state: EngineState, from: PlayerId, to: PlayerId, card: Card): EngineState => ({ ...state, players: { ...state.players, [from]: { ...state.players[from], hand: state.players[from].hand.filter(item => item.id !== card.id) }, [to]: { ...state.players[to], hand: [...state.players[to].hand, card].sort((a,b) => b.value-a.value) } } })
export const giveTribute = (state: EngineState, tribute: TributeState, from: PlayerId, cardId: string): { state: EngineState; tribute: TributeState } => {
  if (tribute.phase !== 'tributing') throw Error('当前不是进贡阶段')
  const action = tribute.actions.find(item => item.from === from); const card = state.players[from].hand.find(item => item.id === cardId)
  if (!action || !card) throw Error('进贡牌无效')
  if (action.card) throw Error('该玩家已经完成进贡')
  // 与原版一致：红桃级牌为逢人配，不作为强制进贡的最大牌候选。
  const eligible = state.players[from].hand.filter(item => !(item.isLevelCard && item.suit === 'heart'))
  const required = highestCard(eligible.length ? eligible : state.players[from].hand)
  if (required && card.id !== required.id) throw Error('进贡必须交出当前最大的牌')
  const actions = tribute.actions.map(item => item.from === from ? { ...item, card } : item); const next = move(state, from, action.to, card)
  return { state: next, tribute: { ...tribute, actions, phase: actions.every(item => item.card) ? 'returning' : 'tributing' } }
}
export const returnTribute = (state: EngineState, tribute: TributeState, from: PlayerId, cardId: string): { state: EngineState; tribute: TributeState } => {
  if (tribute.phase !== 'returning') throw Error('当前不是还贡阶段')
  const action = tribute.actions.find(item => item.to === from); const card = state.players[from].hand.find(item => item.id === cardId)
  if (!action || !card) throw Error('还贡牌无效')
  if (action.returnCard) throw Error('该玩家已经完成还贡')
  // 原项目的 UI 规则为还贡牌点数不高于 10。
  if (card.value > 10) throw Error('还贡只能选择点数不高于 10 的牌')
  const actions = tribute.actions.map(item => item.to === from ? { ...item, returnCard: card } : item); const next = move(state, from, action.from, card)
  return { state: next, tribute: { ...tribute, actions, phase: actions.every(item => item.returnCard) ? 'done' : 'returning' } }
}
export const tributeLeader = (tribute: TributeState, lastRank: PlayerId[], dealer: PlayerId): PlayerId => tribute.isAntiTribute ? dealer : (lastRank[3] || dealer)
export const highestCard = (cards: Card[]) => [...cards].sort((a,b) => b.value-a.value)[0]
export const lowestCard = (cards: Card[]) => [...cards].sort((a,b) => a.value-b.value)[0]
