const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const session = read('assets/scripts/session/GameSession.ts')
const manager = read('assets/scripts/game/GameManager.ts')
const scene = read('assets/scripts/scenes/GameScene.ts')
const aiSource = read('assets/scripts/core/generated/lib/ai.ts')

assert.match(session, /export const APPLICATION_AI_DIFFICULTY = 'master' as const/, 'the application AI difficulty must be a master-only literal')
assert.match(session, /difficulty: typeof APPLICATION_AI_DIFFICULTY/, 'session snapshots must not accept lower AI tiers')
assert.doesNotMatch(manager, /snapshot\.difficulty/, 'local gameplay must not trust persisted or injected AI difficulty')
assert.doesNotMatch(scene, /snapshot\.difficulty/, 'table helpers must not trust persisted or injected AI difficulty')
assert.match(manager, /makeDecision\([\s\S]*APPLICATION_AI_DIFFICULTY[\s\S]*ai\.team[\s\S]*this\.state\.players/, 'AI decisions must receive both master difficulty and the authoritative team map')
assert.match(scene, /startMasterBotTest: \(\) => this\.startMasterBotTest\(\)/, 'the More-menu master bot test must be wired to the table host')
assert.match(scene, /private startMasterBotTest[\s\S]*frontPages\?\.hideAll\(\)[\s\S]*setTableVisible\(true\)[\s\S]*session\.beginLocalGame\('standard'\)[\s\S]*manager\.startRound\(\)/, 'the bot test must enter an isolated local standard table')
assert.match(aiSource, /const getTeammateId[\s\S]*id !== myPlayerId && players\[id\]\.team === myTeam/, 'AI teammate identity must come from the authoritative team field')
assert.match(aiSource, /const teammateHand = players\[teammateId\][\s\S]*players\[teammateId\]\.hand\.length/, 'pressure modelling must not mistake the bot itself for its teammate')

const core = require(path.resolve(root, '../../shared-core/dist'))
const card = (id, suit, rank, value) => ({ id, suit, rank, value, isLevelCard: false })
const players = core.createGame(2).players
players.p1.hand = [card('p1-3', 'spade', 3, 3), card('p1-9', 'heart', 9, 9)]
players.p2.hand = [card('p2-3', 'club', 3, 3), card('p2-9', 'diamond', 9, 9)]
players.p3.hand = [card('p3-4', 'spade', 4, 4), card('p3-8', 'heart', 8, 8)]
players.p4.hand = [card('p4-5', 'club', 5, 5), card('p4-7', 'diamond', 7, 7)]
const context = { currentLevel: 2, teamLevels: { teamA: 2, teamB: 2 }, roundMeta: null }
const single = playerId => ({ playerId, cards: [players[playerId].hand[0]], type: core.PlayType.Single })

const teammateResponseA = core.makeDecision(players.p3.hand, single('p1'), 'master', players.p3.team, players, 'p3', context)
assert.equal(teammateResponseA, null, 'teamA support bot must yield after its p1 teammate controls the trick')
assert.equal(core.getLastAIDecisionTrace().passReason, 'teammate_yield')
const enemyResponseA = core.makeDecision(players.p3.hand, single('p2'), 'master', players.p3.team, players, 'p3', context)
assert.ok(Array.isArray(enemyResponseA) && enemyResponseA.length > 0, 'teamA support bot must contest an enemy when it has a legal response')

const teammateResponseB = core.makeDecision(players.p2.hand, single('p4'), 'master', players.p2.team, players, 'p2', context)
assert.equal(teammateResponseB, null, 'teamB bot must also recognize p4 as its teammate')
assert.equal(core.getLastAIDecisionTrace().difficulty, 'master')

players.p2.team = 'teamA'
players.p3.team = 'teamB'
const remappedTeammateResponse = core.makeDecision(players.p1.hand, single('p2'), 'master', players.p1.team, players, 'p1', context)
assert.equal(remappedTeammateResponse, null, 'team recognition must follow authoritative team data instead of assuming the opposite seat')

console.log('master AI policy regression tests passed')
