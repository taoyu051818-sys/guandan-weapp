import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { acceptance, experiments } from './support/team-policy-experiments.mjs'
import { hash } from './support/team-policy-benchmark.mjs'
import { holdoutVerdict, rankResults } from './support/team-policy-selection.mjs'

const paths = process.argv.slice(2)
assert.equal(paths.length, 4, 'Usage: node scripts/report-team-parameters.mjs SCREEN FINALIST HOLDOUT OUTPUT.json')
const [screen, finalist, holdout] = paths.slice(0, 3).map(path => JSON.parse(readFileSync(resolve(path), 'utf8')))
const expected = [
  [screen, 'screen', acceptance.trainPairs, acceptance.trainSeed],
  [finalist, 'finalist', acceptance.finalistPairs, acceptance.finalistSeed],
  [holdout, 'holdout', acceptance.holdoutPairs, acceptance.holdoutSeed],
]
for (const [report, stage, pairs, seedStart] of expected) {
  assert.equal(report.stage, stage)
  assert.equal(report.pairs, pairs)
  assert.equal(report.seedStart, seedStart)
  assert.equal(report.codeHash, screen.codeHash)
  for (const result of report.results) {
    assert.equal(result.opponent, 'reference')
    assert.equal(result.parameterHash, hash(experiments[result.name]))
    assert.equal(result.games.length, pairs * 2)
    assert.equal(result.pairWins.length, pairs)
    assert.equal(result.wins, result.games.filter(game => game.won).length)
    assert.equal(result.winRate, result.wins / (pairs * 2))
    assert.equal(result.turns, result.timing.decisions + result.opponentTiming.decisions)
    for (let i = 0; i < pairs; i++) {
      const games = result.games.filter(game => game.seed === seedStart + i)
      assert.equal(games.length, 2)
      assert.deepEqual(games.map(game => game.team).sort(), ['teamA', 'teamB'])
      assert.equal(result.pairWins[i], games.filter(game => game.won).length)
    }
  }
}
assert.deepEqual(finalist.results.map(result => result.name).sort(), rankResults(screen.results).slice(0, 2).map(result => result.name).sort())
assert.equal(holdout.results.length, 1)
assert.equal(holdout.results[0].name, rankResults(finalist.results)[0].name)
const verdict = holdoutVerdict(holdout.results[0])
const chosen = verdict.accepted ? verdict.candidate : 'reference'
const stages = { screen, finalist, holdout }
const results = Object.values(stages).flatMap(stage => stage.results)
const summary = { chosen, verdict, parameters: experiments[chosen], parameterHash: hash(experiments[chosen]),
  games: results.reduce((sum, result) => sum + result.games.length, 0),
  actions: results.reduce((sum, result) => sum + result.turns, 0),
  invalidActions: results.reduce((sum, result) => sum + result.invalidActions, 0),
  openingBombs: results.reduce((sum, result) => sum + result.openingBombs[0] + result.openingBombs[1], 0),
  caveat: screen.caveat }
writeFileSync(resolve(paths[3]), `${JSON.stringify({ summary, stages }, null, 2)}\n`)
console.log(JSON.stringify(summary, null, 2))
