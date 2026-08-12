import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
  createInitialMatchState,
  dispatchMatchIntent,
  migrateLegacyMatchState,
  replaceSettlement,
} from './game-session.js'

const require = createRequire(import.meta.url)
const { getRuleProfile } = require('../../../shared-core/dist')
const card = (id, value) => ({ id, suit: 'spade', rank: value, value, isLevelCard: false })
const teamFor = id => id === 'p1' || id === 'p3' ? 'teamA' : 'teamB'
const player = (id, hand) => ({ id, name: id, isAI: false, team: teamFor(id), hand, role: 'normal' })
const players = hands => Object.fromEntries(Object.entries(hands).map(([id, hand]) => [id, player(id, hand)]))

const initial = createInitialMatchState({
  players: players({
    p1: [card('p1-3', 3), card('p1-8', 8)],
    p2: [card('p2-4', 4)],
    p3: [card('p3-5', 5)],
    p4: [card('p4-6', 6)],
  }),
  ruleProfile: getRuleProfile('classic'),
})
assert.equal(initial.revision, 1)
const played = dispatchMatchIntent(initial, { type: 'PLAY_CARDS', playerId: 'p1', cardIds: ['p1-3'] })
assert.equal(played.ok, true)
assert.equal(played.state.revision, 2)
assert.equal(played.state.currentTurn, 'p2')
assert.deepEqual(played.events.map(event => event.type), ['CARDS_PLAYED', 'TURN_ADVANCED'])

const settlementFixture = createInitialMatchState({
  players: players({
    p1: [],
    p2: [card('p2-4', 4)],
    p3: [card('p3-5', 5)],
    p4: [card('p4-6', 6)],
  }),
  ruleProfile: getRuleProfile('classic'),
})
settlementFixture.currentTurn = 'p3'
settlementFixture.finishedPlayers = ['p1']
const settled = dispatchMatchIntent(settlementFixture, { type: 'PLAY_CARDS', playerId: 'p3', cardIds: ['p3-5'] })
assert.equal(settled.ok, true)
assert.equal(settled.state.phase, 'settled')
assert.ok(settled.events.some(event => event.type === 'ROUND_SETTLED'))

const lastPlay = { playerId: 'p1', cards: [card('legacy-3', 3)], type: 'Single' }
const legacy = migrateLegacyMatchState({
  state: {
    currentLevel: 2,
    players: players({
      p1: [card('p1-8', 8)], p2: [card('p2-4', 4)],
      p3: [card('p3-5', 5)], p4: [card('p4-6', 6)],
    }),
    turnOrder: ['p1', 'p2', 'p3', 'p4'],
    currentTurn: 'p3',
    playArea: [lastPlay, { playerId: 'p2', cards: [], type: 'Pass' }],
    lastValidPlay: lastPlay,
    finishedPlayers: [],
  },
  ruleProfile: getRuleProfile('classic'),
  gameVersion: 7,
  roundSequence: 2,
})
assert.equal(legacy.revision, 7)
assert.equal(legacy.roundId, 3)
assert.equal(legacy.trick.winningPlay.playerId, 'p1')
assert.deepEqual(legacy.trick.passedPlayerIds, ['p2'])

const untrustedProfile = { id: 'client-injected', allowJokerWildcards: true }
const canonicalOverride = migrateLegacyMatchState({
  state: { ...initial, ruleProfile: untrustedProfile },
  ruleProfile: getRuleProfile('classic'),
})
assert.deepEqual(canonicalOverride.ruleProfile, getRuleProfile('classic'), '恢复必须用房间预设覆盖快照规则对象')

const escrowed = card('escrowed', 16)
const tributeMigrated = migrateLegacyMatchState({
  state: {
    currentLevel: 2,
    players: players({
      p1: [card('p1-8', 8)], p2: [card('p2-4', 4)],
      p3: [], p4: [card('p4-6', 6)],
    }),
    turnOrder: ['p1', 'p2', 'p3', 'p4'],
    currentTurn: 'p3',
    playArea: [],
    lastValidPlay: null,
    finishedPlayers: [],
  },
  ruleProfile: getRuleProfile('classic'),
  lastRoundRank: ['p1', 'p2', 'p3', 'p4'],
  tribute: {
    isDoubleDown: true,
    isAntiTribute: false,
    phase: 'tributing',
    actions: [
      { from: 'p3', to: 'p1', card: escrowed, returnCard: null },
      { from: 'p4', to: 'p2', card: null, returnCard: null },
    ],
  },
})
assert.equal(tributeMigrated.phase, 'tribute')
assert.equal(tributeMigrated.tribute.status, 'selecting_tribute')
assert.equal(tributeMigrated.tribute.exchanges[0].tributeCardId, escrowed.id)
assert.ok(tributeMigrated.players.p3.hand.some(candidate => candidate.id === escrowed.id), '旧 escrow 牌必须回到贡者手中再等待批量转移')

const priorScores = { ...settlementFixture, scores: { teamA: 4, teamB: 7 } }
const failedASettlement = {
  winnerTeam: 'teamB',
  levelUp: -1,
  currentLevel: 'K',
  teamLevels: { teamA: 'K', teamB: 'A' },
  aFailStreaks: { teamA: 1, teamB: 0 },
  fullRank: ['p1', 'p2', 'p4', 'p3'],
  isGameWon: false,
  message: '冲A失败',
}
const failedAState = replaceSettlement(priorScores, settlementFixture, failedASettlement)
assert.equal(failedAState.settlement.levelUp, -1, 'A 关失败仍需保留负等级变化')
assert.deepEqual(failedAState.scores, priorScores.scores, 'A 关失败不得倒扣任一队的累计分')

const upgradedState = replaceSettlement(priorScores, settlementFixture, {
  ...failedASettlement,
  winnerTeam: 'teamA',
  levelUp: 2,
})
assert.deepEqual(upgradedState.scores, { teamA: 6, teamB: 7 }, '正升级增量必须继续累加')

process.stdout.write('authoritative game session tests passed\n')
