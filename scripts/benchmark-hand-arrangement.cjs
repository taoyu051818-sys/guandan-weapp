/* Offline only: parameter alternatives never enter the game bundle.
 * This measures partitions, NOT match win rate: auto-arrange does not force plays.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const ts = require('../work/guandan-cocos/tests/support/typescript.cjs').loadTypeScript()
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file)
const core = require('../shared-core/dist')
const { createSeededRandom } = require('../shared-core/dist/ai/random.js')
const { createGroupFeatures, sumFeatures } = require('../shared-core/dist/arrangement/features.js')
const { legacyArrangement } = require('./support/legacy-hand-arrangement.cjs')
const profile = core.getRuleProfile('classic')
const variants = {
  shedding: { single: 18, splitPair: 8, splitTriple: 15, splitBomb: 80, wildOrdinary: 16, wildControl: 8, control: 20 },
  balanced: { single: 18, splitPair: 24, splitTriple: 35, splitBomb: 180, wildOrdinary: 48, wildControl: 16, control: 45 },
  flexible: { single: 18, splitPair: 18, splitTriple: 28, splitBomb: 150, wildOrdinary: 36, wildControl: 12, control: 45 },
  control: { single: 18, splitPair: 24, splitTriple: 35, splitBomb: 240, wildOrdinary: 60, wildControl: 16, control: 60 },
  conservative: { single: 18, splitPair: 50, splitTriple: 70, splitBomb: 300, wildOrdinary: 90, wildControl: 30, control: 60 },
  guarded: { single: 18, splitPair: 24, splitTriple: 35, splitBomb: 240, wildOrdinary: 80, wildControl: 12, control: 120 },
  reserve: { single: 18, splitPair: 36, splitTriple: 50, splitBomb: 260, wildOrdinary: 100, wildControl: 12, control: 160 },
}
const trainCount = Number(process.argv[2] ?? 120), holdCount = Number(process.argv[3] ?? 240)
assert.ok(Number.isInteger(trainCount) && trainCount > 0 && trainCount <= 2000)
assert.ok(Number.isInteger(holdCount) && holdCount > 0 && holdCount <= 2000)
function fixtures (count, offset) {
  return Array.from({ length: count }, (_, i) => {
    const level = [2, 5, 9, 'Q', 'A'][i % 5]
    const random = createSeededRandom(offset + i)
    const deck = core.shuffleDeck(core.createDeck(level), random)
    const size = [27, 27, 18, 10, 6][i % 5]
    // Stratified wildcard stress; the report is not the live deal distribution.
    const forced = i % 3 === 0 ? deck.filter(c => c.isRedJoker) : []
    const hand = [...forced, ...deck.filter(c => !forced.includes(c))].slice(0, size)
    return { hand, seed: offset + i, size }
  })
}
function evaluate (samples, policies) {
  const rows = Object.fromEntries(Object.keys(policies).map(name => [name, {
    hands: 0, turns: 0, singles: 0, splitPairs: 0, splitBombs: 0, ordinaryWildcards: 0,
    controlWildcards: 0, controls: 0, times: [], exact: 0,
  }]))
  for (const [i, { hand }] of samples.entries()) {
    const started = performance.now()
    const prepared = core.prepareHandArrangement(hand, profile)
    const preparation = performance.now() - started
    const featureOf = createGroupFeatures(hand, profile)
    for (const [name, weights] of Object.entries(policies)) {
      const start = performance.now()
      const result = weights ? prepared(weights) : { groups: legacyArrangement(hand, profile), exact: false }
      const elapsed = performance.now() - start + (weights ? preparation : 0)
      const ids = result.groups.flatMap(g => g.cards.map(c => c.id))
      assert.deepEqual(ids.slice().sort(), hand.map(c => c.id).sort(), `${name}: cards lost or duplicated`)
      result.groups.forEach(g => assert.ok(core.canPlay(g.cards, null, profile), `${name}: illegal group`))
      const metrics = sumFeatures(result.groups.map(g => featureOf(g.cards, g.resolution)))
      const row = rows[name]; row.hands++; row.exact += +result.exact; row.times.push(elapsed)
      for (const key of ['turns', 'singles', 'splitPairs', 'splitBombs', 'ordinaryWildcards', 'controlWildcards', 'controls']) row[key] += metrics[key]
    }
    if ((i + 1) % 20 === 0) process.stderr.write(`Evaluated ${i + 1}/${samples.length} hands\n`)
  }
  return Object.fromEntries(Object.entries(rows).map(([name, row]) => {
    row.times.sort((a, b) => a - b)
    const result = { hands: row.hands, exactRate: row.exact / row.hands,
      p50Ms: row.times[Math.floor(row.times.length * .5)], p95Ms: row.times[Math.floor(row.times.length * .95)], maxMs: row.times.at(-1) }
    for (const key of ['turns', 'singles', 'splitPairs', 'splitBombs', 'ordinaryWildcards', 'controlWildcards', 'controls']) result[key] = row[key] / row.hands
    return [name, result]
  }))
}
const train = evaluate(fixtures(trainCount, 510000), { legacy: null, ...variants })
// Predeclared acceptance constraints; do not tune on holdout scores.
const eligible = Object.keys(variants).filter(name => {
  const row = train[name], old = train.legacy
  const savedTurns = old.turns - row.turns
  return savedTurns > 0 && row.controls >= old.controls - .07 * savedTurns &&
    row.splitBombs <= old.splitBombs + .02 &&
    row.ordinaryWildcards <= old.ordinaryWildcards + .50 * savedTurns && row.singles <= old.singles
}).sort((a, b) => train[a].turns - train[b].turns || train[a].singles - train[b].singles || a.localeCompare(b))
const selected = eligible[0] ?? null
const holdout = selected ? evaluate(fixtures(holdCount, 1310000), { legacy: null, [selected]: variants[selected] }) : null
const validationPassed = !!holdout && (() => {
  const old = holdout.legacy, next = holdout[selected], saved = old.turns - next.turns
  return saved > 0 && next.controls >= old.controls - .10 * saved && next.splitBombs <= old.splitBombs + .02 &&
    next.ordinaryWildcards <= old.ordinaryWildcards + .50 * saved && next.singles <= old.singles
})()
console.log(JSON.stringify({ version: 2, trainSeed: 510000, holdoutSeed: 1310000,
  fixture: '27/27/18/10/6 cards, levels 2/5/9/Q/A, every third hand forced two wildcards',
  selection: 'min turns then singles; training safety margin <=.07 control-unit loss per saved turn (acceptance <=.10); extra ordinary wild <=.50 per saved turn; split bombs <=baseline+.02; singles <=baseline',
  priorValidation: 'guarded rejected on 60 hands from seed 910000: control loss .210 exceeded .1783 target; this batch is not reused as holdout',
  eligible, selected, weights: selected && variants[selected], train, holdout, validationPassed,
  caveat: 'Structural fixed-hand evaluation, not real-player win rate or globally optimal parameters.' }, null, 2))
