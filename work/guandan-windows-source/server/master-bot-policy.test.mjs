import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createRoomBotPolicy, MASTER_BOT_DIFFICULTY, roundMetaForAI } from './master-bot-policy.js'
import { prepareDuplicateAutomaticPlay } from './duplicate-auto-policy.js'

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
const sourceRoundMeta = { fromTribute: true, isAntiTribute: false }
const copiedRoundMeta = roundMetaForAI(sourceRoundMeta)
assert.deepEqual(copiedRoundMeta, sourceRoundMeta)
assert.notEqual(copiedRoundMeta, sourceRoundMeta, '服务端 AI 上下文不得持有权威状态中的可变引用')
assert.equal(roundMetaForAI(null), null)
assert.throws(() => roundMetaForAI({ fromTribute: true }), /局次上下文无效/)

const policy = createRoomBotPolicy({ ruleProfile: controlledGame('p1').ruleProfile, seed: 20260811 })

let teammateLed = controlledGame('p1')
teammateLed = playCards(teammateLed, 'p1', [teammateLed.players.p1.hand[0]])
teammateLed = passTurn(teammateLed, 'p2')
assert.equal(teammateLed.currentTurn, 'p3')
assert.equal(
  policy.chooseCards({ state: teammateLed, teamLevels: { teamA: 2, teamB: 2 }, playerId: 'p3' }),
  null,
  'p3 必须识别 p1 为队友并让牌，不能压制友方有效出牌',
)

let enemyLed = controlledGame('p2')
enemyLed = playCards(enemyLed, 'p2', [enemyLed.players.p2.hand[0]])
const enemyResponse = policy.chooseCards({ state: enemyLed, teamLevels: { teamA: 2, teamB: 2 }, playerId: 'p3' })
assert.ok(Array.isArray(enemyResponse) && enemyResponse.length > 0, 'p3 必须识别 p2 为敌方并在有合法跟牌时进行策略响应')

const corrupted = controlledGame('p1')
corrupted.players.p3.team = 'teamB'
assert.throws(
  () => policy.chooseCards({ state: corrupted, teamLevels: { teamA: 2, teamB: 2 }, playerId: 'p3' }),
  /队伍数据无效/,
  '服务端不得在席位与队伍映射损坏时继续执行机器人决策',
)

const isolatedA = createRoomBotPolicy({ ruleProfile: enemyLed.ruleProfile, seed: 77 })
const isolatedB = createRoomBotPolicy({ ruleProfile: enemyLed.ruleProfile, seed: 77 })
const beforeB = isolatedB.checkpoint()
const choiceA = isolatedA.chooseCards({ state: enemyLed, teamLevels: { teamA: 2, teamB: 2 }, playerId: 'p3' })
assert.deepEqual(isolatedB.checkpoint(), beforeB, '一个房间的决策不得修改另一个房间的 AI 状态')
const choiceB = isolatedB.chooseCards({ state: enemyLed, teamLevels: { teamA: 2, teamB: 2 }, playerId: 'p3' })
assert.deepEqual(choiceB?.map(card => card.id), choiceA?.map(card => card.id), '相同 seed 的独立房间必须可复现')
assert.deepEqual(isolatedB.checkpoint(), isolatedA.checkpoint(), '相同输入序列的房间 checkpoint 必须一致')

const serializedCheckpoint = JSON.parse(JSON.stringify(isolatedA.checkpoint()))
const restored = createRoomBotPolicy({
  ruleProfile: enemyLed.ruleProfile,
  seed: 1,
  checkpoint: serializedCheckpoint,
})
const continuedChoice = isolatedA.chooseCards({ state: enemyLed, teamLevels: { teamA: 2, teamB: 2 }, playerId: 'p3' })
const restoredChoice = restored.chooseCards({ state: enemyLed, teamLevels: { teamA: 2, teamB: 2 }, playerId: 'p3' })
assert.deepEqual(restoredChoice?.map(card => card.id), continuedChoice?.map(card => card.id), '恢复后的房间必须延续同一决策序列')
assert.deepEqual(restored.checkpoint(), isolatedA.checkpoint(), '恢复后的房间必须延续同一记牌与随机状态')

assert.equal(restored.getLastDecisionTrace().team.policy, 'team-first-v1')
assert.equal(restored.checkpoint().teamDecisions.at(-1).objective, 'team-first-place')

const hidden = controlledGame('p3')
for (const id of ['p1', 'p2', 'p4']) {
  hidden.players[id].hand = new Proxy(hidden.players[id].hand, {
    get(target, property) {
      assert.equal(property, 'length', '机器人边界只能读取其他玩家的公开余牌数')
      return target.length
    },
  })
}
assert.ok(createRoomBotPolicy({ seed: 5 }).chooseCards({ state: hidden, playerId: 'p3' }).length)

let now = 1000
const timing = { random: () => 0.5, measure: () => 0 }
const duplicateTable = { state: controlledGame('p1'), deadlineAt: 21000 }
const first = prepareDuplicateAutomaticPlay(duplicateTable, 51, () => now, timing)
assert.ok(first.cards.length)
assert.equal(first.waitMs, 500)
const replayTable = structuredClone(duplicateTable)
const checkpoint = structuredClone(duplicateTable.aiCheckpoint)
now += 600
assert.equal(prepareDuplicateAutomaticPlay(replayTable, 51, () => now, timing).waitMs, 0)
assert.deepEqual(replayTable.aiCheckpoint, checkpoint, '恢复复式等待计划不重复决策')
duplicateTable.state.revision = 2
replayTable.state.revision = 2
prepareDuplicateAutomaticPlay(duplicateTable, 51, () => now, timing)
prepareDuplicateAutomaticPlay(replayTable, 51, () => now, timing)
assert.deepEqual(replayTable.aiCheckpoint, duplicateTable.aiCheckpoint)
assert.deepEqual(replayTable.pendingBotPlay, duplicateTable.pendingBotPlay)

process.stdout.write('master bot team-awareness policy tests passed\n')
