const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const { compilerPath, loadTypeScript } = require('./support/typescript.cjs')
const designPath = path.join(projectRoot, 'assets/scripts/effects/EffectDesignSystem.ts')
const primitivesPath = path.join(projectRoot, 'assets/scripts/effects/EffectPrimitives.ts')

assert.equal(fs.existsSync(compilerPath), true, 'Cocos Creator TypeScript compiler is required')
const ts = loadTypeScript()
const read = filePath => fs.readFileSync(filePath, 'utf8')

const loadPureTs = (filePath, dependencies = {}) => {
  const result = ts.transpileModule(read(filePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
    fileName: filePath,
    reportDiagnostics: true,
  })
  const errors = (result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
  assert.deepEqual(errors, [], `failed to transpile ${filePath}`)
  const module = { exports: {} }
  const localRequire = request => {
    if (Object.prototype.hasOwnProperty.call(dependencies, request)) return dependencies[request]
    throw new Error(`unexpected runtime dependency ${request} in ${filePath}`)
  }
  new Function('exports', 'module', 'require', '__filename', '__dirname', result.outputText)(module.exports, module, localRequire, filePath, path.dirname(filePath))
  return module.exports
}

class MockColor {
  constructor (r, g, b, a) { Object.assign(this, { r, g, b, a }) }
}

class MockUITransform {
  constructor () { this.contentSize = { width: 0, height: 0 } }
  setContentSize (width, height) { this.contentSize = { width, height } }
}

class MockLabel {
  static HorizontalAlign = { CENTER: 'center' }
  static VerticalAlign = { CENTER: 'center' }
  static Overflow = { SHRINK: 'shrink' }
}

class MockNode {
  constructor (name) {
    this.name = name
    this.children = []
    this.components = []
    this._parent = null
  }
  set parent (parent) {
    if (this._parent) this._parent.children = this._parent.children.filter(child => child !== this)
    this._parent = parent
    if (parent) parent.children.push(this)
  }
  get parent () { return this._parent }
  addComponent (Type) {
    const component = new Type()
    component.node = this
    this.components.push(component)
    return component
  }
  getComponent (Type) { return this.components.find(component => component instanceof Type) ?? null }
  setSiblingIndex (index) {
    if (!this.parent) return
    const siblings = this.parent.children.filter(child => child !== this)
    siblings.splice(index, 0, this)
    this.parent.children = siblings
  }
}

class MockTween {
  static stopped = []
  static stopAllByTarget (target) { this.stopped.push(target) }
}

for (const filePath of [designPath, primitivesPath]) {
  assert.equal(fs.existsSync(filePath), true, `missing ${filePath}`)
  assert.equal(fs.existsSync(`${filePath}.meta`), true, `missing Cocos metadata for ${filePath}`)
}

const design = loadPureTs(designPath, { cc: { Color: MockColor } })
const expectedFamilies = ['system', 'skill', 'honor', 'power', 'royal', 'neutral', 'ink']
assert.deepEqual(Object.keys(design.EFFECT_PALETTES), expectedFamilies)
for (const family of expectedFamilies) {
  const token = design.EFFECT_PALETTES[family]
  assert.equal(Object.isFrozen(token), true, `${family} palette must be immutable`)
  for (const tone of ['primary', 'secondary', 'highlight']) {
    assert.equal(Object.isFrozen(token[tone]), true, `${family}.${tone} tuple must be immutable`)
    assert.equal(token[tone].length, 3)
    token[tone].forEach(channel => assert.equal(channel >= 0 && channel <= 255, true))
  }
}

const firstColor = design.rgba(design.EFFECT_PALETTES.power.primary, 999)
const secondColor = design.rgba(design.EFFECT_PALETTES.power.primary, 999)
assert.notEqual(firstColor, secondColor, 'rgba must return a fresh mutable Cocos Color')
assert.deepEqual(firstColor, new MockColor(255, 91, 36, 255), 'rgba must clamp alpha without mutating the tuple')

assert.deepEqual(Object.values(design.EFFECT_LAYERS), [0, 10, 20, 30, 40, 50, 60])
assert.deepEqual(Object.keys(design.EFFECT_TYPE_SCALE), ['micro', 'caption', 'badge', 'title', 'hero'])
assert.deepEqual(Object.values(design.EFFECT_TYPE_SCALE).map(token => token.fontSize), [20, 24, 34, 46, 54])
for (const level of [0, 1, 2, 3]) {
  const value = design.EFFECT_TIMELINES[level]
  assert.equal(value.impactAtMs <= value.settleAtMs, true)
  assert.equal(value.settleAtMs <= value.releaseAtMs, true)
  assert.equal(value.releaseAtMs <= value.totalMs, true)
}
assert.equal(design.EFFECT_EASING.impact, 'expoOut')
assert.equal(design.EFFECT_EASING.hero, 'backOut')

assert.equal(design.resolveEffectIntent('flow-match-success'), 'system')
assert.equal(design.resolveEffectIntent('straight-flush'), 'skill')
assert.equal(design.resolveEffectIntent('flow-victory'), 'honor')
assert.equal(design.resolveEffectIntent('six-bomb'), 'power')
assert.equal(design.resolveEffectIntent('king-bomb'), 'royal')
assert.equal(design.resolveEffectIntent('flow-defeat'), 'neutral')

const full = design.resolveEffectStyle('king-bomb', 3, 'full')
const reduced = design.resolveEffectStyle('king-bomb', 3, 'reduced')
const off = design.resolveEffectStyle('king-bomb', 3, 'off')
assert.equal(full.budget.globalNodeLimit, 96)
assert.equal(full.budget.particleLimit, 40)
assert.equal(full.budget.smokeLimit, 5)
assert.equal(reduced.budget.globalNodeLimit, 32)
assert.equal(reduced.budget.particleLimit, 12)
assert.equal(reduced.budget.allowDimmer, false)
assert.equal(reduced.budget.allowShake, false)
assert.equal(reduced.budget.allowSmoke, false)
assert.equal(reduced.timeline.totalMs, 420)
assert.equal(off.budget.globalNodeLimit, 0)
assert.equal(off.budget.particleLimit, 0)
assert.equal(off.timeline.totalMs, 0)
assert.equal(design.clampEffectCount(22.9, reduced.budget.particleLimit), 12)

const primitives = loadPureTs(primitivesPath, {
  cc: { Label: MockLabel, Node: MockNode, Tween: MockTween, UITransform: MockUITransform },
  './EffectDesignSystem': design,
})
const parent = new MockNode('Parent')
parent.addComponent(MockUITransform).setContentSize(900, 500)
const root = primitives.createResponsiveEffectRoot(parent, 'ResponsiveRoot', { padding: 20 })
assert.deepEqual(root.getComponent(MockUITransform).contentSize, { width: 940, height: 540 })
const labelNode = primitives.createOutlinedEffectLabel(root, full, { text: '天王炸', role: 'hero' })
const label = labelNode.getComponent(MockLabel)
assert.equal(label.fontSize, 54)
assert.equal(label.lineHeight, 64)
assert.equal(label.enableOutline, true)
assert.equal(label.outlineWidth, 3)
assert.equal(label.overflow, MockLabel.Overflow.SHRINK)
assert.equal(primitives.createEffectDimmer(root, full), null)
assert.equal(primitives.createEffectDimmer(root, reduced), null)
primitives.stopTree(root)
assert.equal(MockTween.stopped.includes(root), true)
assert.equal(MockTween.stopped.includes(label), true)

const primitiveSource = read(primitivesPath)
assert.match(primitiveSource, /parent\.getComponent\(UITransform\)\?\.contentSize/, 'responsive roots must derive size from their parent')
assert.match(primitiveSource, /label\.enableOutline = true/, 'all shared labels must enable the unified outline')
assert.match(primitiveSource, /node\.components\.forEach\(component => Tween\.stopAllByTarget\(component\)\)/, 'stopTree must stop component tweens')
assert.doesNotMatch(
  primitiveSource,
  /\bGraphics\b|\.circle\(|\.ellipse\(|\.rect\(|\.roundRect\(|\.moveTo\(|\.lineTo\(|\.bezierCurveTo\(/,
  'shared VFX primitives must never manufacture missing artwork with code-drawn geometry',
)

console.log('effect design system regression checks passed')
