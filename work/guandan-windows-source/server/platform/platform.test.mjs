import assert from 'node:assert/strict'
import './rating-matchmaking.test.mjs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPlatformRuntime } from '../platform-server.js'
import { GameResultReporter } from './result-reporter.js'
import { SpectatorEventReporter } from './spectator-event-reporter.js'
import { AccessTokenService, GameTicketService, GameTicketVerifier } from './crypto.js'
import { unauthorized } from './errors.js'
import { createSeededPlatformState } from './seeds.js'
import { JsonFilePlatformStore, MemoryPlatformStore, RedisPlatformStorePrototype } from './storage.js'
import { PlatformService } from './service.js'
import { calculateBaseScore, calculateComprehensiveScore } from './rating.js'
import { WxCodeVerifier } from './wx-auth.js'

const accessSecret = 'test-access-secret-with-at-least-thirty-two-characters'
const ticketSecret = 'test-ticket-secret-with-at-least-thirty-two-characters'
const resultSecret = 'test-result-secret-with-at-least-thirty-two-characters'
const spectatorSecret = 'test-spectator-secret-with-at-least-thirty-two-characters'
const baseEnv = {
  NODE_ENV: 'test',
  PLATFORM_ACCESS_SECRET: accessSecret,
  GAME_TICKET_SECRET: ticketSecret,
  GAME_RESULT_SECRET: resultSecret,
  GAME_SPECTATOR_EVENT_SECRET: spectatorSecret,
  GAME_ENDPOINT: 'ws://127.0.0.1:39999/weapp',
}
const fakeWxVerifier = {
  async verify (code) {
    if (!/^valid-[1-4]$/.test(code)) throw unauthorized('微信登录凭证无效或已过期')
    return { externalId: `wx:test:${code}` }
  },
}
const listen = async (runtime) => {
  await new Promise(resolve => runtime.server.listen(0, '127.0.0.1', resolve))
  const { port } = runtime.server.address()
  return `http://127.0.0.1:${port}`
}
const close = (runtime) => new Promise(resolve => runtime.server.close(resolve))
const call = async (baseUrl, path, { method = 'GET', token, body, headers = {} } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, payload: await response.json() }
}

const disabledRuntime = await createPlatformRuntime({ env: baseEnv, wxCodeVerifier: fakeWxVerifier, logger: { error () {} } })
const disabledBaseUrl = await listen(disabledRuntime)
try {
  const disabled = await call(disabledBaseUrl, '/api/v1/auth/dev-login', { method: 'POST', body: { externalId: 'must-not-login' } })
  assert.equal(disabled.status, 403)
  assert.deepEqual(Object.keys(disabled.payload).sort(), ['data', 'error', 'ok'])
  assert.equal(disabled.payload.error.code, 'DEV_LOGIN_DISABLED')
} finally {
  await close(disabledRuntime)
}

const runtime = await createPlatformRuntime({ env: { ...baseEnv, PLATFORM_ENABLE_DEV_LOGIN: 'true' }, wxCodeVerifier: fakeWxVerifier })
const baseUrl = await listen(runtime)
try {
  const invalidWx = await call(baseUrl, '/api/v1/auth/wx-login', { method: 'POST', body: { code: 'arbitrary-code' } })
  assert.equal(invalidWx.status, 401, '测试验证器不能把任意 code 当作用户')

  const users = []
  for (let index = 1; index <= 4; index += 1) {
    const login = await call(baseUrl, '/api/v1/auth/wx-login', { method: 'POST', body: { code: `valid-${index}`, displayName: `测试玩家${index}` } })
    assert.equal(login.status, 200)
    assert.equal(login.payload.ok, true)
    assert.equal(login.payload.error, null)
    users.push({ token: login.payload.data.accessToken, user: login.payload.data.user })
  }
  assert.ok(users.every(({ user }) => /^\d{8}$/.test(user.accountId)), '登录必须返回八位数字账号')
  assert.equal(new Set(users.map(({ user }) => user.accountId)).size, users.length, '不同用户的八位账号不得重复')
  assert.ok(users.every(({ user }) => Number.isSafeInteger(user.comprehensiveScore) && user.comprehensiveScore >= 1_000), '登录公开资料必须返回综合分')

  const devLogin = await call(baseUrl, '/api/v1/auth/dev-login', { method: 'POST', body: { deviceId: 'local-debug-device', externalId: 'must-not-win', displayName: '开发账号' } })
  assert.equal(devLogin.status, 200)
  const devRelogin = await call(baseUrl, '/api/v1/auth/dev-login', { method: 'POST', body: { deviceId: 'local-debug-device', externalId: 'changed-fallback', displayName: '开发账号重登' } })
  assert.equal(devRelogin.payload.data.user.id, devLogin.payload.data.user.id, '同一 deviceId 重登必须保持同一用户')
  assert.equal(devRelogin.payload.data.user.accountId, devLogin.payload.data.user.accountId, '同一用户重登必须保持八位账号')
  assert.equal((await call(baseUrl, '/api/v1/wallet', { token: devRelogin.payload.data.accessToken })).payload.data.wallet.balance, 10_000)
  const unenrolledTournamentMatch = await call(baseUrl, '/api/v1/match/join', { method: 'POST', token: devLogin.payload.data.accessToken, body: { mode: 'weekend_cup' } })
  assert.equal(unenrolledTournamentMatch.status, 403, '未报名用户不得进入赛事匹配')

  const classicMatches = {}
  const classicPlayers = {}
  const classicStakes = { classic_50: 50, classic_300: 300, classic_2000: 2_000, classic_10000: 10_000 }
  for (const mode of Object.keys(classicStakes)) {
    const joined = []
    const players = []
    for (let index = 1; index <= 4; index += 1) {
      const login = await call(baseUrl, '/api/v1/auth/dev-login', {
        method: 'POST',
        body: { deviceId: `${mode}-player-${index}`, displayName: `${mode}玩家${index}` },
      })
      assert.equal(login.status, 200)
      players.push({ token: login.payload.data.accessToken, user: login.payload.data.user })
      const response = await call(baseUrl, '/api/v1/match/join', {
        method: 'POST',
        token: login.payload.data.accessToken,
        body: { mode },
      })
      assert.equal(response.status, 200, '经典底分场无需赛事报名即可匹配')
      joined.push(response.payload.data.match)
    }
    assert.equal(joined[0].status, 'matching')
    assert.equal(joined[3].status, 'matched')
    assert.ok(joined.every(match => match.mode === mode && match.queueId === mode))
    classicMatches[mode] = joined[3].matchId
    classicPlayers[mode] = players
  }
  assert.equal(new Set(Object.values(classicMatches)).size, Object.keys(classicStakes).length, '不同底分场必须使用独立匹配池')

  for (const [mode, stake] of Object.entries(classicStakes)) {
    const match = await runtime.store.read(state => state.matches[classicMatches[mode]])
    const usersBySeat = Object.fromEntries(match.participants.map(participant => [participant.seat, participant.userId]))
    const event = {
      eventId: `game:${match.id}:stake-test`,
      matchId: match.id,
      roomId: match.roomId,
      ranking: ['p1', 'p3', 'p2', 'p4'],
      userIdsBySeat: usersBySeat,
      winnerTeam: 'teamA',
      finishedAt: Date.now(),
      statsBySeat: {},
    }
    await runtime.service.acceptGameResult(event.eventId, event)
    const settledMatch = await runtime.store.read(state => state.matches[match.id])
    assert.equal(settledMatch.status, 'completed')
    assert.ok(settledMatch.participants.every(participant => participant.status === 'completed' && Number.isSafeInteger(participant.completedAt)), '正常结算必须把所有参与者统一置为 completed')
    const balancesBySeat = {}
    for (const player of classicPlayers[mode]) {
      const participant = match.participants.find(item => item.userId === player.user.id)
      balancesBySeat[participant.seat] = (await call(baseUrl, '/api/v1/wallet', { token: player.token })).payload.data.wallet.balance
    }
    assert.deepEqual(
      balancesBySeat,
      { p1: 10_000 + stake, p2: 10_000 - stake, p3: 10_000 + stake, p4: 10_000 - stake },
      `${mode} 应由败方各向对应胜方全额转移底分`,
    )
    const settlementLedger = await runtime.store.read(state => state.ledgerEntries.filter(entry => entry.referenceId === event.eventId))
    assert.deepEqual(settlementLedger.map(entry => entry.type).sort(), ['classic_stake_loss', 'classic_stake_loss', 'classic_stake_win', 'classic_stake_win'])
    assert.deepEqual(settlementLedger.map(entry => entry.amount).sort((left, right) => left - right), [-stake, -stake, stake, stake])
  }

  const historicalPlayer = classicPlayers.classic_50[0]
  const currentClassicMatch = await call(baseUrl, '/api/v1/match/join', {
    method: 'POST',
    token: historicalPlayer.token,
    body: { mode: 'classic_50' },
  })
  assert.equal(currentClassicMatch.payload.data.match.status, 'matching')
  const historicalCancel = await call(baseUrl, '/api/v1/match/cancel', {
    method: 'POST',
    token: historicalPlayer.token,
    body: { matchId: classicMatches.classic_50 },
  })
  assert.equal(historicalCancel.status, 409)
  assert.equal(historicalCancel.payload.error.code, 'MATCH_NOT_ACTIVE')
  assert.equal(
    await runtime.store.read(state => state.activeMatchByUser[historicalPlayer.user.id]),
    currentClassicMatch.payload.data.match.matchId,
    '取消历史对局不得删除当前匹配索引',
  )
  const walletAfterHistoricalCancel = await call(baseUrl, '/api/v1/wallet', { token: historicalPlayer.token })
  assert.deepEqual(
    {
      balance: walletAfterHistoricalCancel.payload.data.wallet.balance,
      reserved: walletAfterHistoricalCancel.payload.data.wallet.reserved,
      available: walletAfterHistoricalCancel.payload.data.wallet.available,
    },
    { balance: 10_050, reserved: 50, available: 10_000 },
    '取消历史对局不得释放当前经典场底分',
  )
  const currentCancel = await call(baseUrl, '/api/v1/match/cancel', {
    method: 'POST',
    token: historicalPlayer.token,
    body: { matchId: currentClassicMatch.payload.data.match.matchId },
  })
  assert.equal(currentCancel.status, 200)

  const poorLogin = await call(baseUrl, '/api/v1/auth/dev-login', { method: 'POST', body: { deviceId: 'classic-poor-player', displayName: '积分不足玩家' } })
  await runtime.store.transaction(state => { state.wallets[poorLogin.payload.data.user.id].balance = 49 })
  const insufficientClassicStake = await call(baseUrl, '/api/v1/match/join', { method: 'POST', token: poorLogin.payload.data.accessToken, body: { mode: 'classic_50' } })
  assert.equal(insufficientClassicStake.status, 409)
  assert.equal(insufficientClassicStake.payload.error.code, 'INSUFFICIENT_CLASSIC_STAKE')

  const reservedLogin = await call(baseUrl, '/api/v1/auth/dev-login', { method: 'POST', body: { deviceId: 'classic-reserved-player', displayName: '底分冻结玩家' } })
  const reservedToken = reservedLogin.payload.data.accessToken
  const reservedMatch = await call(baseUrl, '/api/v1/match/join', { method: 'POST', token: reservedToken, body: { mode: 'classic_10000' } })
  assert.equal(reservedMatch.payload.data.match.status, 'matching')
  const reservedWallet = await call(baseUrl, '/api/v1/wallet', { token: reservedToken })
  assert.deepEqual(
    {
      balance: reservedWallet.payload.data.wallet.balance,
      reserved: reservedWallet.payload.data.wallet.reserved,
      available: reservedWallet.payload.data.wallet.available,
    },
    { balance: 10_000, reserved: 10_000, available: 0 },
  )
  const blockedRedeem = await call(baseUrl, '/api/v1/orders/redeem', {
    method: 'POST',
    token: reservedToken,
    body: { productId: 'soap', quantity: 1, expectedPointsPrice: 600 },
    headers: { 'idempotency-key': 'reserved-redeem' },
  })
  assert.equal(blockedRedeem.status, 409)
  assert.equal(blockedRedeem.payload.error.code, 'INSUFFICIENT_POINTS')
  assert.deepEqual(blockedRedeem.payload.error.details, { balance: 10_000, reserved: 10_000, available: 0, required: 600 })
  const blockedEnrollment = await call(baseUrl, '/api/v1/tournaments/weekend-cup/enroll', {
    method: 'POST',
    token: reservedToken,
    body: { expectedEntryPoints: 200 },
    headers: { 'idempotency-key': 'reserved-enrollment' },
  })
  assert.equal(blockedEnrollment.status, 409)
  assert.equal(blockedEnrollment.payload.error.code, 'INSUFFICIENT_POINTS')
  assert.deepEqual(blockedEnrollment.payload.error.details, { balance: 10_000, reserved: 10_000, available: 0, required: 200 })
  const cancelledReservedMatch = await call(baseUrl, '/api/v1/match/cancel', {
    method: 'POST',
    token: reservedToken,
    body: { matchId: reservedMatch.payload.data.match.matchId },
  })
  assert.equal(cancelledReservedMatch.payload.data.match.status, 'cancelled')
  const releasedWallet = await call(baseUrl, '/api/v1/wallet', { token: reservedToken })
  assert.deepEqual(
    {
      balance: releasedWallet.payload.data.wallet.balance,
      reserved: releasedWallet.payload.data.wallet.reserved,
      available: releasedWallet.payload.data.wallet.available,
    },
    { balance: 10_000, reserved: 0, available: 10_000 },
  )
  const redeemAfterCancel = await call(baseUrl, '/api/v1/orders/redeem', {
    method: 'POST',
    token: reservedToken,
    body: { productId: 'soap', quantity: 1, expectedPointsPrice: 600 },
    headers: { 'idempotency-key': 'reserved-redeem-after-cancel' },
  })
  assert.equal(redeemAfterCancel.status, 200, '取消经典场后应立即释放冻结底分')

  const profile = await call(baseUrl, '/api/v1/profile', { token: users[0].token })
  assert.equal(profile.payload.data.user.displayName, '测试玩家1')
  assert.equal(profile.payload.data.user.accountId, users[0].user.accountId)
  assert.equal(profile.payload.data.user.comprehensiveScore, users[0].user.comprehensiveScore)
  const renamed = await call(baseUrl, '/api/v1/profile', { method: 'PATCH', token: users[0].token, body: { displayName: '陵水一号' } })
  assert.equal(renamed.payload.data.user.displayName, '陵水一号')
  const initialDashboard = await call(baseUrl, '/api/v1/me/dashboard', { token: users[0].token })
  assert.equal(initialDashboard.payload.data.user.accountId, users[0].user.accountId)
  assert.equal(initialDashboard.payload.data.user.comprehensiveScore, initialDashboard.payload.data.rating.comprehensiveScore)
  assert.deepEqual({ games: initialDashboard.payload.data.rating.games, wins: initialDashboard.payload.data.rating.wins, eloOffset: initialDashboard.payload.data.rating.eloOffset }, { games: 0, wins: 0, eloOffset: 0 })
  assert.equal('elo' in initialDashboard.payload.data.stats, false, '旧 stats.elo 不得继续冒充综合分')
  assert.equal(initialDashboard.payload.data.stats.gamesPlayed, 0)
  assert.equal(initialDashboard.payload.data.season.name, '陵水夏季赛季')
  const initialTasks = await call(baseUrl, '/api/v1/season/tasks', { token: users[0].token })
  assert.equal(initialTasks.payload.data.tasks.length, 3)
  assert.ok(initialTasks.payload.data.tasks.every(task => task.claimed === false))

  const products = await call(baseUrl, '/api/v1/products')
  assert.ok(products.payload.data.products.length >= 8)
  const soap = products.payload.data.products.find(product => product.id === 'soap')
  assert.equal(soap.pointsPrice, 600)

  const walletBefore = await call(baseUrl, '/api/v1/wallet', { token: users[0].token })
  assert.equal(walletBefore.payload.data.wallet.balance, 10_000)
  assert.equal(walletBefore.payload.data.ledgerEntries[0].type, 'welcome_bonus')
  const stalePriceOrder = await call(baseUrl, '/api/v1/orders/redeem', { method: 'POST', token: users[0].token, body: { productId: 'soap', quantity: 1, expectedPointsPrice: 601 }, headers: { 'idempotency-key': 'redeem-stale-price' } })
  assert.equal(stalePriceOrder.status, 409)
  assert.equal(stalePriceOrder.payload.error.code, 'PRODUCT_PRICE_CHANGED')
  const redeemOptions = { method: 'POST', token: users[0].token, body: { productId: 'soap', quantity: 2, expectedPointsPrice: 600 }, headers: { 'idempotency-key': 'redeem-soap-1' } }
  const firstOrder = await call(baseUrl, '/api/v1/orders/redeem', redeemOptions)
  const duplicateOrder = await call(baseUrl, '/api/v1/orders/redeem', redeemOptions)
  assert.equal(firstOrder.payload.data.order.orderId, duplicateOrder.payload.data.order.orderId)
  const conflictingOrder = await call(baseUrl, '/api/v1/orders/redeem', { ...redeemOptions, body: { productId: 'soap', quantity: 3, expectedPointsPrice: 600 } })
  assert.equal(conflictingOrder.status, 409)
  assert.equal(conflictingOrder.payload.error.code, 'IDEMPOTENCY_CONFLICT')
  const walletAfterOrder = await call(baseUrl, '/api/v1/wallet', { token: users[0].token })
  assert.equal(walletAfterOrder.payload.data.wallet.balance, 8_800, '幂等重试只能扣一次积分')
  assert.equal(walletAfterOrder.payload.data.ledgerEntries.filter(entry => entry.type === 'shop_redeem').length, 1)
  const dashboardAfterOrder = await call(baseUrl, '/api/v1/me/dashboard', { token: users[0].token })
  assert.equal(dashboardAfterOrder.payload.data.user.comprehensiveScore, initialDashboard.payload.data.user.comprehensiveScore, '商城积分消费不得影响综合分')
  assert.deepEqual(dashboardAfterOrder.payload.data.rating, initialDashboard.payload.data.rating)

  const tournaments = await call(baseUrl, '/api/v1/tournaments', { token: users[0].token })
  assert.ok(tournaments.payload.data.tournaments.some(item => item.id === 'weekend-cup' && item.enrolled === false))
  const staleEntryFee = await call(baseUrl, '/api/v1/tournaments/weekend-cup/enroll', { method: 'POST', token: users[0].token, body: { expectedEntryPoints: 201 }, headers: { 'idempotency-key': 'weekend-stale-fee' } })
  assert.equal(staleEntryFee.status, 409)
  assert.equal(staleEntryFee.payload.error.code, 'TOURNAMENT_PRICE_CHANGED')
  const enrollmentOptions = { method: 'POST', token: users[0].token, body: { expectedEntryPoints: 200 }, headers: { 'idempotency-key': 'weekend-enrollment-1' } }
  const firstEnrollment = await call(baseUrl, '/api/v1/tournaments/weekend-cup/enroll', enrollmentOptions)
  const duplicateEnrollment = await call(baseUrl, '/api/v1/tournaments/weekend-cup/enroll', enrollmentOptions)
  assert.equal(firstEnrollment.payload.data.enrollment.enrollmentId, duplicateEnrollment.payload.data.enrollment.enrollmentId)
  for (let index = 1; index < users.length; index += 1) {
    const enrollment = await call(baseUrl, '/api/v1/tournaments/weekend-cup/enroll', {
      method: 'POST',
      token: users[index].token,
      body: { expectedEntryPoints: 200 },
      headers: { 'idempotency-key': `weekend-enrollment-${index + 1}` },
    })
    assert.equal(enrollment.status, 200)
  }
  const emptyStandings = await call(baseUrl, '/api/v1/tournaments/weekend-cup/standings')
  assert.equal(emptyStandings.payload.data.standings.find(item => item.userId === users[0].user.id).displayName, '陵水一号')
  assert.ok(emptyStandings.payload.data.standings.every(item => item.points === 0))
  const walletAfterEnrollment = await call(baseUrl, '/api/v1/wallet', { token: users[0].token })
  assert.equal(walletAfterEnrollment.payload.data.wallet.balance, 8_600)

  const joined = []
  for (const user of users) {
    const response = await call(baseUrl, '/api/v1/match/join', { method: 'POST', token: user.token, body: { mode: 'weekend_cup' } })
    joined.push(response.payload.data.match)
  }
  assert.equal(joined[0].status, 'matching')
  assert.equal(joined[3].status, 'matched')
  const matchId = joined[3].matchId
  const matched = []
  for (const user of users) {
    const response = await call(baseUrl, `/api/v1/match/status?matchId=${encodeURIComponent(matchId)}`, { token: user.token })
    matched.push(response.payload.data.match)
  }
  assert.equal(new Set(matched.map(item => item.roomId)).size, 1)
  assert.deepEqual(new Set(matched.map(item => item.seat)), new Set(['p1', 'p2', 'p3', 'p4']))
  assert.ok(matched.every(item => item.gameEndpoint === baseEnv.GAME_ENDPOINT && item.gameTicket === item.joinToken))
  const liveSpectatorList = await call(baseUrl, '/api/v1/spectate?delaySeconds=1')
  assert.equal(liveSpectatorList.payload.data.delaySeconds, 15, '公开观战延迟不得低于15秒')
  const liveSpectator = liveSpectatorList.payload.data.feeds.find(item => item.matchId === matchId)
  assert.equal(liveSpectator.status, 'running')
  assert.equal(liveSpectator.availableEventCount, 0)
  assert.equal('roomId' in liveSpectator, false, '公开观战列表不得暴露入桌房间码')
  assert.equal('userIds' in liveSpectator, false, '公开观战列表不得暴露平台用户ID')
  const liveFeed = await call(baseUrl, `/api/v1/spectate/${encodeURIComponent(matchId)}?delaySeconds=15`)
  assert.equal(liveFeed.payload.data.feed.status, 'running')
  assert.deepEqual(liveFeed.payload.data.feed.events, [])
  assert.equal('roomId' in liveFeed.payload.data.feed, false)

  const spectatorReporter = new SpectatorEventReporter({ endpoint: `${baseUrl}/api/v1/game/spectator-events`, secret: spectatorSecret, lifecycleSecret: resultSecret, maxAttempts: 1 })
  const firstSpectatorEvent = {
    eventId: `spectate:${matchId}:1`,
    matchId,
    roomId: matched[0].roomId,
    sequence: 1,
    at: Date.now() - 20_000,
    type: 'play',
    roundSequence: 1,
    playerId: 'p1',
    automatic: false,
    playType: 'Single',
    cards: [{ rank: 'A', suit: 'heart' }],
  }
  const secondSpectatorEvent = {
    eventId: `spectate:${matchId}:2`,
    matchId,
    roomId: matched[0].roomId,
    sequence: 2,
    at: Date.now() - 19_000,
    type: 'pass',
    roundSequence: 1,
    playerId: 'p2',
    automatic: true,
  }
  const wrongSpectatorSecret = new SpectatorEventReporter({ endpoint: `${baseUrl}/api/v1/game/spectator-events`, secret: resultSecret, maxAttempts: 1 })
  await assert.rejects(() => wrongSpectatorSecret.report(firstSpectatorEvent), /签名/)
  await assert.rejects(() => spectatorReporter.report({ ...firstSpectatorEvent, cards: [{ rank: 'A', suit: 'heart', id: 'must-not-leak' }] }), /不允许字段/)
  await assert.rejects(() => spectatorReporter.report(secondSpectatorEvent), /序号不连续/)
  await assert.rejects(() => spectatorReporter.report({ ...firstSpectatorEvent, roomId: '999999' }), /匹配不一致/)
  const firstStreamAccepted = await spectatorReporter.report(firstSpectatorEvent)
  const duplicateStreamAccepted = await spectatorReporter.report(firstSpectatorEvent)
  assert.equal(firstStreamAccepted.duplicate, false)
  assert.equal(duplicateStreamAccepted.duplicate, true)
  await assert.rejects(() => spectatorReporter.report({ ...firstSpectatorEvent, automatic: true }), /同一个观战事件ID/)
  await spectatorReporter.report(secondSpectatorEvent)

  const retryCalls = []
  let transientFailures = 2
  const retryingReporter = new SpectatorEventReporter({
    endpoint: 'https://spectator-retry.test/events',
    secret: spectatorSecret,
    maxAttempts: 1,
    retryBaseMs: 1,
    retryMaxMs: 2,
    fetchImpl: async (_url, options) => {
      const queuedEvent = JSON.parse(options.body)
      retryCalls.push(queuedEvent.sequence)
      if (queuedEvent.sequence === 1 && transientFailures-- > 0) throw new Error('temporary outage')
      return { ok: true, async json () { return { ok: true, data: { event: { sequence: queuedEvent.sequence } } } } }
    },
  })
  const recoveredHead = retryingReporter.enqueue({ ...firstSpectatorEvent, matchId: 'retry-match', eventId: 'retry:1', sequence: 1 })
  const queuedBehindHead = retryingReporter.enqueue({ ...secondSpectatorEvent, matchId: 'retry-match', eventId: 'retry:2', sequence: 2 })
  assert.deepEqual((await Promise.all([recoveredHead, queuedBehindHead])).map(item => item.sequence), [1, 2])
  assert.deepEqual(retryCalls, [1, 1, 1, 2], '失败头事件必须原地恢复，后续 sequence 不得越过或继承 rejection')
  let markStopAttempt
  const stopAttempted = new Promise(resolve => { markStopAttempt = resolve })
  const stoppingReporter = new SpectatorEventReporter({
    endpoint: 'https://spectator-stop.test/events',
    secret: spectatorSecret,
    maxAttempts: 1,
    retryBaseMs: 1000,
    fetchImpl: async () => { markStopAttempt(); throw new Error('still offline') },
  })
  const stoppedReport = stoppingReporter.enqueue({ ...firstSpectatorEvent, matchId: 'stop-match', eventId: 'stop:1', sequence: 1 })
  await stopAttempted
  stoppingReporter.stop('stop-match', new Error('manual stop'))
  await assert.rejects(stoppedReport, /manual stop/, '显式 stop 必须结束失败头及其 unref 退避')
  const delayedLiveFeed = await call(baseUrl, `/api/v1/spectate/${encodeURIComponent(matchId)}?delaySeconds=15`)
  assert.equal(delayedLiveFeed.payload.data.feed.events.length, 2)
  assert.equal(delayedLiveFeed.payload.data.feed.events[0].cards[0].rank, 'A')
  for (const publicEvent of delayedLiveFeed.payload.data.feed.events) {
    assert.equal('eventId' in publicEvent, false, '公开时间线不得泄露内部事件ID')
    assert.equal('matchId' in publicEvent, false, '公开时间线事件不得重复暴露内部匹配键')
    assert.equal('roomId' in publicEvent, false, '公开时间线事件不得泄露六位入桌房间码')
  }

  await call(baseUrl, '/api/v1/tournaments/rookie-cup/enroll', { method: 'POST', token: devLogin.payload.data.accessToken, body: { expectedEntryPoints: 0 }, headers: { 'idempotency-key': 'rookie-dev-enroll' } })
  const cancellation = await call(baseUrl, '/api/v1/match/join', { method: 'POST', token: devLogin.payload.data.accessToken, body: { mode: 'rookie_cup' } })
  const queueMateLogin = await call(baseUrl, '/api/v1/auth/dev-login', { method: 'POST', body: { deviceId: 'queue-mate', displayName: '排队同伴' } })
  await call(baseUrl, '/api/v1/tournaments/rookie-cup/enroll', { method: 'POST', token: queueMateLogin.payload.data.accessToken, body: { expectedEntryPoints: 0 }, headers: { 'idempotency-key': 'rookie-mate-enroll' } })
  await call(baseUrl, '/api/v1/match/join', { method: 'POST', token: queueMateLogin.payload.data.accessToken, body: { mode: 'rookie_cup' } })
  const cancelled = await call(baseUrl, '/api/v1/match/cancel', { method: 'POST', token: devLogin.payload.data.accessToken, body: { matchId: cancellation.payload.data.match.matchId } })
  assert.equal(cancelled.payload.data.match.status, 'cancelled')
  const rejoinedQueue = await call(baseUrl, '/api/v1/match/join', { method: 'POST', token: devLogin.payload.data.accessToken, body: { mode: 'rookie_cup' } })
  assert.equal(rejoinedQueue.payload.data.match.status, 'matching', '取消后重新排队不能命中旧的 cancelled 参与记录')
  await call(baseUrl, '/api/v1/match/cancel', { method: 'POST', token: devLogin.payload.data.accessToken, body: { matchId: rejoinedQueue.payload.data.match.matchId } })

  const ticketVerifier = new GameTicketVerifier({ secret: ticketSecret, required: true })
  matched.forEach(item => {
    const claims = ticketVerifier.verifyAndConsume(item.gameTicket, { roomId: item.roomId, seat: item.seat })
    assert.equal(claims.sub, users[Number(item.seat.slice(1)) - 1].user.id)
    const consumedStatus = ticketVerifier.inspectWithConsumptionStatus(item.gameTicket, { roomId: item.roomId, seat: item.seat })
    assert.equal(consumedStatus.consumed, true)
    assert.equal(consumedStatus.claims.jti, claims.jti)
    assert.throws(() => ticketVerifier.verifyAndConsume(item.gameTicket), /已使用/)
  })

  let ticketClock = 1_700_000_000_000
  const expiringTickets = new GameTicketService({ secret: ticketSecret, gameEndpoint: 'ws://test/weapp', ttlMs: 1000, now: () => ticketClock })
  const expiring = expiringTickets.issue({ userId: 'usr-expiry', matchId: 'mat-expiry', roomId: '123456', seat: 'p1' })
  ticketClock += 2000
  const expiryVerifier = new GameTicketVerifier({ secret: ticketSecret, required: true, now: () => ticketClock })
  assert.throws(() => expiryVerifier.inspect(expiring.gameTicket), /过期/)

  const event = {
    eventId: `game:${matchId}:1`,
    matchId,
    roomId: matched[0].roomId,
    ranking: ['p1', 'p2', 'p3', 'p4'],
    userIdsBySeat: Object.fromEntries(matched.map((item, index) => [item.seat, users[index].user.id])),
    winnerTeam: 'teamA',
    finishedAt: Date.now(),
    statsBySeat: { p1: { bombsPlayed: 2 }, p2: { bombsPlayed: 0 }, p3: { bombsPlayed: 1 }, p4: { bombsPlayed: 0 } },
    publicTimeline: [
      { at: Date.now() - 22_000, type: 'play', playerId: 'p1', cards: [{ rank: 'A', suit: 'heart' }] },
      { at: Date.now() - 20_000, type: 'pass', playerId: 'p2', text: '不要' },
    ],
  }
  const reporter = new GameResultReporter({ endpoint: `${baseUrl}/api/v1/game/results`, secret: resultSecret, maxAttempts: 1 })
  const invalidResult = await call(baseUrl, '/api/v1/game/results', {
    method: 'POST',
    body: event,
    headers: {
      'x-game-event-id': event.eventId,
      'x-game-timestamp': String(Date.now()),
      'x-game-signature': 'invalid-signature',
    },
  })
  assert.equal(invalidResult.status, 401)
  await assert.rejects(() => reporter.report({ ...event, eventId: `${event.eventId}:bad-team`, winnerTeam: 'teamZ' }), /winnerTeam/)
  await assert.rejects(() => reporter.report({
    ...event,
    eventId: `${event.eventId}:duplicate-user`,
    userIdsBySeat: { ...event.userIdsBySeat, p2: event.userIdsBySeat.p1 },
  }), /四个不同用户/)
  await assert.rejects(() => reporter.report({ ...event, eventId: `${event.eventId}:bad-stats`, statsBySeat: { ...event.statsBySeat, p1: { bombsPlayed: 1.5 } } }), /0 到 99/)
  await assert.rejects(() => reporter.report({
    ...event,
    eventId: `${event.eventId}:wrong-users`,
    userIdsBySeat: { ...event.userIdsBySeat, p1: devLogin.payload.data.user.id },
  }), /席位用户与匹配分配不一致/)
  const accepted = await reporter.report(event)
  const duplicate = await reporter.report(event)
  assert.equal(accepted.duplicate, false)
  assert.equal(duplicate.duplicate, true)
  await assert.rejects(() => reporter.report({ ...event, finishedAt: event.finishedAt + 1 }), /同一个结算事件ID/)
  await assert.rejects(() => reporter.report({ ...event, eventId: `${event.eventId}:second` }), /已经完成结算/)
  const walletAfterResult = await call(baseUrl, '/api/v1/wallet', { token: users[0].token })
  assert.equal(walletAfterResult.payload.data.wallet.balance, 8_700, '重复结算事件只能入账一次')
  assert.equal(walletAfterResult.payload.data.ledgerEntries.filter(entry => entry.referenceId === event.eventId).length, 1)
  const dashboardAfterResult = await call(baseUrl, '/api/v1/me/dashboard', { token: users[0].token })
  assert.equal(dashboardAfterResult.payload.data.stats.gamesPlayed, 1)
  assert.equal(dashboardAfterResult.payload.data.stats.wins, 1)
  assert.equal(dashboardAfterResult.payload.data.stats.firstPlaceFinishes, 1)
  assert.equal(dashboardAfterResult.payload.data.stats.bombsPlayed, 2)
  assert.equal(dashboardAfterResult.payload.data.rating.games, 1)
  assert.equal(dashboardAfterResult.payload.data.rating.wins, 1)
  assert.equal(dashboardAfterResult.payload.data.rating.eloOffset, 100, '同分队伍胜者每人应获得100 ELO修正')
  assert.equal(dashboardAfterResult.payload.data.user.comprehensiveScore, dashboardAfterResult.payload.data.rating.comprehensiveScore)
  assert.equal(dashboardAfterResult.payload.data.recentMatches[0].replayId, `rpl_${event.eventId}`)

  const standingsAfterResult = await call(baseUrl, '/api/v1/tournaments/weekend-cup/standings')
  assert.deepEqual(standingsAfterResult.payload.data.standings.map(item => item.points), [3, 2, 1, 0])
  assert.equal(standingsAfterResult.payload.data.tournament.currentRound, 1)
  assert.equal(standingsAfterResult.payload.data.tournament.status, 'running')
  assert.ok(standingsAfterResult.payload.data.standings.every(item => item.advanced === false), '未完成全部轮次不得提前标记晋级')
  assert.ok(standingsAfterResult.payload.data.standings.every(item => !('opponents' in item)), '公开排名不得暴露对手内部用户 ID')

  const replayList = await call(baseUrl, '/api/v1/replays', { token: users[0].token })
  assert.equal(replayList.payload.data.replays.length, 1)
  assert.equal(replayList.payload.data.replays[0].eventCount, 2)
  assert.equal('userIds' in replayList.payload.data.replays[0], false, '牌谱列表不得暴露平台用户 ID')
  const replay = await call(baseUrl, `/api/v1/replays/${encodeURIComponent(replayList.payload.data.replays[0].id)}`, { token: users[0].token })
  assert.equal(replay.payload.data.replay.events[0].cards[0].rank, 'A')
  assert.equal('userIds' in replay.payload.data.replay, false, '牌谱详情不得暴露平台用户 ID')
  const spectator = await call(baseUrl, `/api/v1/spectate/${encodeURIComponent(matchId)}?delaySeconds=15`)
  assert.equal(spectator.payload.data.feed.events.length, 2)
  assert.equal(spectator.payload.data.feed.delaySeconds, 15)
  assert.equal(spectator.payload.data.feed.status, 'finished')
  assert.equal(spectator.payload.data.feed.timelineComplete, false, '结束状态与延迟时间线是两个独立概念')
  assert.equal('roomId' in spectator.payload.data.feed, false)
  const finishedSpectatorList = await call(baseUrl, '/api/v1/spectate?delaySeconds=15')
  assert.equal(finishedSpectatorList.payload.data.feeds.find(item => item.matchId === matchId).status, 'finished')
  const ignoredFinishedClose = await spectatorReporter.report({
    eventId: `spectate:${matchId}:3`, matchId, roomId: matched[0].roomId,
    sequence: 3, at: Date.now(), type: 'room-closed', roundSequence: 1, reason: 'empty-timeout',
  })
  assert.equal(ignoredFinishedClose.ignored, true, '正常结算后的资源回收应被确认但不能把 feed 改判为 aborted')
  assert.equal((await call(baseUrl, `/api/v1/spectate/${encodeURIComponent(matchId)}?delaySeconds=15`)).payload.data.feed.status, 'finished')

  const abortUsers = []
  for (let index = 1; index <= 4; index += 1) {
    const login = await call(baseUrl, '/api/v1/auth/dev-login', { method: 'POST', body: { deviceId: `abort-device-${index}`, displayName: `退出测试${index}` } })
    abortUsers.push({ token: login.payload.data.accessToken, user: login.payload.data.user })
  }
  const abortJoins = []
  for (const user of abortUsers) abortJoins.push((await call(baseUrl, '/api/v1/match/join', { method: 'POST', token: user.token, body: { mode: 'quick' } })).payload.data.match)
  const abortMatchId = abortJoins.at(-1).matchId
  const abortViews = []
  for (const user of abortUsers) abortViews.push((await call(baseUrl, `/api/v1/match/status?matchId=${encodeURIComponent(abortMatchId)}`, { token: user.token })).payload.data.match)
  const abortRoomId = abortViews[0].roomId
  const abortStart = {
    eventId: `spectate:${abortMatchId}:1`, matchId: abortMatchId, roomId: abortRoomId,
    sequence: 1, at: Date.now() - 20_000, type: 'game-start', roundSequence: 1,
  }
  const abortClose = {
    eventId: `spectate:${abortMatchId}:2`, matchId: abortMatchId, roomId: abortRoomId,
    sequence: 2, at: Date.now() - 19_000, type: 'room-closed', roundSequence: 1, reason: 'empty-timeout',
  }
  const lowPrivilegeReporter = new SpectatorEventReporter({ endpoint: `${baseUrl}/api/v1/game/spectator-events`, secret: spectatorSecret, maxAttempts: 1 })
  await assert.rejects(() => lowPrivilegeReporter.report({
    ...abortClose,
    eventId: `spectate:${abortMatchId}:1`,
    sequence: 1,
  }), /高权限|签名/, '只有观战密钥的调用方不得终止平台匹配')
  await spectatorReporter.report(abortStart)
  await spectatorReporter.report(abortClose)
  const abortedFeed = await call(baseUrl, `/api/v1/spectate/${encodeURIComponent(abortMatchId)}?delaySeconds=15`)
  assert.equal(abortedFeed.payload.data.feed.status, 'aborted')
  assert.equal(abortedFeed.payload.data.feed.abortReason, 'empty-timeout')
  assert.equal(abortedFeed.payload.data.feed.timelineComplete, true)
  assert.equal(abortedFeed.payload.data.feed.events.at(-1).type, 'room-closed')
  assert.equal('roomId' in abortedFeed.payload.data.feed.events.at(-1), false)
  for (const user of abortUsers) {
    const status = await call(baseUrl, `/api/v1/match/status?matchId=${encodeURIComponent(abortMatchId)}`, { token: user.token })
    assert.equal(status.payload.data.match.status, 'aborted')
    assert.equal('gameTicket' in status.payload.data.match, false, '终止匹配不应继续下发旧入桌票据')
  }
  await assert.rejects(() => spectatorReporter.report({ ...abortClose, eventId: `spectate:${abortMatchId}:3`, sequence: 3 }), /已终止牌桌/)
  const rematchAfterAbort = await call(baseUrl, '/api/v1/match/join', { method: 'POST', token: abortUsers[0].token, body: { mode: 'quick' } })
  assert.equal(rematchAfterAbort.payload.data.match.status, 'matching', 'room-closed 必须释放 activeMatch，允许玩家重新排队')
  const abortSnapshot = await runtime.store.read(state => state)
  assert.equal(abortSnapshot.gameResultByMatch[abortMatchId], undefined, 'aborted 牌桌不得伪造正常结算')
  assert.equal(Object.values(abortSnapshot.gameResults).some(result => result.event?.matchId === abortMatchId), false)
  const recoveredResultEvent = {
    eventId: `game:${abortMatchId}:1`,
    matchId: abortMatchId,
    roomId: abortRoomId,
    ranking: ['p1', 'p2', 'p3', 'p4'],
    userIdsBySeat: Object.fromEntries(abortViews.map((view, index) => [view.seat, abortUsers[index].user.id])),
    winnerTeam: 'teamA',
    finishedAt: Date.now(),
  }
  assert.equal((await reporter.report(recoveredResultEvent)).accepted, true, '正式签名结算必须能覆盖异常回收竞态')
  const recoveredMatch = await call(baseUrl, `/api/v1/match/status?matchId=${encodeURIComponent(abortMatchId)}`, { token: abortUsers[0].token })
  assert.equal(recoveredMatch.payload.data.match.status, 'completed')
  const recoveredFeed = await call(baseUrl, `/api/v1/spectate/${encodeURIComponent(abortMatchId)}?delaySeconds=15`)
  assert.equal(recoveredFeed.payload.data.feed.status, 'finished')
  assert.equal((await call(baseUrl, `/api/v1/match/status?matchId=${encodeURIComponent(rematchAfterAbort.payload.data.match.matchId)}`, { token: abortUsers[0].token })).payload.data.match.status, 'matching', '补到的旧局结算不得破坏玩家的新匹配')

  const completedTasks = await call(baseUrl, '/api/v1/season/tasks', { token: users[0].token })
  assert.equal(completedTasks.payload.data.tasks.find(task => task.id === 'daily-play-1').completed, true)
  const taskClaimOptions = { method: 'POST', token: users[0].token, headers: { 'idempotency-key': 'claim-daily-1' } }
  const taskClaim = await call(baseUrl, '/api/v1/season/tasks/daily-play-1/claim', taskClaimOptions)
  const duplicateTaskClaim = await call(baseUrl, '/api/v1/season/tasks/daily-play-1/claim', taskClaimOptions)
  assert.equal(taskClaim.payload.data.claim.duplicate, false)
  assert.equal(duplicateTaskClaim.payload.data.claim.duplicate, true)
  assert.equal((await call(baseUrl, '/api/v1/wallet', { token: users[0].token })).payload.data.wallet.balance, 8_780)

  const merchantApplication = await call(baseUrl, '/api/v1/merchants/apply', { method: 'POST', token: users[0].token, body: { name: '陵水生活馆', contactName: '店长' } })
  assert.equal(merchantApplication.payload.data.merchant.status, 'pending')
  const storeOptions = { method: 'POST', token: users[0].token, body: { name: '清水湾店', address: '陵水示例地址' }, headers: { 'idempotency-key': 'create-store-1' } }
  const pendingStore = await call(baseUrl, '/api/v1/merchants/stores', storeOptions)
  assert.equal(pendingStore.status, 403, '未审核商户不得创建门店')
  await runtime.store.transaction(state => { state.merchants[merchantApplication.payload.data.merchant.id].status = 'active' })
  const firstStore = await call(baseUrl, '/api/v1/merchants/stores', storeOptions)
  const duplicateStore = await call(baseUrl, '/api/v1/merchants/stores', storeOptions)
  assert.equal(firstStore.payload.data.store.id, duplicateStore.payload.data.store.id)
  const employee = await call(baseUrl, '/api/v1/merchants/employees', { method: 'POST', token: users[0].token, body: { employeeUserId: users[1].user.id, role: 'cashier' } })
  assert.equal(employee.payload.data.employee.role, 'cashier')
  const selfGrant = await call(baseUrl, '/api/v1/merchants/points/grant', { method: 'POST', token: users[0].token, body: { storeId: firstStore.payload.data.store.id, recipientUserId: users[0].user.id, amount: 100 }, headers: { 'idempotency-key': 'blocked-self-grant' } })
  assert.equal(selfGrant.status, 403, '商户负责人不得给自己发分')
  const recipientBalance = (await call(baseUrl, '/api/v1/wallet', { token: users[2].token })).payload.data.wallet.balance
  const grantOptions = { method: 'POST', token: users[1].token, body: { storeId: firstStore.payload.data.store.id, recipientUserId: users[2].user.id, amount: 250, note: '线下消费奖励' }, headers: { 'idempotency-key': 'grant-points-1' } }
  const firstGrant = await call(baseUrl, '/api/v1/merchants/points/grant', grantOptions)
  const duplicateGrant = await call(baseUrl, '/api/v1/merchants/points/grant', grantOptions)
  assert.equal(firstGrant.payload.data.grant.duplicate, false)
  assert.equal(duplicateGrant.payload.data.grant.duplicate, true)
  assert.equal((await call(baseUrl, '/api/v1/wallet', { token: users[2].token })).payload.data.wallet.balance, recipientBalance + 250)
  const merchantConsole = await call(baseUrl, '/api/v1/merchants/me', { token: users[0].token })
  assert.equal(merchantConsole.payload.data.stores.length, 1)
  assert.equal(merchantConsole.payload.data.employees.length, 1)
  assert.equal(merchantConsole.payload.data.grantedPoints, 250)
  const nextMatch = await call(baseUrl, '/api/v1/match/join', { method: 'POST', token: users[0].token, body: { mode: 'weekend_cup' } })
  assert.equal(nextMatch.payload.data.match.status, 'matching', '结算完成后用户应能进入下一场匹配')

  const snapshot = await runtime.store.read(state => state)
  const ledgerCount = snapshot.ledgerEntries.length
  snapshot.ledgerEntries.length = 0
  assert.equal((await runtime.store.read(state => state.ledgerEntries.length)), ledgerCount, '读取快照不能修改不可变账本')
} finally {
  await close(runtime)
}

const tempRoot = await mkdtemp(join(tmpdir(), 'guandan-platform-'))
try {
  const filePath = join(tempRoot, 'platform.json')
  const jsonStore = await JsonFilePlatformStore.open(filePath, createSeededPlatformState())
  await jsonStore.transaction(state => { state.products.soap.stock = 7 })
  const reopened = await JsonFilePlatformStore.open(filePath, createSeededPlatformState())
  assert.equal(await reopened.read(state => state.products.soap.stock), 7)

  const legacyPath = join(tempRoot, 'platform-schema-4.json')
  const legacyState = createSeededPlatformState()
  legacyState.schemaVersion = 4
  legacyState.users = {
    usr_legacy_a: { id: 'usr_legacy_a', externalId: 'legacy-a', accountId: '23456789', displayName: '旧账号甲', avatarUrl: '', createdAt: 1, updatedAt: 1 },
    usr_legacy_b: { id: 'usr_legacy_b', externalId: 'legacy-b', accountId: '23456789', displayName: '旧账号乙', avatarUrl: '', createdAt: 2, updatedAt: 2 },
    usr_legacy_c: { id: 'usr_legacy_c', externalId: 'legacy-c', displayName: '旧账号丙', avatarUrl: '', createdAt: 3, updatedAt: 3 },
  }
  legacyState.userByExternalId = { 'legacy-a': 'usr_legacy_a', 'legacy-b': 'usr_legacy_b', 'legacy-c': 'usr_legacy_c' }
  legacyState.wallets = {
    usr_legacy_a: { userId: 'usr_legacy_a', balance: 4_321, currency: 'points', updatedAt: 9 },
  }
  legacyState.ledgerEntries = []
  legacyState.matches = {
    mat_legacy_active: {
      id: 'mat_legacy_active',
      mode: 'classic_300',
      status: 'matched',
      participants: [
        { userId: 'usr_legacy_a', status: 'matched' },
        { userId: 'usr_legacy_b', status: 'matched' },
      ],
      createdAt: 1,
    },
    mat_legacy_completed: {
      id: 'mat_legacy_completed',
      mode: 'quick',
      status: 'completed',
      participants: [{ userId: 'usr_legacy_c', status: 'completed' }],
      createdAt: 1,
      completedAt: 2,
    },
  }
  legacyState.activeMatchByUser = {
    usr_legacy_a: 'mat_stale',
    usr_legacy_c: 'mat_legacy_completed',
  }
  legacyState.userStats.usr_legacy_a = { userId: 'usr_legacy_a', gamesPlayed: 12, wins: 7, firstPlaceFinishes: 2, bombsPlayed: 3, elo: 1_400, updatedAt: 4 }
  delete legacyState.userByAccountId
  delete legacyState.playerRatings
  delete legacyState.tournaments['lingshui-16-cup']
  delete legacyState.tournamentRuns
  delete legacyState.tournamentPlayerRoundResults
  legacyState.tournaments['weekend-cup'].name = '运营自定义周末赛'
  await writeFile(legacyPath, `${JSON.stringify(legacyState)}\n`)
  const migrated = await JsonFilePlatformStore.open(legacyPath, createSeededPlatformState())
  const migratedSnapshot = await migrated.read(state => state)
  assert.equal(migratedSnapshot.schemaVersion, 8)
  assert.equal(migratedSnapshot.tournaments['lingshui-16-cup'].format, 'fixed16-latin-3', '旧 JSON 应补入新增系统赛事')
  assert.equal(migratedSnapshot.tournaments['weekend-cup'].name, '运营自定义周末赛', '迁移不得覆盖已有运营记录')
  assert.deepEqual(migratedSnapshot.tournamentRuns, {})
  assert.deepEqual(migratedSnapshot.tournamentPlayerRoundResults, {})
  const migratedAccountIds = Object.values(migratedSnapshot.users).map(user => user.accountId)
  assert.ok(migratedAccountIds.every(accountId => /^\d{8}$/.test(accountId)), '旧用户必须补齐八位账号')
  assert.equal(new Set(migratedAccountIds).size, migratedAccountIds.length, '迁移必须修复重复账号')
  assert.equal(migratedSnapshot.users.usr_legacy_a.accountId, '23456789', '无冲突的旧八位账号应保留')
  migratedAccountIds.forEach(accountId => {
    const userId = migratedSnapshot.userByAccountId[accountId]
    assert.equal(migratedSnapshot.users[userId].accountId, accountId, '八位账号反向索引必须与用户记录一致')
  })
  assert.deepEqual(migratedSnapshot.playerRatings.usr_legacy_a, { id: 'usr_legacy_a', games: 12, wins: 7, eloOffset: 0, updatedAt: 4 }, '旧统计只迁移场次和胜场，旧 elo 或钱包不得进入综合分')
  assert.equal('elo' in migratedSnapshot.userStats.usr_legacy_a, false)
  assert.deepEqual(migratedSnapshot.wallets.usr_legacy_a, { userId: 'usr_legacy_a', balance: 4_321, currency: 'points', updatedAt: 9 }, '已有钱包不得被初始积分迁移覆盖')
  assert.deepEqual(migratedSnapshot.wallets.usr_legacy_b, { userId: 'usr_legacy_b', balance: 10_000, currency: 'points', updatedAt: 2 })
  assert.deepEqual(migratedSnapshot.wallets.usr_legacy_c, { userId: 'usr_legacy_c', balance: 10_000, currency: 'points', updatedAt: 3 })
  const migratedWalletLedger = migratedSnapshot.ledgerEntries.filter(entry => entry.id.startsWith('led_wallet_migration_'))
  assert.deepEqual(migratedWalletLedger.map(entry => entry.id).sort(), ['led_wallet_migration_usr_legacy_b', 'led_wallet_migration_usr_legacy_c'])
  assert.ok(migratedWalletLedger.every(entry => entry.amount === 10_000 && entry.balanceAfter === 10_000 && entry.type === 'welcome_bonus'))
  assert.deepEqual(
    migratedSnapshot.activeMatchByUser,
    { usr_legacy_a: 'mat_legacy_active', usr_legacy_b: 'mat_legacy_active' },
    '迁移必须从 matching/matched 对局重建活跃匹配索引并移除终态旧索引',
  )
  const migratedReopened = await JsonFilePlatformStore.open(legacyPath, createSeededPlatformState())
  assert.equal(await migratedReopened.read(state => state.schemaVersion), 8, '迁移结果应立即持久化')
  assert.deepEqual(await migratedReopened.read(state => Object.values(state.users).map(user => user.accountId)), migratedAccountIds, '迁移账号重启后必须稳定')
  assert.equal(await migratedReopened.read(state => state.ledgerEntries.filter(entry => entry.id.startsWith('led_wallet_migration_')).length), 2, '迁移重启后不得重复写入初始积分流水')

  const conflictingPath = join(tempRoot, 'platform-conflicting-active-matches.json')
  const conflictingState = createSeededPlatformState()
  conflictingState.matches = {
    mat_active_a: { id: 'mat_active_a', mode: 'classic_50', status: 'matching', participants: [{ userId: 'usr_conflict', status: 'matching' }] },
    mat_active_b: { id: 'mat_active_b', mode: 'classic_300', status: 'matched', participants: [{ userId: 'usr_conflict', status: 'matched' }] },
  }
  await writeFile(conflictingPath, `${JSON.stringify(conflictingState)}\n`)
  await assert.rejects(
    JsonFilePlatformStore.open(conflictingPath, createSeededPlatformState()),
    /用户 usr_conflict 同时存在多个活跃匹配/,
    '同一用户存在多个活跃匹配时必须 fail-fast，不能静默选择并错误预留底分',
  )
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}

const redisMemory = new Map()
const redisClient = { async get (key) { return redisMemory.get(key) || null }, async set (key, value) { redisMemory.set(key, value) } }
const redisStore = new RedisPlatformStorePrototype({ client: redisClient, fallbackState: createSeededPlatformState() })
await redisStore.transaction(state => { state.products.soap.stock = 5 })
assert.equal(await redisStore.read(state => state.products.soap.stock), 5)

const collisionCandidates = ['12345678', '12345678', '87654321']
const collisionStore = new MemoryPlatformStore(createSeededPlatformState())
const collisionService = new PlatformService({
  store: collisionStore,
  accessTokens: new AccessTokenService({ secret: accessSecret }),
  gameTickets: new GameTicketService({ secret: ticketSecret, gameEndpoint: baseEnv.GAME_ENDPOINT }),
  createAccountId: () => collisionCandidates.shift(),
})
const [collisionUserA, collisionUserB] = await Promise.all([
  collisionService.loginExternal({ externalId: 'collision-a', displayName: '碰撞甲' }),
  collisionService.loginExternal({ externalId: 'collision-b', displayName: '碰撞乙' }),
])
assert.equal(collisionUserA.user.accountId, '12345678')
assert.equal(collisionUserB.user.accountId, '87654321', '事务内发现账号碰撞后必须重新分配')
const collisionSnapshot = await collisionStore.read(state => state)
assert.equal(collisionSnapshot.userByAccountId['12345678'], collisionUserA.user.id)
assert.equal(collisionSnapshot.userByAccountId['87654321'], collisionUserB.user.id)

let ratingMatchClock = 1_700_000_000_000
const ratingMatchStore = new MemoryPlatformStore(createSeededPlatformState())
const ratingMatchService = new PlatformService({
  store: ratingMatchStore,
  accessTokens: new AccessTokenService({ secret: accessSecret }),
  gameTickets: new GameTicketService({ secret: ticketSecret, gameEndpoint: baseEnv.GAME_ENDPOINT }),
  now: () => ratingMatchClock,
})
const ratingMatchUsers = {}
for (const name of ['high', 'low1', 'low2', 'low3', 'low4', 'low5', 'other-queue']) {
  ratingMatchUsers[name] = (await ratingMatchService.loginExternal({ externalId: `rating-${name}`, displayName: name })).user.id
}
await ratingMatchStore.transaction(state => {
  Object.entries(ratingMatchUsers).forEach(([name, userId]) => {
    const rating = state.playerRatings[userId]
    const targetScore = name === 'high' ? 50_000 : 10_000
    rating.eloOffset = targetScore - calculateBaseScore(rating)
    assert.ok(Math.abs(calculateComprehensiveScore(rating) - targetScore) < 1e-7)
  })
})
const highWaiting = await ratingMatchService.joinMatch(ratingMatchUsers.high, { mode: 'classic_50' })
const lowMatches = []
for (const name of ['low1', 'low2', 'low3', 'low4']) lowMatches.push(await ratingMatchService.joinMatch(ratingMatchUsers[name], { mode: 'classic_50' }))
assert.ok(lowMatches.every(match => match.matchId === lowMatches[0].matchId), '四名低分玩家应进入同一近分桌')
assert.equal(lowMatches[3].status, 'matched')
assert.notEqual(highWaiting.matchId, lowMatches[0].matchId, '四万分差不应在刚入队时强行拼桌')
assert.equal((await ratingMatchService.getMatchStatus(ratingMatchUsers.high, highWaiting.matchId)).status, 'matching')
ratingMatchClock += 120_000
const relaxedMatch = await ratingMatchService.joinMatch(ratingMatchUsers.low5, { mode: 'classic_50' })
assert.equal(relaxedMatch.matchId, highWaiting.matchId, '等待两分钟后应逐步放宽到四万分差')
const otherQueueMatch = await ratingMatchService.joinMatch(ratingMatchUsers['other-queue'], { mode: 'classic_300' })
assert.notEqual(otherQueueMatch.matchId, highWaiting.matchId, '即使等待放宽也不得跨经典场次')

let requestedUrl
const officialVerifier = new WxCodeVerifier({
  appId: 'wx-test-app',
  secret: 'wx-test-secret',
  fetchImpl: async (url) => { requestedUrl = new URL(url); return { ok: true, async json () { return { openid: 'sensitive-openid', session_key: 'never-return-this' } } } },
})
assert.deepEqual(await officialVerifier.verify('one-time-code'), { externalId: 'wx:wx-test-app:sensitive-openid' })
assert.equal(requestedUrl.hostname, 'api.weixin.qq.com')
assert.equal(requestedUrl.searchParams.get('grant_type'), 'authorization_code')

console.log('platform API, storage, ticket and signed result tests passed')
