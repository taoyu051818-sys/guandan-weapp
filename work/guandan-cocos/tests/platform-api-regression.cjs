const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const sourcePath = path.join(projectRoot, 'assets/scripts/services/PlatformApi.ts')
const platformModuleDir = path.join(projectRoot, 'assets/scripts/services/platform')
const gatewayContractsPath = path.join(projectRoot, 'assets/scripts/services/FrontPageGatewayContracts.ts')
const { loadTypeScript } = require('./support/typescript.cjs')
const ts = loadTypeScript()

const source = fs.readFileSync(sourcePath, 'utf8')
assert.ok(source.split('\n').length < 40, 'PlatformApi.ts must remain a small compatibility facade')
assert.match(source, /export type \{[\s\S]*HttpTransport,[\s\S]*PlatformApiConfig,[\s\S]*\} from '\.\/platform\/contracts'/)
assert.match(source, /export \{ PlatformApiError \} from '\.\/platform\/contracts'/)
assert.match(source, /export \{ PlatformApiClient, XhrTransport \} from '\.\/platform\/client'/)
assert.match(source, /export \{ createHttpGateways \} from '\.\/platform\/factory'/)
assert.equal(fs.existsSync(gatewayContractsPath), true, 'stable front-page gateway contracts are missing')
assert.equal(fs.existsSync(`${gatewayContractsPath}.meta`), true, 'stable front-page gateway contracts need Cocos metadata')
const gatewayContracts = fs.readFileSync(gatewayContractsPath, 'utf8')
assert.doesNotMatch(gatewayContracts, /SAMPLE_|Development[A-Z]|from ['"]cc['"]/, 'gateway contracts must remain transport and runtime independent')
for (const moduleName of ['client', 'contracts', 'validation', 'profileGateways', 'replayGateways', 'commerceGateways', 'competitionDecoders', 'competitionGateways', 'friendRoomGateway', 'MatchRecoveryAttempt', 'matchRecoveryGateway', 'factory']) {
  const modulePath = path.join(platformModuleDir, `${moduleName}.ts`)
  assert.equal(fs.existsSync(modulePath), true, `platform module ${moduleName} is missing`)
  assert.equal(fs.existsSync(path.join(platformModuleDir, `${moduleName}.ts.meta`)), true, `platform module ${moduleName} is missing Cocos metadata`)
  assert.doesNotMatch(fs.readFileSync(modulePath, 'utf8'), /DevelopmentApis/, `production platform module ${moduleName} must not depend on development adapters`)
}
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  fileName: sourcePath,
}).outputText
const runtimeModule = new Module(sourcePath, module)
runtimeModule.filename = sourcePath
runtimeModule.paths = Module._nodeModulePaths(path.dirname(sourcePath))
const previousTypeScriptLoader = Module._extensions['.ts']
let FriendRoomPlatformFlow
let retiredPlatform
Module._extensions['.ts'] = (targetModule, filename) => {
  const dependency = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  }).outputText
  targetModule._compile(dependency, filename)
}
try {
  runtimeModule._compile(compiled, sourcePath)
  retiredPlatform = require(path.join(projectRoot, 'migration/platform/RetiredPlatformApi.ts'))
  ;({ FriendRoomPlatformFlow } = require(path.join(projectRoot, 'assets/scripts/scenes/front-pages/FriendRoomPlatformFlow.ts')))
} finally {
  if (previousTypeScriptLoader) Module._extensions['.ts'] = previousTypeScriptLoader
  else delete Module._extensions['.ts']
}

const developmentSourcePath = path.join(projectRoot, 'migration/platform/RetiredDevelopmentApis.ts')
const developmentCompiled = ts.transpileModule(fs.readFileSync(developmentSourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: developmentSourcePath,
}).outputText
const developmentModule = new Module(developmentSourcePath, module)
developmentModule.filename = developmentSourcePath
developmentModule.paths = Module._nodeModulePaths(path.dirname(developmentSourcePath))
Module._extensions['.ts'] = (targetModule, filename) => {
  const dependency = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  }).outputText
  targetModule._compile(dependency, filename)
}
try {
  developmentModule._compile(developmentCompiled, developmentSourcePath)
} finally {
  if (previousTypeScriptLoader) Module._extensions['.ts'] = previousTypeScriptLoader
  else delete Module._extensions['.ts']
}

const { PlatformApiClient, PlatformApiError } = runtimeModule.exports
const { createHttpGateways } = retiredPlatform
assert.deepEqual(Object.keys(runtimeModule.exports.createHttpGateways({ baseUrl: 'https://platform.example', deviceId: 'retirement' })).sort(), ['configured', 'auth', 'matchmaking', 'friendRooms', 'matchRecovery', 'wallet', 'playerCenter', 'seasons', 'replays', 'tournaments'].sort(), 'the shipped factory must only expose active player services')
const { DevelopmentTournamentGateway } = developmentModule.exports
const ok = data => ({ status: 200, body: { ok: true, data, error: null } })
const errorResponse = (status, code, message, details, retryable) => ({
  status,
  body: { ok: false, data: null, error: { code, message, details, ...(retryable === undefined ? {} : { retryable }) } },
})
const validMatched = (overrides = {}) => ({
  matchId: 'm1',
  entryAttemptId: 'normalMatchEntry_Q7mN4vX9kLp2',
  mode: 'quick',
  status: 'matched',
  roomId: '123456',
  seat: 'p2',
  gameEndpoint: 'ws://127.0.0.1:3002/weapp',
  gameTicket: 'signed-ticket',
  expiresAt: Date.now() + 60_000,
  ...overrides,
})
const friendRoomSettings = {
  mode: 'classic', rounds: 8, scoring: 'double-3', scoreVisibility: 'live', turnSeconds: 40,
  trusteeSeconds: 15, totalTimeMinutes: 0, spectator: 'off', autoSort: true,
  disableInteraction: true, sortOrder: 'desc', authoritativeValidation: true,
}
const validFriendEntry = (entryAttemptId, overrides = {}) => ({
  entryAttemptId,
  matchId: 'mat_friend_1',
  roomId: '123456',
  seat: 'p1',
  gameEndpoint: 'wss://game.example/weapp',
  gameTicket: 'signed-friend-ticket',
  joinToken: 'signed-friend-ticket',
  expiresAt: Date.now() + 60_000,
  roomExpiresAt: Date.now() + 600_000,
  roomSettings: friendRoomSettings,
  roomKind: 'friend',
  ticketPurpose: 'entry',
  inviteCode: 'Q7mN4vX9kLp2sTw8aBcD',
  invitePayload: { version: 1, roomId: '123456', inviteCode: 'Q7mN4vX9kLp2sTw8aBcD' },
  inviteText: '123456.Q7mN4vX9kLp2sTw8aBcD',
  ...overrides,
})
const validMerchantConsole = (overrides = {}) => ({
  merchant: { id: 'mch1', ownerUserId: 'u1', name: '陵水生活馆', contactName: '店长', status: 'active', dailyPointLimit: 5000, createdAt: 1000 },
  role: 'owner',
  stores: [{ id: 'str1', merchantId: 'mch1', name: '清水湾店', address: '陵水示例地址', status: 'active', createdAt: 1100 }],
  employees: [{ id: 'mch1:u2', merchantId: 'mch1', userId: 'u2', role: 'cashier', status: 'active', updatedAt: 1200 }],
  grants: [{ id: 'mgr1', merchantId: 'mch1', storeId: 'str1', operatorUserId: 'u2', recipientUserId: 'u3', amount: 250, note: '消费奖励', status: 'posted', createdAt: 1300 }],
  grantedPoints: 250,
  ...overrides,
})
const validFixedTournament = (overrides = {}) => ({
  id: 't16',
  title: '陵水16人积分赛',
  summary: '固定16人 · 三轮积分',
  status: 'running',
  entryFee: 0,
  queueId: 'lingshui_16_cup',
  enrolled: true,
  format: 'fixed16-latin-3',
  capacity: 16,
  checkedInCount: 16,
  roundsTotal: 3,
  currentRound: 1,
  advanceCount: 8,
  ...overrides,
})
const validTournamentStanding = (overrides = {}) => ({
  userId: 'u1',
  displayName: '陵水玩家',
  played: 1,
  wins: 1,
  firstPlaces: 1,
  points: 3,
  opponentPoints: 4,
  rank: 1,
  advanced: false,
  qualificationStatus: 'pending',
  ...overrides,
})
const validTournamentState = (overrides = {}) => ({
  tournament: validFixedTournament(),
  phase: 'round-active',
  capacity: 16,
  checkedInCount: 16,
  roundNumber: 1,
  roundsTotal: 3,
  tablesTotal: 4,
  tablesSettled: 0,
  cutoffRank: 8,
  viewerEntry: { enrolled: true, checkedIn: true, rosterLocked: true },
  assignment: { assignmentId: 'tpa-roster-r1-t1', roundNumber: 1, tableNumber: 1, status: 'pending' },
  viewerStanding: validTournamentStanding(),
  ...overrides,
})

class FakeTransport {
  constructor () { this.requests = [] }

  async request (input) {
    this.requests.push(input)
    const url = new URL(input.url)
    if (url.pathname === '/api/v1/auth/dev-login') {
      assert.deepEqual(input.body, { deviceId: 'regression-device', displayName: '陵水玩家' }, 'development login body must keep the stable identity contract')
      return ok({ accessToken: 'test-token', expiresAt: Date.now() + 60_000, user: { id: 'u1' } })
    }
    assert.equal(input.headers.Authorization, 'Bearer test-token', `missing auth header for ${url.pathname}`)
    if (input.method === 'GET') assert.equal(input.headers['Content-Type'], undefined, `GET ${url.pathname} must not send Content-Type`)
    if (url.pathname === '/api/v1/products') return ok({ products: [{ id: 'rice', name: '大米', description: '5kg', tag: '粮油', points: 3200, availableStock: 12 }] })
    if (url.pathname === '/api/v1/wallet') return ok({ wallet: { balance: 8000, currency: 'POINTS' }, ledgerEntries: [] })
    if (url.pathname === '/api/v1/orders/redeem') return ok({ order: { orderId: 'o1', productId: 'rice', quantity: 1, totalPoints: 3200, status: 'paid' } })
    if (url.pathname === '/api/v1/tournaments' && input.method === 'GET') return ok({ tournaments: [
      { id: 't1', title: '周末赛', summary: '三轮积分赛', status: 'open', entryFee: 200, queueId: 'weekend_cup', enrolled: true },
      validFixedTournament(),
    ] })
    if (url.pathname === '/api/v1/tournaments/t1/enroll') return ok({ enrollment: { tournamentId: 't1' } })
    if (url.pathname === '/api/v1/tournaments/t16/check-in') return ok(validTournamentState())
    if (url.pathname === '/api/v1/tournaments/t16/withdraw') return ok(validTournamentState({ phase: 'check-in', viewerEntry: { enrolled: false, checkedIn: false, rosterLocked: false }, assignment: null }))
    if (url.pathname === '/api/v1/tournaments/t16/state') return ok(validTournamentState({
      assignment: { assignmentId: 'tpa-roster-r1-t1', round: 1, table: 1, status: 'pending' },
    }))
    if (url.pathname === '/api/v1/tournaments/t1/standings') return ok({
      tournament: { id: 't1', title: '周末赛', summary: '三轮积分赛', status: 'open', entryFee: 200, queueId: 'weekend_cup', enrolled: true, roundsTotal: 3, currentRound: 1, advanceCount: 8 },
      standings: [validTournamentStanding({ advanced: true, qualificationStatus: 'qualified' })],
      provisional: false,
      cutoffRank: 8,
      viewerStanding: validTournamentStanding({ advanced: true, qualificationStatus: 'qualified' }),
    })
    if (url.pathname === '/api/v1/me/dashboard') return ok({
      user: { id: 'u1', accountId: '58310427', displayName: '陵水玩家', comprehensiveScore: 6311 },
      rating: { games: 2, wins: 1, eloOffset: 0, baseScore: 6311, comprehensiveScore: 6311 },
      stats: { gamesPlayed: 2, wins: 1, firstPlaceFinishes: 1, bombsPlayed: 3 },
      season: { id: 's1', name: '夏季赛季', status: 'active', progress: { score: 5, gamesPlayed: 2, wins: 1 } },
      recentMatches: [{ eventId: 'e1', replayId: 'r1', matchId: 'm1', roomId: '123456', place: 1, won: true, tournamentId: 't1', finishedAt: 1000 }],
    })
    if (url.pathname === '/api/v1/season/tasks' && input.method === 'GET') return ok({ season: { id: 's1', name: '夏季赛季', status: 'active' }, tasks: [{ id: 'daily', name: '完成一局', target: 1, rewardPoints: 80, progress: 1, completed: true, claimed: false, cadence: 'daily' }] })
    if (url.pathname === '/api/v1/season/tasks/daily/claim') return ok({ claim: { taskId: 'daily' } })
    if (url.pathname === '/api/v1/replays' && input.method === 'GET') return ok({ replays: [{ id: 'r1', eventId: 'e1', matchId: 'm1', roomId: '123456', ranking: ['p1', 'p3', 'p2', 'p4'], winnerTeam: 'teamA', finishedAt: 1000, eventCount: 1 }] })
    if (url.pathname === '/api/v1/replays/r1') return ok({ replay: { id: 'r1', eventId: 'e1', matchId: 'm1', roomId: '123456', ranking: ['p1', 'p3', 'p2', 'p4'], winnerTeam: 'teamA', finishedAt: 1000, participants: { p1: '陵水玩家' }, viewerSeat: 'p2', events: [{ sequence: 1, at: 900, type: 'play', roundSequence: 2, playerId: 'p1', cards: [{ rank: 'A', suit: 'heart' }], playType: 'Single', automatic: false }] } })
    if (url.pathname === '/api/v1/spectate') return ok({ delaySeconds: 30, feeds: [
      { matchId: 'm-live', tableLabel: '快速匹配 · MLIVE桌', mode: 'quick', status: 'playing', startedAt: 800, finishedAt: null, abortedAt: null, abortReason: null, delaySeconds: Number(url.searchParams.get('delaySeconds')), availableEventCount: 1, totalEventCount: 2, timelineComplete: false },
      { matchId: 'm-aborted', tableLabel: '快速匹配 · MABORT桌', mode: 'quick', status: 'aborted', startedAt: 600, finishedAt: null, abortedAt: 900, abortReason: 'empty-timeout', delaySeconds: Number(url.searchParams.get('delaySeconds')), availableEventCount: 2, totalEventCount: 2, timelineComplete: true },
      { matchId: 'm-classic-50', tableLabel: '经典场 · 底分50', mode: 'classic_50', status: 'running', startedAt: 850, finishedAt: null, abortedAt: null, abortReason: null, delaySeconds: Number(url.searchParams.get('delaySeconds')), availableEventCount: 0, totalEventCount: 0, timelineComplete: false },
    ] })
    if (url.pathname === '/api/v1/spectate/m1') return ok({ feed: { matchId: 'm1', tableLabel: '快速匹配 · M1桌', mode: 'quick', status: 'completed', startedAt: 800, finishedAt: 1000, delaySeconds: Number(url.searchParams.get('delaySeconds')), availableEventCount: 1, totalEventCount: 1, timelineComplete: true, availableThrough: 1100, events: [{ sequence: 1, at: 900, type: 'play', playerId: 'p1' }] } })
    if (url.pathname === '/api/v1/merchants/apply') return ok({ merchant: { id: 'mch1', ownerUserId: 'u1', name: '陵水生活馆', contactName: '店长', status: 'pending', dailyPointLimit: 5000, createdAt: 1000 } })
    if (url.pathname === '/api/v1/merchants/me') return ok({
      merchant: { id: 'mch1', ownerUserId: 'u1', name: '陵水生活馆', contactName: '店长', status: 'active', dailyPointLimit: 5000, createdAt: 1000 },
      role: 'owner',
      stores: [{ id: 'str1', merchantId: 'mch1', name: '清水湾店', address: '陵水示例地址', status: 'active', createdAt: 1100 }],
      employees: [{ id: 'mch1:u2', merchantId: 'mch1', userId: 'u2', role: 'cashier', status: 'active', updatedAt: 1200 }],
      grants: [{ id: 'mgr1', merchantId: 'mch1', storeId: 'str1', operatorUserId: 'u2', recipientUserId: 'u3', amount: 250, note: '消费奖励', status: 'posted', createdAt: 1300 }],
      grantedPoints: 250,
    })
    if (url.pathname === '/api/v1/merchants/stores') return ok({ store: { id: 'str2', merchantId: 'mch1', name: '椰林店', address: '陵水椰林镇', status: 'active', createdAt: 1400 } })
    if (url.pathname === '/api/v1/merchants/employees') return ok({ employee: { id: 'mch1:u4', merchantId: 'mch1', userId: 'u4', role: 'manager', status: 'active', updatedAt: 1500 } })
    if (url.pathname === '/api/v1/merchants/points/grant') return ok({ grant: { id: 'mgr2', merchantId: 'mch1', storeId: 'str1', operatorUserId: 'u1', recipientUserId: 'u5', amount: 80, note: '到店奖励', status: 'posted', createdAt: 1600, duplicate: false } })
    if (url.pathname === '/api/v1/match/join') return ok({ match: {
      matchId: input.body.assignmentId ? 'm16' : input.body.mode === 'quick' ? 'm1' : `m-${input.body.mode}`,
      mode: input.body.mode,
      status: 'matching',
    } })
    if (url.pathname === '/api/v1/match/status') return ok({ match: validMatched() })
    if (url.pathname === '/api/v1/match/cancel') return ok({ match: { matchId: 'm1', status: 'cancelled' } })
    throw new Error(`unhandled fake route: ${input.method} ${url.pathname}`)
  }
}

const assertMalformedTicket = async (ticket, expectedPattern, config = {}) => {
  const transport = { request: async input => {
    if (new URL(input.url).pathname === '/api/v1/match/status') return ok({ match: ticket })
    throw new Error('unexpected route')
  } }
  const gateways = createHttpGateways({ baseUrl: 'https://platform.example', deviceId: 'd', accessToken: 'token', ...config }, transport)
  await assert.rejects(gateways.matchmaking.getStatus('m1'), error => {
    assert.ok(error instanceof PlatformApiError)
    assert.equal(error.code, 'MALFORMED_RESPONSE')
    assert.equal(error.status, 200)
    assert.equal(error.retryable, false)
    assert.match(error.message, expectedPattern)
    return true
  })
}

const testDevelopmentTournamentState = async () => {
  const gateway = new DevelopmentTournamentGateway()
  const tournaments = await gateway.listTournaments()
  const fixedTournament = tournaments.find(item => item.queueId === 'lingshui_16_cup')
  assert.equal(fixedTournament.format, 'fixed16-latin-3')
  const state = await gateway.getState(fixedTournament.id)
  assert.equal(state.capacity, 16)
  assert.equal(state.checkedInCount, 16)
  assert.equal(state.roundNumber, 1)
  assert.equal(state.assignment.tableNumber, 1)
  assert.equal(state.assignment.status, 'pending')
  assert.equal((await gateway.checkIn(fixedTournament.id)).assignment.assignmentId, state.assignment.assignmentId)
}

const testBasicGateways = async () => {
  assert.throws(
    () => createHttpGateways({ baseUrl: 'http://platform.example', deviceId: 'unsafe' }, new FakeTransport()),
    /HTTPS/,
    'HTTP platform endpoints must be rejected unless an explicit development policy is provided',
  )
  const lockedTransport = new FakeTransport()
  const lockedGateways = createHttpGateways({ baseUrl: 'http://127.0.0.1:3003', deviceId: 'locked-device', httpEndpointPolicy: 'allow-localhost-insecure' }, lockedTransport)
  await assert.rejects(lockedGateways.shop.listProducts(), error => error instanceof PlatformApiError && error.code === 'AUTH_REQUIRED', 'development login must be opt-in')
  assert.equal(lockedTransport.requests.length, 0, 'a production client must not silently call development login')

  const transport = new FakeTransport()
  let storedToken = null
  const gateways = createHttpGateways({
    baseUrl: 'http://127.0.0.1:3003/',
    deviceId: 'regression-device',
    allowDevelopmentLogin: true,
    httpEndpointPolicy: 'allow-localhost-insecure',
    credentialStore: {
      getAccessToken: () => storedToken,
      setAccessToken: token => { storedToken = token },
      clearAccessToken: () => { storedToken = null },
    },
  }, transport)

  const products = await gateways.shop.listProducts()
  assert.deepEqual(products[0], { id: 'rice', name: '大米', description: '5kg', category: '粮油', pointsPrice: 3200, stock: 12, imageUrl: undefined })
  assert.equal(storedToken, 'test-token')
  assert.equal(transport.requests.filter(request => request.url.endsWith('/api/v1/auth/dev-login')).length, 1, 'login should be shared across gateways')
  assert.deepEqual(await gateways.wallet.getWallet(), { points: 8000, diamonds: 0 })

  const order = await gateways.shop.createOrder('rice', 1, 3200)
  assert.equal(order.totalPoints, 3200)
  const orderRequest = transport.requests.find(request => request.url.endsWith('/api/v1/orders/redeem'))
  assert.match(orderRequest.headers['Idempotency-Key'], /^shop-/)
  assert.deepEqual(orderRequest.body, { productId: 'rice', quantity: 1, expectedPointsPrice: 3200 })

  const tournaments = await gateways.tournaments.listTournaments()
  assert.equal(tournaments[0].name, '周末赛')
  const fixedTournament = tournaments.find(item => item.id === 't16')
  assert.equal(fixedTournament.queueId, 'lingshui_16_cup')
  assert.equal(fixedTournament.format, 'fixed16-latin-3')
  assert.equal(fixedTournament.capacity, 16)
  assert.equal(fixedTournament.checkedInCount, 16)
  assert.equal((await gateways.tournaments.enroll('t1', 200)).enrolled, true)
  const enrollRequest = transport.requests.find(request => request.url.endsWith('/api/v1/tournaments/t1/enroll'))
  assert.deepEqual(enrollRequest.body, { expectedEntryPoints: 200 })
  const checkedInState = await gateways.tournaments.checkIn('t16')
  assert.equal(checkedInState.phase, 'round-active')
  assert.equal(checkedInState.checkedInCount, 16)
  assert.equal(checkedInState.assignment.assignmentId, 'tpa-roster-r1-t1')
  assert.equal(checkedInState.assignment.roundNumber, 1)
  assert.equal(checkedInState.assignment.tableNumber, 1)
  assert.equal(checkedInState.assignment.status, 'pending')
  assert.equal(checkedInState.viewerEntry.rosterLocked, true)
  assert.equal(checkedInState.viewerStanding.qualificationStatus, 'pending')
  const checkInRequest = transport.requests.find(request => request.url.endsWith('/api/v1/tournaments/t16/check-in'))
  assert.equal(checkInRequest.method, 'POST')
  assert.equal(checkInRequest.body, undefined)
  assert.equal((await gateways.tournaments.withdraw('t16')).viewerEntry.enrolled, false)
  const withdrawRequest = transport.requests.find(request => request.url.endsWith('/api/v1/tournaments/t16/withdraw'))
  assert.equal(withdrawRequest.method, 'POST')
  assert.match(withdrawRequest.headers['Idempotency-Key'], /^withdraw-/)
  await assert.rejects(gateways.tournaments.withdraw(' '), /不能为空/)
  const refreshedState = await gateways.tournaments.getState('t16')
  assert.equal(refreshedState.assignment.roundNumber, 1, 'wire round/table aliases must normalize to the public roundNumber/tableNumber contract')
  assert.equal(refreshedState.assignment.tableNumber, 1)
  assert.equal(transport.requests.find(request => request.url.endsWith('/api/v1/tournaments/t16/state')).method, 'GET')
  const standings = await gateways.tournaments.getStandings('t1')
  assert.equal(standings.tournament.roundsTotal, 3)
  assert.equal(standings.standings[0].displayName, '陵水玩家')
  assert.equal(standings.standings[0].advanced, true)
  assert.equal(standings.standings[0].qualificationStatus, 'qualified')
  assert.equal(standings.provisional, false)
  assert.equal(standings.cutoffRank, 8)
  assert.equal(standings.viewerStanding.userId, 'u1')

  const dashboard = await gateways.playerCenter.getDashboard()
  assert.equal(dashboard.user.accountId, '58310427')
  assert.equal(dashboard.user.comprehensiveScore, 6311)
  assert.equal(dashboard.rating.comprehensiveScore, 6311)
  assert.equal(dashboard.stats.elo, 6311, 'legacy client stat field must fall back to the authoritative comprehensive score')
  assert.equal(dashboard.recentMatches[0].replayId, 'r1')
  const taskList = await gateways.seasons.listTasks()
  assert.equal(taskList.tasks[0].completed, true)
  await gateways.seasons.claim('daily')
  assert.match(transport.requests.find(request => request.url.endsWith('/api/v1/season/tasks/daily/claim')).headers['Idempotency-Key'], /^task-/)
  assert.equal((await gateways.replays.list())[0].eventCount, 1)
  const replay = await gateways.replays.get('r1')
  assert.equal(replay.events[0].cards[0].rank, 'A')
  assert.equal(replay.events[0].roundSequence, 2)
  assert.equal(replay.events[0].playType, 'Single')
  assert.equal(replay.events[0].automatic, false)
  assert.equal(replay.viewerSeat, 'p2')
  const publicMatches = await gateways.spectator.list(30)
  assert.equal(publicMatches[0].status, 'playing')
  assert.equal(publicMatches[0].tableLabel, '快速匹配 · MLIVE桌')
  assert.equal('roomId' in publicMatches[0], false, '公开观战 DTO 不应包含入桌房间码')
  assert.equal(publicMatches[1].status, 'aborted')
  assert.equal(publicMatches[1].abortReason, 'empty-timeout')
  assert.equal(publicMatches[2].mode, 'classic_50')
  const publicFeed = await gateways.spectator.getFeed('m1', 30)
  assert.equal(publicFeed.delaySeconds, 30)
  assert.equal(publicFeed.status, 'completed')
  assert.equal(publicFeed.events.length, 1)

  const merchantConsole = await gateways.merchant.getConsole()
  assert.equal(merchantConsole.merchant.status, 'active')
  assert.equal(merchantConsole.role, 'owner')
  assert.equal(merchantConsole.stores[0].name, '清水湾店')
  assert.equal(merchantConsole.employees[0].role, 'cashier')
  assert.equal(merchantConsole.grants[0].amount, 250)
  assert.equal((await gateways.merchant.apply({ name: '陵水生活馆', contactName: '店长' })).status, 'pending')
  assert.equal((await gateways.merchant.createStore({ name: '椰林店', address: '陵水椰林镇' })).id, 'str2')
  assert.equal((await gateways.merchant.addEmployee({ employeeUserId: 'u4', role: 'manager' })).userId, 'u4')
  assert.equal((await gateways.merchant.grantPoints({ storeId: 'str1', recipientUserId: 'u5', amount: 80, note: '到店奖励' })).duplicate, false)
  for (const route of ['/api/v1/merchants/apply', '/api/v1/merchants/stores', '/api/v1/merchants/employees', '/api/v1/merchants/points/grant']) {
    const request = transport.requests.find(item => new URL(item.url).pathname === route)
    assert.match(request.headers['Idempotency-Key'], /^merchant-/, `${route} must carry an idempotency key`)
  }
  assert.deepEqual(transport.requests.find(item => item.url.endsWith('/api/v1/merchants/stores')).body, { name: '椰林店', address: '陵水椰林镇' })
  assert.deepEqual(transport.requests.find(item => item.url.endsWith('/api/v1/merchants/employees')).body, { employeeUserId: 'u4', role: 'manager' })
  assert.deepEqual(transport.requests.find(item => item.url.endsWith('/api/v1/merchants/points/grant')).body, { storeId: 'str1', recipientUserId: 'u5', amount: 80, note: '到店奖励' })

  assert.equal((await gateways.matchmaking.joinQueue('quick')).ticketId, 'm1')
  assert.deepEqual(transport.requests.find(request => request.url.endsWith('/api/v1/match/join')).body, { mode: 'quick' })
  for (const queueId of ['classic_50', 'classic_300', 'classic_2000', 'classic_10000']) {
    const classicTicket = await gateways.matchmaking.joinQueue(queueId)
    assert.equal(classicTicket.queueId, queueId)
    assert.equal(classicTicket.ticketId, `m-${queueId}`)
  }
  const assignedTicket = await gateways.matchmaking.joinQueue('lingshui_16_cup', { tournamentId: 't16', assignmentId: 'tpa-roster-r1-t1' })
  assert.equal(assignedTicket.ticketId, 'm16')
  assert.equal(assignedTicket.queueId, 'lingshui_16_cup')
  const matchJoinRequests = transport.requests.filter(request => request.url.endsWith('/api/v1/match/join'))
  assert.deepEqual(matchJoinRequests.at(-1).body, { mode: 'lingshui_16_cup', tournamentId: 't16', assignmentId: 'tpa-roster-r1-t1' })
  const matched = await gateways.matchmaking.getStatus('m1')
  assert.equal(matched.joinToken, 'signed-ticket')
  assert.equal(matched.entryAttemptId, 'normalMatchEntry_Q7mN4vX9kLp2')
  assert.equal(matched.seat, 'p2')
  assert.ok(matched.expiresAt > Date.now())
  await gateways.matchmaking.cancel('m1')
}

const testWechatLoginBody = async () => {
  const requests = []
  const gateways = createHttpGateways({
    baseUrl: 'https://platform.example',
    deviceId: 'wechat-device',
    displayName: '海风玩家',
    loginProvider: async () => ({ kind: 'wechat', code: 'wx-code' }),
  }, { request: async input => {
    requests.push(input)
    const route = new URL(input.url).pathname
    if (route === '/api/v1/auth/wx-login') return ok({ accessToken: 'wx-token' })
    if (route === '/api/v1/wallet') return ok({ wallet: { balance: 1 } })
    throw new Error('unexpected route')
  } })
  await gateways.wallet.getWallet()
  assert.deepEqual(requests[0].body, { code: 'wx-code', displayName: '海风玩家' })
  assert.equal(requests.some(item => item.url.endsWith('/api/v1/auth/dev-login')), false)
}

const testLoginLifecycle = async () => {
  let releaseCredential
  let providerCalls = 0
  let storedToken = null
  const requests = []
  const firstCredential = new Promise(resolve => { releaseCredential = resolve })
  const client = new PlatformApiClient({ request: async input => {
    requests.push(input)
    const route = new URL(input.url).pathname
    if (route === '/api/v1/auth/wx-login') return ok({ accessToken: providerCalls === 1 ? 'stale-late-token' : 'fresh-token' })
    if (route === '/api/v1/wallet') return ok({ wallet: true })
    throw new Error(`unexpected route ${route}`)
  } }, {
    baseUrl: 'https://platform.example',
    deviceId: 'wechat-device',
    loginProvider: async () => {
      providerCalls += 1
      if (providerCalls === 1) return firstCredential
      return { kind: 'wechat', code: 'fresh-code' }
    },
    credentialStore: {
      getAccessToken: () => storedToken,
      setAccessToken: token => { storedToken = token },
      clearAccessToken: () => { storedToken = null },
    },
  })

  const staleRequest = client.request('/api/v1/wallet')
  await Promise.resolve()
  client.signOut()
  releaseCredential({ kind: 'wechat', code: 'late-code' })
  await assert.rejects(staleRequest, error => error instanceof PlatformApiError && error.code === 'AUTH_CANCELLED')
  assert.equal(storedToken, null, 'signOut must prevent a late login from restoring credentials')
  assert.equal(requests.some(item => item.body?.code === 'late-code'), false, 'a provider result arriving after signOut must not reach the auth endpoint')

  await client.request('/api/v1/wallet')
  assert.equal(storedToken, 'fresh-token', 'a later explicit request may start a fresh login generation')
  assert.equal(providerCalls, 2)

  const timedClient = new PlatformApiClient({ request: async () => assert.fail('a timed-out provider must not reach HTTP') }, {
    baseUrl: 'https://platform.example',
    deviceId: 'timeout-device',
    loginTimeoutMs: 5,
    loginProvider: () => new Promise(() => {}),
  })
  await assert.rejects(
    Promise.race([
      timedClient.request('/api/v1/wallet'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('login lifecycle test watchdog expired')), 50)),
    ]),
    error => error instanceof PlatformApiError && error.code === 'LOGIN_PROVIDER_TIMEOUT' && error.retryable,
  )
}

const testRequestGenerationAfterSignOut = async () => {
  for (const status of [200, 401]) {
    let release
    let markStarted
    const started = new Promise(resolve => { markStarted = resolve })
    const delayed = new Promise(resolve => { release = resolve })
    let stored = 'old-token'
    const calls = []
    const client = new PlatformApiClient({ request: async input => {
      calls.push(input)
      if (input.url.endsWith('/api/v1/auth/dev-login')) return ok({ accessToken: 'new-token' })
      if (input.headers.Authorization === 'Bearer old-token') { markStarted(); return delayed }
      return ok({ current: true })
    } }, {
      baseUrl: 'https://platform.example', deviceId: 'generation-test', allowDevelopmentLogin: true,
      credentialStore: {
        getAccessToken: () => stored, setAccessToken: token => { stored = token }, clearAccessToken: () => { stored = null },
      },
    })
    const stale = client.request('/api/v1/action', 'POST', { marker: 'old-action' })
    await started
    client.signOut()
    release(status === 200 ? ok({ stale: true }) : errorResponse(401, 'EXPIRED', 'expired'))
    await assert.rejects(stale, error => error.code === 'AUTH_CANCELLED')
    assert.equal(stored, null, 'a late response must not restore credentials')
    assert.equal(calls.length, 1, 'old POST must neither log in nor replay after signOut')
    assert.deepEqual(await client.request('/api/v1/current'), { current: true }, 'explicit new request can log in normally')
    assert.equal(stored, 'new-token')
  }

  const beforeSend = new PlatformApiClient({ request: async () => assert.fail('cancelled before token await must not send') }, {
    baseUrl: 'https://platform.example', deviceId: 'before-send', accessToken: 'token',
  })
  const cancelled = beforeSend.request('/api/v1/action', 'POST')
  beforeSend.signOut()
  await assert.rejects(cancelled, error => error.code === 'AUTH_CANCELLED')

  // Logout can also happen after refresh, while the second HTTP request is in flight.
  let finishRetry
  let markRetry
  const retryStarted = new Promise(resolve => { markRetry = resolve })
  const retried = new Promise(resolve => { finishRetry = resolve })
  const retryClient = new PlatformApiClient({ request: async input => {
    if (input.url.endsWith('/api/v1/auth/dev-login')) return ok({ accessToken: 'fresh' })
    if (input.headers.Authorization === 'Bearer old') return errorResponse(401, 'EXPIRED', 'expired')
    markRetry()
    return retried
  } }, { baseUrl: 'https://platform.example', deviceId: 'retry', accessToken: 'old', allowDevelopmentLogin: true })
  const pending = retryClient.request('/api/v1/action')
  await retryStarted
  retryClient.signOut()
  finishRetry(ok({ stale: true }))
  await assert.rejects(pending, error => error.code === 'AUTH_CANCELLED')
}

const testFriendRoomIdempotentResponseOwnership = async () => {
  const deferred = () => {
    let resolve
    const promise = new Promise(done => { resolve = done })
    return { promise, resolve }
  }
  for (const firstResponse of [0, 1]) {
    const started = [deferred(), deferred()]
    const responses = [deferred(), deferred()]
    const requests = []
    const cancellations = []
    const entered = []
    const gateways = createHttpGateways({ baseUrl: 'https://platform.example', deviceId: 'ownership', accessToken: 'token', gameEndpointPolicy: 'secure-only' }, {
      request: async input => {
        if (input.url.endsWith('/api/v1/match/cancel')) { cancellations.push(input.body.matchId); return ok({ cancelled: true }) }
        assert.equal(input.url.endsWith('/api/v1/friend-rooms/create'), true)
        const index = requests.push(input) - 1
        started[index].resolve()
        return responses[index].promise
      },
    })
    const flow = new FriendRoomPlatformFlow({
      gateway: gateways.friendRooms, isDisposed: () => false, onChanged: () => {},
      enterMatchedRoom: value => entered.push(value), showNotice: title => assert.fail(title),
    })
    const oldTask = flow.create(friendRoomSettings)
    await started[0].promise
    flow.leave()
    const newTask = flow.create(friendRoomSettings)
    await started[1].promise
    assert.equal(requests[0].body.entryAttemptId, requests[1].body.entryAttemptId, 'real gateway reuses the unresolved idempotency attempt')
    const receipt = ok({ entry: validFriendEntry(requests[0].body.entryAttemptId) })
    const tasks = [oldTask, newTask]
    responses[firstResponse].resolve(receipt)
    await tasks[firstResponse]
    assert.deepEqual(cancellations, [])
    if (firstResponse === 1) { flow.handoffReservation(); flow.leave() }
    responses[1 - firstResponse].resolve(receipt)
    await tasks[1 - firstResponse]
    flow.handoffReservation()
    flow.destroy()
    assert.deepEqual(entered.map(value => value.matchId), ['mat_friend_1'])
    assert.deepEqual(cancellations, [])
  }
}

const testErrorMetadata = async () => {
  const client = new PlatformApiClient({ request: async () => errorResponse(409, 'PRICE_CHANGED', '价格已变更', { currentPointsPrice: 3300 }, false) }, {
    baseUrl: 'https://platform.example', deviceId: 'd', accessToken: 'token',
  })
  await assert.rejects(client.request('/api/v1/failure'), error => {
    assert.ok(error instanceof PlatformApiError)
    assert.equal(error.status, 409)
    assert.equal(error.code, 'PRICE_CHANGED')
    assert.deepEqual(error.details, { currentPointsPrice: 3300 })
    assert.equal(error.retryable, false)
    return true
  })

  const retryableClient = new PlatformApiClient({ request: async () => errorResponse(503, 'UPSTREAM_DOWN', '上游暂不可用', { region: 'hn' }, true) }, {
    baseUrl: 'https://platform.example', deviceId: 'd', accessToken: 'token',
  })
  await assert.rejects(retryableClient.request('/api/v1/failure'), error => error instanceof PlatformApiError && error.status === 503 && error.code === 'UPSTREAM_DOWN' && error.retryable)

  const malformedClient = new PlatformApiClient({ request: async () => ({ status: 200, body: { ok: true, error: null } }) }, {
    baseUrl: 'https://platform.example', deviceId: 'd', accessToken: 'token',
  })
  await assert.rejects(malformedClient.request('/api/v1/malformed'), error => error instanceof PlatformApiError && error.code === 'MALFORMED_RESPONSE')
}

const testConcurrentUnauthorizedRefresh = async () => {
  let loginCalls = 0
  let clearCalls = 0
  const attempts = new Map()
  const transport = { request: async input => {
    const route = new URL(input.url).pathname
    if (route === '/api/v1/auth/dev-login') {
      loginCalls += 1
      await new Promise(resolve => setTimeout(resolve, 8))
      return ok({ accessToken: 'fresh-token' })
    }
    assert.equal(route, '/api/v1/wallet')
    const requestId = Number(new URL(input.url).searchParams.get('requestId'))
    const count = (attempts.get(requestId) ?? 0) + 1
    attempts.set(requestId, count)
    if (input.headers.Authorization === 'Bearer stale-token') {
      await new Promise(resolve => setTimeout(resolve, (requestId % 10) * 3))
      return errorResponse(401, 'TOKEN_EXPIRED', '令牌过期')
    }
    assert.equal(input.headers.Authorization, 'Bearer fresh-token')
    return ok({ requestId })
  } }
  let storedToken = 'stale-token'
  const client = new PlatformApiClient(transport, {
    baseUrl: 'https://platform.example',
    deviceId: 'regression-device',
    allowDevelopmentLogin: true,
    credentialStore: {
      getAccessToken: () => storedToken,
      setAccessToken: token => { storedToken = token },
      clearAccessToken: () => { clearCalls += 1; storedToken = null },
    },
  })
  const results = await Promise.all(Array.from({ length: 20 }, (_, requestId) => client.request(`/api/v1/wallet?requestId=${requestId}`)))
  assert.deepEqual(results.map(item => item.requestId), Array.from({ length: 20 }, (_, index) => index))
  assert.equal(loginCalls, 1, 'twenty staggered 401 responses must share one refresh login')
  assert.equal(clearCalls, 1, 'late stale-token 401 responses must not clear the fresh token')
  assert.equal(storedToken, 'fresh-token')
  assert.ok([...attempts.values()].every(value => value === 2), 'every request should retry exactly once')
}

const testTicketValidation = async () => {
  await assertMalformedTicket({ matchId: 'm1', mode: 'quick', status: 'queued' }, /状态/)
  await assertMalformedTicket({ matchId: 'm1', mode: 'unknown', status: 'matching' }, /队列/)
  await assertMalformedTicket({ matchId: '  ', mode: 'quick', status: 'matching' }, /ID/)
  await assertMalformedTicket(validMatched({ seat: 'p9' }), /座位/)
  await assertMalformedTicket(validMatched({ entryAttemptId: 'short' }), /幂等 ID/)
  const missingEntryAttempt = validMatched()
  delete missingEntryAttempt.entryAttemptId
  await assertMalformedTicket(missingEntryAttempt, /缺少入桌所需字段/)
  await assertMalformedTicket(validMatched({ expiresAt: Date.now() - 1 }), /过期时间/)
  await assertMalformedTicket(validMatched({ gameTicket: '' }), /入桌凭证/)
  await assertMalformedTicket(validMatched({ gameEndpoint: 'javascript:alert(1)' }), /WebSocket/)
  await assertMalformedTicket(validMatched({ gameEndpoint: 'https://game.example/weapp' }), /WebSocket/)
  await assertMalformedTicket(validMatched({ roomId: 'room-1' }), /六位数字/)
  await assertMalformedTicket(validMatched({ gameEndpoint: 'ws://game.example/weapp' }), /非本机/)
  await assertMalformedTicket(validMatched(), /必须使用 HTTPS\/WSS/, { gameEndpointPolicy: 'secure-only' })

  const remoteTransport = { request: async () => ok({ match: validMatched({ gameEndpoint: 'ws://192.168.1.8:3002/weapp' }) }) }
  const remoteGateways = createHttpGateways({
    baseUrl: 'https://platform.example', deviceId: 'd', accessToken: 'token', gameEndpointPolicy: 'allow-insecure',
  }, remoteTransport)
  assert.equal((await remoteGateways.matchmaking.getStatus('m1')).gameEndpoint, 'ws://192.168.1.8:3002/weapp')

  const secureTransport = { request: async () => ok({ match: validMatched({ gameEndpoint: 'wss://game.example/weapp' }) }) }
  const secureGateways = createHttpGateways({
    baseUrl: 'https://platform.example', deviceId: 'd', accessToken: 'token', gameEndpointPolicy: 'secure-only',
  }, secureTransport)
  assert.equal((await secureGateways.matchmaking.getStatus('m1')).gameEndpoint, 'wss://game.example/weapp')
  const fixedTicket = await createHttpGateways({
    baseUrl: 'https://platform.example', deviceId: 'd', accessToken: 'token', gameEndpointPolicy: 'secure-only',
  }, { request: async () => ok({ match: validMatched({
    matchId: 'fixed-match', mode: 'lingshui_16_cup', entryAttemptId: 'fixedTournamentEntry_Q7mN4vX9k', gameEndpoint: 'wss://game.example/weapp',
  }) }) }).matchmaking.getStatus('fixed-match')
  assert.equal(fixedTicket.entryAttemptId, 'fixedTournamentEntry_Q7mN4vX9k', 'fixed tournament tickets must preserve the server-bound WebSocket attempt id')

  for (const status of ['playing', 'completed', 'aborted']) {
    const terminalGateways = createHttpGateways({ baseUrl: 'https://platform.example', deviceId: 'd', accessToken: 'token' }, {
      request: async () => ok({ match: { matchId: `m-${status}`, mode: 'quick', status } }),
    })
    assert.equal((await terminalGateways.matchmaking.getStatus(`m-${status}`)).status, status)
  }
}

const testMatchRecoveryGateway = async () => {
  const calls = []
  const transport = { request: async input => {
    calls.push(input)
    const recoveryAttemptId = input.body.recoveryAttemptId
    return ok({ entry: {
      entryAttemptId: recoveryAttemptId, recoveryAttemptId, matchId: 'recover-match', roomId: '787878', seat: 'p3',
      roomKind: 'match', queueId: 'lingshui_16_cup', ticketPurpose: 'rejoin', gameEndpoint: 'wss://game.example/weapp',
      gameTicket: `ticket-${recoveryAttemptId}`, joinToken: `ticket-${recoveryAttemptId}`, expiresAt: Date.now() + 60_000,
    } })
  } }
  const gateways = createHttpGateways({
    baseUrl: 'https://platform.example', deviceId: 'd', accessToken: 'token', gameEndpointPolicy: 'secure-only',
  }, transport)
  const first = await gateways.matchRecovery.recover()
  assert.equal(first.queueId, 'lingshui_16_cup', 'cold recovery preserves tournament navigation')
  const duplicate = await gateways.matchRecovery.recover()
  assert.match(first.recoveryAttemptId, /^[A-Za-z0-9_-]{22,128}$/)
  assert.equal(duplicate.recoveryAttemptId, first.recoveryAttemptId, 'HTTP retry and subsequent WS entry must share one recovery attempt')
  assert.equal(calls[0].method, 'POST')
  assert.equal(new URL(calls[0].url).pathname, '/api/v1/matches/recover')
  gateways.matchRecovery.confirm(first.recoveryAttemptId)
  const rotated = await gateways.matchRecovery.recover()
  assert.notEqual(rotated.recoveryAttemptId, first.recoveryAttemptId, 'roomRejoined confirmation must close the attempt before the next disconnect')

  const expiredLeaseGateway = createHttpGateways({
    baseUrl: 'https://platform.example', deviceId: 'd', accessToken: 'token', gameEndpointPolicy: 'secure-only',
  }, { request: async input => ok({ entry: validFriendEntry(input.body.recoveryAttemptId, {
    recoveryAttemptId: input.body.recoveryAttemptId, ticketPurpose: 'rejoin', roomExpiresAt: Date.now() - 60_000,
    inviteCode: undefined, invitePayload: undefined, inviteText: undefined,
  }) }) })
  const friendRecovery = await expiredLeaseGateway.matchRecovery.recover()
  assert.equal(friendRecovery.ticketPurpose, 'rejoin')
  assert.ok(friendRecovery.roomExpiresAt < Date.now(), 'a playing friend-room rejoin must preserve its immutable expired lobby lease')

  const waitingHostGateway = createHttpGateways({
    baseUrl: 'https://platform.example', deviceId: 'd', accessToken: 'token', gameEndpointPolicy: 'secure-only',
  }, { request: async input => ok({ entry: validFriendEntry(input.body.recoveryAttemptId, {
    recoveryAttemptId: input.body.recoveryAttemptId,
  }) }) })
  const waitingHost = await waitingHostGateway.matchRecovery.recover()
  assert.equal(waitingHost.roomKind, 'friend')
  assert.equal(waitingHost.inviteText, '123456.Q7mN4vX9kLp2sTw8aBcD', 'waiting host recovery must retain the complete invite secret')

  const leakingGuestGateway = createHttpGateways({
    baseUrl: 'https://platform.example', deviceId: 'd', accessToken: 'token', gameEndpointPolicy: 'secure-only',
  }, { request: async input => ok({ entry: validFriendEntry(input.body.recoveryAttemptId, {
    recoveryAttemptId: input.body.recoveryAttemptId, seat: 'p3',
  }) }) })
  await assert.rejects(leakingGuestGateway.matchRecovery.recover(), error => error instanceof PlatformApiError && /邀请/.test(error.message))

  const waitingGuestGateway = createHttpGateways({
    baseUrl: 'https://platform.example', deviceId: 'd', accessToken: 'token', gameEndpointPolicy: 'secure-only',
  }, { request: async input => ok({ entry: validFriendEntry(input.body.recoveryAttemptId, {
    recoveryAttemptId: input.body.recoveryAttemptId, seat: 'p3', inviteCode: undefined, invitePayload: undefined, inviteText: undefined,
  }) }) })
  const waitingGuest = await waitingGuestGateway.matchRecovery.recover()
  assert.equal('inviteText' in waitingGuest, false, 'guest recovery must not synthesize or retain the host invite secret')

  const retryAttemptIds = []
  let recoveryRequests = 0
  const retryGateway = createHttpGateways({
    baseUrl: 'https://platform.example', deviceId: 'd', accessToken: 'token', gameEndpointPolicy: 'secure-only',
  }, { request: async input => {
    retryAttemptIds.push(input.body.recoveryAttemptId)
    recoveryRequests += 1
    if (recoveryRequests === 1) throw new Error('temporary timeout')
    return ok({ entry: null })
  } })
  await assert.rejects(retryGateway.matchRecovery.recover(), /temporary timeout/)
  assert.equal(await retryGateway.matchRecovery.recover(), null)
  assert.equal(retryAttemptIds[1], retryAttemptIds[0], 'an HTTP retry after transport uncertainty must reuse the same recovery attempt id')
}

const testWechatRecoveryRandomness = async () => {
  const descriptors = Object.fromEntries(['crypto', 'wx'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const requests = []
  const callbacks = []
  const native = { getRandomValues (options) {
    assert.equal(this, native, 'native random provider must retain its receiver')
    assert.equal(options.length, 16)
    callbacks.push(options)
  } }
  const gateways = createHttpGateways({
    baseUrl: 'https://platform.example', deviceId: 'd', accessToken: 'token', gameEndpointPolicy: 'secure-only',
  }, { request: async input => {
    requests.push(input.body.recoveryAttemptId)
    const id = input.body.recoveryAttemptId
    return ok({ entry: { entryAttemptId: id, recoveryAttemptId: id, matchId: 'wechat-recovery', roomId: '787878', seat: 'p3',
      roomKind: 'match', ticketPurpose: 'rejoin', gameEndpoint: 'wss://game.example/weapp',
      gameTicket: 'wechat-ticket', joinToken: 'wechat-ticket', expiresAt: Date.now() + 60_000 } })
  } })
  const flush = () => new Promise(resolve => setImmediate(resolve))
  try {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined })
    Object.defineProperty(globalThis, 'wx', { configurable: true, value: { getUserCryptoManager: () => native } })
    const first = gateways.matchRecovery.recover()
    const duplicate = gateways.matchRecovery.recover()
    const results = Promise.all([first, duplicate])
    // Attach immediately so a synchronous platform mismatch is an assertion failure, not an unhandled rejection.
    results.catch(() => undefined)
    await flush()
    assert.equal(callbacks.length, 1, 'phone recovery must request native secure bytes once, even during concurrent retry')
    assert.equal(requests.length, 0, 'HTTP must wait for native secure randomness')
    callbacks.shift().success({ randomValues: Uint8Array.from({ length: 16 }, (_, i) => i).buffer })
    const [a, b] = await results
    assert.equal(a.recoveryAttemptId, 'AAECAwQFBgcICQoLDA0ODw')
    assert.equal(b.recoveryAttemptId, a.recoveryAttemptId)
    assert.deepEqual(requests, [a.recoveryAttemptId, a.recoveryAttemptId])
    gateways.matchRecovery.confirm('not-a-current-attempt')
    await gateways.matchRecovery.recover()
    assert.equal(callbacks.length, 0, 'unrelated acknowledgements must not rotate a pending recovery identity')
    gateways.matchRecovery.confirm(a.recoveryAttemptId)
    const failing = assert.rejects(gateways.matchRecovery.recover(), /安全随机数.*失败/)
    await flush()
    callbacks.shift().fail({ errMsg: 'private-native-detail' })
    await failing
    const malformed = assert.rejects(gateways.matchRecovery.recover(), /安全随机数.*无效/)
    await flush()
    callbacks.shift().success({ randomValues: new ArrayBuffer(8) })
    await malformed
    const retry = gateways.matchRecovery.recover()
    await flush()
    callbacks.shift().success({ randomValues: new Uint8Array(16).fill(42).buffer })
    const recovered = await retry
    assert.notEqual(recovered.recoveryAttemptId, a.recoveryAttemptId)
    gateways.matchRecovery.abandon(recovered.recoveryAttemptId)
    const originalTimer = globalThis.setTimeout
    try {
      // Fast-forward only the native API's timeout, without a real five-second sleep.
      globalThis.setTimeout = (callback, delay, ...args) => {
        assert.equal(delay, 5000)
        return originalTimer(callback, 0, ...args)
      }
      await assert.rejects(gateways.matchRecovery.recover(), /安全随机数.*超时/)
    } finally { globalThis.setTimeout = originalTimer }
    const late = callbacks.shift()
    const afterTimeout = gateways.matchRecovery.recover()
    await flush()
    late.success({ randomValues: new Uint8Array(16).fill(99).buffer })
    callbacks.shift().success({ randomValues: new Uint8Array(16).fill(43).buffer })
    const fresh = await afterTimeout
    assert.equal(fresh.recoveryAttemptId, Buffer.alloc(16, 43).toString('base64url'), 'a late native callback must not overwrite the new recovery identity')
    gateways.matchRecovery.abandon(fresh.recoveryAttemptId)
    globalThis.wx.getUserCryptoManager = () => ({ getRandomValues: options => {
      const bytes = new Uint8Array(16)
      require('node:crypto').randomFillSync(bytes)
      queueMicrotask(() => options.success({ randomValues: bytes.buffer }))
    } })
    await testFriendRoomGateway()
    Object.defineProperty(globalThis, 'wx', { configurable: true, value: undefined })
    const beforeUnsupported = requests.length
    await assert.rejects(gateways.matchRecovery.recover(), /安全随机数/)
    assert.equal(requests.length, beforeUnsupported, 'unsupported environments must fail closed, never fall back to Math.random')
  } finally {
    for (const key of ['crypto', 'wx']) {
      if (descriptors[key]) Object.defineProperty(globalThis, key, descriptors[key])
      else delete globalThis[key]
    }
  }
}

const testFriendRoomGateway = async () => {
  const calls = []
  let createCalls = 0
  let numberCalls = 0
  const gateways = createHttpGateways({ baseUrl: 'https://platform.example', deviceId: 'd', accessToken: 'token', gameEndpointPolicy: 'secure-only' }, {
    request: async input => {
      const route = new URL(input.url).pathname
      calls.push({ route, body: input.body })
      if (route === '/api/v1/friend-rooms/create') {
        createCalls += 1
        if (createCalls === 1) throw new Error('response lost after friend room commit')
        return ok({ entry: validFriendEntry(input.body.entryAttemptId) })
      }
      if (route === '/api/v1/friend-rooms/join-by-number' && ++numberCalls === 1) throw new Error('numeric entry response lost')
      if (route === '/api/v1/friend-rooms/join' || route === '/api/v1/friend-rooms/join-by-number') return ok({ entry: validFriendEntry(input.body.entryAttemptId, {
        seat: 'p3', inviteCode: undefined, invitePayload: undefined, inviteText: undefined,
      }) })
      if (route === '/api/v1/match/cancel') return ok({ match: { matchId: input.body.matchId, status: 'cancelled' } })
      throw new Error(`unexpected friend-room route ${route}`)
    },
  })

  await assert.rejects(gateways.friendRooms.create(friendRoomSettings), error => error instanceof PlatformApiError && error.retryable)
  const created = await gateways.friendRooms.create(friendRoomSettings)
  assert.equal(created.inviteText, '123456.Q7mN4vX9kLp2sTw8aBcD')
  const creates = calls.filter(call => call.route.endsWith('/create'))
  assert.match(creates[0].body.entryAttemptId, /^[A-Za-z0-9_-]{22,128}$/)
  assert.equal(creates[1].body.entryAttemptId, creates[0].body.entryAttemptId, 'an uncertain create retry must reuse entryAttemptId')
  assert.deepEqual(creates[0].body.roomSettings, friendRoomSettings)

  const joined = await gateways.friendRooms.join(' 123456.Q7mN4vX9kLp2sTw8aBcD ')
  assert.equal(joined.seat, 'p3')
  const joinCall = calls.find(call => call.route.endsWith('/join'))
  assert.deepEqual({ roomId: joinCall.body.roomId, inviteCode: joinCall.body.inviteCode }, {
    roomId: '123456', inviteCode: 'Q7mN4vX9kLp2sTw8aBcD',
  })
  assert.match(joinCall.body.entryAttemptId, /^[A-Za-z0-9_-]{22,128}$/)
  await assert.rejects(gateways.friendRooms.join('123456'), error => error instanceof PlatformApiError && error.code === 'INVALID_FRIEND_ROOM_INVITE')
  const beforeInvalidNumber = calls.length
  for (const value of ['12345', 'abc456', '123456.token']) await assert.rejects(gateways.friendRooms.joinRoomNumber(value), error => error.code === 'INVALID_ROOM_NUMBER')
  assert.equal(calls.length, beforeInvalidNumber)
  await assert.rejects(gateways.friendRooms.joinRoomNumber(' 123456 '), error => error.retryable)
  const numbered = await gateways.friendRooms.joinRoomNumber(' 123456 ')
  const numberRequests = calls.filter(call => call.route.endsWith('/join-by-number'))
  assert.equal(numberRequests[0].body.entryAttemptId, numberRequests[1].body.entryAttemptId, 'lost numeric entry response must reuse the same attempt')
  assert.equal(numbered.seat, 'p3')
  assert.equal(calls.at(-1).route, '/api/v1/friend-rooms/join-by-number')
  assert.deepEqual(Object.keys(calls.at(-1).body).sort(), ['entryAttemptId', 'roomId'])
  assert.equal(calls.at(-1).body.roomId, '123456')
  await assert.rejects(gateways.friendRooms.joinRoomNumber('654321'), error => error.code === 'MALFORMED_RESPONSE' && /房间号不一致/.test(error.message))
  assert.equal(calls.filter(call => call.route.endsWith('/join')).length, 1, 'a six-digit display id alone must never reach the authenticated join endpoint')

  await gateways.friendRooms.cancel(created.matchId)
  assert.equal(calls.at(-1).body.matchId, created.matchId)

  const malformed = createHttpGateways({ baseUrl: 'https://platform.example', deviceId: 'd', accessToken: 'token', gameEndpointPolicy: 'secure-only' }, {
    request: async input => ok({ entry: validFriendEntry(input.body.entryAttemptId, { inviteText: '123456.wrong' }) }),
  })
  await assert.rejects(malformed.friendRooms.create(friendRoomSettings), error => error instanceof PlatformApiError && error.code === 'MALFORMED_RESPONSE' && /邀请口令/.test(error.message))
}

const testOrderIdempotencyRecovery = async () => {
  const keys = []
  let riceCalls = 0
  let soapCalls = 0
  const gateways = createHttpGateways({ baseUrl: 'https://platform.example', deviceId: 'd', accessToken: 'token' }, {
    request: async input => {
      assert.equal(new URL(input.url).pathname, '/api/v1/orders/redeem')
      keys.push({ productId: input.body.productId, key: input.headers['Idempotency-Key'] })
      if (input.body.productId === 'rice') {
        riceCalls += 1
        if (riceCalls === 1) throw new Error('response lost after commit')
        return ok({ order: { orderId: 'committed-order', productId: 'rice', quantity: 1, totalPoints: 3200, status: 'paid' } })
      }
      soapCalls += 1
      if (soapCalls === 1) return errorResponse(409, 'PRICE_CHANGED', '价格已变更')
      return ok({ order: { orderId: 'new-order', productId: 'soap', quantity: 1, totalPoints: 600, status: 'paid' } })
    },
  })

  await assert.rejects(gateways.shop.createOrder('rice', 1, 3200), error => error instanceof PlatformApiError && error.code === 'TRANSPORT_ERROR' && error.retryable)
  assert.equal((await gateways.shop.createOrder('rice', 1, 3200)).orderId, 'committed-order')
  assert.equal((await gateways.shop.createOrder('rice', 1, 3200)).orderId, 'committed-order')
  const riceKeys = keys.filter(item => item.productId === 'rice').map(item => item.key)
  assert.equal(riceKeys[0], riceKeys[1], 'an uncertain retry must reuse the original idempotency key')
  assert.notEqual(riceKeys[1], riceKeys[2], 'a confirmed success must release the idempotency key')

  await assert.rejects(gateways.shop.createOrder('soap', 1, 600), error => error instanceof PlatformApiError && error.status === 409)
  await gateways.shop.createOrder('soap', 1, 600)
  const soapKeys = keys.filter(item => item.productId === 'soap').map(item => item.key)
  assert.notEqual(soapKeys[0], soapKeys[1], 'a definite 4xx must release the idempotency key')
}

const testMerchantIdempotencyRecovery = async () => {
  const calls = []
  let storeCalls = 0
  let grantCalls = 0
  const gateways = createHttpGateways({ baseUrl: 'https://platform.example', deviceId: 'd', accessToken: 'token' }, {
    request: async input => {
      const route = new URL(input.url).pathname
      calls.push({ route, key: input.headers['Idempotency-Key'], body: input.body })
      if (route === '/api/v1/merchants/stores') {
        storeCalls += 1
        if (storeCalls === 1) throw new Error('store response lost after commit')
        return ok({ store: { id: 'str-recovered', merchantId: 'mch1', name: '清水湾店', address: '', status: 'active', createdAt: 1000 } })
      }
      if (route === '/api/v1/merchants/points/grant') {
        grantCalls += 1
        if (grantCalls === 1) throw new Error('grant response lost after commit')
        return ok({ grant: { id: 'mgr-recovered', merchantId: 'mch1', storeId: 'str1', operatorUserId: 'u1', recipientUserId: 'u3', amount: 20, note: '', status: 'posted', createdAt: 1100, duplicate: true } })
      }
      throw new Error(`unexpected route ${route}`)
    },
  })

  await assert.rejects(gateways.merchant.createStore({ name: '清水湾店' }), error => error instanceof PlatformApiError && error.retryable)
  assert.equal((await gateways.merchant.createStore({ name: '清水湾店' })).id, 'str-recovered')
  await gateways.merchant.createStore({ name: '清水湾店' })
  const storeKeys = calls.filter(item => item.route === '/api/v1/merchants/stores').map(item => item.key)
  assert.equal(storeKeys[0], storeKeys[1], 'uncertain store retry must reuse its idempotency key')
  assert.notEqual(storeKeys[1], storeKeys[2], 'confirmed store response must release its idempotency key')

  await assert.rejects(gateways.merchant.grantPoints({ storeId: 'str1', recipientUserId: 'u3', amount: 20 }), error => error instanceof PlatformApiError && error.retryable)
  assert.equal((await gateways.merchant.grantPoints({ storeId: 'str1', recipientUserId: 'u3', amount: 20 })).duplicate, true)
  const grantKeys = calls.filter(item => item.route === '/api/v1/merchants/points/grant').map(item => item.key)
  assert.equal(grantKeys[0], grantKeys[1], 'uncertain point grant retry must reuse its idempotency key')

  const callsBeforeInvalidInput = calls.length
  await assert.rejects(gateways.merchant.createStore({ name: '   ' }), error => error instanceof PlatformApiError && error.code === 'INVALID_MERCHANT_INPUT')
  await assert.rejects(gateways.merchant.grantPoints({ storeId: 'str1', recipientUserId: 'u3', amount: 0 }), error => error instanceof PlatformApiError && error.code === 'INVALID_MERCHANT_INPUT')
  assert.equal(calls.length, callsBeforeInvalidInput, 'invalid merchant forms must be rejected before network writes')
}

const testMalformedCollections = async () => {
  const products = createHttpGateways({ baseUrl: 'https://platform.example', deviceId: 'd', accessToken: 'token' }, {
    request: async () => ok({ products: null }),
  })
  await assert.rejects(products.shop.listProducts(), error => error instanceof PlatformApiError && error.code === 'MALFORMED_RESPONSE')

  const badProduct = createHttpGateways({ baseUrl: 'https://platform.example', deviceId: 'd', accessToken: 'token' }, {
    request: async () => ok({ products: [{ id: 'p1', name: '商品', pointsPrice: -1, stock: 1 }] }),
  })
  await assert.rejects(badProduct.shop.listProducts(), error => error instanceof PlatformApiError && /积分价格/.test(error.message))

  const badTournament = createHttpGateways({ baseUrl: 'https://platform.example', deviceId: 'd', accessToken: 'token' }, {
    request: async () => ok({ tournaments: [{ id: 't1', status: 'mystery', entryPoints: 1, queueId: 'quick' }] }),
  })
  await assert.rejects(badTournament.tournaments.listTournaments(), error => error instanceof PlatformApiError && /赛事状态/.test(error.message))

  const badTournamentFormat = createHttpGateways({ baseUrl: 'https://platform.example', deviceId: 'd', accessToken: 'token' }, {
    request: async () => ok({ tournaments: [validFixedTournament({ format: 'knockout' })] }),
  })
  await assert.rejects(badTournamentFormat.tournaments.listTournaments(), error => error instanceof PlatformApiError && /赛制/.test(error.message))

  const badTournamentState = createHttpGateways({ baseUrl: 'https://platform.example', deviceId: 'd', accessToken: 'token' }, {
    request: async () => ok(validTournamentState({ viewerEntry: { enrolled: true, checkedIn: 'yes', rosterLocked: true } })),
  })
  await assert.rejects(badTournamentState.tournaments.getState('t16'), error => error instanceof PlatformApiError && /布尔值/.test(error.message))

  const badAssignmentState = createHttpGateways({ baseUrl: 'https://platform.example', deviceId: 'd', accessToken: 'token' }, {
    request: async () => ok(validTournamentState({ assignment: { assignmentId: 'bad', roundNumber: 1, tableNumber: 1, status: 'waiting' } })),
  })
  await assert.rejects(badAssignmentState.tournaments.checkIn('t16'), error => error instanceof PlatformApiError && /分配状态/.test(error.message))

  const badQualification = createHttpGateways({ baseUrl: 'https://platform.example', deviceId: 'd', accessToken: 'token' }, {
    request: async () => ok({
      tournament: { id: 't1', title: '周末赛', status: 'running', entryFee: 0, queueId: 'weekend_cup', enrolled: true },
      standings: [validTournamentStanding({ qualificationStatus: 'maybe' })],
      provisional: true,
      cutoffRank: 8,
      viewerStanding: null,
    }),
  })
  await assert.rejects(badQualification.tournaments.getStandings('t1'), error => error instanceof PlatformApiError && /晋级状态/.test(error.message))

  const badWallet = createHttpGateways({ baseUrl: 'https://platform.example', deviceId: 'd', accessToken: 'token' }, {
    request: async () => ok({ wallet: { balance: -1 } }),
  })
  await assert.rejects(badWallet.wallet.getWallet(), error => error instanceof PlatformApiError && /钱包积分/.test(error.message))

  const badLogin = createHttpGateways({ baseUrl: 'https://platform.example', deviceId: 'regression-device', allowDevelopmentLogin: true }, {
    request: async () => ok({ accessToken: '   ' }),
  })
  await assert.rejects(badLogin.wallet.getWallet(), error => error instanceof PlatformApiError && error.code === 'MALFORMED_RESPONSE')

  const badMerchantStatus = createHttpGateways({ baseUrl: 'https://platform.example', deviceId: 'd', accessToken: 'token' }, {
    request: async () => ok(validMerchantConsole({ merchant: { ...validMerchantConsole().merchant, status: 'mystery' } })),
  })
  await assert.rejects(badMerchantStatus.merchant.getConsole(), error => error instanceof PlatformApiError && /商户资料状态/.test(error.message))

  const foreignMerchantData = createHttpGateways({ baseUrl: 'https://platform.example', deviceId: 'd', accessToken: 'token' }, {
    request: async () => ok(validMerchantConsole({ stores: [{ ...validMerchantConsole().stores[0], merchantId: 'mch-other' }] })),
  })
  await assert.rejects(foreignMerchantData.merchant.getConsole(), error => error instanceof PlatformApiError && /其他商户/.test(error.message))

  const malformedMerchantCollections = createHttpGateways({ baseUrl: 'https://platform.example', deviceId: 'd', accessToken: 'token' }, {
    request: async () => ok(validMerchantConsole({ employees: null })),
  })
  await assert.rejects(malformedMerchantCollections.merchant.getConsole(), error => error instanceof PlatformApiError && /员工列表/.test(error.message))

  const stringMerchantLimit = createHttpGateways({ baseUrl: 'https://platform.example', deviceId: 'd', accessToken: 'token' }, {
    request: async () => ok(validMerchantConsole({ merchant: { ...validMerchantConsole().merchant, dailyPointLimit: '5000' } })),
  })
  await assert.rejects(stringMerchantLimit.merchant.getConsole(), error => error instanceof PlatformApiError && /非负整数/.test(error.message))
}

;(async () => {
  await testDevelopmentTournamentState()
  await testBasicGateways()
  await testWechatLoginBody()
  await testLoginLifecycle()
  await testRequestGenerationAfterSignOut()
  await testFriendRoomIdempotentResponseOwnership()
  await testErrorMetadata()
  await testConcurrentUnauthorizedRefresh()
  await testTicketValidation()
  await testMatchRecoveryGateway()
  await testWechatRecoveryRandomness()
  await testFriendRoomGateway()
  await testOrderIdempotencyRecovery()
  await testMerchantIdempotencyRecovery()
  await testMalformedCollections()
  process.stdout.write('platform API regression checks passed\n')
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
