const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { loadTypeScript } = require('./support/typescript.cjs')

const projectRoot = path.resolve(__dirname, '..')
const sourcePath = path.join(projectRoot, 'assets/scripts/ui/TableLayoutOverlapAudit.ts')
const metaPath = `${sourcePath}.meta`
const gameScenePath = path.join(projectRoot, 'assets/scripts/scenes/GameScene.ts')
const tableHudPath = path.join(projectRoot, 'assets/scripts/ui/TableGameHud.ts')
const bridgePath = path.join(projectRoot, 'assets/scripts/scenes/TableLayoutAuditBridge.ts')
const bridgeMetaPath = `${bridgePath}.meta`
const ts = loadTypeScript()

assert.equal(fs.existsSync(sourcePath), true, 'the overlap audit must have a pure source module')
assert.equal(fs.existsSync(metaPath), true, 'the overlap audit must include Cocos metadata')
assert.match(JSON.parse(fs.readFileSync(metaPath, 'utf8')).uuid, /^[a-f0-9-]{36}$/)

const source = fs.readFileSync(sourcePath, 'utf8')
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  fileName: sourcePath,
  reportDiagnostics: true,
})
const errors = (transpiled.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
assert.deepEqual(errors, [], 'the pure overlap audit must transpile')
const moduleUnderTest = { exports: {} }
Function('module', 'exports', transpiled.outputText)(moduleUnderTest, moduleUnderTest.exports)
const { auditTableLayoutOverlaps, formatTableLayoutOverlapReport } = moduleUnderTest.exports

const report = auditTableLayoutOverlaps([
  { id: 'hand', label: '我方手牌区', role: 'cards', interactive: true, rect: { left: 0, bottom: 0, width: 400, height: 100 } },
  { id: 'play', label: '我方出牌区', role: 'cards', interactive: false, rect: { left: 100, bottom: 50, width: 200, height: 100 } },
  { id: 'control', label: '回合操作按钮', role: 'control', interactive: true, rect: { left: 150, bottom: 75, width: 100, height: 50 } },
  { id: 'decoration', label: '桌布高光', role: 'decoration', rect: { left: 180, bottom: 80, width: 20, height: 20 } },
], { width: 800, height: 400 }, { pixelScaleX: 0.5, pixelScaleY: 0.5 })

assert.deepEqual(report.viewportPx, { width: 400, height: 200 })
const handPlay = report.overlaps.find(overlap => overlap.firstId === 'hand' && overlap.secondId === 'play')
assert.deepEqual(handPlay, {
  firstId: 'hand', firstLabel: '我方手牌区', secondId: 'play', secondLabel: '我方出牌区', severity: 'notice',
  widthPx: 100, heightPx: 25, areaPx2: 2500, firstAreaRatio: 0.25, secondAreaRatio: 0.5,
}, 'the report must expose width, height, pixel area and both region ratios')
const handControl = report.overlaps.find(overlap => overlap.firstId === 'hand' && overlap.secondId === 'control')
assert.equal(handControl.severity, 'warning', 'two interactive regions must warn without forcing a layout change')
assert.ok(report.overlaps.some(overlap => overlap.secondId === 'decoration' && overlap.severity === 'allowed'), 'decorative overlap remains allowed')
assert.ok(formatTableLayoutOverlapReport(report).some(line => line.includes('100×25px = 2500px²') && line.includes('占我方手牌区 25.0%') && line.includes('占我方出牌区 50.0%')))
assert.doesNotMatch(source, /setPosition|setContentSize|\.active\s*=|\.visible\s*=|destroy\(/, 'the audit must measure only; it must never mutate layout')

const shapedHand = {
  id: 'hand', label: '我方手牌区', role: 'cards', interactive: true,
  rect: { left: 0, bottom: 0, width: 400, height: 300 },
  parts: [
    { left: 0, bottom: 0, width: 80, height: 300 },
    { left: 80, bottom: 0, width: 240, height: 100 },
    { left: 320, bottom: 0, width: 80, height: 300 },
  ],
}
const inBay = { id: 'play', label: '我方出牌区', role: 'cards', rect: { left: 100, bottom: 150, width: 200, height: 100 } }
assert.equal(auditTableLayoutOverlaps([shapedHand, inBay], { width: 800, height: 400 }).overlaps.length, 0, 'central empty bay is not a false hand/play collision')
const widePlay = { ...inBay, rect: { left: 0, bottom: 150, width: 400, height: 100 } }
const shapedReport = auditTableLayoutOverlaps([shapedHand, widePlay], { width: 800, height: 400 })
assert.equal(shapedReport.overlaps[0].areaPx2, 16000, 'only both side stacks intersect; central whitespace is excluded')
assert.equal(shapedReport.overlaps[0].secondAreaRatio, .4)
assert.equal(shapedReport.overlaps[0].firstAreaRatio, .1333, 'ratios remain relative to each safe region, not summed card areas')
assert.equal(shapedReport.overlaps[0].measurement, 'outline')
assert.ok(formatTableLayoutOverlapReport(shapedReport)[1].includes('实际交叠 16000px²'))
const duplicateParts = { ...shapedHand, parts: shapedHand.parts.concat(shapedHand.parts) }
assert.equal(auditTableLayoutOverlaps([duplicateParts, widePlay], { width: 800, height: 400 }).overlaps[0].areaPx2, 16000, 'stack layers must not double-count shared pixels')
assert.equal(auditTableLayoutOverlaps([{ ...shapedHand, parts: [] }, widePlay], { width: 800, height: 400 }).overlaps.length, 0, 'empty hands have no visible collision')
const scaledOutline = auditTableLayoutOverlaps([shapedHand, widePlay], { width: 800, height: 400 }, { pixelScaleX: .5, pixelScaleY: .25 }).overlaps[0]
assert.equal(scaledOutline.areaPx2, 2000)
assert.equal(scaledOutline.firstAreaRatio, .1333)
assert.equal(scaledOutline.secondAreaRatio, .4)
// Deterministic small-grid oracle: mixed/duplicate fragments must equal pixel union.
let seed = 903
const next = max => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % max }
for (let trial = 0; trial < 80; trial++) {
  const pieces = Array.from({ length: 6 }, () => ({ left: next(7), bottom: next(7), width: next(4) + 1, height: next(4) + 1 }))
  const target = { left: next(5), bottom: next(5), width: next(4) + 1, height: next(4) + 1 }
  const safe = { left: 0, bottom: 0, width: 10, height: 10 }
  let expected = 0
  const contains = (rect, x, y) => x >= rect.left && x < rect.left + rect.width && y >= rect.bottom && y < rect.bottom + rect.height
  for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) if (contains(target, x, y) && pieces.some(rect => contains(rect, x, y))) expected++
  const actual = auditTableLayoutOverlaps([
    { ...shapedHand, rect: safe, parts: pieces }, { ...inBay, rect: target },
  ], { width: 10, height: 10 }).overlaps[0]?.areaPx2 ?? 0
  assert.equal(actual, expected, `union area agrees with pixel oracle, trial ${trial}`)
}

const gameScene = fs.readFileSync(gameScenePath, 'utf8')
const tableHud = fs.readFileSync(tableHudPath, 'utf8')
const bridge = fs.readFileSync(bridgePath, 'utf8')
assert.equal(fs.existsSync(bridgeMetaPath), true, 'the Cocos bridge must include metadata')
assert.match(bridge, /__guandanLayoutAudit/, 'the enabled audit must expose a browser QA bridge')
assert.match(bridge, /pixelScaleX[\s\S]*pixelScaleY/, 'the runtime report must convert logical geometry into screen pixels')
assert.match(gameScene, /new TableLayoutAuditBridge\(/, 'the scene must compose, not implement, the audit bridge')
assert.match(bridge, /HUD_SURFACES[\s\S]*findDescendant/, 'the optional bridge must discover top-level HUD surfaces without coupling the pure audit to Cocos')
assert.match(gameScene, /setTouchExclusionPredicate\(screenPoint =>/, 'existing hit arbitration must remain the behavior authority when visuals overlap')

// Execute the real bridge in isolated globals, not Node's browser-compatible
// globals: the WeChat adapter has location.search but no URLSearchParams.
const bridgeJs = ts.transpileModule(bridge, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText
const createBridgeRuntime = (isBrowser, globals = {}, dependencies = {}) => {
  const warnings = []
  const sandbox = {
    exports: {},
    console: { warn: (...args) => warnings.push(args), info: () => {} },
    require: name => {
      if (name === 'cc') return { sys: { isBrowser } }
      if (name === '../ui/TableLayoutOverlapAudit') return moduleUnderTest.exports
      throw new Error(`Unexpected bridge dependency: ${name}`)
    },
    ...globals,
  }
  vm.createContext(sandbox)
  vm.runInContext(bridgeJs, sandbox)
  const instance = new sandbox.exports.TableLayoutAuditBridge({
    viewport: () => ({ width: 800, height: 400 }),
    handNode: () => null, playArea: () => null, humanId: () => 'p1',
    hudRoot: () => null, auxiliaryNodes: () => [],
    ...dependencies,
  })
  return { sandbox, instance, warnings }
}
const browserDocument = { getElementById: () => ({ getBoundingClientRect: () => ({ width: 400, height: 200 }) }) }
for (const [isBrowser, globals] of [
  [false, { location: { search: '?id=2' } }],
  [false, { URLSearchParams, document: browserDocument, location: { search: '?layoutAudit=1' } }],
  [true, { document: browserDocument, location: { search: '?layoutAudit=1' } }],
  [true, { URLSearchParams, location: { search: '?layoutAudit=1' } }],
  [true, { URLSearchParams, document: browserDocument, location: { search: '?id=2' } }],
  [true, { URLSearchParams, document: browserDocument, location: { search: '?notlayoutAudit=1' } }],
]) {
  const runtime = createBridgeRuntime(isBrowser, globals)
  assert.doesNotThrow(() => runtime.instance.install(), 'optional audit must not abort mini-game or unsupported-browser startup')
  assert.equal(runtime.sandbox.__guandanLayoutAudit, undefined, 'unsupported/opt-out platforms must not publish an audit')
  assert.doesNotThrow(() => runtime.instance.dispose())
}
const browserRuntime = createBridgeRuntime(true, {
  URLSearchParams, document: browserDocument, location: { search: '?id=2&layoutAudit=1' },
})
browserRuntime.instance.install()
assert.equal(typeof browserRuntime.sandbox.__guandanLayoutAudit?.snapshot, 'function', 'explicit browser opt-in must keep working')
assert.deepEqual(browserRuntime.sandbox.__guandanLayoutAudit.snapshot().viewportPx, { width: 400, height: 200 })
assert.doesNotThrow(() => browserRuntime.sandbox.__guandanLayoutAudit.warn())
browserRuntime.instance.dispose()
assert.equal(browserRuntime.sandbox.__guandanLayoutAudit, undefined, 'dispose must remove its own browser bridge')
browserRuntime.instance.install()
const replacement = {}
browserRuntime.sandbox.__guandanLayoutAudit = replacement
browserRuntime.instance.dispose()
assert.equal(browserRuntime.sandbox.__guandanLayoutAudit, replacement, 'dispose must preserve a replacement owner')

const brokenHost = createBridgeRuntime(true, {
  URLSearchParams, document: browserDocument,
  location: { get search () { throw new Error('adapter unavailable') } },
})
assert.doesNotThrow(() => brokenHost.instance.install(), 'host API failures must remain inside the diagnostic boundary')
assert.equal(brokenHost.warnings.length, 1, 'an unexpected diagnostic failure should warn once, not fail silently')

const element = tag => ({ tag, style: {}, children: [], hidden: false, removed: false,
  append (...children) { this.children.push(...children) }, remove () { this.removed = true },
})
const qaDocument = { ...browserDocument, body: element('body'), createElement: element }
const qa = createBridgeRuntime(true, { URLSearchParams, document: qaDocument, location: { search: '?layoutAudit=1' } })
qa.instance.install()
assert.equal(qaDocument.body.children.length, 1)
const qaRoot = qaDocument.body.children[0]
const [qaButton, qaOutput] = qaRoot.children
assert.equal(qaButton.textContent, '布局报告')
assert.equal(qaOutput.hidden, true)
qaButton.onclick()
assert.equal(qaOutput.hidden, false)
assert.match(qaOutput.textContent, /400×200px/)
qaButton.onclick()
assert.equal(qaOutput.hidden, true)
qa.instance.dispose()
assert.equal(qaRoot.removed, true, 'optional report UI must be cleaned up with its bridge')

const geometryNode = (name, rect, children = []) => ({
  name, children, isValid: true, activeInHierarchy: true,
  getComponent: () => ({ getBoundingBoxToWorld: () => ({ x: rect.left, y: rect.bottom, width: rect.width, height: rect.height }) }),
})
const handNode = geometryNode('Hand', shapedHand.rect, shapedHand.parts.map((rect, i) => geometryNode(`card-${i}`, rect, [geometryNode('CardVisual', rect)])))
const tableNode = geometryNode('PlayArea', shapedHand.rect, [geometryNode('play-p1', inBay.rect, [geometryNode('played-1', inBay.rect, [geometryNode('CardVisual', inBay.rect)])])])
const realGeometry = createBridgeRuntime(true, { URLSearchParams, document: browserDocument, location: { search: '?layoutAudit=1' } }, {
  handNode: () => handNode, playArea: () => ({ node: tableNode }),
})
realGeometry.instance.install()
let geometryReport = realGeometry.sandbox.__guandanLayoutAudit.snapshot()
assert.equal(geometryReport.regionCount, 2, 'audit reads only actual visible actions, not four phantom play regions')
assert.equal(geometryReport.overlaps.length, 0, 'live bridge preserves the empty central bay')
tableNode.children[0].children[0].children[0].activeInHierarchy = false
geometryReport = realGeometry.sandbox.__guandanLayoutAudit.snapshot()
assert.equal(geometryReport.regionCount, 1, 'deferred hidden cards are not reported as visible overlap')
realGeometry.instance.dispose()

const operationButtonRect = { left: 120, bottom: 150, width: 100, height: 50 }
const operations = geometryNode('FloatingOperationGroup', { left: 0, bottom: 150, width: 400, height: 50 }, [geometryNode('PassButton', operationButtonRect)])
const paddedOperations = createBridgeRuntime(true, { URLSearchParams, document: browserDocument, location: { search: '?layoutAudit=1' } }, {
  handNode: () => handNode, hudRoot: () => geometryNode('Hud', shapedHand.rect, [operations]),
})
paddedOperations.instance.install()
assert.equal(paddedOperations.sandbox.__guandanLayoutAudit.snapshot().overlaps.length, 0, 'symmetric clamp padding is not occupied button artwork or touch targets')
operationButtonRect.left = 30
assert.equal(paddedOperations.sandbox.__guandanLayoutAudit.snapshot().overlaps.length, 1, 'an actual button entering the hand still produces a warning')
paddedOperations.instance.dispose()

process.stdout.write('table layout overlap audit regression checks passed\n')
