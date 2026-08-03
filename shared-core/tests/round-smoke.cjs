const assert = require('node:assert/strict')
const core = require('../dist')

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

let tributeGame
let tribute
for (let attempt = 0; attempt < 200; attempt += 1) {
  tributeGame = core.createGame(2)
  tribute = core.createTribute(tributeGame, ['p1', 'p2', 'p3', 'p4'])
  if (tribute && !tribute.isAntiTribute) break
}
assert.ok(tribute && !tribute.isAntiTribute, '应能构造非抗贡样本')
const tributeCard = core.highestCard(tributeGame.players.p4.hand.filter(card => !(card.isLevelCard && card.suit === 'heart')))
let tributeResult = core.giveTribute(tributeGame, tribute, 'p4', tributeCard.id)
assert.equal(tributeResult.tribute.phase, 'returning')
const returned = core.lowestCard(tributeResult.state.players.p1.hand.filter(card => card.value <= 10))
tributeResult = core.returnTribute(tributeResult.state, tributeResult.tribute, 'p1', returned.id)
assert.equal(tributeResult.tribute.phase, 'done')

// 用同一套策略驱动四个座位，验证回合推进、接风和结算不是只在单步中可用。
let fullGame = core.createGame(2)
let turns = 0
while (!core.isRoundOver(fullGame) && turns < 3000) {
  const id = fullGame.currentTurn
  const current = fullGame.players[id]
  const cards = core.makeDecision(current.hand, fullGame.lastValidPlay, 'medium', current.team, fullGame.players, id, {
    currentLevel: fullGame.currentLevel, teamLevels: { teamA: 2, teamB: 2 }, roundMeta: null,
  })
  fullGame = cards && cards.length ? core.playCards(fullGame, id, cards) : core.passTurn(fullGame, id)
  turns += 1
}
assert.ok(core.isRoundOver(fullGame), '完整自动对局必须在安全回合数内结束')
assert.ok(core.settle(fullGame, { teamA: 2, teamB: 2 }, { teamA: 0, teamB: 0 }), '完整自动对局必须可以结算')

console.log('shared-core round smoke passed')
