// Audit-only: recompute archived team-policy records, without replaying games,
// building core, writing source/results, or contacting any service.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { acceptance, experiments } from '../../../../scripts/support/team-policy-experiments.mjs'
import { hash, pairedConfidence } from '../../../../scripts/support/team-policy-benchmark.mjs'
import { holdoutVerdict, rankResults, validResult } from '../../../../scripts/support/team-policy-selection.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const path = 'docs/TEAM_POLICY_BENCHMARK_20260910.json'
const original = fs.readFileSync(resolve(root, path), 'utf8')
const archive = JSON.parse(original)
const require = createRequire(resolve(root, 'work/guandan-cocos/package.json'))
const ts = require('typescript')
const plain = value => JSON.parse(JSON.stringify(value))
const loadTs = relative => {
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(resolve(root, relative), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText
  vm.runInNewContext(code, { module, exports: module.exports }, { filename: relative })
  return module.exports
}
const { createSeededRandom } = loadTs('shared-core/src/ai/random.ts')
const { TEAM_POLICY_PARAMETERS } = loadTs('shared-core/src/ai/team/parameters.ts')
const sum = values => values.reduce((a,b) => a+b, 0)
const cases = []
const ranges = []
let games = 0, actions = 0, sameTranscriptPairs = 0
for (const [stageName, stage] of Object.entries(archive.stages)) {
  assert.equal(stage.stage, stageName)
  const prefix = stageName === 'screen' ? 'train' : stageName
  assert.equal(stage.pairs, acceptance[prefix + 'Pairs'])
  assert.equal(stage.seedStart, acceptance[prefix + 'Seed'])
  assert.deepEqual(stage.acceptance, acceptance)
  assert.match(stage.codeHash, /^[0-9a-f]{64}$/)
  assert.equal(stage.codeHash, archive.stages.screen.codeHash)
  assert.equal(stage.runtime, 'v26.7.0')
  assert.ok(Number.isFinite(Date.parse(stage.createdAt)))
  ranges.push([stage.seedStart, stage.seedStart + stage.pairs - 1])
  for (const result of stage.results) {
    assert.deepEqual(result.parameters, experiments[result.name])
    assert.equal(result.parameterHash, hash(result.parameters))
    assert.equal(result.opponent, 'reference')
    assert.equal(result.games.length, 2 * stage.pairs)
    assert.equal(result.pairWins.length, stage.pairs)
    const seen = new Set()
    for (let i = 0; i < stage.pairs; i++) {
      const pair = result.games.slice(2*i, 2*i+2)
      assert.deepEqual(pair.map(g => g.team), i % 2 ? ['teamB', 'teamA'] : ['teamA', 'teamB'])
      for (const game of pair) {
        assert.deepEqual(Object.keys(game), ['seed','team','won','level','leader','turns','hash'])
        assert.equal(game.seed, stage.seedStart + i)
        assert.equal(game.level, [2,5,9,'Q','A'][i%5])
        assert.equal(game.leader, ['p1','p2','p3','p4'][i%4])
        assert.equal(typeof game.won, 'boolean')
        assert.ok(Number.isInteger(game.turns) && game.turns > 0 && game.turns <= 600)
        assert.match(game.hash, /^[0-9a-f]{64}$/)
        const identity = game.seed + ':' + game.team
        assert.ok(!seen.has(identity)); seen.add(identity)
      }
      assert.equal(result.pairWins[i], sum(pair.map(g => Number(g.won))))
      if (pair[0].hash === pair[1].hash) {
        sameTranscriptPairs++
        assert.equal(pair[0].turns, pair[1].turns)
        assert.notEqual(pair[0].won, pair[1].won)
      }
    }
    assert.equal(result.wins, sum(result.games.map(g => Number(g.won))))
    assert.equal(result.wins, sum(result.pairWins))
    assert.equal(result.winRate, result.wins / result.games.length)
    assert.equal(result.turns, sum(result.games.map(g => g.turns)))
    assert.equal(result.turns, result.timing.decisions + result.opponentTiming.decisions)
    assert.equal(result.invalidActions, 0)
    assert.deepEqual(result.openingBombs, [0,0])
    for (const [side, stats] of [result.timing, result.opponentTiming].entries()) {
      const ordered = ['p50Ms','p95Ms','p99Ms','maxMs'].map(k => stats[k])
      assert.ok(ordered.every((n,i) => Number.isFinite(n) && n >= 0 && (!i || n >= ordered[i-1])))
      assert.ok(Number.isInteger(stats.decisions) && stats.decisions > 0)
      const counts = result.scenarios[side]
      assert.ok(Object.values(counts).every(n => Number.isInteger(n) && n >= 0))
      const groups = [['strong','balanced','weak','hard-rule'],
        ['ally-10-or-less','ally-over-10'], ['previous-10-or-less','previous-over-10'],
        ['next-10-or-less','next-over-10']]
      assert.deepEqual(Object.keys(counts).sort(), groups.flat().sort())
      for (const group of groups) assert.equal(sum(group.map(k => counts[k])), stats.decisions)
    }
    const ci = pairedConfidence(result.pairWins, createSeededRandom(55190))
    assert.deepEqual(ci, result.paired95)
    assert.equal(validResult(result), true)
    cases.push({ stage: stageName, name: result.name, games: result.games.length,
      wins: result.wins, actions: result.turns, paired95: ci,
      p95Ratio: result.timing.p95Ms / result.opponentTiming.p95Ms })
    games += result.games.length
    actions += result.turns
  }
}
for (let i=1;i<ranges.length;i++) assert.ok(ranges[i-1][1] < ranges[i][0])
assert.equal(games, 1216)
assert.equal(actions, 91633)
assert.deepEqual(rankResults(archive.stages.screen.results).slice(0,2).map(r=>r.name), ['exit','support'])
assert.equal(rankResults(archive.stages.finalist.results)[0].name, 'support')
assert.deepEqual(holdoutVerdict(archive.stages.holdout.results[0]), archive.summary.verdict)
assert.equal(archive.summary.chosen, 'reference')
assert.equal(archive.summary.verdict.accepted, false)
assert.deepEqual(plain(TEAM_POLICY_PARAMETERS), experiments.reference)
assert.deepEqual(archive.summary.parameters, plain(TEAM_POLICY_PARAMETERS))
assert.equal(archive.summary.parameterHash, hash(archive.summary.parameters))

// Execute the original summarizer with memory-only read/write ports.
const stagePaths = ['screen','finalist','holdout'].map(s => resolve('/audit-memory', s+'.json'))
const outputPath = resolve('/audit-memory/output.json')
const originals = Object.fromEntries(stagePaths.map((p,i) => [p, JSON.stringify(Object.values(archive.stages)[i])]))
const reportSource = fs.readFileSync(resolve(root, 'scripts/report-team-parameters.mjs'), 'utf8')
  .replace(/^import .*\n/gm, '')
function runReport(input, expectedToFail=false) {
  let captured, writes=0
  const sandbox = {
    // The imported selector returns host-realm arrays; compare their JSON data
    // against VM arrays, without treating different Array prototypes as bugs.
    assert: Object.assign((...args)=>assert(...args), assert, {
      deepEqual: (a,b,...args)=>assert.deepEqual(plain(a),plain(b),...args),
    }), resolve, acceptance, experiments, hash, holdoutVerdict, rankResults,
    process: { argv: ['node','report',...stagePaths,outputPath] },
    console: { log() {} },
    readFileSync: p => { assert.ok(Object.hasOwn(input,p)); return input[p] },
    writeFileSync: (p,data) => { assert.equal(p,outputPath); captured=data; writes++ },
  }
  if (expectedToFail) {
    assert.throws(() => vm.runInNewContext(reportSource,sandbox))
    assert.equal(writes,0)
  } else {
    vm.runInNewContext(reportSource,sandbox)
    assert.equal(writes,1)
    assert.equal(captured,original)
  }
}
runReport(originals)
const rejected = []
for (const [name, change] of [
  ['wins', s=>s.results[0].wins++],
  ['paired-team', s=>s.results[0].games[1].team=s.results[0].games[0].team],
  ['parameter-hash', s=>s.results[0].parameterHash='0'.repeat(64)],
  ['stage-seed', s=>s.seedStart++],
]) {
  const input = {...originals}, stage = JSON.parse(input[stagePaths[0]])
  change(stage); input[stagePaths[0]]=JSON.stringify(stage)
  runReport(input,true); rejected.push(name)
}
assert.equal(fs.readFileSync(resolve(root,path),'utf8'),original)
console.log(JSON.stringify({ passed:true, games, actions, cases, sameTranscriptPairs,
  stageSeedRanges:ranges, recomputedPairedConfidenceIntervals:cases.length,
  originalReporterExactBytes:true, rejectedMutations:rejected,
  productionParametersMatch:true, writes:'captured memory only; no file output',
  limitations:['No historical game replay or raw timing samples.',
    'Decision digests do not independently prove hidden-hand isolation or move legality.',
    'Historical codeHash fingerprints policy.js only, not the full dependency tree.',
    'Classic five-level first-finisher simulation, not no-shuffle/rotation/duplicate/tournament or real-player win rate.']
},null,2))
