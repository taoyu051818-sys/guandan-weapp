import { createGame, PlayType, type Card, type EngineState, type PlayerId, type Rank } from '../../assets/scripts/core/generated'
import type { FixedMatchFixture } from './FixedMatchFixtures'

type PickCards = (rank: Rank, count: number) => Card[]
const seats: readonly PlayerId[] = ['p1', 'p2', 'p3', 'p4']

/** Mid-round snapshots omit already-cleared tricks, just as EngineState does. */
const layoutState = (chooseHand: (pick: PickCards) => Card[], mode: 'opening' | 'follow' | 'landed'): EngineState => {
  const showOwnPlay = mode !== 'opening'
  const base = createGame(2, 'p1')
  let pool = seats.flatMap(id => base.players[id].hand).map(card => ({ ...card })).sort((a, b) => a.id.localeCompare(b.id))
  const pick: PickCards = (rank, count) => {
    const picked = pool.filter(card => card.rank === rank).slice(0, count)
    if (picked.length !== count) throw new Error(`Layout fixture exhausted rank ${rank}`)
    const ids = new Set(picked.map(card => card.id))
    pool = pool.filter(card => !ids.has(card.id))
    return picked
  }
  const ownPlay = showOwnPlay ? pick(4, 2) : []
  const opponentPlay = mode === 'follow' ? pick(5, 2) : []
  const humanHand = chooseHand(pick)
  if (humanHand.length + ownPlay.length > 27) throw new Error('Layout fixture exceeds the original human hand')
  const hands = { p1: humanHand, p2: pool.splice(0, 27), p3: pool.splice(0, 27), p4: pool.splice(0, mode === 'follow' ? 25 : 27) }
  // Remaining cards belonged to earlier, cleared tricks; never stuff them into
  // another player's hand just to make a mid-round snapshot sum to 108.
  const playArea = showOwnPlay ? [
    { playerId: 'p1' as const, cards: ownPlay, type: PlayType.Pair, resolution: { type: PlayType.Pair, maxValue: 4, length: 2 } },
    { playerId: 'p2' as const, cards: [], type: PlayType.Pass },
    { playerId: 'p3' as const, cards: [], type: PlayType.Pass },
    { playerId: 'p4' as const, cards: opponentPlay, type: PlayType.Pair, resolution: { type: PlayType.Pair, maxValue: 5, length: 2 } },
  ] : []
  if (mode === 'landed') playArea.splice(1)
  return {
    ...base,
    currentTurn: mode === 'landed' ? 'p2' : 'p1',
    players: Object.fromEntries(seats.map(id => [id, { ...base.players[id], hand: hands[id] }])) as EngineState['players'],
    playArea,
    lastValidPlay: showOwnPlay ? playArea[playArea.length - 1] : null,
  }
}

const splitHand = (pick: PickCards): Card[] => [
  ...pick(3, 4), ...pick(8, 4), ...pick(6, 3), ...pick(7, 3), ...pick('Q', 3), ...pick('K', 3),
  ...pick(9, 1), ...pick(10, 1), ...pick('A', 1), ...pick('Small', 1), ...pick('Big', 1),
]

export const TABLE_LAYOUT_FIXTURES: readonly FixedMatchFixture[] = Object.freeze([
  { id: 'match-teammate-finish', label: '出完进入队友视角', description: '本人剩一张 A 首出；实际点击出牌后，底部切换为队友手牌且不能操作。', createState: () => teammateViewState(false) },
  { id: 'match-teammate-watching', label: '队友视角 · 恢复', description: '本人已出完，队友剩 12 张；恢复后直接显示，不重发牌。', createState: () => teammateViewState(true) },
  { id: 'match-layout-all-bombs', label: '27 张 · 全炸弹', description: '四个不同点数的高炸弹列；一键理牌后检查左区、顶部和头像遮挡。', createState: () => layoutState(pick => [
    ...pick(3, 7), ...pick(7, 8), ...pick('J', 8), ...pick('A', 4),
  ], 'opening') },
  { id: 'match-layout-split', label: '高叠牌 · 跟牌', description: '25 张手牌，压过上家对子；检查理牌后提示与选择，不重播历史动作。', createState: () => layoutState(splitHand, 'follow') },
  { id: 'match-layout-combinations', label: '只剩右侧组合', description: '12 张手牌可组成两副钢板，没有低牌撑开中央，检查右区落位。', createState: () => layoutState(pick => [
    ...pick(6, 3), ...pick(7, 3), ...pick('Q', 3), ...pick('K', 3),
  ], 'follow') },
  { id: 'match-layout-one-card', label: '最后一张牌', description: '一张 A 对上家的对子，只显示不要；检查剩余数量、按钮居中和牌桌提示。', createState: () => layoutState(pick => pick('A', 1), 'follow') },
  { id: 'match-layout-own-landed', label: '我方落牌 · 定格', description: '我方对子已落桌，轮到下家；固定适配器不启动 AI，供理牌前后重叠验收。', createState: () => layoutState(splitHand, 'landed') },
])

const teammateViewState = (finished: boolean): EngineState => {
  const state = layoutState(pick => pick('A', 1), 'opening')
  state.players.p3.hand = state.players.p3.hand.slice(0, 12)
  if (finished) {
    const action = { playerId: 'p1' as const, cards: state.players.p1.hand, type: PlayType.Single }
    state.players.p1.hand = []
    state.finishedPlayers = ['p1']
    state.currentTurn = 'p3'
    state.playArea = [action]
    state.lastValidPlay = action
  }
  return state
}
