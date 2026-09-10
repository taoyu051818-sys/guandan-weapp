import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
// MatchState explicitly clones optional fields as undefined; the legacy facade
// may omit them. Compare their serialized game data, not property presence.
const wireData = value => JSON.parse(JSON.stringify(value))
export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0
}
export const timing = values => ({ decisions: values.length, p50Ms: percentile(values, 0.5),
  p95Ms: percentile(values, 0.95), p99Ms: percentile(values, 0.99), maxMs: percentile(values, 1) })

/** Isolated compiled module trees, not a second implementation of the AI.
 * Only the frozen scoring-constant module is substituted BEFORE loading core.
 * No production mutation hook, no shared global parameter switching mid-game.
 */
export function loadExperiment(dist, parameters, name) {
  const directory = mkdtempSync(join(tmpdir(), `guandan-bench-${name}-`))
  cpSync(dist, directory, { recursive: true })
  if (parameters) {
    const filename = resolve(directory, 'ai/team/parameters.js')
    const keys = Object.keys(require(filename).TEAM_POLICY_PARAMETERS).sort()
    assert.deepEqual(Object.keys(parameters).sort(), keys)
    assert.ok(Object.values(parameters).every(n => Number.isFinite(n) && n > 0 && n <= 3))
    require.cache[require.resolve(filename)].exports = Object.freeze({ TEAM_POLICY_PARAMETERS: Object.freeze({ ...parameters }) })
  }
  return { core: require(directory), directory,
    codeHash: hash(readFileSync(resolve(directory, 'ai/team/policy.js'), 'utf8')) }
}

export const contextFor = (state, level, turn, ruleProfile) => ({
  currentLevel: level, teamLevels: { teamA: level, teamB: level }, ruleProfile,
  roundMeta: null, publicHistory: state.playArea, turnOrder: state.turnOrder,
  finishedPlayers: state.finishedPlayers, roundId: 1, revision: turn,
})

// Fail instantly if an engine attempts to inspect a hidden hand; length only.
export const publicPlayers = (players, self) => Object.fromEntries(Object.entries(players).map(([id, player]) =>
  [id, id === self ? player : { ...player, hand: new Proxy([], {
    get(_target, key) {
      if (key !== 'length') throw new Error(`Hidden-hand access ${id}.${String(key)}`)
      return player.hand.length
    },
  }) }]))

export function playGame(core, left, right, seed, index, leftTeam, { verifyTransitions = false } = {}) {
  const { createSeededRandom } = require(resolve(left.directory, 'ai/random.js'))
  const level = [2, 5, 9, 'Q', 'A'][index % 5]
  const leader = ['p1', 'p2', 'p3', 'p4'][index % 4]
  const rules = core.getRuleProfile('classic')
  let state = core.createGame(level, leader, rules, createSeededRandom(seed))
  let shadow = verifyTransitions ? core.createMatchState({ ...state, dealerId: leader,
    levelTeam: 'teamA', teamLevels: { teamA: level, teamB: level } }) : null
  const engines = [left, right].map(source => source.core.createAIEngine({ ruleProfile: rules, seed: seed + 17 }))
  const samples = [[], []]
  const scenarios = [{}, {}]
  const openingBombs = [0, 0]
  let turns = 0
  const decisionHash = createHash('sha256')
  while (!state.finishedPlayers.length && turns < 600) {
    const id = state.currentTurn
    const player = state.players[id]
    const side = player.team === leftTeam ? 0 : 1
    const engine = engines[side]
    const context = contextFor(state, level, turns, rules)
    const cards = engine.makeDecision(player.hand, state.lastValidPlay, 'master', player.team,
      publicPlayers(state.players, id), id, context)
    const ms = engine.getLastMetrics().elapsedMs
    samples[side].push(ms)
    const trace = engine.getLastDecisionTrace().team
    const ally = Object.values(state.players).find(p => p.id !== id && p.team === player.team)
    const order = state.turnOrder
    const seatIndex = order.indexOf(id)
    const previous = state.players[order[(seatIndex + order.length - 1) % order.length]]
    const next = state.players[order[(seatIndex + 1) % order.length]]
    const buckets = [trace?.strength?.tier ?? 'hard-rule',
      ally.hand.length <= 10 ? 'ally-10-or-less' : 'ally-over-10',
      previous.hand.length <= 10 ? 'previous-10-or-less' : 'previous-over-10',
      next.hand.length <= 10 ? 'next-10-or-less' : 'next-over-10']
    for (const bucket of buckets) scenarios[side][bucket] = (scenarios[side][bucket] ?? 0) + 1
    const tag = `seed=${seed} team=${leftTeam} turn=${turns} player=${id}`
    const ids = cards?.map(card => card.id) ?? []
    assert.equal(new Set(ids).size, ids.length, `Repeated cards ${tag}`)
    assert.ok(ids.every(cardId => player.hand.some(card => card.id === cardId)), `Foreign card ${tag}`)
    assert.ok(cards?.length ? core.canPlay(cards, state.lastValidPlay, rules) : !!state.lastValidPlay, `Illegal ${tag}`)
    if (turns === 0 && cards?.length && [core.PlayType.Bomb, core.PlayType.StraightFlush, core.PlayType.Rocket]
      .includes(core.getPlayInfo(cards, rules).type)) openingBombs[side]++
    decisionHash.update(JSON.stringify([id, ids]))
    state = cards?.length ? core.playCards(state, id, cards) : core.passTurn(state, id)
    if (shadow) {
      const nextState = core.transition(shadow, { type: cards?.length ? 'PLAY_CARDS' : 'PASS',
        playerId: id, cardIds: ids, roundId: shadow.roundId, expectedRevision: shadow.revision })
      assert.ok(nextState.ok, `Authoritative transition disagrees ${tag}: ${nextState.reason}`)
      shadow = nextState.state
      for (const field of ['players', 'currentTurn', 'lastValidPlay', 'finishedPlayers'])
        assert.deepEqual(wireData(shadow[field]), wireData(state[field]), `Authoritative ${field} mismatch ${tag}`)
      assert.deepEqual(wireData(shadow.playHistory), wireData(state.playArea), `Public-history mismatch ${tag}`)
    }
    turns++
  }
  assert.ok(state.finishedPlayers.length, `Turn limit exceeded seed=${seed}`)
  return { won: state.players[state.finishedPlayers[0]].team === leftTeam, turns, samples, scenarios,
    level, leader, openingBombs, decisionHash: decisionHash.digest('hex') }
}

// Bootstrap complete paired deals, NOT individual correlated games/actions.
export function pairedConfidence(pairWins, random, iterations = 10000) {
  const means = []
  for (let n = 0; n < iterations; n++) {
    let sum = 0
    for (let i = 0; i < pairWins.length; i++) sum += pairWins[Math.floor(random() * pairWins.length)]
    means.push(sum / (pairWins.length * 2))
  }
  return { lower: percentile(means, 0.025), upper: percentile(means, 0.975),
    unit: 'paired-deal', method: 'percentile-bootstrap', iterations }
}
