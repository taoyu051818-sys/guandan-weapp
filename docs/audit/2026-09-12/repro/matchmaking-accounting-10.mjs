import assert from 'node:assert/strict'
import { PlatformService } from '../../../../work/guandan-windows-source/server/platform/service.js'
import { MemoryPlatformStore, createEmptyPlatformState } from '../../../../work/guandan-windows-source/server/platform/storage.js'
import { AccessTokenService, GameTicketService, GameTicketVerifier } from '../../../../work/guandan-windows-source/server/platform/crypto.js'
import { CLASSIC_STAKES } from '../../../../work/guandan-windows-source/server/platform/classic-stakes.js'
import { createRoomMetadata } from '../../../../work/guandan-windows-source/server/weapp-room-metadata.js'
import { botSeatBindingsMatch, ensureMatchBotMetadata } from '../../../../work/guandan-windows-source/server/weapp-match-bot-seats.js'
import { buildGameResultEvent, recordAuthoritativeAction } from '../../../../work/guandan-windows-source/server/game-stats.js'

// Actual domain/facade/ticket modules, synthetic in-memory users and unused endpoint only.
const base = 1_800_000_000_000, seats = ['p1', 'p2', 'p3', 'p4']
class FaultStore extends MemoryPlatformStore {
  async persist () { if (this.failNext) { this.failNext = false; throw new Error('audit10 persist failure') } }
}
const fixture = () => {
  let now = base, id = 0, roomId = 600_000, entryId = 0
  const state = createEmptyPlatformState()
  for (let i = 0; i < 20; i++) {
    const userId = `human-${i}`
    state.users[userId] = { id: userId, displayName: userId }
    state.wallets[userId] = { userId, balance: 20_000, currency: 'points' }
  }
  state.products.auditItem = { id: 'auditItem', name: '合成测试物品', stock: 50, pointsPrice: 1 }
  const store = new FaultStore(state), secret = 'audit10-synthetic-secret-not-production'
  const gameTickets = new GameTicketService({ secret, now: () => now, gameEndpoint: 'ws://127.0.0.1:1/not-connected' })
  const verifier = new GameTicketVerifier({ secret, required: true, now: () => now })
  const service = new PlatformService({ store, gameTickets, accessTokens: new AccessTokenService({ secret, now: () => now }),
    now: () => now, createId: () => `audit10-${++id}`, createRoomId: () => String(++roomId),
    createEntryAttemptId: () => `audit10-entry-${String(++entryId).padStart(12, '0')}` })
  return { service, store, gameTickets, verifier, now: () => now, advance: ms => { now += ms } }
}
const roomMetadata = createRoomMetadata({ playerIds: seats, createResumeToken: () => 'audit10-resume',
  createBotSeed: () => 'audit10-bot-seed', entryKindForClaims: c => c.roomKind,
  entryDeadlineForClaims: c => c.exp * 1000 })
let modeHumanCases = 0, verifiedTickets = 0
for (const mode of ['quick', ...Object.keys(CLASSIC_STAKES)]) for (const humans of [1, 2, 3, 4]) {
  const f = fixture()
  const joined = await Promise.all(Array.from({ length: humans }, (_, i) => f.service.joinMatch(`human-${i}`, { mode })))
  const matchId = joined[0].matchId
  assert.equal(new Set(joined.map(x => x.matchId)).size, 1)
  if (humans < 4) {
    f.advance(2_999)
    assert.equal((await f.service.getMatchStatus('human-0', matchId)).status, 'matching')
    f.advance(1)
  }
  const views = await Promise.all(Array.from({ length: humans }, (_, i) => f.service.getMatchStatus(`human-${i}`, matchId)))
  const snapshot = await f.store.read(s => s), match = snapshot.matches[matchId]
  assert.equal(match.status, 'matched')
  assert.equal(match.participants.length, 4)
  assert.equal(new Set(match.participants.map(p => p.userId)).size, 4)
  assert.equal(new Set(match.participants.map(p => p.seat)).size, 4)
  assert.equal(match.participants.filter(p => p.isBot).length, 4 - humans)
  assert.equal(Object.keys(snapshot.activeMatchByUser).length, humans)
  assert.deepEqual(snapshot.matchQueues, {})
  const binding = Object.fromEntries(match.participants.filter(p => p.isBot).map(p => [p.seat, p.userId]))
  let room
  for (let i = 0; i < humans; i++) {
    const claims = f.verifier.inspect(views[i].gameTicket)
    assert.equal(claims.sub, `human-${i}`)
    assert.equal(claims.seat, seats[i])
    assert.equal(claims.matchMode, mode)
    assert.deepEqual(claims.botUserIdsBySeat || {}, binding)
    room ||= roomMetadata.createRoomRecord({ roomId: match.roomId, ticketClaims: claims })
    assert.equal(botSeatBindingsMatch(room, claims), true)
    room.userIdsBySeat[claims.seat] = claims.sub
    verifiedTickets++
  }
  ensureMatchBotMetadata(room)
  for (const seat of Object.keys(binding)) {
    assert.equal(room.userIdsBySeat[seat], binding[seat])
    assert.equal(room.seats[seat], null)
    assert.equal(room.resumeTokens[seat], null)
  }
  assert.deepEqual(room.userIdsBySeat, Object.fromEntries(match.participants.map(p => [p.seat, p.userId])))
  const beforeUnauthorized = await f.store.read(s => s)
  await assert.rejects(f.service.getMatchStatus('human-19', matchId), /不属于/)
  assert.deepEqual(await f.store.read(s => s), beforeUnauthorized)
  const recovered = await f.service.recoverActiveMatch('human-0', { recoveryAttemptId: 'audit10-recovery-attempt-00001' })
  assert.deepEqual(f.verifier.inspect(recovered.gameTicket).botUserIdsBySeat || {}, binding)
  const start = { eventId: `spectate:${matchId}:1`, matchId, roomId: match.roomId, sequence: 1,
    roundSequence: 1, at: f.now(), type: 'game-start' }
  await f.service.claimGameStart(start.eventId, start)
  room.roundSequence = 1; room.spectatorSequence = 2
  recordAuthoritativeAction(room.statsBySeat, 'p1', { kind: 'play', playType: 'Bomb' })
  const end = { ...start, eventId: `spectate:${matchId}:2`, sequence: 2, type: 'round-end',
    ranking: seats, winnerTeam: 'teamA', isGameWon: true }
  await f.service.acceptSpectatorEvent(end.eventId, end)
  const beforeResult = await f.store.read(s => s)
  // Synthetic terminal result: validates mapping/accounting, not 52 full games.
  const event = buildGameResultEvent(room, { fullRank: seats, winnerTeam: 'teamA', teamLevels: { teamA: 'A', teamB: 2 } }, f.now())
  assert.equal((await f.service.acceptGameResult(event.eventId, event)).accepted, true)
  assert.equal((await f.service.acceptGameResult(event.eventId, event)).duplicate, true)
  const after = await f.store.read(s => s)
  assert.equal(after.matches[matchId].status, 'completed')
  assert.deepEqual(after.activeMatchByUser, {})
  for (const participant of match.participants) {
    assert.equal(after.userStats[participant.userId].gamesPlayed, 1)
    assert.equal(after.userStats[participant.userId].bombsPlayed, participant.seat === 'p1' ? 1 : 0)
  }
  const delta = match.participants.reduce((sum, p) => sum + after.wallets[p.userId].balance - beforeResult.wallets[p.userId].balance, 0)
  assert.equal(delta, mode === 'quick' ? 200 : 0)
  modeHumanCases++
}

const concurrency = fixture()
const joined = await Promise.all(Array.from({ length: 16 }, (_, i) => concurrency.service.joinMatch(`human-${i}`, { mode: 'classic_50' })))
assert.equal(new Set(joined.map(x => x.matchId)).size, 4)
const concurrentState = await concurrency.store.read(s => s)
assert.equal(Object.keys(concurrentState.activeMatchByUser).length, 16)
assert.ok(Object.values(concurrentState.matches).every(m => m.status === 'matched' && m.participants.length === 4))

const failed = fixture()
const waiting = await failed.service.joinMatch('human-0', { mode: 'classic_300' })
failed.advance(3_000)
const before = await failed.store.read(s => s)
failed.store.failNext = true
await assert.rejects(failed.service.getMatchStatus('human-0', waiting.matchId), /audit10 persist failure/)
assert.deepEqual(await failed.store.read(s => s), before, 'no partial generated accounts/tickets/queue changes when matching commit fails')
assert.equal((await failed.service.getMatchStatus('human-0', waiting.matchId)).botCount, 3)
const assigned = await failed.store.read(s => s)
assert.equal(Object.keys(assigned.users).length, 23)
const expiresAt = assigned.matches[waiting.matchId].entryDeadlineAt
failed.advance(expiresAt - failed.now())
assert.equal((await failed.service.getMatchStatus('human-0', waiting.matchId)).status, 'cancelled')
assert.deepEqual(await failed.store.read(s => s.activeMatchByUser), {})

for (const offset of [2_999, 3_000]) {
  const f = fixture(), first = await f.service.joinMatch('human-0', { mode: 'quick' })
  f.advance(offset)
  if (offset < 3_000) {
    assert.equal((await f.service.cancelMatch('human-0', first.matchId)).status, 'cancelled')
    f.advance(1)
    assert.equal((await f.service.getMatchStatus('human-0', first.matchId)).botCount, 0)
  } else {
    await assert.rejects(f.service.cancelMatch('human-0', first.matchId), e => e.code === 'MATCH_ALREADY_ASSIGNED')
    assert.equal((await f.service.getMatchStatus('human-0', first.matchId)).botCount, 3)
  }
}

for (const operationOrder of ['match-first', 'purchase-first']) {
  const f = fixture()
  await f.store.transaction(s => { s.wallets['human-0'].balance = 350; s.products.auditItem.pointsPrice = 100 })
  const purchase = () => f.service.commerce.redeem('human-0', { productId: 'auditItem' }, 'audit10-purchase')
  const match = () => f.service.joinMatch('human-0', { mode: 'classic_300' })
  const outcomes = await Promise.allSettled(operationOrder === 'match-first' ? [match(), purchase()] : [purchase(), match()])
  assert.equal(outcomes[0].status, 'fulfilled')
  assert.equal(outcomes[1].status, 'rejected')
  const snapshot = await f.store.read(s => s)
  assert.equal(snapshot.wallets['human-0'].balance, operationOrder === 'match-first' ? 350 : 250)
  assert.equal(Boolean(snapshot.activeMatchByUser['human-0']), operationOrder === 'match-first')
}
const purchaseRetry = fixture()
const beforePurchase = await purchaseRetry.store.read(s => s)
purchaseRetry.store.failNext = true
await assert.rejects(purchaseRetry.service.commerce.redeem('human-0', { productId: 'auditItem' }, 'audit10-idempotent'), /audit10 persist failure/)
assert.deepEqual(await purchaseRetry.store.read(s => s), beforePurchase)
const orders = await Promise.all(Array.from({ length: 20 }, () => purchaseRetry.service.commerce.redeem('human-0', { productId: 'auditItem' }, 'audit10-idempotent')))
assert.equal(new Set(orders.map(x => x.orderId)).size, 1)
assert.equal(await purchaseRetry.store.read(s => s.products.auditItem.stock), 49)
assert.equal(await purchaseRetry.store.read(s => s.wallets['human-0'].balance), 19_999)
assert.equal(await purchaseRetry.store.read(s => s.ledgerEntries.length), 1)
console.log(JSON.stringify({ matchmakingAccounting10: { modeHumanCases, verifiedTickets, concurrentHumans: 16,
  isolatedMatchedTables: 4, botFillFailureRecovery: true, cancelBoundaryControls: 2,
  reservedStakePurchaseOrderings: 2, idempotentPurchaseAttempts: 20 } }, null, 2))
