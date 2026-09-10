import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Run after shared-core build. Baseline is a copied, previously built dist,
// never a checkout/reset of the user's working tree. No production traffic.
const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('..', import.meta.url))
const baselinePath = process.argv[2]
if (!baselinePath) throw new Error('Usage: node scripts/benchmark-team-ai.mjs BASELINE_DIST [PAIRS=16] [SEED_OFFSET=0]')
const pairs = Number(process.argv[3] ?? 16)
const offset = Number(process.argv[4] ?? 0)
if (!Number.isInteger(pairs) || pairs < 1 || pairs > 500 || !Number.isInteger(offset)) throw new Error('Invalid sample size or seed offset')
const core = require(resolve(root, 'shared-core/dist'))
const baseline = require(resolve(baselinePath))
const { createSeededRandom } = require(resolve(root, 'shared-core/dist/ai/random.js'))
const rules = core.getRuleProfile('classic')
const times = []
let wins = 0
let invalid = 0
let totalTurns = 0
let openingBombs = 0
let oldOpeningBombs = 0
const pairResults = []
for (let index = 0; index < pairs; index++) {
  const seed = 93001 + offset + index
  let pairWins = 0
  for (const newTeam of ['teamA', 'teamB']) {
    const level = [2, 5, 9, 'Q', 'A'][index % 5]
    let state = core.createGame(level, ['p1', 'p2', 'p3', 'p4'][index % 4], rules, createSeededRandom(seed))
    const modern = core.createAIEngine({ seed: seed + 17, ruleProfile: rules })
    const old = baseline.createAIEngine({ seed: seed + 17, ruleProfile: rules })
    for (let turn = 0; turn < 600 && !state.finishedPlayers.length; turn++) {
      const id = state.currentTurn
      const player = state.players[id]
      const policy = player.team === newTeam ? modern : old
      const cards = policy.makeDecision(player.hand, state.lastValidPlay, 'master', player.team, state.players, id, {
        currentLevel: level, teamLevels: { teamA: level, teamB: level }, ruleProfile: rules, roundMeta: null,
        publicHistory: state.playArea, turnOrder: state.turnOrder, finishedPlayers: state.finishedPlayers,
        roundId: 1, revision: turn,
      })
      if (policy === modern) times.push(policy.getLastMetrics().elapsedMs)
      const legal = cards?.length ? core.canPlay(cards, state.lastValidPlay, rules) : !!state.lastValidPlay
      if (!legal) invalid++
      assert.ok(legal, `Illegal choice seed=${seed} turn=${turn} player=${id}`)
      if (turn === 0 && cards?.length && [core.PlayType.Bomb, core.PlayType.StraightFlush, core.PlayType.Rocket]
        .includes(core.getPlayInfo(cards, rules).type)) {
        if (policy === modern) openingBombs++
        else oldOpeningBombs++
      }
      state = cards?.length ? core.playCards(state, id, cards) : core.passTurn(state, id)
      totalTurns++
    }
    assert.ok(state.finishedPlayers.length, `No first place after 600 turns, seed=${seed}`)
    if (state.players[state.finishedPlayers[0]].team === newTeam) { wins++; pairWins++ }
  }
  pairResults.push(pairWins)
  console.log(JSON.stringify({ completedPairs: index + 1, newTeamFirsts: wins, games: (index + 1) * 2 }))
}
times.sort((a, b) => a - b)
console.log(JSON.stringify({ policy: 'team-first-v1', pairs, seedOffset: offset, games: pairs * 2,
  wins, rate: wins / (pairs * 2), pairResults, invalid, openingBombs, oldOpeningBombs, totalTurns,
  decisions: times.length, p50Ms: times[Math.floor(times.length * 0.5)], p95Ms: times[Math.floor(times.length * 0.95)],
  maxMs: times[times.length - 1], caveat: 'Fixed-deal paired simulation; not a calibrated real-player win rate.' }, null, 2))
