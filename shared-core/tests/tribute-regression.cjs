const assert = require('node:assert/strict')
const core = require('../dist')

const card = (id, suit, rank, value) => ({ id, suit, rank, value, isLevelCard: false })
const lastRank = ['p1', 'p3', 'p2', 'p4']
const fillers = (prefix, count, suit) => Array.from({ length: count }, (_, index) => card(`${prefix}-${index}`, suit, 2, 2))
const handCount = state => Object.values(state.players).reduce((total, player) => total + player.hand.length, 0)

const doubleFixture = ({ thirdCard, lastCard }) => {
  const state = core.createGame(2)
  state.turnOrder = ['p1', 'p2', 'p3', 'p4']
  state.players.p1.hand = [card('return-first', 'diamond', 3, 3), ...fillers('p1-low', 26, 'diamond')]
  state.players.p2.hand = [thirdCard, ...fillers('p2-low', 26, 'spade')]
  state.players.p3.hand = [card('return-second', 'club', 4, 4), ...fillers('p3-low', 26, 'club')]
  state.players.p4.hand = [lastCard, ...fillers('p4-low', 26, 'heart')]
  assert.equal(handCount(state), 108)
  const tribute = core.createTribute(state, lastRank)
  assert.ok(tribute?.isDoubleDown && !tribute.isAntiTribute)
  return { state, tribute }
}

// 三游贡小、末游贡大：首张移入 action escrow，收齐后映射翻转并原子入手。
{
  const fixture = doubleFixture({
    thirdCard: card('third-small', 'spade', 'Q', 12),
    lastCard: card('last-big', 'heart', 'A', 14),
  })
  const afterThird = core.giveTribute(fixture.state, fixture.tribute, 'p2', 'third-small')
  assert.equal(handCount(afterThird.state), 107, '首张双贡须离开贡者手牌并进入 escrow')
  assert.equal(afterThird.tribute.actions.filter(action => action.card).length, 1)
  assert.equal(handCount(afterThird.state) + afterThird.tribute.actions.filter(action => action.card).length, 108, '手牌与 escrow 合计必须守恒')
  assert.ok(!afterThird.state.players.p2.hand.some(item => item.id === 'third-small'))
  assert.throws(
    () => core.giveTribute(afterThird.state, afterThird.tribute, 'p2', 'third-small'),
    /已经完成进贡/,
    'action.card 必须让客户端和核心都识别首位贡者已完成',
  )
  assert.equal(afterThird.tribute.phase, 'tributing')

  let result = core.giveTribute(afterThird.state, afterThird.tribute, 'p4', 'last-big')
  assert.equal(result.tribute.phase, 'returning')
  assert.equal(handCount(result.state), 108, '双贡收齐后两张贡牌必须同时进入实际收贡者手牌')
  assert.equal(result.tribute.actions.find(action => action.from === 'p4').to, 'p1', '较大贡牌必须交给上游')
  assert.equal(result.tribute.actions.find(action => action.from === 'p2').to, 'p3', '较小贡牌必须交给二游')
  assert.ok(result.state.players.p1.hand.some(item => item.id === 'last-big'))
  assert.ok(result.state.players.p3.hand.some(item => item.id === 'third-small'))
  assert.ok(!result.state.players.p2.hand.some(item => item.id === 'third-small'))
  assert.ok(!result.state.players.p4.hand.some(item => item.id === 'last-big'))
  assert.equal(core.tributeLeader(result.tribute, lastRank, 'p1'), 'p4', '贡给上游者必须首圈领出')

  result = core.returnTribute(result.state, result.tribute, 'p1', 'return-first')
  result = core.returnTribute(result.state, result.tribute, 'p3', 'return-second')
  assert.equal(result.tribute.phase, 'done')
  assert.equal(result.tribute.actions.find(action => action.from === 'p4').returnCard.id, 'return-first', '上游须向实际大牌贡者对应还牌')
  assert.equal(result.tribute.actions.find(action => action.from === 'p2').returnCard.id, 'return-second', '二游须向实际小牌贡者对应还牌')
  assert.ok(result.state.players.p4.hand.some(item => item.id === 'return-first'))
  assert.ok(result.state.players.p2.hand.some(item => item.id === 'return-second'))
}

// 反向大小关系应保留三游给上游、末游给二游。
{
  const fixture = doubleFixture({
    thirdCard: card('third-big', 'spade', 'A', 14),
    lastCard: card('last-small', 'heart', 'Q', 12),
  })
  const afterLast = core.giveTribute(fixture.state, fixture.tribute, 'p4', 'last-small')
  const result = core.giveTribute(afterLast.state, afterLast.tribute, 'p2', 'third-big')
  assert.equal(result.tribute.actions.find(action => action.from === 'p2').to, 'p1')
  assert.equal(result.tribute.actions.find(action => action.from === 'p4').to, 'p3')
  assert.equal(core.tributeLeader(result.tribute, lastRank, 'p1'), 'p2')
}

// 同点不依赖提交先后：沿 turnOrder 顺时针，p2→p3、p4→p1。
{
  const fixture = doubleFixture({
    thirdCard: card('third-tie', 'spade', 'K', 13),
    lastCard: card('last-tie', 'heart', 'K', 13),
  })
  const afterLast = core.giveTribute(fixture.state, fixture.tribute, 'p4', 'last-tie')
  const result = core.giveTribute(afterLast.state, afterLast.tribute, 'p2', 'third-tie')
  assert.equal(result.tribute.actions.find(action => action.from === 'p2').to, 'p3')
  assert.equal(result.tribute.actions.find(action => action.from === 'p4').to, 'p1')
  assert.equal(core.tributeLeader(result.tribute, lastRank, 'p1'), 'p4')
}

console.log('shared-core tribute regression passed')
