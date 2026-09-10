import assert from 'node:assert/strict'
import { decisionDelayMs, prepareBotPlay } from './bot-turn-pacing.js'
import { createTurnClock } from './weapp-turn-clock.js'
import { BOT_NICKNAMES, generatedPlayerNickname, roomPlayerNicknames } from './player-nicknames.js'

for (const [cost, expected] of [[0, 500], [1, 500], [10, 500], [20, 1000], [40, 2000], [60, 3000], [200, 3000]]) {
  assert.equal(decisionDelayMs(cost, () => 0.1), expected)
  assert.equal(decisionDelayMs(cost, () => 0.099), expected * 3)
}
assert.equal(decisionDelayMs(NaN, () => 0.5), 500)
assert.equal(decisionDelayMs(-4, () => 0.5), 500)
assert.equal(Array.from({ length: 100 }, (_, i) => decisionDelayMs(20, () => i / 100)).filter(n => n === 3000).length, 10)
let time = 1000, choices = 0, measureTime = 0
const hand = [{ id: 'a', rank: 7 }, { id: 'b', rank: 9 }]
const room = { roomId: '123456', state: { revision: 1, playArea: [], players: { p2: { hand } } }, turnDeadlineAt: 21000 }
const policy = { chooseCards: () => { choices++; return [hand[0]] } }
const timing = { now: () => time, random: () => 0.5, measure: () => { const result = measureTime; measureTime += 20; return result } }
let result = prepareBotPlay(room, 'p2', policy, timing)
assert.equal(room.pendingBotPlay.at, 2000)
assert.equal(room.pendingBotPlay.elapsedMs, 20)
assert.equal(result.waitMs, 1000)
const restored = JSON.parse(JSON.stringify(room))
time = 1700
result = prepareBotPlay(restored, 'p2', policy, { ...timing, random: () => { throw Error('must not reroll') } })
assert.equal(choices, 1)
assert.equal(result.waitMs, 300)
time = 2500
assert.equal(prepareBotPlay(restored, 'p2', policy, timing).waitMs, 0)
const capped = { ...room, pendingBotPlay: null, turnDeadlineAt: 2700 }
assert.equal(prepareBotPlay(capped, 'p2', policy, { ...timing, random: () => 0 }).waitMs, 200)
assert.equal(capped.pendingBotPlay.delayMs, 3000, 'deadline caps schedule, not the recorded humanized sample')
restored.state.revision++
prepareBotPlay(restored, 'p2', policy, timing)
assert.equal(choices, 3)
const passing = { ...room, pendingBotPlay: null }
assert.equal(prepareBotPlay(passing, 'p2', { chooseCards: () => [] }, timing).waitMs, 1000, 'passing uses the same measured policy')

let timer, bot = true
const timedRoom = { roomId: '234567', state: { currentTurn: 'p2', phase: 'playing' }, trustees: {} }
const clocks = createTurnClock({
  clearTurnTimer: () => { timer = null }, turnTimers: new Map(), ensureLiveMetadata: () => {},
  deadlineStepFor: r => r.state.phase === 'playing' ? { playerId: r.state.currentTurn, action: 'play' } : null,
  isBotPlayer: () => bot, isMatchRoom: () => true, friendSecondMs: 1000,
  turnTimeoutMs: 20000, now: () => time,
  scheduleTimeout: (callback, delay) => { timer = { callback, delay }; return timer },
  enqueueServerOperation: fn => fn(), automatedDeadline: () => {}, publishTurnStatus: () => {},
})
time = 10000
clocks.armTurnDeadline(timedRoom)
assert.equal(timedRoom.turnDeadlineAt, 30000)
assert.equal(timer.delay, 0, 'calculate immediately; delay is measured and planned afterwards')
timedRoom.pendingBotPlay = { at: 12800 }
time = 11000
clocks.restoreTurnDeadline(timedRoom)
assert.equal(timer.delay, 1800)
bot = false
timedRoom.trustees.p2 = { reason: 'manual' }
clocks.armTurnDeadline(timedRoom)
assert.equal(timer.delay, 0, 'trustees use the identical immediate planning path')
assert.equal(timedRoom.turnDeadlineAt, 31000, 'trustees keep the full public turn budget')
timedRoom.pendingBotPlay = { at: 15000 }
clocks.restoreTurnDeadline(timedRoom)
assert.equal(timer.delay, 4000, 'restart restores trustee thinking, not just bot thinking')
timedRoom.trustees.p2 = null
clocks.armTurnDeadline(timedRoom)
assert.equal(timedRoom.pendingBotPlay, null, 'cancel trustee discards pending automatic cards')
assert.equal(timer.delay, 20000)
timedRoom.state.phase = 'settled'
clocks.restoreTurnDeadline(timedRoom)
assert.equal(timer, null)
assert.equal(timedRoom.pendingBotPlay, null)

const names = new Set()
for (let i = 0; i < 200; i++) {
  const identity = 'bot_test_' + i
  const name = generatedPlayerNickname(identity)
  assert.equal(name, generatedPlayerNickname(identity))
  assert.doesNotMatch(name, /机器人|大师|真人|官方|系统/)
  assert.ok([...name].length >= 1 && [...name].length <= 24)
  names.add(name)
  assert.equal(new Set(Object.values(roomPlayerNicknames({ matchId: String(i) }))).size, 4)
}
assert.ok(BOT_NICKNAMES.length >= 8 && BOT_NICKNAMES.length <= 50)
assert.equal(new Set(BOT_NICKNAMES).size, BOT_NICKNAMES.length)
assert.ok(names.size >= BOT_NICKNAMES.length * 0.8, 'identity hashing should use the imported pool')
assert.ok([...names].every(name => BOT_NICKNAMES.includes(name)))
const namedRoom = { matchId: 'durable-nickname' }
const allocated = roomPlayerNicknames(namedRoom)
assert.deepEqual(roomPlayerNicknames(JSON.parse(JSON.stringify(namedRoom))), allocated, 'persisted rooms retain their allocated names')
console.log('bot pacing, durable decisions, private wakeups and generated nickname tests passed')
