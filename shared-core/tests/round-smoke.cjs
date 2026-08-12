const assert = require('node:assert/strict')
const core = require('../dist')
const classic = core.getRuleProfile('classic')

require('./rules-regression.cjs')
require('./tribute-regression.cjs')

const allHandsHave = (state, size) => Object.values(state.players).every(player => player.hand.length === size)

for (const difficulty of ['easy', 'medium', 'hard', 'master']) {
  let game = core.createGame(2)
  assert.ok(allHandsHave(game, 27), '两副牌必须各发 27 张')
  game = core.playCards(game, 'p1', [game.players.p1.hand[0]])
  game = core.runAiTurns(game, difficulty, 60)
  assert.ok(core.isRoundOver(game) || game.currentTurn === 'p1', `${difficulty} AI 应结束自己的连续回合`)
}

const doubleDown = core.createGame(2)
doubleDown.players.p1.hand = []
doubleDown.players.p3.hand = []
doubleDown.finishedPlayers = ['p1', 'p3']
assert.equal(core.isRoundOver(doubleDown), true, '双下应在第二名产生时结束')
const settled = core.settle(doubleDown, { teamA: 2, teamB: 2 }, { teamA: 0, teamB: 0 })
assert.equal(settled.levelUp, 3)
assert.equal(settled.currentLevel, 5)

const next = core.dealNextRound(doubleDown, 5, 'p1')
assert.equal(next.currentTurn, 'p1')
assert.ok(allHandsHave(next, 27), '下一局必须重新发牌')

const highOnlyReturn = core.createGame(2)
highOnlyReturn.players.p1.hand = [
  { id: 'high-j', suit: 'spade', rank: 'J', value: 11, isLevelCard: false },
  { id: 'high-q', suit: 'club', rank: 'Q', value: 12, isLevelCard: false },
]
assert.equal(core.automaticReturnCard([
  { id: 'normal-8', suit: 'heart', rank: 8, value: 8, isLevelCard: false },
  { id: 'normal-3', suit: 'diamond', rank: 3, value: 3, isLevelCard: false },
  { id: 'normal-j', suit: 'club', rank: 'J', value: 11, isLevelCard: false },
]).id, 'normal-3', '常规自动还贡必须从 <=10 的牌中选择最低牌')
assert.equal(core.automaticReturnCard(highOnlyReturn.players.p1.hand).id, 'high-j', '整手均高于 10 时自动还贡必须回退到整手最低牌')

// 用同一套策略驱动四个座位，验证回合推进、接风和结算不是只在单步中可用。
let fullGame = core.createGame(2)
const smokeAI = core.createAIEngine({ ruleProfile: fullGame.ruleProfile, seed: 20260811 })
let turns = 0
while (!core.isRoundOver(fullGame) && turns < 3000) {
  const id = fullGame.currentTurn
  const current = fullGame.players[id]
  const cards = smokeAI.makeDecision(current.hand, fullGame.lastValidPlay, 'medium', current.team, fullGame.players, id, {
    currentLevel: fullGame.currentLevel, teamLevels: { teamA: 2, teamB: 2 }, roundMeta: null,
    ruleProfile: fullGame.ruleProfile,
  })
  fullGame = cards && cards.length ? core.playCards(fullGame, id, cards) : core.passTurn(fullGame, id)
  turns += 1
}
assert.ok(core.isRoundOver(fullGame), '完整自动对局必须在安全回合数内结束')
assert.ok(core.settle(fullGame, { teamA: 2, teamB: 2 }, { teamA: 0, teamB: 0 }), '完整自动对局必须可以结算')

// Presentation semantics must distinguish six-card patterns from bombs and preserve wildcard use.
const card = (id, suit, rank, value, extra = {}) => ({ id, suit, rank, value, isLevelCard: false, ...extra })
const tube = [
  card('t3a', 'spade', 3, 3), card('t3b', 'club', 3, 3),
  card('t4a', 'spade', 4, 4), card('t4b', 'club', 4, 4),
  card('t5a', 'spade', 5, 5), card('t5b', 'club', 5, 5),
]
assert.equal(core.resolvePlay(tube, classic).type, core.PlayType.Tube, '六张三连对不能误判为炸弹')
const wildcard = card('wild-heart-2', 'heart', 2, 15, { isLevelCard: true, isRedJoker: true })
const wildcardPair = core.resolvePlay([card('pair-9', 'spade', 9, 9), wildcard], classic)
assert.equal(wildcardPair.type, core.PlayType.Pair)
assert.equal(wildcardPair.wildcardUsages[0].cardId, wildcard.id)
assert.equal(wildcardPair.wildcardUsages[0].representedValue, 9)

const semanticGame = core.createGame(2)
semanticGame.players.p1.hand = [...tube]
semanticGame.currentTurn = 'p1'
const semanticState = core.playCards(semanticGame, 'p1', tube)
assert.equal(semanticState.playArea[0].resolution.type, core.PlayType.Tube)

console.log('shared-core round smoke passed')
