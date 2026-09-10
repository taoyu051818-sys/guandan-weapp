const assert = require('node:assert/strict')
const fs = require('node:fs')
const { loadTypeScript } = require('./support/typescript.cjs')
const ts = loadTypeScript()
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 }, fileName: file,
}).outputText, file)
const core = require('../assets/scripts/core/generated/index.ts')
const { HandWorkspace } = require('../assets/scripts/game/HandWorkspace.ts')
const { createSeededRandom } = require('../assets/scripts/core/generated/ai/random.ts')
assert.equal(core.planHandArrangement, undefined, 'retired scoring planner must not be shipped')
assert.equal(core.createHandArrangementTask, undefined, 'no retired search generator')
assert.equal(core.DEFAULT_ARRANGEMENT_WEIGHTS, undefined, 'no arrangement scoring weights')
const times = []
for (const mode of ['random', 'no-shuffle']) for (const [index, level] of core.MATCH_LEVELS.entries()) {
  const hands = core.dealGameCards(level, mode, createSeededRandom(931000 + index))
  for (const hand of Object.values(hands)) {
    const profile = core.getRuleProfile(index % 2 ? 'tournament' : 'classic')
    const options = { roundId: 1, levelRank: level, direction: 'desc', autoSort: true, ruleProfile: profile }
    const workspace = new HandWorkspace()
    workspace.syncAuthoritativeHand(hand, options)
    const baseline = workspace.snapshot.displayCardIds
    const original = JSON.stringify(hand)
    const start = performance.now()
    assert.equal(workspace.toggleArrangement(options), 'arranged', 'simple rules finish in one invocation')
    times.push(performance.now() - start)
    const snapshot = workspace.snapshot
    assert.deepEqual(snapshot.displayCardIds.slice().sort(), hand.map(card => card.id).sort())
    for (const group of snapshot.groups.filter(group => group.origin === 'auto')) {
      const cards = hand.filter(card => group.cardIds.includes(card.id))
      // Tournament rules classify a physical straight flush as Straight.
      if (group.kind === 'straight') assert.equal(new Set(cards.filter(card => !card.isRedJoker).map(card => card.suit)).size, 1,
        'mixed-suit ordinary straight requires a manual lock')
      assert.ok(core.getPlayInfo(cards, profile))
    }
    assert.equal(workspace.toggleArrangement(options), 'restored')
    assert.deepEqual(workspace.snapshot.displayCardIds, baseline)
    assert.equal(workspace.toggleArrangement(options), 'arranged')
    assert.deepEqual(workspace.snapshot.displayCardIds, snapshot.displayCardIds)
    assert.equal(JSON.stringify(hand), original)
    workspace.resetForTableExit()
  }
}
// A plain/wildcard straight remains manually legal without any automatic search.
const deck = core.createDeck(9), profile = core.getRuleProfile('classic')
for (const wild of [false, true]) {
  const hand = [3, 4, 5, 6, 7].map((rank, index) => deck.find(card => card.rank === rank && card.suit === ['spade', 'club'][index % 2]))
  if (wild) hand[4] = deck.find(card => card.isRedJoker)
  const workspace = new HandWorkspace()
  const options = { roundId: 1, levelRank: 9, direction: 'desc', autoSort: true, ruleProfile: profile }
  workspace.syncAuthoritativeHand(hand, options)
  workspace.toggleArrangement(options)
  assert.equal(workspace.snapshot.groups.some(group => group.kind === 'straight'), false)
  const ids = hand.map(card => card.id)
  assert.equal(workspace.applySelectionLock(ids, profile), true)
  workspace.toggleArrangement(options)
  workspace.toggleArrangement(options)
  assert.deepEqual(workspace.lockedCardIds.slice().sort(), ids.slice().sort())
  assert.deepEqual(workspace.playSelectionForCard(ids[0]).slice().sort(), ids.slice().sort())
  assert.equal(workspace.applySelectionLock(ids, profile), true)
  assert.deepEqual(workspace.lockedCardIds, [])
}
times.sort((a, b) => a - b)
console.log(JSON.stringify({ simpleArrangement: 'passed', samples: times.length, host: 'Node; excludes Cocos rendering, not phone latency',
  clickMs: { p50: times[Math.floor(times.length * .5)], p95: times[Math.floor(times.length * .95)], max: times.at(-1) } }))
