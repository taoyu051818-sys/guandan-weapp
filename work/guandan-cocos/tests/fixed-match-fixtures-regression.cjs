const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTypeScript } = require('./support/typescript.cjs')
const ts = loadTypeScript()
require.extensions['.ts'] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
    fileName: filename,
  })
  module._compile(result.outputText, filename)
}
const { FIXED_MATCH_FIXTURES, createFixedMatchState } = require('./fixtures/FixedMatchFixtures.ts')
assert.equal(Object.isFrozen(FIXED_MATCH_FIXTURES), true)
assert.equal(new Set(FIXED_MATCH_FIXTURES.map(f => f.id)).size, FIXED_MATCH_FIXTURES.length)
for (const fixture of FIXED_MATCH_FIXTURES) {
  const state = fixture.createState()
  const hands = Object.values(state.players).flatMap(player => player.hand)
  const cards = hands.concat(state.playArea.flatMap(action => action.cards))
  const midRound = fixture.id.startsWith('match-layout-') || fixture.id.startsWith('match-teammate-')
  if (midRound) assert.ok(cards.length <= 108)
  else assert.equal(cards.length, 108)
  assert.equal(new Set(cards.map(card => card.id)).size, cards.length, fixture.id)
  assert.ok(Object.values(state.players).every(player => player.hand.length <= 27))
  assert.equal(state.currentTurn, fixture.id === 'match-layout-own-landed' ? 'p2' : fixture.id === 'match-teammate-watching' ? 'p3' : 'p1')
  const another = fixture.createState()
  assert.notEqual(state, another)
  assert.notEqual(state.players.p1.hand, another.players.p1.hand)
  assert.deepEqual(state.players.p1.hand, another.players.p1.hand)
  for (const directory of ['assets/scripts/development', 'assets/scripts/scenes/front-pages']) {
    assert.equal(fs.existsSync(path.join(__dirname, '..', directory, 'FixedMatchFixtures.ts')), false)
  }
}
assert.equal(createFixedMatchState('missing'), null)
const first = createFixedMatchState('match-opening')
first.players.p1.hand[0].id = 'test-mutated'
assert.notEqual(createFixedMatchState('match-opening').players.p1.hand[0].id, 'test-mutated')
assert.equal(createFixedMatchState('match-follow-bomb').lastValidPlay.type, 'Bomb')
assert.ok(createFixedMatchState('match-wildcard-bomb').players.p1.hand.some(card => card.isRedJoker))
console.log('Test-only fixed fixtures passed: fresh snapshots, 108-card accounting, unique physical cards and four-seat layout states')
