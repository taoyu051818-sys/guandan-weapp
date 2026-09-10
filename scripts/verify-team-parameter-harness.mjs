import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { experiments } from './support/team-policy-experiments.mjs'
import { contextFor, loadExperiment, pairedConfidence, playGame, publicPlayers } from './support/team-policy-benchmark.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = resolve(root, 'shared-core/dist')
const require = createRequire(import.meta.url)
const { createSeededRandom } = require(resolve(dist, 'ai/random.js'))
const originalConstants = { ...require(resolve(dist, 'ai/team/parameters.js')).TEAM_POLICY_PARAMETERS }
const baseline = loadExperiment(dist, experiments.reference, 'reference-check')
const candidate = loadExperiment(dist, experiments.control, 'isolation-check')
assert.notDeepEqual(require(resolve(baseline.directory, 'ai/team/parameters.js')).TEAM_POLICY_PARAMETERS,
  require(resolve(candidate.directory, 'ai/team/parameters.js')).TEAM_POLICY_PARAMETERS)
assert.deepEqual(require(resolve(dist, 'ai/team/parameters.js')).TEAM_POLICY_PARAMETERS, originalConstants)
assert.throws(() => publicPlayers({ p1: { hand: [1, 2] } }, 'p2').p1.hand[0], /Hidden-hand/)
assert.equal(publicPlayers({ p1: { hand: [1, 2] } }, 'p2').p1.hand.length, 2)
assert.deepEqual(pairedConfidence([1, 1, 1, 1], createSeededRandom(5)).lower, 0.5)

// The same policy on both teams must produce identical mirrored games, not
// merely an approximately even win rate. Repeatability excludes wall clock.
for (let index = 0; index < 2; index++) {
  const a = playGame(baseline.core, baseline, baseline, 2500000 + index, index, 'teamA', { verifyTransitions: true })
  const b = playGame(baseline.core, baseline, baseline, 2500000 + index, index, 'teamB', { verifyTransitions: true })
  assert.equal(a.decisionHash, b.decisionHash)
  assert.equal(Number(a.won) + Number(b.won), 1)
}

// Optional pre-extraction build: check every action, score, probability and
// checkpoint throughout actual games, not only a few hand-picked positions.
if (process.argv[2]) {
  const old = require(resolve(process.argv[2]))
  for (let index = 0; index < 5; index++) {
    const level = [2, 5, 9, 'Q', 'A'][index]
    const rules = baseline.core.getRuleProfile('classic')
    let state = baseline.core.createGame(level, 'p1', rules, createSeededRandom(2501000 + index))
    const engines = [baseline.core, old].map(core => core.createAIEngine({ ruleProfile: rules, seed: 35 + index }))
    let turn = 0
    while (!state.finishedPlayers.length && turn < 600) {
      const id = state.currentTurn, player = state.players[id]
      const context = contextFor(state, level, turn, rules)
      const choices = engines.map(engine => engine.makeDecision(player.hand, state.lastValidPlay, 'master',
        player.team, publicPlayers(state.players, id), id, context))
      assert.deepEqual(choices[0], choices[1], `Extraction changed action level=${level} turn=${turn}`)
      assert.deepEqual(engines[0].getLastDecisionTrace(), engines[1].getLastDecisionTrace())
      assert.deepEqual(engines[0].checkpoint(), engines[1].checkpoint())
      state = choices[0]?.length ? baseline.core.playCards(state, id, choices[0]) : baseline.core.passTurn(state, id)
      turn++
    }
    assert.ok(state.finishedPlayers.length)
  }
}
console.log('Team parameter harness: isolated modules, opaque hands, mirrored deals, authoritative transition/public-history parity, reproducibility and optional baseline parity passed.')
