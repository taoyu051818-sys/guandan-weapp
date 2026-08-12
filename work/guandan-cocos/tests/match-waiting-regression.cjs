const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const { compilerPath, loadTypeScript } = require('./support/typescript.cjs')
const presentationPath = path.join(projectRoot, 'assets/scripts/services/MatchWaitingPresentation.ts')
const matchmakingPagePath = path.join(projectRoot, 'assets/scripts/scenes/front-pages/MatchmakingPageDomain.ts')
const ts = loadTypeScript()

require.extensions['.ts'] = (module, filePath) => {
  const result = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
    fileName: filePath,
    reportDiagnostics: true,
  })
  const errors = (result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
  assert.deepEqual(errors, [], `failed to transpile ${filePath}`)
  module._compile(result.outputText, filePath)
}

const { formatMatchElapsed, matchWaitingText } = require(presentationPath)
const source = fs.readFileSync(matchmakingPagePath, 'utf8')
const matchmakingOutput = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: matchmakingPagePath,
}).outputText
class PlatformApiError extends Error {}
const matchmakingModule = { exports: {} }
new Function('exports', 'module', 'require', matchmakingOutput)(matchmakingModule.exports, matchmakingModule, request => {
  if (request === 'cc') return {
    Color: class {}, Graphics: class {}, Label: class {}, UITransform: class {}, Vec3: class {},
    Node: class { static EventType = { TOUCH_END: 'touch-end' } },
    tween: () => ({ delay () { return this }, repeatForever () { return this }, to () { return this }, start () { return this } }),
  }
  if (request === '../../services/PlatformApi') return { PlatformApiError }
  if (request === '../../services/MatchWaitingPresentation') return { matchWaitingText }
  throw new Error(`unexpected dependency ${request}`)
})
const { MatchmakingPageDomain } = matchmakingModule.exports

const createDomain = matchmaking => {
  const router = { current: 'matching' }
  const notices = []
  const entered = []
  const pages = []
  const domain = new MatchmakingPageDomain({
    router,
    gateways: { matchmaking },
    isDisposed: () => false,
    scheduleOnce: () => {},
    showNotice: (...notice) => notices.push(notice),
    enterMatchedGame: ticket => entered.push(ticket),
    showMenu: () => { router.current = 'menu'; pages.push('menu') },
    showOnlinePlay: () => { router.current = 'online'; pages.push('online') },
    showCompetition: () => { router.current = 'competition'; pages.push('competition') },
    showClassicRooms: () => { router.current = 'classic-rooms'; pages.push('classic-rooms') },
  })
  return { domain, router, notices, entered, pages }
}

async function verifyUncertainTicketReconciliation () {
  const calls = []
  let initialFailure = true
  const harness = createDomain({
    joinQueue: async queueId => {
      calls.push(`join:${queueId}`)
      return { ticketId: 'new-ticket', queueId, status: 'matching' }
    },
    getStatus: async ticketId => {
      calls.push(`status:${ticketId}`)
      if (initialFailure) throw new Error('status unavailable')
      return { ticketId, queueId: 'quick', status: 'matching' }
    },
    cancel: async ticketId => {
      calls.push(`cancel:${ticketId}`)
      if (initialFailure) throw new Error('cancel unavailable')
    },
  })
  await harness.domain.cancelOrRecoverAssignedMatch('old-ticket')
  assert.deepEqual([...harness.domain.uncertainMatchIds], ['old-ticket'], 'cancel + status failure must retain the uncertain ticket id')

  initialFailure = false
  calls.length = 0
  harness.domain.matchAttemptToken = 1
  await harness.domain.requestMatch('quick', 1, 'menu')
  assert.deepEqual(calls.slice(0, 3), ['status:old-ticket', 'cancel:old-ticket', 'join:quick'], 'a new join must reconcile the prior uncertain ticket first')
  assert.equal(harness.domain.uncertainMatchIds.size, 0)

  const blockedCalls = []
  const blocked = createDomain({
    joinQueue: async queueId => { blockedCalls.push(`join:${queueId}`); return { ticketId: 'never', queueId, status: 'matching' } },
    getStatus: async ticketId => { blockedCalls.push(`status:${ticketId}`); throw new Error('status unavailable') },
    cancel: async ticketId => { blockedCalls.push(`cancel:${ticketId}`); throw new Error('cancel unavailable') },
  })
  await blocked.domain.cancelOrRecoverAssignedMatch('uncertain-ticket')
  blockedCalls.length = 0
  blocked.domain.matchAttemptToken = 1
  await blocked.domain.requestMatch('quick', 1, 'menu')
  assert.equal(blockedCalls.some(call => call.startsWith('join:')), false, 'an unresolved prior ticket must block creation of a second queue ticket')
  assert.deepEqual([...blocked.domain.uncertainMatchIds], ['uncertain-ticket'])
  assert.match(blocked.notices.at(-1)[0], /确认上次匹配/)

  for (let index = 0; index < 40; index += 1) blocked.domain.rememberUncertain(`ticket-${index}`)
  assert.equal(blocked.domain.uncertainMatchIds.size, 32, 'uncertain ticket retention must stay bounded')
  assert.equal(blocked.domain.uncertainMatchIds.has('ticket-0'), false)
  assert.equal(blocked.domain.uncertainMatchIds.has('ticket-39'), true)
}

assert.equal(formatMatchElapsed(-1), '00:00')
assert.equal(formatMatchElapsed(12_999), '00:12')
assert.equal(formatMatchElapsed(65_000), '01:05')
assert.equal(formatMatchElapsed(Number.NaN), '00:00')
assert.match(matchWaitingText('快速匹配', 'requesting', 2_000), /快速匹配[\s\S]*正在请求匹配服务[\s\S]*已等待 00:02/)
assert.match(matchWaitingText('新手体验赛', 'queued', 61_000), /已进入队列[\s\S]*已等待 01:01 · 可随时取消/)
assert.doesNotMatch(matchWaitingText('快速匹配', 'queued', 1_000), /人|预计|成功率/, 'the client must not invent queue population or ETA')
assert.match(source, /scheduleMatchingWaitTick/, 'the matching page must refresh elapsed time while it remains visible')
assert.match(source, /activeMatchTicketId = ticket\.ticketId[\s\S]*matchingStage = 'queued'/, 'server queue acceptance must advance the visible stage')
assert.match(source, /this\.pageButton\(ui, '取消匹配'/, 'matching must keep an explicit cancel action')
for (const terminalStatus of ['playing', 'completed', 'aborted']) {
  assert.match(source, new RegExp(`ticket\\.status === '${terminalStatus}'`), `${terminalStatus} must terminate client polling explicitly`)
}
assert.equal(fs.existsSync(`${presentationPath}.meta`), true, 'Cocos metadata is required for the presentation helper')

verifyUncertainTicketReconciliation().then(() => {
  process.stdout.write('match waiting regression checks passed\n')
}).catch(error => {
  console.error(error)
  process.exitCode = 1
})
