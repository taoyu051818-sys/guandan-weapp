import assert from 'node:assert/strict'
import { test } from 'node:test'
import { acceptance, experiments } from './support/team-policy-experiments.mjs'
import { holdoutVerdict, rankResults } from './support/team-policy-selection.mjs'
import { pairedConfidence } from './support/team-policy-benchmark.mjs'

const result = (name, winRate, lower, p95 = 10) => ({ name, winRate, paired95: { lower, upper: 0.7 },
  invalidActions: 0, openingBombs: [0, 0], timing: { p95Ms: p95 }, opponentTiming: { p95Ms: 10 },
  parameters: experiments.reference })

test('experimental catalogue is bounded and training/holdout seeds never overlap', () => {
  assert.equal(Object.keys(experiments).length, 8)
  for (const params of Object.values(experiments)) {
    assert.ok(Object.isFrozen(params))
    assert.deepEqual(Object.keys(params).sort(), Object.keys(experiments.reference).sort())
    assert.ok(Object.values(params).every(n => Number.isFinite(n) && n > 0 && n <= 3))
  }
  assert.ok(acceptance.trainSeed + acceptance.trainPairs <= acceptance.finalistSeed)
  assert.ok(acceptance.finalistSeed + acceptance.finalistPairs <= acceptance.holdoutSeed)
})
test('selection prefers team first place, then CPU time; invalid/slow policies excluded', () => {
  const strong = result('strong', 0.6, 0.55), quick = result('quick', 0.6, 0.55, 8)
  const slow = result('slow', 0.8, 0.7, 16), illegal = result('illegal', 0.9, 0.8)
  illegal.invalidActions = 1
  assert.deepEqual(rankResults([strong, quick, slow, illegal]).map(r => r.name), ['quick', 'strong'])
})
test('a noisy winner cannot replace production; confidence and all safety gates required', () => {
  assert.equal(holdoutVerdict(result('noisy', 0.54, 0.49)).accepted, false)
  assert.equal(holdoutVerdict(result('edge', 0.55, 0.5)).accepted, false)
  assert.equal(holdoutVerdict(result('supported', 0.6, 0.55)).accepted, true)
  const opening = result('bomb', 0.8, 0.7); opening.openingBombs[0] = 1
  assert.equal(holdoutVerdict(opening).accepted, false)
})
test('confidence resamples paired deals, including deterministic self-play ties', () => {
  const confidence = pairedConfidence([1, 1, 1, 1], () => 0.5, 100)
  assert.equal(confidence.lower, 0.5)
  assert.equal(confidence.upper, 0.5)
  assert.equal(confidence.unit, 'paired-deal')
})
