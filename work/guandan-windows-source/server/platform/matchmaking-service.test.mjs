import assert from 'node:assert/strict'
import { BOT_NICKNAMES, roomPlayerNicknames } from '../player-nicknames.js'
import { GameTicketService, GameTicketVerifier } from './crypto.js'
import { FriendRoomService } from './friend-room-service.js'
import { MatchmakingService } from './matchmaking-service.js'
import { createInitialRating } from './rating.js'
import { createEmptyPlatformState, MemoryPlatformStore } from './storage.js'

let now = 1_700_000_000_000
const state = createEmptyPlatformState()
for (const userId of ['u1', 'u2', 'u3', 'u4']) {
  state.users[userId] = { id: userId, displayName: userId }
  state.wallets[userId] = { userId, balance: 10_000, currency: 'points', updatedAt: now }
  state.playerRatings[userId] = createInitialRating(userId)
}
const store = new MemoryPlatformStore(state)
let id = 0
let entry = 0
const matchmaking = new MatchmakingService({
  store,
  gameTickets: {
    issue (claims) {
      return {
        gameEndpoint: 'ws://game.test',
        gameTicket: `ticket-${claims.userId}`,
        expiresAt: now + 90_000,
        claims: structuredClone(claims),
      }
    },
  },
  now: () => now,
  createId: () => `id-${++id}`,
  createEntryAttemptId: () => `entry-attempt-${String(++entry).padStart(12, '0')}`,
  createRoomId: () => '123456',
  ensurePlayerRating: (draft, userId) => (draft.playerRatings[userId] ||= createInitialRating(userId)),
  ensureParticipantEntryAttemptId: (participant, preferred = '') => (participant.entryAttemptId ||= preferred || `entry-attempt-${String(++entry).padStart(12, '0')}`),
  friendRooms: {
    hasExpired: () => false,
    cancelExpired: () => false,
    cancelByHost: () => false,
  },
})

const joined = []
for (const userId of ['u1', 'u2', 'u3', 'u4']) joined.push(await matchmaking.join(userId, { mode: 'quick' }))
assert.ok(joined.every(result => result.matchId === joined[0].matchId))
assert.equal(joined[3].status, 'matched')
assert.deepEqual(
  (await Promise.all(['u1', 'u2', 'u3', 'u4'].map(userId => matchmaking.getStatus(userId, joined[0].matchId)))).map(result => result.seat),
  ['p1', 'p2', 'p3', 'p4'],
)
assert.deepEqual(await store.read(snapshot => snapshot.matchQueues), {})
await assert.rejects(
  () => matchmaking.cancel('u1', joined[0].matchId),
  error => error.code === 'MATCH_ALREADY_ASSIGNED',
)

now += 90_001
assert.equal((await matchmaking.getStatus('u1', joined[0].matchId)).status, 'cancelled')
const expired = await store.read(snapshot => snapshot)
assert.deepEqual(expired.activeMatchByUser, {})
assert.equal(expired.spectatorFeeds[joined[0].matchId].abortReason, 'entry-timeout')

const createBotFillFixture = () => {
  let fixtureNow = 1_800_000_000_000
  let fixtureId = 0
  let fixtureEntry = 0
  let fixtureRoom = 700000
  const fixtureState = createEmptyPlatformState()
  for (const userId of ['h1', 'h2', 'late', 'cancelled', 'tournament']) {
    fixtureState.users[userId] = { id: userId, displayName: userId }
    fixtureState.wallets[userId] = { userId, balance: 20_000, currency: 'points', updatedAt: fixtureNow }
    fixtureState.playerRatings[userId] = createInitialRating(userId)
  }
  const fixtureStore = new MemoryPlatformStore(fixtureState)
  const secret = 'match-bot-fill-test-secret-with-at-least-32-characters'
  const gameTickets = new GameTicketService({ secret, gameEndpoint: 'ws://game.test', now: () => fixtureNow })
  const service = new MatchmakingService({
    store: fixtureStore,
    gameTickets,
    now: () => fixtureNow,
    createId: () => `fixture-${++fixtureId}`,
    createEntryAttemptId: () => `fixture-entry-${String(++fixtureEntry).padStart(12, '0')}`,
    createRoomId: () => String(++fixtureRoom),
    ensurePlayerRating: (draft, userId) => (draft.playerRatings[userId] ||= createInitialRating(userId)),
    ensureParticipantEntryAttemptId: (participant, preferred = '') => (participant.entryAttemptId ||= preferred || `fixture-entry-${String(++fixtureEntry).padStart(12, '0')}`),
    friendRooms: { hasExpired: () => false, cancelExpired: () => false, cancelByHost: () => false },
  })
  return { service, store: fixtureStore, gameTickets, secret, now: () => fixtureNow, advance: ms => { fixtureNow += ms } }
}

const singleFixture = createBotFillFixture()
const singleWaiting = await singleFixture.service.join('h1', { mode: 'quick' })
assert.equal(singleWaiting.status, 'matching')
assert.equal(singleWaiting.botFillAt, singleFixture.now() + 3_000)
assert.equal(singleWaiting.humanPlayerCount, 1)
singleFixture.advance(2_999)
assert.equal((await singleFixture.service.getStatus('h1', singleWaiting.matchId)).status, 'matching')
singleFixture.advance(1)
const singleMatched = await singleFixture.service.getStatus('h1', singleWaiting.matchId)
assert.equal(singleMatched.status, 'matched')
assert.equal(singleMatched.botCount, 3)
assert.equal(singleMatched.humanPlayerCount, 1)
const singleSnapshot = await singleFixture.store.read(snapshot => snapshot)
const singleRecord = singleSnapshot.matches[singleWaiting.matchId]
const expectedBotNames = roomPlayerNicknames({ matchId: singleWaiting.matchId })
const persistedBotNames = singleRecord.participants.filter(item => item.isBot).map(item => {
  const name = singleSnapshot.users[item.userId].displayName
  assert.ok(BOT_NICKNAMES.includes(name))
  assert.equal(name, expectedBotNames[item.seat], 'platform account and game room must display the same nickname')
  return name
})
assert.equal(new Set(persistedBotNames).size, 3)
assert.deepEqual(singleRecord.participants.filter(item => item.isBot).map(item => item.seat), ['p2', 'p3', 'p4'])
assert.deepEqual(singleSnapshot.activeMatchByUser, { h1: singleWaiting.matchId }, '机器人不得占用玩家活跃匹配索引')
const verifiedSingleTicket = new GameTicketVerifier({ secret: singleFixture.secret, required: true, now: singleFixture.now }).inspect(singleMatched.gameTicket)
assert.deepEqual(verifiedSingleTicket.botUserIdsBySeat, Object.fromEntries(singleRecord.participants.filter(item => item.isBot).map(item => [item.seat, item.userId])))
const recoveryService = new FriendRoomService({
  store: singleFixture.store,
  gameTickets: singleFixture.gameTickets,
  now: singleFixture.now,
  createId: () => 'unused-recovery-id',
  createEntryAttemptId: () => 'unused-recovery-entry-0001',
  createRoomId: () => '999999',
  cancelExpiredUnstartedMatch: () => false,
})
const recoveredSingle = await recoveryService.recover('h1', { recoveryAttemptId: 'match-bot-recovery-attempt-0001' })
const verifiedRecoveryTicket = new GameTicketVerifier({ secret: singleFixture.secret, required: true, now: singleFixture.now }).inspect(recoveredSingle.gameTicket)
assert.deepEqual(verifiedRecoveryTicket.botUserIdsBySeat, verifiedSingleTicket.botUserIdsBySeat, '恢复票据必须保留同一组签名机器人席位')
const duplicateJoin = await singleFixture.service.join('h1', { mode: 'quick' })
assert.equal(duplicateJoin.matchId, singleMatched.matchId)
assert.equal(duplicateJoin.gameTicket, recoveredSingle.gameTicket, '重复加入必须返回当前已分配票据而不能另建牌桌')
await assert.rejects(() => singleFixture.service.cancel('h1', singleWaiting.matchId), error => error.code === 'MATCH_ALREADY_ASSIGNED')

const pairFixture = createBotFillFixture()
const pairFirst = await pairFixture.service.join('h1', { mode: 'classic_50' })
pairFixture.advance(1_000)
const pairSecond = await pairFixture.service.join('h2', { mode: 'classic_50' })
assert.equal(pairSecond.matchId, pairFirst.matchId)
pairFixture.advance(2_000)
const pairMatched = await pairFixture.service.getStatus('h2', pairFirst.matchId)
assert.equal(pairMatched.status, 'matched', '以最早玩家的三秒等待期限为准')
assert.equal(pairMatched.botCount, 2)

const cancelFixture = createBotFillFixture()
const cancelWaiting = await cancelFixture.service.join('cancelled', { mode: 'quick' })
cancelFixture.advance(2_999)
assert.equal((await cancelFixture.service.cancel('cancelled', cancelWaiting.matchId)).status, 'cancelled')
cancelFixture.advance(10_000)
assert.equal((await cancelFixture.service.getStatus('cancelled', cancelWaiting.matchId)).status, 'cancelled', '期限前取消后不得补机器人')

const lateFixture = createBotFillFixture()
const aged = await lateFixture.service.join('h1', { mode: 'quick' })
lateFixture.advance(3_001)
const late = await lateFixture.service.join('late', { mode: 'quick' })
assert.notEqual(late.matchId, aged.matchId, '超过期限的旧桌必须先补机器人，后来玩家进入新桌')
assert.equal((await lateFixture.service.getStatus('h1', aged.matchId)).status, 'matched')

const tournamentFixture = createBotFillFixture()
const tournamentWaiting = await tournamentFixture.service.join('tournament', { mode: 'rookie_cup' })
tournamentFixture.advance(60_000)
assert.equal((await tournamentFixture.service.getStatus('tournament', tournamentWaiting.matchId)).status, 'matching', '赛事队列禁止机器人补位')

console.log('matchmaking service tests passed')
