import assert from 'node:assert/strict'
import { botOpeningDelay, isDeliberatePlay, prepareBotPlay } from './bot-turn-pacing.js'
import { createTurnClock } from './weapp-turn-clock.js'
import { BOT_NICKNAMES, generatedPlayerNickname, roomPlayerNicknames } from './player-nicknames.js'

const card = (id, rank) => ({ id, rank })
const hand = [card('a', 7), card('b', 7), card('c', 7), card('d', 7), card('e', 9)]
assert.equal(isDeliberatePlay(hand, hand.slice(0, 4)), true)
assert.equal(isDeliberatePlay(hand, [hand[0]]), true)
assert.equal(isDeliberatePlay(hand, [hand[4]]), false)
assert.equal(isDeliberatePlay(hand, []), false)
assert.notEqual(botOpeningDelay(650, () => 0), botOpeningDelay(650, () => 1))
for (const base of [500, 650, 1000]) {
  assert.equal(botOpeningDelay(base, () => 0), 500)
  assert.equal(botOpeningDelay(base, () => 0.5), 1000)
  assert.equal(botOpeningDelay(base, () => 1), 1500)
}
assert.equal(botOpeningDelay(10, () => 1), 30, 'explicit accelerated test clocks remain supported')
let time = 1_650, choices = 0
const room = { roomId: '123456', state: { revision: 1, playArea: [], players: { p2: { hand } } },
  botTurnStartedAt: 1_000, turnDeadlineAt: 21_000 }
const policy = { chooseCards: () => { choices++; return hand.slice(0, 4) } }
let result = prepareBotPlay(room, 'p2', policy, { now: () => time, random: () => 1, baseMs: 650 })
assert.equal(room.pendingBotPlay.at, 4_000, 'deliberate action ends at 3s total, not 3s after its wakeup')
assert.equal(result.waitMs, 2_350)
const restored = JSON.parse(JSON.stringify(room))
time = 3_000
result = prepareBotPlay(restored, 'p2', policy, { now: () => time, random: () => 0, baseMs: 650 })
assert.equal(choices, 1, 'restart/retry does not choose again or shorten the decision')
assert.equal(result.waitMs, 1_000)
time = 4_500
assert.equal(prepareBotPlay(restored, 'p2', policy, { now: () => time, baseMs: 650 }).waitMs, 0)
const capped = { ...room, pendingBotPlay: null, turnDeadlineAt: 2_000 }
assert.equal(prepareBotPlay(capped, 'p2', policy, { now: () => 1_650, random: () => 1, baseMs: 650 }).waitMs, 350)
restored.state.revision++
prepareBotPlay(restored, 'p2', policy, { now: () => time, baseMs: 650 })
assert.equal(choices, 3, 'changed authoritative state invalidates the old plan')

let timer, published = 0
const timedRoom = { roomId: '234567', state: { currentTurn: 'p2', phase: 'playing' }, trustees: {} }
const clocks = createTurnClock({
  clearTurnTimer: () => { timer = null }, turnTimers: new Map(), ensureLiveMetadata: () => {},
  deadlineStepFor: r => r.state.phase === 'playing' ? { playerId: r.state.currentTurn, action: 'play' } : null,
  isBotPlayer: () => true, isMatchRoom: () => true, botActionDelayMs: 650, friendSecondMs: 1000,
  trusteeActionDelayMs: 500, turnTimeoutMs: 20_000, now: () => time,
  scheduleTimeout: (callback, delay) => { timer = { callback, delay }; return timer },
  enqueueServerOperation: fn => fn(), automatedDeadline: () => {}, publishTurnStatus: () => published++,
})
time = 10_000
clocks.armTurnDeadline(timedRoom)
assert.equal(timedRoom.turnDeadlineAt, 30_000, 'bot seats retain the same public 20s turn budget')
assert.ok(timer.delay >= 500 && timer.delay <= 1500)
timedRoom.pendingBotPlay = { at: 12_800 }
time = 11_000
clocks.restoreTurnDeadline(timedRoom)
assert.equal(timer.delay, 1_800)
assert.equal(timedRoom.turnDeadlineAt, 30_000)
timedRoom.state.phase = 'settled'
clocks.restoreTurnDeadline(timedRoom)
assert.equal(timer, null)
assert.equal(timedRoom.pendingBotPlay, null)
assert.equal(published, 1)

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
