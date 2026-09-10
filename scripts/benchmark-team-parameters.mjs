import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { acceptance, experiments } from './support/team-policy-experiments.mjs'
import { hash, loadExperiment, pairedConfidence, playGame, timing } from './support/team-policy-benchmark.mjs'

// pnpm --dir shared-core build
// node scripts/benchmark-team-parameters.mjs STAGE PAIRS SEED IDS OPPONENT OUTPUT.json
// IDS: comma-separated experiment names; OPPONENT defaults to reference.
// "production" loads the unmodified compiled policy for final parity checks.
const [stage = 'screen', pairText = '32', seedText = '2700000', names = 'exit,control,support,pressure,reserve,precise,balanced',
  opponentName = 'reference', output] = process.argv.slice(2)
const pairs = Number(pairText), seedStart = Number(seedText)
assert.ok(Number.isInteger(pairs) && pairs >= 1 && pairs <= 2000)
assert.ok(Number.isInteger(seedStart) && seedStart >= 1 && seedStart + pairs < 2 ** 31)
const ids = names.split(',')
const valid = name => name === 'production' || Object.hasOwn(experiments, name)
assert.ok(ids.every(valid) && valid(opponentName) && new Set(ids).size === ids.length)
const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('..', import.meta.url))
const dist = resolve(root, 'shared-core/dist')
const { createSeededRandom } = require(resolve(dist, 'ai/random.js'))
const sources = new Map([...new Set([...ids, opponentName])].map(name =>
  [name, loadExperiment(dist, experiments[name], name)]))
const opponent = sources.get(opponentName)
const results = ids.map(name => ({ name, parameters: experiments[name]
  ?? require(resolve(dist, 'ai/team/parameters.js')).TEAM_POLICY_PARAMETERS,
  opponent: opponentName, pairWins: [], games: [], samples: [[], []], scenarios: [{}, {}],
  openingBombs: [0, 0], invalidActions: 0, wins: 0, turns: 0 }))
// Interleave candidates per seed to reduce warm-up / thermal bias.
for (let index = 0; index < pairs; index++) {
  const seed = seedStart + index
  for (let offset = 0; offset < ids.length; offset++) {
    const result = results[(index + offset) % ids.length]
    let pairWins = 0
    const left = sources.get(result.name)
    for (const team of index % 2 ? ['teamB', 'teamA'] : ['teamA', 'teamB']) {
      const game = playGame(left.core, left, opponent, seed, index, team)
      pairWins += Number(game.won)
      result.turns += game.turns
      for (let side = 0; side < 2; side++) {
        result.samples[side].push(...game.samples[side])
        result.openingBombs[side] += game.openingBombs[side]
        for (const [key, count] of Object.entries(game.scenarios[side]))
          result.scenarios[side][key] = (result.scenarios[side][key] ?? 0) + count
      }
      result.games.push({ seed, team, won: game.won, level: game.level, leader: game.leader,
        turns: game.turns, hash: game.decisionHash })
    }
    result.pairWins.push(pairWins)
    result.wins += pairWins
  }
  console.log(JSON.stringify({ stage, pairsDone: index + 1, gamesPerCandidate: (index + 1) * 2,
    wins: Object.fromEntries(results.map(r => [r.name, r.wins])) }))
}
const report = { stage, pairs, seedStart, runtime: process.version, createdAt: new Date().toISOString(), acceptance,
  codeHash: opponent.codeHash,
  caveat: 'Fixed-deal paired team-first simulation, not real-player win rate. Timing excludes simulated waits.',
  results: results.map(({ samples, ...result }) => ({ ...result, parameterHash: hash(result.parameters),
    winRate: result.wins / (pairs * 2), paired95: pairedConfidence(result.pairWins, createSeededRandom(55190)),
    timing: timing(samples[0]), opponentTiming: timing(samples[1]) })) }
if (output) writeFileSync(resolve(output), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ ...report, results: report.results.map(({ games, ...summary }) => summary) }, null, 2))
