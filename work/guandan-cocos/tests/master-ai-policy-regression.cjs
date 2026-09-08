const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const session = read('assets/scripts/session/GameSession.ts')
const sessionModel = read('assets/scripts/session/GameSessionModel.ts')
const manager = read('assets/scripts/game/GameManager.ts')
const localMatch = read('tests/support/local-match/LocalMatchController.ts')
const localAITurns = read('tests/support/local-match/LocalAITurnController.ts')
const localAIEngine = read('tests/support/local-match/SynchronousLocalAIEngine.ts')
const scene = read('assets/scripts/scenes/GameScene.ts')
const tableMatchCoordinator = read('assets/scripts/scenes/TableMatchCoordinator.ts')
const aiSource = read('assets/scripts/core/generated/ai/decisionRunner.ts')
const policyOverrides = read('assets/scripts/core/generated/ai/policyOverrides.ts')
const fallbackDecision = read('assets/scripts/core/generated/ai/fallbackDecision.ts')
const decisionSupport = read('assets/scripts/core/generated/ai/decisionSupport.ts')

assert.doesNotMatch(manager, /snapshot\.difficulty/, 'local gameplay must not trust persisted or injected AI difficulty')
assert.doesNotMatch(scene, /snapshot\.difficulty/, 'table helpers must not trust persisted or injected AI difficulty')
assert.doesNotMatch(manager, /LocalAITurnController|makeDecision/, 'AI execution is server-owned, not a dormant client mode')
assert.match(localAITurns, /difficulty: APPLICATION_AI_DIFFICULTY|difficulty: Difficulty/, 'the AI turn controller must receive an explicit application difficulty')
assert.match(localAIEngine, /createAIWorkerRuntime\(\)[\s\S]*createAIWorkerRequest\([\s\S]*this\.currentCheckpoint/, 'the Cocos synchronous adapter must use the portable Worker protocol and checkpoint chain')
assert.match(localAIEngine, /expectedGeneration[\s\S]*expectedGeneration !== this\.generation/, 'the Cocos AI adapter must invalidate decisions across lifecycle generations')
assert.match(localMatch, /aiEngine\?\.makeDecision\([\s\S]*difficulty,[\s\S]*player\.team,[\s\S]*this\.match\.players,[\s\S]*playerId,[\s\S]*ruleProfile: this\.match\.ruleProfile/, 'the injected AI engine must receive rules, difficulty, authoritative teams and player identity')
assert.doesNotMatch(manager, /\bmakeDecision\(/, 'GameManager must not bind the module-level AI singleton')
assert.match(decisionSupport, /const getTeammateId[\s\S]*id !== myPlayerId && players\[id\]\.team === myTeam/, 'AI teammate identity must come from the authoritative team field')
assert.match(decisionSupport, /const teammateHand = players\[teammateId\][\s\S]*players\[teammateId\]\.hand\.length/, 'pressure modelling must not mistake the bot itself for its teammate')
assert.match(aiSource, /createDecisionRunner[\s\S]*observeRuntimeIntel\(lastPlay, players\)[\s\S]*search\.chooseEndgamePlay/, 'the runner must preserve the decision gate and search ordering')
assert.match(policyOverrides, /createPolicyOverrides[\s\S]*chooseMasterOverrideImpl[\s\S]*hardTacticalOverrideImpl[\s\S]*chooseMediumOverrideImpl/, 'difficulty policies must be adapted outside the engine state container')
assert.match(fallbackDecision, /createFallbackDecision[\s\S]*master_pre6_bomb_hold[\s\S]*bomb_conservation[\s\S]*humanizeJitter/, 'ordinary follow, lead and humanization fallback must stay outside the gate runner')

const core = require(path.resolve(root, '../../shared-core/dist'))
const card = (id, suit, rank, value) => ({ id, suit, rank, value, isLevelCard: false })
const game = core.createGame(2)
const players = game.players
players.p1.hand = [card('p1-3', 'spade', 3, 3), card('p1-9', 'heart', 9, 9)]
players.p2.hand = [card('p2-3', 'club', 3, 3), card('p2-9', 'diamond', 9, 9)]
players.p3.hand = [card('p3-4', 'spade', 4, 4), card('p3-8', 'heart', 8, 8)]
players.p4.hand = [card('p4-5', 'club', 5, 5), card('p4-7', 'diamond', 7, 7)]
const context = {
  currentLevel: 2,
  teamLevels: { teamA: 2, teamB: 2 },
  roundMeta: null,
  ruleProfile: game.ruleProfile,
}
const ai = core.createAIEngine({ ruleProfile: game.ruleProfile, seed: 20260811 })
const single = playerId => ({ playerId, cards: [players[playerId].hand[0]], type: core.PlayType.Single })

const teammateResponseA = ai.makeDecision(players.p3.hand, single('p1'), 'master', players.p3.team, players, 'p3', context)
assert.equal(teammateResponseA, null, 'teamA support bot must yield after its p1 teammate controls the trick')
assert.equal(ai.getLastDecisionTrace().passReason, 'teammate_yield')
const enemyResponseA = ai.makeDecision(players.p3.hand, single('p2'), 'master', players.p3.team, players, 'p3', context)
assert.ok(Array.isArray(enemyResponseA) && enemyResponseA.length > 0, 'teamA support bot must contest an enemy when it has a legal response')

const teammateResponseB = ai.makeDecision(players.p2.hand, single('p4'), 'master', players.p2.team, players, 'p2', context)
assert.equal(teammateResponseB, null, 'teamB bot must also recognize p4 as its teammate')
assert.equal(ai.getLastDecisionTrace().difficulty, 'master')

players.p2.team = 'teamA'
players.p3.team = 'teamB'
const remappedTeammateResponse = ai.makeDecision(players.p1.hand, single('p2'), 'master', players.p1.team, players, 'p1', context)
assert.equal(remappedTeammateResponse, null, 'team recognition must follow authoritative team data instead of assuming the opposite seat')
const remappedP4Response = ai.makeDecision(players.p4.hand, single('p3'), 'master', players.p4.team, players, 'p4', context)
assert.equal(remappedP4Response, null, 'remapped p4 must recognize p3 as its authoritative teammate')

console.log('master AI policy regression tests passed')

assert.doesNotMatch(sessionModel, /difficulty:|APPLICATION_AI_DIFFICULTY/, 'old client AI settings must not survive migration')
