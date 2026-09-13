// Audit-only. Mutations affect fs reads inside disposable child processes only.
// Original CJS test bodies and original assertion semantics are retained.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../../../../work/guandan-cocos')
const cases = [
  { id: 'TOUCH_INTENT', file: 'game/HandDragSelectionPolicy.ts',
    from: 'desiredSelected: !selected,', to: 'desiredSelected: selected,', test: 'selection' },
  { id: 'TOUCH_VISIT', file: 'game/HandDragSelectionPolicy.ts',
    from: 'gesture.visitedCardIds.add(cardId)', to: 'void cardId', test: 'selection' },
  { id: 'LOCK_ATOMIC', file: 'game/HandGrouping.ts',
    from: 'return group.locked || group.cardIds[group.cardIds.length - 1] === cardId ? group.cardIds.slice() : []',
    to: 'return group.locked || group.cardIds[group.cardIds.length - 1] === cardId ? [cardId] : []', test: 'hand-grouping' },
  { id: 'RESTORE_HAND', file: 'game/HandGrouping.ts',
    from: 'snapshotIds.some(cardId => !authoritativeIds.has(cardId))) return false',
    to: 'snapshotIds.some(cardId => !authoritativeIds.has(cardId))) return true', test: 'hand-grouping' },
  { id: 'CLOCK_CANCEL', file: 'scenes/TableTurnClockController.ts',
    from: 'this.dependencies.unschedule(this.tick)', to: 'void this.tick', test: 'table-turn-clock-controller' },
  { id: 'CLOCK_RESET', file: 'scenes/TableTurnClockController.ts',
    from: 'this.snapshot = null', to: 'void this.snapshot', test: 'table-turn-clock-controller' },
  { id: 'WIRE_COPY', file: 'game/RoundViewState.ts',
    from: 'return snapshotData<EngineState>(state) as EngineState', to: 'return state', test: 'round-view-boundary' },
  { id: 'TRIBUTE_COPY', file: 'scenes/TablePhasePresenter.ts',
    from: "? '确认还牌' : '确认贡牌'", to: "? '确认贡牌' : '确认贡牌'", test: 'table-phase-presenter' },
  { id: 'LEVEL_FLAG', file: 'ui/CardPresentationMapper.ts',
    from: 'levelCard: card.isLevelCard,', to: 'levelCard: false,', test: 'card-presentation-mapper' },
]
const bootstrap = String.raw`
'use strict'
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module')
const config = JSON.parse(process.argv[1])
const originalRead = fs.readFileSync.bind(fs)
const originalLoad = Module._load
const originalAssert = require('node:assert/strict')
const summary = { sourceReads: 0, assertions: 0, failure: null, setupError: null }
const check = fn => (...args) => {
  summary.assertions++
  try { return fn(...args) } catch (error) {
    summary.failure ??= { name: error.name, message: error.message.slice(0, 700) }
    throw error
  }
}
const guardedAssert = new Proxy(originalAssert, {
  apply(target, self, args) { return check(target)(...args) },
  get(target, key) {
    const value = Reflect.get(target, key)
    return typeof value === 'function' && /^[a-z]/.test(String(key)) ? check(value) : value
  },
})
Module._load = function (specifier, parent, isMain) {
  if (specifier === 'node:assert/strict' || specifier === 'assert/strict') return guardedAssert
  return originalLoad.call(this, specifier, parent, isMain)
}
fs.readFileSync = function (file, ...args) {
  const value = originalRead(file, ...args)
  if (!config.mutant || typeof file !== 'string' || path.resolve(file) !== config.target) return value
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : value
  if (text.split(config.mutant.from).length !== 2) throw Error('AUDIT mutation target is not unique')
  summary.sourceReads++
  const changed = text.replace(config.mutant.from, config.mutant.to)
  return Buffer.isBuffer(value) ? Buffer.from(changed) : changed
}
process.on('exit', () => process.stdout.write('\nAUDIT_RESULT:' + JSON.stringify(summary) + '\n'))
try { require(config.testFile) } catch (error) {
  if (!summary.failure) summary.setupError = { name: error.name, message: error.message.slice(0, 700) }
  process.exitCode = 1
}
`
function run(test, mutant = null) {
  const testFile = path.join(root, 'tests', test + '-regression.cjs')
  const target = mutant && path.join(root, 'assets/scripts', mutant.file)
  const child = spawnSync(process.execPath, ['-e', bootstrap, JSON.stringify({ testFile, target, mutant })],
    { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 })
  assert.equal(child.error, undefined, test + ': child execution error')
  assert.equal(child.signal, null, test + ': child unexpectedly signaled')
  const line = child.stdout.split('\n').find(s => s.startsWith('AUDIT_RESULT:'))
  assert.ok(line, test + ': child did not complete')
  return { exitCode: child.status, ...JSON.parse(line.slice('AUDIT_RESULT:'.length)),
    output: child.stdout.split('\n').filter(s => s && !s.startsWith('AUDIT_RESULT:')).join('\n').slice(0, 500) }
}
const baselines = Object.fromEntries([...new Set(cases.map(c => c.test))].map(test => {
  const result = run(test)
  assert.equal(result.exitCode, 0, JSON.stringify({ test, result }))
  assert.equal(result.failure, null)
  assert.equal(result.setupError, null)
  return [test, result]
}))
const mutations = cases.map(c => {
  const result = run(c.test, c)
  assert.ok(result.sourceReads > 0, c.id + ': source not reached')
  assert.equal(result.exitCode, 1, c.id + ': changed behavior was not detected')
  assert.equal(result.setupError, null, c.id + ': setup failure is not a detected mutation')
  assert.equal(result.failure?.name, 'AssertionError', c.id + ': expected original test assertion')
  return { id: c.id, source: c.file, test: c.test, result }
})
console.log(JSON.stringify({ baselines, mutations, tested: cases.length, detected: mutations.length,
  scope: 'Nine handpicked in-memory source faults detected by six unmodified original CJS test entries. No global mutation coverage, live Cocos/WeChat test, test assertion edits or product writes.' }, null, 2))
