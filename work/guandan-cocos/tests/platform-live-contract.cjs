const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const Module = require('node:module')
const fs = require('node:fs')

const projectRoot = path.resolve(__dirname, '..')
const platformSource = path.join(projectRoot, 'assets/scripts/services/PlatformApi.ts')
const serverEntry = path.resolve(projectRoot, '../guandan-windows-source/server/platform-server.js')
const typescriptPath = '/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/resources/3d/engine/node_modules/typescript'
const ts = require(typescriptPath)

function loadPlatformClient () {
  const compiled = ts.transpileModule(fs.readFileSync(platformSource, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: platformSource,
  }).outputText
  const runtimeModule = new Module(platformSource, module)
  runtimeModule.filename = platformSource
  runtimeModule.paths = Module._nodeModulePaths(path.dirname(platformSource))
  const previousTypeScriptLoader = Module._extensions['.ts']
  Module._extensions['.ts'] = (targetModule, filename) => {
    const dependency = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
      fileName: filename,
    }).outputText
    targetModule._compile(dependency, filename)
  }
  try {
    runtimeModule._compile(compiled, platformSource)
  } finally {
    if (previousTypeScriptLoader) Module._extensions['.ts'] = previousTypeScriptLoader
    else delete Module._extensions['.ts']
  }
  return runtimeModule.exports
}

class FetchTransport {
  async request (input) {
    const response = await fetch(input.url, {
      method: input.method,
      headers: input.headers,
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    })
    return { status: response.status, body: await response.json() }
  }
}

const listen = runtime => new Promise(resolve => {
  runtime.server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${runtime.server.address().port}`))
})
const close = runtime => new Promise(resolve => runtime.server.close(resolve))

;(async () => {
  assert.equal(fs.existsSync(serverEntry), true, `platform server is missing: ${serverEntry}`)
  const { createHttpGateways, PlatformApiError } = loadPlatformClient()
  const { createPlatformRuntime } = await import(pathToFileURL(serverEntry).href)
  const runtime = await createPlatformRuntime({
    env: {
      NODE_ENV: 'test',
      PLATFORM_ENABLE_DEV_LOGIN: 'true',
      PLATFORM_ACCESS_SECRET: 'live-contract-access-secret-at-least-32-characters',
      GAME_TICKET_SECRET: 'live-contract-ticket-secret-at-least-32-characters',
      GAME_RESULT_SECRET: 'live-contract-result-secret-at-least-32-characters',
      GAME_ENDPOINT: 'ws://127.0.0.1:39999/weapp',
    },
    logger: { error () {} },
  })
  const baseUrl = await listen(runtime)
  try {
    const gateways = Array.from({ length: 4 }, (_, index) => createHttpGateways({
      baseUrl,
      deviceId: `live-contract-device-${index + 1}`,
      displayName: `契约玩家${index + 1}`,
      allowDevelopmentLogin: true,
      httpEndpointPolicy: 'allow-localhost-insecure',
      gameEndpointPolicy: 'allow-localhost-insecure',
    }, new FetchTransport()))

    const profile = await gateways[0].auth.getProfile()
    assert.equal(profile.displayName, '契约玩家1')
    assert.equal((await gateways[0].wallet.getWallet()).points, 10_000)

    const products = await gateways[0].shop.listProducts()
    const soap = products.find(product => product.id === 'soap')
    assert.ok(soap)
    const order = await gateways[0].shop.createOrder(soap.id, 1, soap.pointsPrice)
    assert.equal(order.status, 'paid')
    assert.equal((await gateways[0].wallet.getWallet()).points, 10_000 - soap.pointsPrice)

    const tournaments = await gateways[0].tournaments.listTournaments()
    const rookie = tournaments.find(tournament => tournament.id === 'rookie-cup')
    assert.ok(rookie)
    const enrolled = await gateways[0].tournaments.enroll(rookie.id, rookie.entryPoints)
    assert.equal(enrolled.enrolled, true)

    const joined = []
    for (const gateway of gateways) joined.push(await gateway.matchmaking.joinQueue('quick'))
    const matchId = joined[3].ticketId
    assert.equal(joined[3].status, 'matched')
    const matched = await Promise.all(gateways.map(gateway => gateway.matchmaking.getStatus(matchId)))
    assert.deepEqual(new Set(matched.map(ticket => ticket.seat)), new Set(['p1', 'p2', 'p3', 'p4']))
    assert.equal(new Set(matched.map(ticket => ticket.roomId)).size, 1)
    assert.ok(matched.every(ticket => ticket.joinToken && ticket.expiresAt > Date.now()))
    await assert.rejects(
      gateways[0].matchmaking.cancel(matchId),
      error => error instanceof PlatformApiError && error.status === 409 && error.code === 'MATCH_ALREADY_ASSIGNED',
    )

    const tournamentGateways = Array.from({ length: 16 }, (_, index) => createHttpGateways({
      baseUrl,
      deviceId: `fixed-tournament-contract-${index + 1}`,
      displayName: `固定赛玩家${index + 1}`,
      allowDevelopmentLogin: true,
      httpEndpointPolicy: 'allow-localhost-insecure',
      gameEndpointPolicy: 'allow-localhost-insecure',
    }, new FetchTransport()))
    for (const [index, gateway] of tournamentGateways.entries()) {
      const fixedTournament = (await gateway.tournaments.listTournaments()).find(tournament => tournament.id === 'lingshui-16-cup')
      assert.ok(fixedTournament)
      await gateway.tournaments.enroll(fixedTournament.id, fixedTournament.entryPoints)
      const state = await gateway.tournaments.checkIn(fixedTournament.id)
      assert.equal(state.checkedInCount, index + 1)
    }
    await assert.rejects(
      tournamentGateways[0].matchmaking.joinQueue('lingshui_16_cup'),
      error => error instanceof PlatformApiError && error.code === 'TOURNAMENT_ASSIGNMENT_REQUIRED',
    )
    const tournamentStates = await Promise.all(tournamentGateways.map(gateway => gateway.tournaments.getState('lingshui-16-cup')))
    assert.ok(tournamentStates.every(state => state.phase === 'round-active' && state.roundNumber === 1 && state.assignment))
    const assignmentGroups = new Map()
    tournamentStates.forEach((state, index) => {
      const group = assignmentGroups.get(state.assignment.assignmentId) || []
      group.push({ gateway: tournamentGateways[index], assignment: state.assignment })
      assignmentGroups.set(state.assignment.assignmentId, group)
    })
    assert.equal(assignmentGroups.size, 4)
    for (const group of assignmentGroups.values()) {
      assert.equal(group.length, 4)
      const joinedTournamentTable = []
      for (const member of group) {
        joinedTournamentTable.push(await member.gateway.matchmaking.joinQueue('lingshui_16_cup', {
          tournamentId: 'lingshui-16-cup',
          assignmentId: member.assignment.assignmentId,
        }))
      }
      const tournamentMatchId = joinedTournamentTable.at(-1).ticketId
      const tableTickets = await Promise.all(group.map(member => member.gateway.matchmaking.getStatus(tournamentMatchId)))
      assert.ok(tableTickets.every(ticket => ticket.status === 'matched' && ticket.queueId === 'lingshui_16_cup'))
      assert.deepEqual(new Set(tableTickets.map(ticket => ticket.seat)), new Set(['p1', 'p2', 'p3', 'p4']))
    }
  } finally {
    await close(runtime)
  }
  process.stdout.write('Cocos platform client/live server contract passed\n')
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
