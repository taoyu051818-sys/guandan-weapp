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
  if (request === '../../services/MatchmakingErrorPresentation') return require(path.join(projectRoot, 'assets/scripts/services/MatchmakingErrorPresentation.ts'))
  if (request === '../../ui/CoastalUi') return {}
  if (request === './MatchmakingPageView') return { renderMatchmakingPage: () => ({ string: '' }) }
  if (request === '../../services/MatchWaitingPresentation') return { matchWaitingText }
  throw new Error(`unexpected dependency ${request}`)
})
const { MatchmakingPageDomain } = matchmakingModule.exports

// Exercise the actual waiting renderer, not the domain's view stub.
class WaitingNode {
  static EventType = { TOUCH_END: 'end' }
  constructor (name) { this.name = name; this.children = []; this.components = []; this.handlers = {} }
  set parent (value) { value.children.push(this) }
  setPosition (value) { this.position = value }
  addComponent (Type) { const value = new Type(); this.components.push(value); return value }
  on (event, action) { this.handlers[event] = action }
}
let shuffleTweens = 0
const waitingModule = { exports: {} }
const waitingSource = fs.readFileSync(path.join(projectRoot, 'assets/scripts/scenes/front-pages/MatchmakingPageView.ts'), 'utf8')
new Function('exports', 'module', 'require', ts.transpileModule(waitingSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText)(waitingModule.exports, waitingModule, name => {
  assert.equal(name, 'cc', 'waiting renderer must not acquire gateway or gameplay dependencies')
  return {
    Node: WaitingNode, Color: class {}, Vec3: class { constructor (x, y, z) { Object.assign(this, { x, y, z }) } },
    UITransform: class { setContentSize (width, height) { Object.assign(this, { width, height }) } },
    Graphics: class { roundRect () {} fill () {} stroke () {} },
    tween: () => ({ delay () { return this }, repeatForever () { return this }, to () { return this }, start () { shuffleTweens++ } }),
  }
})
const waitingView = (stage, animate = true) => {
  shuffleTweens = 0
  const parent = new WaitingNode('matching'), buttons = [], labels = [], actions = []
  const ui = { parent, panel: () => assert.fail('waiting must not restore the retired panel'),
    outlinedLabel: (text, x, y, fontSize, style) => { const label = { string: text, ...style }; labels.push(label); return label },
    button: (_name, text, x, width, height) => { const node = new WaitingNode(text); Object.assign(node, { width, height }); buttons.push(node); return node },
  }
  const status = waitingModule.exports.renderMatchmakingPage(ui, stage, stage === 'failed' ? '网络暂不可用' : null,
    () => actions.push('cancel'), () => actions.push('retry'), () => actions.push('defer'), animate)
  return { parent, buttons, labels, actions, status, tweens: shuffleTweens }
}
const queuedView = waitingView('queued')
assert.equal(queuedView.parent.children.length, 3)
assert.equal(queuedView.tweens, 3)
assert.deepEqual(queuedView.parent.children.map(n => n.components[0].width), [58, 58, 58])
assert.deepEqual(queuedView.buttons.map(n => n.name), ['取消匹配'])
queuedView.buttons[0].handlers.end(); assert.deepEqual(queuedView.actions, ['cancel'])
assert.equal(waitingView('queued', false).tweens, 0, 'reduced effect quality keeps static cards')
assert.equal(waitingView('cancelling').tweens, 0)
assert.equal(waitingView('entering').buttons.length, 0, 'no duplicate cancel during handoff')
const failedView = waitingView('failed')
assert.equal(failedView.parent.children.length, 0, 'a failed request is not shown as ongoing shuffling')
assert.equal(failedView.status.height, 116)
failedView.buttons[1].handlers.end(); assert.deepEqual(failedView.actions, ['retry'])
const uncertainView = waitingView('cancel-uncertain')
uncertainView.buttons[0].handlers.end(); assert.deepEqual(uncertainView.actions, ['defer'])
const frontSource = fs.readFileSync(path.join(projectRoot, 'assets/scripts/scenes/FrontPageController.ts'), 'utf8')
assert.match(frontSource, /previous === 'matching' \|\| next === 'matching'.*setFriendRoomWaitingVisible\(next === 'matching'\)/,
  'matching route uses the empty-table lifecycle on both entry and exit')

const createDomain = matchmaking => {
  const router = { current: 'matching', open: () => { router.current = 'matching'; return {} } }
  const notices = []
  const entered = []
  const pages = []
  const scheduled = []
  const domain = new MatchmakingPageDomain({
    animationsEnabled: () => true,
    router,
    gateways: { matchmaking },
    isDisposed: () => false,
    scheduleOnce: (callback, delay) => scheduled.push({ callback, delay }),
    showNotice: (...notice) => notices.push(notice),
    enterMatchedGame: ticket => entered.push(ticket),
    showMenu: () => { router.current = 'menu'; pages.push('menu') },
    showOnlinePlay: () => { router.current = 'online'; pages.push('online') },
    showClassicRooms: () => { router.current = 'classic-rooms'; pages.push('classic-rooms') },
  })
  return { domain, router, notices, entered, pages, scheduled }
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
assert.equal(matchWaitingText('快速匹配', 'requesting', 2_000), '')
assert.equal(matchWaitingText('新手体验赛', 'queued', 61_000), '')
assert.equal(matchWaitingText('快速匹配', 'queued', 3_000, true), '')
assert.doesNotMatch(matchWaitingText('快速匹配', 'queued', 1_000), /人|预计|成功率/, 'the client must not invent queue population or ETA')
assert.match(source, /scheduleMatchingWaitTick/, 'the matching page must refresh elapsed time while it remains visible')
assert.match(source, /activeMatchTicketId = ticket\.ticketId[\s\S]*matchingStage = 'queued'/, 'server queue acceptance must advance the visible stage')
for (const stage of ['requesting', 'queued', 'cancelling', 'cancel-uncertain', 'entering', 'failed']) {
  const { buttons, actions, status } = waitingView(stage)
  const expected = { requesting: ['取消匹配'], queued: ['取消匹配'], cancelling: [], entering: [], 'cancel-uncertain': ['稍后确认', '重新确认'], failed: ['返回', '重新匹配'] }
  assert.deepEqual(buttons.map(b => b.name), expected[stage], 'only valid actions may be clickable in ' + stage)
  for (const button of buttons) {
    assert.ok(Math.abs(button.position.x) + button.width / 2 <= 410)
    assert.ok(Math.abs(button.position.y) + button.height / 2 <= 207)
    button.handlers.end()
  }
  if (stage === 'failed') assert.deepEqual(actions, ['cancel', 'retry'])
  if (stage === 'cancel-uncertain') assert.deepEqual(actions, ['defer', 'cancel'])
  if (buttons.length === 2) assert.ok(buttons[1].position.x - buttons[0].position.x - buttons[0].width >= 24, 'dual actions need an unambiguous touch gap')
  if (stage === 'failed' || stage === 'cancel-uncertain') assert.equal(status.height, 116, 'actionable errors have multiline space')
}
for (const terminalStatus of ['playing', 'completed', 'aborted']) {
  assert.match(source, new RegExp(`ticket\\.status === '${terminalStatus}'`), `${terminalStatus} must terminate client polling explicitly`)
}
assert.equal(fs.existsSync(`${presentationPath}.meta`), true, 'Cocos metadata is required for the presentation helper')

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const matched = id => ({ ticketId: id, status: 'matched', entryAttemptId: 'entry', roomId: '123456', gameEndpoint: 'wss://game.example/weapp', joinToken: 'ticket', seat: 'p1', expiresAt: Date.now() + 60000 })

async function verifyMatchFlow () {
  for (const returnPage of ['menu', 'online', 'classic-rooms']) {
    let joins = 0
    const h = createDomain({ joinQueue: async () => { joins++; return { ticketId: 'late', status: 'matching' } } })
    h.router.current = returnPage
    h.domain.begin('quick', '快速匹配', returnPage)
    h.domain.begin('quick', '快速匹配', returnPage)
    assert.equal(h.scheduled.filter(s => s.delay === 0).length, 1, 'double tap cannot create a second scheduled join')
    await h.domain.cancelMatch()
    h.scheduled.find(s => s.delay === 0).callback()
    await flush()
    assert.equal(joins, 0, 'cancel before dispatch must not create a ticket')
    assert.deepEqual(h.pages, [returnPage], 'cancel returns to its real origin')
  }
  const joining = deferred(), cancelling = deferred()
  let cancelCalls = 0
  const h = createDomain({ joinQueue: () => joining.promise, cancel: () => { cancelCalls++; return cancelling.promise } })
  h.domain.begin('quick', '快速匹配', 'menu')
  h.scheduled.find(s => s.delay === 0).callback()
  await flush()
  const cancelTask = h.domain.cancelMatch()
  await h.domain.cancelMatch()
  assert.equal(h.domain.matchingStage, 'cancelling')
  assert.equal(h.router.current, 'matching', 'in-flight join must settle before navigating away')
  joining.resolve({ ticketId: 'joining-ticket', status: 'matching' })
  await flush()
  assert.equal(cancelCalls, 1, 'repeated cancel taps issue one cancel')
  assert.deepEqual(h.pages, [], 'do not claim cancellation before the server confirms')
  cancelling.resolve()
  await cancelTask
  assert.deepEqual(h.pages, ['menu'])
  await h.domain.reconcileStaleMatch(matched('joining-ticket'))
  assert.deepEqual(h.entered, [], 'a stale matched response after confirmed cancellation cannot teleport the player')

  const crossing = createDomain({ cancel: async () => { throw new Error('already assigned') }, getStatus: async () => matched('crossed') })
  crossing.domain.matchingStage = 'queued'
  crossing.domain.activeMatchTicketId = 'crossed'
  await crossing.domain.cancelMatch()
  assert.equal(crossing.entered.length, 1)
  assert.equal(crossing.domain.matchingStage, 'entering', 'server assignment takes ownership before displaying entering')
  assert.deepEqual(crossing.pages, [], 'assignment/cancel race must not bounce through the lobby')
  await crossing.domain.cancelMatch()
  assert.equal(crossing.entered.length, 1)
  assert.doesNotMatch(matchWaitingText('经典', 'entering', 4000), /可随时取消|待分配/)

  let unavailable = true
  const uncertain = createDomain({ cancel: async () => { if (unavailable) throw new Error('offline') }, getStatus: async () => { throw new Error('offline') } })
  uncertain.domain.activeMatchTicketId = 'uncertain'
  await uncertain.domain.cancelMatch()
  assert.equal(uncertain.domain.matchingStage, 'cancel-uncertain')
  assert.deepEqual(uncertain.pages, [])
  unavailable = false
  await uncertain.domain.cancelMatch()
  assert.deepEqual(uncertain.pages, ['menu'], 'cancel retry must return only after confirmation')

  const later = createDomain({ cancel: async () => { throw new Error('offline') }, getStatus: async () => { throw new Error('offline') } })
  later.domain.activeMatchTicketId = 'later'
  await later.domain.cancelMatch()
  later.domain.deferUncertainMatch()
  assert.deepEqual(later.pages, ['menu'], 'offline cancellation still provides an explicit escape route')
  assert.ok(later.domain.uncertainMatchIds.has('later'), 'leaving must not discard uncertain ownership')
  await later.domain.reconcileStaleMatch(matched('later'))
  assert.equal(later.entered.length, 0, 'deferred confirmation must not auto-enter from a late poll')

  let joinCalls = 0
  const retry = createDomain({ joinQueue: async () => { if (++joinCalls === 1) throw new Error('offline'); return { ticketId: 'retry', status: 'matching' } }, cancel: async () => {} })
  retry.domain.begin('classic_50', '经典初级场', 'classic-rooms')
  retry.scheduled.find(s => s.delay === 0).callback()
  await flush()
  assert.equal(retry.domain.matchingStage, 'failed')
  assert.deepEqual(retry.pages, [], 'failed join retains the matching page and its queue')
  retry.domain.retryRequest()
  retry.scheduled.filter(s => s.delay === 0).at(-1).callback()
  await flush()
  assert.equal(retry.domain.matchingStage, 'queued')
  assert.equal(joinCalls, 2)
  await retry.domain.cancelMatch()
  assert.deepEqual(retry.pages, ['classic-rooms'])

  let invalidCancels = 0
  const invalid = createDomain({ cancel: async () => { invalidCancels++ } })
  invalid.domain.activeMatchTicketId = 'invalid'
  invalid.domain.acceptMatchTicket({ ticketId: 'invalid', status: 'matched' }, 0, 'menu')
  assert.equal(invalid.domain.matchingStage, 'failed')
  assert.equal(invalid.domain.activeMatchTicketId, 'invalid', 'malformed entry retains ticket ownership until the user retries or leaves')
  assert.equal(invalidCancels, 0, 'a background cancel must not race an inline error page')
  await invalid.domain.cancelMatch()
  assert.equal(invalidCancels, 1)
  assert.deepEqual(invalid.pages, ['menu'])

  const pollFailure = createDomain({ getStatus: async () => { throw new Error('offline') }, cancel: async () => {} })
  pollFailure.domain.matchingStage = 'queued'
  pollFailure.domain.activeMatchTicketId = 'poll'
  await pollFailure.domain.pollMatch('poll', 0, 'menu')
  assert.equal(pollFailure.domain.matchingStage, 'failed')
  assert.deepEqual(pollFailure.pages, [], 'poll failure must offer recovery without losing the queue origin')
  await pollFailure.domain.cancelMatch()
  assert.deepEqual(pollFailure.pages, ['menu'])
}

Promise.resolve().then(verifyUncertainTicketReconciliation).then(verifyMatchFlow).then(() => {
  process.stdout.write('match waiting regression checks passed\n')
}).catch(error => {
  console.error(error)
  process.exitCode = 1
})
