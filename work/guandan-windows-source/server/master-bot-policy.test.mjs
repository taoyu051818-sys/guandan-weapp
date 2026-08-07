import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { chooseMasterBotCards, MASTER_BOT_DIFFICULTY } from './master-bot-policy.js'

const require = createRequire(import.meta.url)
const { createGame, passTurn, playCards } = require('../../../shared-core/dist')

const card = (id, suit, rank, value) => ({ id, suit, rank, value, isLevelCard: false })
const controlledGame = (leaderId) => {
  const state = createGame(2, leaderId)
  state.players.p1.hand = [card('p1-3', 'spade', 3, 3), card('p1-9', 'heart', 9, 9)]
  state.players.p2.hand = [card('p2-3', 'club', 3, 3), card('p2-9', 'diamond', 9, 9)]
  state.players.p3.hand = [card('p3-4', 'spade', 4, 4), card('p3-8', 'heart', 8, 8)]
  state.players.p4.hand = [card('p4-5', 'club', 5, 5), card('p4-7', 'diamond', 7, 7)]
  state.currentTurn = leaderId
  state.lastValidPlay = null
  state.playArea = []
  state.finishedPlayers = []
  return state
}

assert.equal(MASTER_BOT_DIFFICULTY, 'master', '牌局服只允许最高档机器人策略')

let teammateLed = controlledGame('p1')
teammateLed = playCards(teammateLed, 'p1', [teammateLed.players.p1.hand[0]])
teammateLed = passTurn(teammateLed, 'p2')
assert.equal(teammateLed.currentTurn, 'p3')
assert.equal(
  chooseMasterBotCards({ state: teammateLed, teamLevels: { teamA: 2, teamB: 2 }, playerId: 'p3' }),
  null,
  'p3 必须识别 p1 为队友并让牌，不能压制友方有效出牌',
)

let enemyLed = controlledGame('p2')
enemyLed = playCards(enemyLed, 'p2', [enemyLed.players.p2.hand[0]])
const enemyResponse = chooseMasterBotCards({ state: enemyLed, teamLevels: { teamA: 2, teamB: 2 }, playerId: 'p3' })
assert.ok(Array.isArray(enemyResponse) && enemyResponse.length > 0, 'p3 必须识别 p2 为敌方并在有合法跟牌时进行策略响应')

const corrupted = controlledGame('p1')
corrupted.players.p3.team = 'teamB'
assert.throws(
  () => chooseMasterBotCards({ state: corrupted, teamLevels: { teamA: 2, teamB: 2 }, playerId: 'p3' }),
  /队伍数据无效/,
  '服务端不得在席位与队伍映射损坏时继续执行机器人决策',
)

process.stdout.write('master bot team-awareness policy tests passed\n')
