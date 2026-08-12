const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTypeScript } = require('./support/typescript.cjs')

const projectRoot = path.resolve(__dirname, '..')
const actionPath = path.join(projectRoot, 'assets/scripts/effects/EffectActionPresentationCoordinator.ts')
const playbackPath = path.join(projectRoot, 'assets/scripts/effects/EffectPlaybackCoordinator.ts')
const handlePath = path.join(projectRoot, 'assets/scripts/effects/EffectHandle.ts')
const policyPath = path.join(projectRoot, 'assets/scripts/effects/NetworkEffectSyncPolicy.ts')
const ts = loadTypeScript()

;(async () => {

for (const sourcePath of [actionPath, playbackPath]) {
  assert.equal(fs.existsSync(sourcePath), true, `${path.basename(sourcePath)} must exist`)
  assert.equal(fs.existsSync(`${sourcePath}.meta`), true, `${path.basename(sourcePath)} must have Cocos metadata`)
}

const loadPureTs = (sourcePath, dependencies = {}) => {
  const result = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
    fileName: sourcePath,
    reportDiagnostics: true,
  })
  const errors = (result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
  assert.deepEqual(errors, [], `${path.basename(sourcePath)} must transpile`)
  const moduleRecord = { exports: {} }
  new Function('exports', 'module', 'require', '__filename', '__dirname', result.outputText)(
    moduleRecord.exports,
    moduleRecord,
    request => {
      if (Object.prototype.hasOwnProperty.call(dependencies, request)) return dependencies[request]
      throw new Error(`unexpected dependency ${request}`)
    },
    sourcePath,
    path.dirname(sourcePath),
  )
  return moduleRecord.exports
}

const policy = loadPureTs(policyPath)
const { EffectHandle } = loadPureTs(handlePath)
const { EffectActionPresentationCoordinator } = loadPureTs(actionPath, { './NetworkEffectSyncPolicy': policy })
const { EffectPlaybackCoordinator } = loadPureTs(playbackPath, {
  '../core/generated': { PlayType: { Pass: 'Pass' } },
  './EffectHandle': { EffectHandle },
  './EffectRecipes': { isBombEffectKey: () => false },
})

const card = id => ({ id, rank: '3', suit: 'Spades' })
const action = (cards = [card('c1')]) => ({ playerId: 'p1', type: 'Single', cards })
const position = playerId => `seat:${playerId}`
const presentationCalls = []
const presentation = {
  deferAction: (_action, index) => { presentationCalls.push(['defer', index]); return `ticket:${index}` },
  beginAction: (_action, index, ticket) => presentationCalls.push(['begin', index, ticket]),
  revealCard: (_action, index, cardId, ticket) => presentationCalls.push(['card', index, cardId, ticket]),
  revealAction: (_action, index, ticket) => presentationCalls.push(['reveal', index, ticket]),
  resetPresentation: count => presentationCalls.push(['reset', count]),
}
const actionCoordinator = new EffectActionPresentationCoordinator()
const requests = []
let recoveries = 0
const sync = actions => actionCoordinator.syncActions(actions, 'p1', position, position, presentation, () => { recoveries += 1 }, request => requests.push(request))

sync([action()])
assert.deepEqual(requests, [], 'the first snapshot must establish a silent baseline')
actionCoordinator.captureLocalOrigins([{ cardId: 'c2', worldPosition: 'captured:c2' }])
sync([action()])
assert.deepEqual(requests, [], 'a duplicate snapshot must remain silent')
sync([action(), action([card('c2'), card('c3')])])
assert.deepEqual(requests.at(-1).sourcePositions, ['captured:c2', 'seat:p1'], 'the authoritative append must consume matching local origins once')
requests.at(-1).onFlightStart()
requests.at(-1).onCardArrive('c2')
requests.at(-1).onFlightFinish()
assert.deepEqual(presentationCalls.slice(-4), [
  ['defer', 1], ['begin', 1, 'ticket:1'], ['card', 1, 'c2', 'ticket:1'], ['reveal', 1, 'ticket:1'],
], 'one deferred ticket must follow the flight lifecycle without changing payload identity')
sync([action(), action(), action(), action()])
assert.equal(recoveries, 1, 'an action-count gap must cancel the visible lifecycle before rebasing')
assert.deepEqual(presentationCalls.at(-1), ['reset', 4])

const reports = []
const voiceCalls = []
const soundCalls = []
const pendingPreparation = []
let available = true
const playback = new EffectPlaybackCoordinator({
  isAvailable: () => available,
  getFlight: () => null,
  withQuality: (_quality, work) => work(),
  preparePlayImpact: () => new Promise(resolve => pendingPreparation.push(resolve)),
  renderPlayImpact: () => EffectHandle.completed(),
  prepareContext: () => Promise.resolve(true),
  renderContext: () => EffectHandle.completed(),
  playSound: sound => soundCalls.push(sound),
  playActionVoice: value => voiceCalls.push(value),
  vibrate: () => {},
  reportError: (message, error) => reports.push([message, error]),
})
const profile = { key: 'single', level: 0, label: '', durationMs: 0, flightMs: 200, shake: 'none', sound: 'play', haptic: 'none', dimTable: false, color: [0, 0, 0] }
const lifecycle = []
const firstHandle = playback.play({
  action: action(), actionIndex: 0, humanId: 'p1', sourcePositions: [], targetWorldPosition: 'target',
  onFlightStart: () => lifecycle.push('start'), onFlightFinish: () => lifecycle.push('finish'),
}, 'full', profile)
await Promise.resolve()
assert.equal(pendingPreparation.length, 1, 'the first queued action must own asynchronous preparation')
playback.cancelAll('recovery')
pendingPreparation[0](true)
assert.equal(await firstHandle.finished, 'recovery')
await Promise.resolve()
assert.deepEqual(lifecycle, [], 'recovery cancellation must not reveal a stale deferred presentation')
assert.deepEqual(voiceCalls, [], 'late preparation must not emit action voice after recovery')
assert.deepEqual(soundCalls, [], 'late preparation must not emit semantic audio after recovery')

const secondHandle = playback.play({ action: action(), actionIndex: 1, humanId: 'p1', sourcePositions: [], targetWorldPosition: 'target' }, 'off', profile)
await Promise.resolve()
assert.equal(await secondHandle.finished, 'completed')
assert.equal(voiceCalls.length, 1, 'visual-off playback must still dispatch one action voice through the visible lane')
assert.deepEqual(soundCalls, ['play'])
available = false
const unavailableHandle = playback.waitForPresentation(Promise.resolve())
await Promise.resolve()
assert.equal(await unavailableHandle.finished, 'unavailable', 'a destroyed owner must reject newly queued visible work')
assert.deepEqual(reports, [])

process.stdout.write('effect controller lifecycle regression checks passed\n')
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
