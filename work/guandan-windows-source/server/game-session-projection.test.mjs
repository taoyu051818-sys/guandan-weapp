import assert from 'node:assert/strict'
import { stateForViewer, tributeForViewer } from './game-session-projection.js'

const card = (id, value) => ({ id, suit: 'spade', rank: value, value, isLevelCard: false })
const players = Object.fromEntries(['p1', 'p2', 'p3', 'p4'].map(id => [id, { hand: [card(`${id}-card`, 10)] }]))

const p2State = stateForViewer({ players }, 'p2')
assert.equal(p2State.players.p2.hand[0].rank, 10)
assert.deepEqual(p2State.players.p1.hand, [{ id: 'hidden-p1-0' }])

const selectedTribute = {
  players: {
    ...players,
    p3: { hand: [card('tribute-1', 16)] },
  },
  tribute: {
    mode: 'double',
    status: 'selecting_tribute',
    exchanges: [
      { id: 'one', from: 'p3', to: 'p1', tributeCardId: 'tribute-1', returnCardId: null },
      { id: 'two', from: 'p4', to: 'p2', tributeCardId: null, returnCardId: null },
    ],
  },
}
assert.equal(stateForViewer(selectedTribute, 'p1').tribute.exchanges[0].tributeCardId, null)
assert.equal(stateForViewer(selectedTribute, 'p3').tribute.exchanges[0].tributeCardId, 'tribute-1')
assert.equal(tributeForViewer(selectedTribute, 'p3').actions[0].card.id, 'tribute-1')
assert.equal(tributeForViewer(selectedTribute, 'p1').actions[0].card, null, '未完成双贡不得向接收者泄露先选的牌')
assert.equal(tributeForViewer(selectedTribute, 'p4').actions[0].card, null, '未完成双贡不得向另一贡者泄露先选的牌')

const selectedReturn = {
  ...selectedTribute,
  players: {
    ...players,
    p1: { hand: [card('tribute-1', 16), card('return-1', 5)] },
    p2: { hand: [card('tribute-2', 15)] },
  },
  tribute: {
    ...selectedTribute.tribute,
    status: 'selecting_return',
    exchanges: selectedTribute.tribute.exchanges.map((exchange, index) => ({
      ...exchange,
      tributeCardId: `tribute-${index + 1}`,
      returnCardId: index === 0 ? 'return-1' : null,
    })),
  },
}
assert.equal(stateForViewer(selectedReturn, 'p3').tribute.exchanges[0].returnCardId, null)
assert.equal(tributeForViewer(selectedReturn, 'p1').actions[0].returnCard.id, 'return-1')
assert.equal(tributeForViewer(selectedReturn, 'p3').actions[0].returnCard, null, '未完成双还贡不得向接收方泄露先选的牌')
assert.equal(tributeForViewer({ ...selectedReturn, tribute: { ...selectedReturn.tribute, status: 'ready' } }, 'p3').actions[0].returnCard.id, 'return-1')

process.stdout.write('game session viewer projection tests passed\n')
