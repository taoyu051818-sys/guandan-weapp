const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTypeScript } = require('./support/typescript.cjs')

const root = path.resolve(__dirname, '..')
const ts = loadTypeScript()
require.extensions['.ts'] = (module, filePath) => {
  const result = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
    fileName: filePath,
    reportDiagnostics: true,
  })
  const errors = (result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
  assert.deepEqual(errors, [], `failed to transpile ${filePath}`)
  module._compile(result.outputText, filePath)
}

const controllerPath = path.join(root, 'tests/support/local-match/LocalMatchController.ts')
const aiTurnControllerPath = path.join(root, 'tests/support/local-match/LocalAITurnController.ts')
const selectionControllerPath = path.join(root, 'assets/scripts/game/LocalHandSelectionController.ts')
const eventControllerPath = path.join(root, 'tests/support/local-match/LocalMatchEventController.ts')
const schedulerPath = path.join(root, 'tests/support/local-match/LocalTurnScheduler.ts')
const networkActionControllerPath = path.join(root, 'assets/scripts/game/NetworkActionController.ts')
const synchronousAIPath = path.join(root, 'tests/support/local-match/SynchronousLocalAIEngine.ts')
const managerPath = path.join(root, 'assets/scripts/game/GameManager.ts')
const managerProjectionPath = path.join(root, 'assets/scripts/game/GameManagerProjection.ts')
const networkSnapshotControllerPath = path.join(root, 'assets/scripts/game/NetworkMatchSnapshotController.ts')
const sessionPath = path.join(root, 'assets/scripts/session/GameSession.ts')
const sessionModelPath = path.join(root, 'assets/scripts/session/GameSessionModel.ts')
const { LocalMatchController } = require(controllerPath)
const { createLocalMatchFixtureFactory } = require('./support/create-local-match-fixture.cjs')
const fromEngineState = createLocalMatchFixtureFactory(LocalMatchController, require(path.join(root, 'assets/scripts/core/generated/index.ts')).createMatchState)
assert.equal(LocalMatchController.fromEngineState, undefined, 'fixed-state injection must remain test-only')
const { LocalAITurnController } = require(aiTurnControllerPath)
const { LocalHandSelectionController } = require(selectionControllerPath)
const { countPlayerBombs, LocalMatchEventController } = require(eventControllerPath)
const { LocalTurnScheduler } = require(schedulerPath)
const { NetworkActionController } = require(networkActionControllerPath)
const { createSynchronousLocalAIEngine } = require(synchronousAIPath)
const { createGameManagerProjection, projectAuthoritativeState } = require(managerProjectionPath)
const { NetworkMatchSnapshotController } = require(networkSnapshotControllerPath)
const { automaticReturnCard, rankHintMoves } = require(path.join(root, 'assets/scripts/core/generated/index.ts'))
const { createDefaultSessionSnapshot, restoreSessionSnapshot } = require(sessionModelPath)

const classic = Object.freeze({ allowA2345Straight: true, straightFlushAsBomb: true, enableTripleWithPair: true })
const card = (id, value) => ({ id, suit: 'spade', rank: value, value, isLevelCard: false, isRedJoker: false })
const player = (id, hand) => ({
  id,
  name: id,
  isAI: id !== 'p1',
  team: id === 'p1' || id === 'p3' ? 'teamA' : 'teamB',
  hand,
  role: 'normal',
})
const engineState = ({ currentTurn = 'p1', finishedPlayers = [], hands }) => ({
  currentLevel: 2,
  ruleProfile: classic,
  players: {
    p1: player('p1', hands.p1),
    p2: player('p2', hands.p2),
    p3: player('p3', hands.p3),
    p4: player('p4', hands.p4),
  },
  turnOrder: ['p1', 'p2', 'p3', 'p4'],
  currentTurn,
  playArea: [],
  lastValidPlay: null,
  finishedPlayers,
})

const restoredSession = restoreSessionSnapshot({
  schemaVersion: 1,
  currentLevel: 'invalid-rank',
  teamLevels: { teamA: 'A' },
  settings: { rulePreset: 'unknown', voicePack: 'male', volume: 7 },
  playerStats: { gamesPlayed: 4 },
})
assert.deepEqual(restoredSession.teamLevels, { teamA: 'A', teamB: 2 }, 'partial nested progression must merge over defaults')
assert.equal(restoredSession.currentLevel, 2, 'invalid persisted ranks must fall back safely')
assert.equal(restoredSession.settings.rulePreset, 'classic', 'unknown persisted presets must not produce an undefined RuleProfile')
assert.equal(restoredSession.settings.voicePack, 'female')
assert.equal(restoredSession.settings.volume, 1, 'persisted numeric settings must be bounded')
assert.deepEqual(restoredSession.playerStats, {
  gamesPlayed: 4,
  wins: 0,
  bombsPlayed: 0,
  firstPlaceFinishes: 0,
  elo: 1000,
})
assert.equal(restoredSession.status, 'menu', 'transient routes must never be restored without a matching engine')
assert.equal(restoredSession.schemaVersion, createDefaultSessionSnapshot().schemaVersion)

const match = fromEngineState(engineState({
  currentTurn: 'p3',
  finishedPlayers: ['p1'],
  hands: { p1: [], p2: [card('p2-4', 4)], p3: [card('p3-5', 5)], p4: [card('p4-6', 6)] },
}), { teamA: 2, teamB: 2 }, () => 0.5)

const beforeIllegal = JSON.stringify(match.state)
const illegal = match.dispatch({ type: 'PLAY_CARDS', playerId: 'p2', cardIds: ['p2-4'] })
assert.deepEqual(illegal, { ok: false, reason: 'NOT_PLAYER_TURN' })
assert.equal(JSON.stringify(match.state), beforeIllegal, 'a rejected intent must keep the MatchState byte-for-byte unchanged')

const settled = match.dispatch({ type: 'PLAY_CARDS', playerId: 'p3', cardIds: ['p3-5'] })
assert.equal(settled.ok, true)
assert.deepEqual(settled.events.map(event => event.type), ['CARDS_PLAYED', 'PLAYER_FINISHED', 'ROUND_SETTLED'])
assert.equal(match.state.phase, 'settled')
assert.equal(match.state.revision, 1)
assert.equal(match.projection.phase, 'settlement')
assert.deepEqual(match.state.lastRoundRank.slice(0, 2), ['p1', 'p3'])
const settledState = structuredClone(match.state)

const projectedSettlement = projectAuthoritativeState(createGameManagerProjection(), settledState, {
  phase: 'playing',
  settlement: null,
})
assert.equal(projectedSettlement.accepted, true)
assert.equal(projectedSettlement.projection.phase, 'settlement', 'canonical MatchState phase must override split-packet fallbacks')
assert.deepEqual(projectedSettlement.projection.settlement, settledState.settlement)
assert.equal(projectedSettlement.projection.roundId, settledState.roundId)
assert.equal(projectedSettlement.projection.revision, settledState.revision)

const staleProjection = projectAuthoritativeState(projectedSettlement.projection, {
  ...settledState,
  roundId: settledState.roundId,
  revision: settledState.revision - 1,
  phase: 'playing',
  settlement: null,
}, { phase: 'playing' })
assert.equal(staleProjection.accepted, false, 'an older game revision must not overwrite the canonical projection')
assert.equal(staleProjection.projection, projectedSettlement.projection)

const networkPlayingState = {
  ...settledState,
  phase: 'playing',
  settlement: null,
  playHistory: [
    { playerId: 'p1', cards: [], type: 'Bomb' },
    { playerId: 'p2', cards: [], type: 'Rocket' },
    { playerId: 'p1', cards: [], type: 'StraightFlush' },
  ],
}
const networkHarness = initialState => {
  let state = structuredClone(initialState)
  let projection = createGameManagerProjection()
  const records = []
  const phases = []
  const selection = new LocalHandSelectionController()
  const controller = new NetworkMatchSnapshotController({
    getState: () => state,
    getProjection: () => projection,
    getRoomId: () => 'room-1',
    getHumanId: () => 'p1',
    commit: (nextState, nextProjection) => { state = nextState; projection = nextProjection },
    retireLocalMatch: () => {}, clearSelection: () => selection.clear(), cancelPendingAction: () => {},
    setSessionPhase: phase => phases.push(phase),
    recordRound: record => records.push(record), publishHint: () => {},
  })
  return { controller, records, phases, selection, state: () => state, projection: () => projection }
}

// Preselection survives other seats' network turns, but never submits a move or crosses a round.
{
  const initial = { ...engineState({ currentTurn: 'p2', hands: {
    p1: [card('pre-a', 3), card('pre-b', 5)], p2: [card('other', 6)], p3: [], p4: [],
  } }), roundId: 1, revision: 1 }
  const h = networkHarness(initial)
  h.controller.applyServerState(initial)
  const context = () => ({ state: h.state(), humanId: 'p1', actionPending: false, phase: 'playing', tribute: null })
  h.selection.toggle('pre-a', context())
  assert.deepEqual([...h.selection.selectedCardIds], ['pre-a'])
  assert.equal(h.selection.hint(context()), null, 'off-turn hint does not imply a legal turn')
  h.selection.replaceFromInput(['pre-a', 'pre-b'], context())
  for (const [index, currentTurn] of ['p3', 'p4', 'p1'].entries()) {
    h.controller.applyServerState({ ...initial, currentTurn, revision: index + 2 })
    assert.deepEqual([...h.selection.selectedCardIds], ['pre-a', 'pre-b'], 'other seat updates and arrival of our turn keep the selection')
  }
  h.selection.toggle('pre-a', { ...context(), actionPending: true })
  h.selection.replaceFromInput([], { ...context(), actionPending: true })
  assert.equal(h.selection.selectedCardIds.size, 2, 'pending action cannot mutate the submitted choice')
  h.controller.applyServerState({ ...initial, currentTurn: 'p2', revision: 5 })
  assert.equal(h.selection.selectedCardIds.size, 0, 'our own pass/turn completion retires the selection')
  h.selection.toggle('pre-b', context())
  h.controller.applyServerState({ ...initial, roundId: 2, revision: 6 })
  assert.equal(h.selection.selectedCardIds.size, 0, 'new round clears even reused physical card IDs')
  h.selection.toggle('pre-b', context())
  const changed = structuredClone(h.state())
  changed.revision++
  changed.players.p1.hand.pop()
  h.controller.applyServerState(changed)
  assert.equal(h.selection.selectedCardIds.size, 0, 'an authoritative hand change retires missing cards')
}

const settledFirst = networkHarness(settledState)
assert.equal(settledFirst.controller.applyServerState(settledState), true)
assert.equal(settledFirst.controller.applyRoundEnded(settledState.settlement, settledState, { bombsPlayed: 7 }), true)
assert.equal(settledFirst.records[0].bombCount, 7, 'viewer-authoritative round stats must override incomplete projected play history')

const legacyRoundEnd = networkHarness(networkPlayingState)
assert.equal(legacyRoundEnd.controller.applyServerState(networkPlayingState), true)
assert.equal(legacyRoundEnd.controller.applyRoundEnded(settledState.settlement), true, 'legacy roundEnded must settle an older canonical playing snapshot')
assert.equal(legacyRoundEnd.projection().phase, 'settlement')
assert.equal(legacyRoundEnd.records[0].bombCount, 2, 'old packets must fall back to viewer play-history counting')
assert.equal(legacyRoundEnd.controller.applyRoundEnded(settledState.settlement), true)
assert.equal(legacyRoundEnd.records.length, 1, 'duplicate network settlement packets must record progress once per room and round')
assert.equal(legacyRoundEnd.controller.applyServerState(networkPlayingState), false, 'an equal-version playing snapshot arriving after settlement must not regress lifecycle')

const legacyNoRoundIdState = { ...networkPlayingState }
delete legacyNoRoundIdState.roundId
delete legacyNoRoundIdState.revision
const legacyIdentity = networkHarness(legacyNoRoundIdState)
assert.equal(legacyIdentity.controller.applyServerState(legacyNoRoundIdState), true)
const eventIdentity = { roomId: 'room-1', version: 41, gameVersion: 7 }
assert.equal(legacyIdentity.controller.applyRoundEnded(settledState.settlement, null, undefined, eventIdentity), true)
assert.equal(legacyIdentity.controller.applyRoundEnded(settledState.settlement, null, undefined, eventIdentity), true)
assert.equal(legacyIdentity.records.length, 1, 'result-only settlements without roundId must dedupe by stable server event identity')

const legacyFallback = networkHarness(legacyNoRoundIdState)
assert.equal(legacyFallback.controller.applyServerState(legacyNoRoundIdState), true)
assert.equal(legacyFallback.controller.applyRoundEnded(settledState.settlement), true)
assert.equal(legacyFallback.controller.applyRoundEnded(settledState.settlement), true)
assert.equal(legacyFallback.records.length, 1, 'direct legacy callers without roundId or event identity must retain an idempotent settlement fallback')

const packetSettled = networkHarness(networkPlayingState)
assert.equal(packetSettled.controller.applyServerState(networkPlayingState), true)
assert.equal(packetSettled.controller.applyRoundEnded(settledState.settlement, settledState, { bombsPlayed: 4 }), true)
assert.equal(packetSettled.state().phase, 'settled', 'a packet-authoritative settled state must replace the older playing snapshot')
assert.equal(packetSettled.records[0].bombCount, 4)
const nextRoundState = { ...networkPlayingState, roundId: settledState.roundId + 1, revision: 0 }
assert.equal(packetSettled.controller.applyRoundPrepared(nextRoundState, null), true)
assert.equal(packetSettled.controller.applyRoundEnded(settledState.settlement, settledState, { bombsPlayed: 99 }), false, 'a delayed roundEnded state from an older round must be rejected')
assert.equal(packetSettled.projection().phase, 'playing')
assert.equal(packetSettled.records.length, 1)
assert.deepEqual(packetSettled.records[0].scores, settledState.scores, 'canonical scores must win over legacy round-ended arithmetic')

const prepared = match.prepareNextRound()
assert.equal(prepared.ok, true)
assert.equal(match.state.roundId, 2)
assert.equal(match.state.phase, 'tribute')
assert.deepEqual(match.state.roundMeta, { fromTribute: true, isAntiTribute: false })
assert.equal(match.projection.tribute.isDoubleDown, true)
assert.equal(prepared.events.filter(event => event.type === 'ROUND_PREPARED').length, 1)
const projectedTribute = projectAuthoritativeState(projectedSettlement.projection, match.state, {
  phase: 'playing',
  tribute: null,
})
assert.equal(projectedTribute.accepted, true)
assert.equal(projectedTribute.projection.phase, 'tribute')
assert.equal(projectedTribute.projection.tribute.isDoubleDown, true, 'canonical tribute state must drive the legacy UI projection')

const automated = match.automateTribute()
assert.equal(automated.ok, true)
assert.ok(automated.events.some(event => event.type === 'TRIBUTE_CARD_SELECTED'))
assert.equal(new Set(automated.events.map((event, index) => `${index}:${event.type}`)).size, automated.events.length)
assert.equal(match.state.tribute.status, 'selecting_return', 'automation must stop at the remaining human return action')
assert.equal(match.projection.tribute.phase, 'returning')

const humanReturn = automaticReturnCard(match.state.players.p1.hand)
const returnedByHuman = match.dispatch({ type: 'SELECT_RETURN_CARD', playerId: 'p1', cardId: humanReturn.id })
assert.equal(returnedByHuman.ok, true)
assert.equal(match.state.tribute.status, 'ready')
const tributeStarted = match.beginPlayAfterTribute()
assert.equal(tributeStarted.ok, true)
assert.equal(match.state.phase, 'playing')
let tributeAIContext = null
const tributeAiMove = match.runAiTurn(match.state.currentTurn, 'master', {
  makeDecision (hand, _lastPlay, _difficulty, _team, _players, _playerId, context) {
    tributeAIContext = context
    return [hand[0]]
  },
})
assert.equal(tributeAiMove.ok, true)
assert.deepEqual(tributeAIContext.roundMeta, { fromTribute: true, isAntiTribute: false }, 'AI decisions must receive canonical round provenance')

let disposed = 0
let decisions = 0
const ai = {
  makeDecision (hand) { decisions += 1; return [hand[0]] },
  reset () {},
  dispose () { disposed += 1 },
}
const aiMatch = fromEngineState(engineState({
  currentTurn: 'p2',
  hands: { p1: [card('p1-9', 9)], p2: [card('p2-3', 3), card('p2-8', 8)], p3: [card('p3-4', 4)], p4: [card('p4-5', 5)] },
}), { teamA: 2, teamB: 2 })
const aiCallbacks = []
const aiHints = []
let aiCommits = 0
const aiTurns = new LocalAITurnController(aiMatch, ai, (callback, delay) => aiCallbacks.push({ callback, delay }), {
  humanId: 'p1',
  difficulty: 'master',
  publishHint: hint => aiHints.push(hint),
  commit: result => { assert.equal(result.ok, true); aiCommits += 1 },
  failureHint: reason => reason,
})
aiTurns.runNext()
assert.match(aiHints.at(-1), /p2.*正在思考/)
assert.equal(aiCallbacks[0].delay, 0.72)
aiCallbacks[0].callback()
assert.equal(decisions, 1)
assert.equal(aiCommits, 1)
assert.equal(aiMatch.state.players.p2.hand.length, 1)
assert.equal(aiCallbacks.length, 2, 'the AI turn controller must continue until control returns to the human')
aiTurns.dispose()
assert.equal(disposed, 1, 'an injected AI engine must be disposed with its local match')
const stateAfterDispose = JSON.stringify(aiMatch.state)
aiCallbacks[1].callback()
assert.equal(JSON.stringify(aiMatch.state), stateAfterDispose, 'disposing the AI turn controller must invalidate retained callbacks')

const failingMatch = fromEngineState(engineState({
  currentTurn: 'p2',
  hands: { p1: [card('retry-p1', 9)], p2: [card('retry-p2', 3)], p3: [card('retry-p3', 4)], p4: [card('retry-p4', 5)] },
}), { teamA: 2, teamB: 2 })
const retryCallbacks = []
const retryHints = []
let failedAttempts = 0
const failingTurns = new LocalAITurnController(failingMatch, {
  makeDecision () { failedAttempts += 1; throw new Error('deterministic AI failure') },
}, (callback, delay) => retryCallbacks.push({ callback, delay }), {
  humanId: 'p1',
  difficulty: 'master',
  publishHint: hint => retryHints.push(hint),
  commit: () => assert.fail('a failed AI turn must never commit'),
  failureHint: reason => reason,
})
failingTurns.runNext()
retryCallbacks[0].callback()
retryCallbacks[1].callback()
retryCallbacks[2].callback()
assert.equal(failedAttempts, 3, 'a persistent AI failure must stop after three total attempts')
assert.equal(retryCallbacks.length, 3, 'a terminal AI failure must not retain scheduling pressure forever')
assert.match(retryHints.at(-1), /连续失败/, 'the terminal retry state must tell the user how to recover')
failingTurns.dispose()

const deterministicAIState = engineState({
  currentTurn: 'p2',
  hands: {
    p1: [card('p1-3', 3), card('p1-9', 9)],
    p2: [card('p2-4', 4), card('p2-8', 8)],
    p3: [card('p3-5', 5), card('p3-10', 10)],
    p4: [card('p4-6', 6), card('p4-11', 11)],
  },
})
const deterministicContext = {
  ruleProfile: classic,
  currentLevel: 2,
  teamLevels: { teamA: 2, teamB: 2 },
  roundMeta: null,
}
const firstAI = createSynchronousLocalAIEngine({ ruleProfile: classic, seed: 73021 })
const secondAI = createSynchronousLocalAIEngine({ ruleProfile: classic, seed: 73021 })
const decide = engine => engine.makeDecision(
  deterministicAIState.players.p2.hand,
  null,
  'master',
  'teamB',
  deterministicAIState.players,
  'p2',
  deterministicContext,
)
const firstDecision = decide(firstAI)
const secondDecision = decide(secondAI)
assert.deepEqual(firstDecision?.map(item => item.id), secondDecision?.map(item => item.id), 'equal seeds must reproduce the Cocos adapter decision')
assert.deepEqual(firstAI.checkpoint(), secondAI.checkpoint(), 'equal seeds must reproduce the full Cocos adapter checkpoint')
firstAI.reset()
const resetDecision = decide(firstAI)
const freshAI = createSynchronousLocalAIEngine({ ruleProfile: classic, seed: 73021 })
assert.deepEqual(resetDecision?.map(item => item.id), decide(freshAI)?.map(item => item.id), 'reset must restore the initial deterministic sequence')
firstAI.dispose()
assert.throws(() => decide(firstAI), /disposed/, 'a retired match must reject late AI work')
secondAI.dispose()
freshAI.dispose()

const selectionState = engineState({
  currentTurn: 'p1',
  hands: { p1: [card('p1-3', 3), card('p1-8', 8)], p2: [card('p2-4', 4)], p3: [card('p3-5', 5)], p4: [card('p4-6', 6)] },
})
let hintRankCalls = 0
const selection = new LocalHandSelectionController(input => {
  hintRankCalls += 1
  return rankHintMoves(input)
})
const selectionContext = { state: selectionState, humanId: 'p1', actionPending: false, phase: 'playing', tribute: null }
assert.match(selection.toggle('p1-3', selectionContext), /可出/)
assert.deepEqual(Array.from(selection.selectedCardIds), ['p1-3'])
assert.equal(selection.replaceFromInput(['missing-card'], selectionContext), '手牌已更新，请重新选择')
assert.deepEqual(Array.from(selection.selectedCardIds), [], 'a stale batch selection must clear atomically')
assert.match(selection.hint(selectionContext), /提示：/)
assert.deepEqual(Array.from(selection.selectedCardIds), ['p1-3'], 'the first hint must select the least damaging legal move')
assert.match(selection.hint(selectionContext), /提示：/)
assert.deepEqual(Array.from(selection.selectedCardIds), ['p1-8'], 'an unchanged hint context must cycle deterministically')
assert.equal(hintRankCalls, 1, 'an unchanged hint context must reuse its ranked candidate list')
const nextHintContext = { ...selectionContext, state: { ...selectionState, roundId: 2, revision: 0 } }
assert.match(selection.hint(nextHintContext), /提示：/)
assert.deepEqual(Array.from(selection.selectedCardIds), ['p1-3'], 'a round signature change must reset hint cycling to the best move')
assert.equal(hintRankCalls, 2, 'an authoritative signature change must invalidate the hint cache')

const networkCallbacks = []
// Hints obey hard lock boundaries, even when the only legal move would split a lock.
{
  const pair = [card('locked-a', 8), card('locked-b', 8)]
  const locked = [{ id: 'manual-pair', kind: 'locked', cardIds: pair.map(c => c.id) }]
  const state = engineState({ hands: { p1: [...pair, card('free-nine', 9)], p2: [], p3: [], p4: [] } })
  state.lastValidPlay = { playerId: 'p4', type: 'Single', cards: [card('last-seven', 7)] }
  const context = { state, humanId: 'p1', actionPending: false, phase: 'playing', tribute: null }
  const hints = new LocalHandSelectionController()
  for (let i = 0; i < 4; i++) {
    assert.match(hints.hint(context, locked), /提示/)
    assert.deepEqual([...hints.selectedCardIds], ['free-nine'], 'hint cycling cannot select part of the locked pair')
  }
  state.players.p1.hand = pair
  assert.match(hints.hint(context, locked), /没有不拆锁牌/)
  assert.equal(hints.selectedCardIds.size, 0, 'no protected hint clears stale selection instead of breaking the lock')
  assert.match(hints.hint(context, []), /提示/, 'restoring a group re-enables split hints')
  state.lastValidPlay = { playerId: 'p4', type: 'Pair', cards: [card('last-a', 7), card('last-b', 7)] }
  assert.match(hints.hint(context, locked), /提示/)
  assert.deepEqual(new Set(hints.selectedCardIds), new Set(pair.map(c => c.id)), 'whole locked combinations remain valid hints')
}
const networkHints = []
const networkActions = new NetworkActionController(
  (callback, delay) => networkCallbacks.push({ callback, delay }),
  hint => networkHints.push(hint),
)
const available = { connected: true, roomId: 'room-1', roomStatus: 'ready' }
assert.equal(networkActions.begin(available, 'pending-1', 'play', () => 41), true)
assert.equal(networkActions.pending, true)
assert.equal(networkCallbacks[0].delay, 8)
networkActions.applyResult({ ok: false, requestId: 42, requestType: 'play', message: 'stale rejection' })
assert.equal(networkActions.pending, true, 'a stale request result must not unlock the current action')
networkActions.applyResult({ ok: false, requestId: 41, requestType: 'play', message: 'authoritative rejection' })
assert.equal(networkActions.pending, false)
assert.equal(networkHints.at(-1), 'authoritative rejection')
assert.equal(networkActions.begin(available, 'pending-2', 'pass', () => 43), true)
networkActions.cancel()
const hintCountAfterCancel = networkHints.length
networkCallbacks[1].callback()
assert.equal(networkHints.length, hintCountAfterCancel, 'leaving the session must invalidate an old network timeout')
assert.equal(networkActions.begin(available, 'pending-3', 'play', () => {
  networkActions.fail('平台确认开局期间暂不能操作')
  return null
}), false)
assert.equal(networkHints.at(-1), '平台确认开局期间暂不能操作', 'a synchronous lifecycle rejection must not be overwritten by the generic send fallback')

const scheduled = []
const scheduler = new LocalTurnScheduler((callback, delay) => scheduled.push({ callback, delay }))
let currentVersion = { roundId: 1, revision: 0 }
let runs = 0
const current = expected => expected.roundId === currentVersion.roundId && expected.revision === currentVersion.revision
scheduler.schedule({ roundId: 1, revision: 0 }, current, () => { runs += 1 }, 0.72)
scheduler.schedule({ roundId: 2, revision: 0 }, current, () => { runs += 10 }, 0.72)
currentVersion = { roundId: 2, revision: 0 }
scheduled[0].callback()
scheduled[1].callback()
assert.equal(runs, 10, 'a newer generation must invalidate the old round callback')

scheduler.schedule({ roundId: 2, revision: 0 }, current, () => { runs += 100 }, 0.72)
currentVersion = { roundId: 2, revision: 1 }
scheduled[2].callback()
assert.equal(runs, 10, 'a revision change must invalidate delayed work even within the same round')
scheduler.schedule({ roundId: 3, revision: 0 }, current, () => { runs += 1000 }, 0.72)
scheduler.cancel()
currentVersion = { roundId: 3, revision: 0 }
scheduled[3].callback()
assert.equal(runs, 10, 'session cancellation must invalidate delayed work')

const effects = []
const eventController = new LocalMatchEventController({
  playPass: () => effects.push('pass-audio'),
  playRoundStart: () => effects.push('round-audio'),
  setSessionPhase: phase => effects.push(`phase:${phase}`),
  recordRound: record => effects.push(`record:${record.settlement.message}:${record.bombCount}`),
  clearSelection: () => effects.push('clear-selection'),
  publishHint: hint => effects.push(`hint:${hint}`),
})
const settlementEvent = settled.events.find(event => event.type === 'ROUND_SETTLED')
eventController.consume([
  { type: 'PLAYER_PASSED', playerId: 'p2' },
  { type: 'ROUND_PREPARED', roundId: 2, mode: 'double', status: 'selecting_tribute' },
  { type: 'PLAY_STARTED_AFTER_TRIBUTE', leaderId: 'p1', wasResisted: false },
  settlementEvent,
], { state: settledState, humanId: 'p1', scores: settledState.scores })
assert.deepEqual(effects, [
  'pass-audio',
  'round-audio',
  'phase:tribute',
  'phase:playing',
  `record:${settlementEvent.settlement.message}:0`,
  'phase:settlement',
  'clear-selection',
  `hint:${settlementEvent.settlement.message}`,
], 'each domain event must map to its application effects exactly once and in order')

effects.length = 0
eventController.consume([settlementEvent], {
  state: {
    ...settledState,
    playHistory: [
      { playerId: 'p1', cards: [], type: 'Bomb' },
      { playerId: 'p2', cards: [], type: 'Rocket' },
      { playerId: 'p1', cards: [], type: 'StraightFlush' },
    ],
  },
  humanId: 'p1',
  scores: settledState.scores,
})
assert.ok(effects.includes(`record:${settlementEvent.settlement.message}:2`), 'personal stats must count only the human seat bombs')
assert.equal(countPlayerBombs({
  ...settledState,
  ruleProfile: { ...classic, straightFlushAsBomb: false },
  playHistory: [
    { playerId: 'p1', cards: [], type: 'Bomb' },
    { playerId: 'p1', cards: [], type: 'Rocket' },
    { playerId: 'p1', cards: [], type: 'StraightFlush' },
  ],
}, 'p1'), 2, 'tournament rules must not count a straight flush as a bomb when the profile disables it')

const managerSource = fs.readFileSync(managerPath, 'utf8')
const networkSnapshotSource = fs.readFileSync(networkSnapshotControllerPath, 'utf8')
assert.doesNotMatch(managerSource, /LocalMatchController/)
assert.doesNotMatch(managerSource, /LocalAITurnController/)
assert.match(managerSource, /LocalHandSelectionController/)
assert.doesNotMatch(managerSource, /LocalMatchEventController/)
assert.match(managerSource, /NetworkActionController/)
assert.match(managerSource, /NetworkMatchSnapshotController/)
assert.doesNotMatch(managerSource, /LocalTurnScheduler/, 'Cocos must not own delayed-turn generations')
assert.doesNotMatch(managerSource, /\btransition\(/, 'GameManager must not write MatchState directly')
assert.doesNotMatch(managerSource, /\bmakeDecision\(/, 'GameManager must not bind the legacy module-level AI')
assert.doesNotMatch(managerSource, /\.runAiTurn\(/, 'GameManager must delegate AI turn orchestration as one controller operation')
assert.doesNotMatch(managerSource, /public (?:phase|tribute|settlement):/, 'lifecycle projections must not remain independently writable public fields')
assert.match(managerSource, /private projection: GameManagerProjection/, 'one immutable projection must own lifecycle and progression fields')
assert.match(managerSource, /applyServerState[\s\S]*this\.networkSnapshots\.applyServerState\(state, hint\)/, 'GameManager must delegate complete network snapshot handling')
assert.match(networkSnapshotSource, /projectAuthoritativeState\(this\.ports\.getProjection\(\), state, fallback\)/, 'one projector must own phase, tribute, settlement, progression, and version gating')
assert.match(networkSnapshotSource, /const authoritativeScores = match\.phase === 'playing' \? null : match\.scores/, 'legacy playing state must not masquerade as post-settlement canonical scores')
assert.match(networkSnapshotSource, /current\.scores\[result\.winnerTeam\] \+ Math\.max\(0, result\.levelUp\)/, 'legacy network settlements must preserve negative A-failure level deltas without subtracting cumulative scores')
assert.match(networkSnapshotSource, /!this\.recordedRoundKeys\.has\(roundKey\)[\s\S]*this\.ports\.recordRound/, 'network settlement statistics must be idempotent by room and protocol event')
assert.match(networkSnapshotSource, /stats\?\.bombsPlayed[\s\S]*countPlayerBombs\(state, humanId\)/, 'server-projected viewer stats must win while legacy packets retain the local history fallback')
assert.match(networkSnapshotSource, /commitLegacyRoundEnd[\s\S]*mergeGameManagerProjection\(adapted\.projection, patch\)/, 'legacy result-only packets must have an explicit settlement lifecycle adapter')
assert.ok(managerSource.split('\n').length <= 470, 'GameManager must keep maintenance margin as a bounded Cocos input adapter')

const sessionSource = fs.readFileSync(sessionPath, 'utf8')
assert.match(sessionSource, /get ruleProfile \(\): RuleProfile \{ return getRuleProfile\(this\.snapshot\.settings\.rulePreset\) \}/)
assert.doesNotMatch(sessionSource, /setRuleProfileByPreset/, 'GameSession must not mutate a module-level rule profile')
assert.match(sessionSource, /restoreSessionSnapshot\(JSON\.parse\(raw\)\)/, 'persisted session data must pass through the versioned schema migrator')
assert.doesNotMatch(sessionSource, /setRoundLevels/, 'round progression must be committed atomically with the round record')

process.stdout.write('local match controller and delayed-turn guards passed\n')

assert.doesNotMatch(sessionSource, /beginLocalGame|completeGrouping|resetMatchProgress|campaignProgress/, 'retired local lifecycle stays outside runtime')
