const assert = require('node:assert/strict')
const core = require('../dist')

const commandMeta = state => ({
  roundId: state.roundId,
  expectedRevision: state.revision,
})

const base = core.createGame(2)
const rank = ['p1', 'p2', 'p3', 'p4']
const settled = {
  ...core.createMatchState({
    ruleProfile: core.getRuleProfile('classic'),
    currentLevel: 2,
    levelTeam: 'teamA',
    teamLevels: { teamA: 2, teamB: 2 },
    dealerId: 'p1',
    players: base.players,
  }),
  phase: 'settled',
  finishedPlayers: rank.slice(0, 3),
  lastRoundRank: rank,
  settlement: {
    winnerTeam: 'teamA',
    levelUp: 1,
    currentLevel: 3,
    teamLevels: { teamA: 3, teamB: 2 },
    aFailStreaks: { teamA: 0, teamB: 0 },
    fullRank: rank,
    isGameWon: false,
    message: 'fixture',
  },
}

const dealtHands = core.dealCards(core.createDeck(3))
const prepared = core.transition(settled, {
  type: 'PREPARE_NEXT_ROUND',
  dealtHands,
  ...commandMeta(settled),
})
assert.equal(prepared.ok, true)
assert.equal(prepared.state.phase, 'tribute')
assert.deepEqual(prepared.state.roundMeta, { fromTribute: true, isAntiTribute: false })
assert.equal(prepared.state.tribute.status, 'selecting_tribute')

const exchange = prepared.state.tribute.exchanges[0]
const tributeHand = prepared.state.players[exchange.from].hand
const eligibleTribute = tributeHand.filter(card => !(card.isLevelCard && card.suit === 'heart'))
const tributeCard = core.highestCard(eligibleTribute.length ? eligibleTribute : tributeHand)
const selectedTribute = core.transition(prepared.state, {
  type: 'SELECT_TRIBUTE_CARD',
  playerId: exchange.from,
  cardId: tributeCard.id,
  ...commandMeta(prepared.state),
})
assert.equal(selectedTribute.ok, true)
assert.equal(selectedTribute.state.tribute.status, 'selecting_return')
assert.equal(selectedTribute.state.players[exchange.from].hand.length, 26)
assert.equal(selectedTribute.state.players[exchange.to].hand.length, 28)

const returnHand = selectedTribute.state.players[exchange.to].hand
const returnCard = core.automaticReturnCard(returnHand)
const selectedReturn = core.transition(selectedTribute.state, {
  type: 'SELECT_RETURN_CARD',
  playerId: exchange.to,
  cardId: returnCard.id,
  ...commandMeta(selectedTribute.state),
})
assert.equal(selectedReturn.ok, true)
assert.equal(selectedReturn.state.tribute.status, 'ready')
assert.equal(selectedReturn.state.players[exchange.from].hand.length, 27)
assert.equal(selectedReturn.state.players[exchange.to].hand.length, 27)

const started = core.transition(selectedReturn.state, {
  type: 'BEGIN_PLAY_AFTER_TRIBUTE',
  playerId: exchange.from,
  ...commandMeta(selectedReturn.state),
})
assert.equal(started.ok, true)
assert.equal(started.state.phase, 'playing')
assert.equal(started.state.currentTurn, exchange.from)
assert.equal(started.state.tribute, null)
assert.deepEqual(started.state.roundMeta, { fromTribute: true, isAntiTribute: false })

assert.equal(core.createTribute, undefined)
assert.equal(core.giveTribute, undefined)
assert.equal(core.returnTribute, undefined)
assert.equal(core.tributeLeader, undefined)

console.log('shared-core tribute regression passed')
