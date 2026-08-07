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

interface Transfer { from: PlayerId; to: PlayerId; card: Card }

const escrowCard = (state: EngineState, from: PlayerId, card: Card): EngineState => ({
  ...state,
  players: {
    ...state.players,
    [from]: { ...state.players[from], hand: state.players[from].hand.filter(item => item.id !== card.id) },
  },
})

/** Apply every transfer to one cloned player map so a double tribute becomes visible atomically. */
const moveAll = (state: EngineState, transfers: Transfer[]): EngineState => {
  const players = { ...state.players }
  transfers.forEach(({ from, card }) => {
    players[from] = { ...players[from], hand: players[from].hand.filter(item => item.id !== card.id) }
  })
  transfers.forEach(({ to, card }) => {
    players[to] = { ...players[to], hand: [...players[to].hand, card].sort((a,b) => b.value-a.value) }
  })
  return { ...state, players }
}

const clockwiseRecipient = (state: EngineState, from: PlayerId, recipients: PlayerId[]): PlayerId => {
  const order = state.turnOrder.length === ids.length ? state.turnOrder : ids
  const start = order.indexOf(from)
  if (start >= 0) {
    for (let offset = 1; offset <= order.length; offset += 1) {
      const candidate = order[(start + offset) % order.length]
      if (recipients.includes(candidate)) return candidate
    }
  }
  return recipients[0]
}

const resolveDoubleRecipients = (state: EngineState, actions: TributeAction[]): TributeAction[] => {
  const [thirdAction, lastAction] = actions
  if (!thirdAction?.card || !lastAction?.card) throw Error('双贡必须收齐两张贡牌后分配')

  // createTribute keeps first/second in the provisional action destinations until
  // both face-down cards arrive. Only then can their actual recipients be known.
  const recipients: PlayerId[] = [thirdAction.to, lastAction.to]
  if (thirdAction.card.value === lastAction.card.value) {
    const clockwise = actions.map(action => ({
      ...action,
      to: clockwiseRecipient(state, action.from, recipients),
    }))
    if (new Set(clockwise.map(action => action.to)).size !== actions.length) throw Error('双贡顺时针映射无效')
    return clockwise
  }

  const [first, second] = recipients
  const thirdGetsFirst = thirdAction.card.value > lastAction.card.value
  return [
    { ...thirdAction, to: thirdGetsFirst ? first : second },
    { ...lastAction, to: thirdGetsFirst ? second : first },
  ]
}

export const giveTribute = (state: EngineState, tribute: TributeState, from: PlayerId, cardId: string): { state: EngineState; tribute: TributeState } => {
  if (tribute.phase !== 'tributing') throw Error('当前不是进贡阶段')
  const action = tribute.actions.find(item => item.from === from)
  if (!action) throw Error('进贡牌无效')
  if (action.card) throw Error('该玩家已经完成进贡')
  const card = state.players[from].hand.find(item => item.id === cardId)
  if (!card) throw Error('进贡牌无效')
  // 与原版一致：红桃级牌为逢人配，不作为强制进贡的最大牌候选。
  const eligible = state.players[from].hand.filter(item => !(item.isLevelCard && item.suit === 'heart'))
  const required = highestCard(eligible.length ? eligible : state.players[from].hand)
  if (required && card.id !== required.id) throw Error('进贡必须交出当前最大的牌')
  const actions = tribute.actions.map(item => item.from === from ? { ...item, card } : item)
  if (tribute.isDoubleDown && !actions.every(item => item.card)) {
    return { state: escrowCard(state, from, card), tribute: { ...tribute, actions, phase: 'tributing' } }
  }
  const resolved = tribute.isDoubleDown ? resolveDoubleRecipients(state, actions) : actions
  const next = moveAll(state, resolved.map(item => ({ from: item.from, to: item.to, card: item.card! })))
  return { state: next, tribute: { ...tribute, actions: resolved, phase: 'returning' } }
}
export const returnTribute = (state: EngineState, tribute: TributeState, from: PlayerId, cardId: string): { state: EngineState; tribute: TributeState } => {
  if (tribute.phase !== 'returning') throw Error('当前不是还贡阶段')
  const action = tribute.actions.find(item => item.to === from); const card = state.players[from].hand.find(item => item.id === cardId)
  if (!action || !card) throw Error('还贡牌无效')
  if (action.returnCard) throw Error('该玩家已经完成还贡')
  // 竞赛规则：通常可还任意一张牌点不高于 10 的牌；若整手牌点均高于
  // 10，则必须还其中牌点最小的一张，避免极端发牌形成无合法动作。
  const eligible = state.players[from].hand.filter(item => item.value <= 10)
  if (eligible.length && card.value > 10) throw Error('还贡只能选择点数不高于 10 的牌')
  if (!eligible.length && card.id !== automaticReturnCard(state.players[from].hand)?.id) throw Error('没有 10 以下牌时必须选择牌点最小的牌还贡')
  const actions = tribute.actions.map(item => item.to === from ? { ...item, returnCard: card } : item); const next = moveAll(state, [{ from, to: action.from, card }])
  return { state: next, tribute: { ...tribute, actions, phase: actions.every(item => item.returnCard) ? 'done' : 'returning' } }
}
export const tributeLeader = (tribute: TributeState, lastRank: PlayerId[], dealer: PlayerId): PlayerId => {
  if (tribute.isAntiTribute) return dealer
  const first = lastRank[0]
  return tribute.actions.find(action => action.to === first)?.from || dealer
}
export const highestCard = (cards: Card[]) => [...cards].sort((a,b) => b.value-a.value)[0]
export const lowestCard = (cards: Card[]) => [...cards].sort((a,b) => a.value-b.value)[0]
/** 服务端托管还贡：优先选 <=10 的最低牌；无低牌时按竞赛规则选整手最低。 */
export const automaticReturnCard = (cards: Card[]): Card | undefined => {
  const eligible = cards.filter(card => card.value <= 10)
  return lowestCard(eligible.length ? eligible : cards)
}
