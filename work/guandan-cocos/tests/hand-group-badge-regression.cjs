const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const ts = require('./support/typescript.cjs').loadTypeScript()
require.extensions['.ts'] = (module, file) => {
  const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } })
  module._compile(result.outputText, file)
}
const { PlayType, getRuleProfile } = require('../assets/scripts/core/generated/index.ts')
const { resolveHandGroupBadge, projectHandRenderModel } = require('../assets/scripts/game/HandRenderProjector.ts')
for (const [type, count, label, tone] of [
  [PlayType.Triple, 3, '三张', 'cyan'],
  [PlayType.TripleWithPair, 5, '三带二', 'cyan'], [PlayType.Straight, 5, '顺子', 'cyan'],
  [PlayType.Tube, 6, '三连对', 'cyan'], [PlayType.Plate, 6, '钢板', 'cyan'],
  [PlayType.Bomb, 4, '四炸', 'purple'], [PlayType.Bomb, 6, '六炸', 'purple'],
  [PlayType.StraightFlush, 5, '同花顺', 'purple'], [PlayType.Rocket, 4, '天王炸', 'purple'],
]) assert.deepEqual(resolveHandGroupBadge(type, count), { label, tone })
assert.equal(resolveHandGroupBadge(undefined, 3), undefined)
assert.equal(resolveHandGroupBadge(PlayType.Single, 1), undefined)
assert.equal(resolveHandGroupBadge(PlayType.Pair, 2), undefined, 'pairs remain grouped without a stamp')
const hand = [0, 1, 2, 3].map((id) => ({ id: String(id), rank: 8, value: 8, suit: ['spade', 'heart', 'club', 'diamond'][id], isLevelCard: false }))
const grouping = { layoutMode: 'smart-arranged', ruleProfile: getRuleProfile('classic'), displayCardIds: hand.map(c => c.id), groups: [{ id: 'g', cardIds: hand.map(c => c.id), kind: 'manual', origin: 'manual', locked: true }] }
const input = { hand, grouping, mode: 'play', playSelectedCardIds: [], lockDraftCardIds: [], lockedCardIds: [], availableSuits: [], sortOrder: 'desc', interactive: true, selectedSuit: null, lockAction: 'start', arrangeRestoreAvailable: true }
assert.deepEqual(projectHandRenderModel(input).groups[0].badge, { label: '四炸', tone: 'purple' }, 'badge comes from actual rules, not a stale/manual group kind')
assert.equal(projectHandRenderModel({ ...input, grouping: { ...grouping, layoutMode: 'point-stacked' } }).groups[0].badge, undefined, 'restoring the ordinary view hides stamps')
assert.equal(projectHandRenderModel({ ...input, hand: hand.slice(0, 2) }).groups[0].badge, undefined, 'a bomb reduced to a pair must clear its stamp')
const pairHand = hand.slice(0, 2)
for (const origin of ['manual', 'auto']) {
  const pairGroup = { id: 'pair', cardIds: pairHand.map(c => c.id), kind: 'pair', origin, locked: origin === 'manual' }
  const model = projectHandRenderModel({ ...input, hand: pairHand, playSelectedCardIds: pairGroup.cardIds, grouping: { ...grouping, groups: [pairGroup], displayCardIds: pairGroup.cardIds } })
  assert.equal(model.groups[0].badge, undefined, `${origin} pairs must not show labels`)
  assert.deepEqual(model.groups[0].cardIds, pairGroup.cardIds, 'hiding a stamp must preserve the pair group')
  assert.deepEqual(model.playSelectedCardIds, pairGroup.cardIds, 'hiding a stamp must preserve selection')
}

class UITransform { setContentSize (width, height) { this.contentSize = { width, height } } }
class Node {
  constructor (name) { this.name = name; this.children = []; this.components = []; this.active = true }
  set parent (parent) { parent.children.push(this) }
  setPosition (position) { this.position = position }
  addComponent (Type) { const c = new Type(); c.node = this; this.components.push(c); return c }
  getComponent (Type) { return this.components.find(c => c instanceof Type) }
}
class Color { constructor (r, g, b, a) { Object.assign(this, { r, g, b, a }) } }
class Vec3 { constructor (x, y, z) { Object.assign(this, { x, y, z }) } }
class Graphics { clear () {} roundRect (...rect) { this.rect = rect } fill () {} stroke () {} }
class Label { static HorizontalAlign = { CENTER: 1 }; static VerticalAlign = { CENTER: 1 } }
const file = path.join(root, 'assets/scripts/ui/HandGroupBadgeView.ts')
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } })
const mod = { exports: {} }
Function('require', 'exports', 'module', compiled.outputText)(name => { assert.equal(name, 'cc'); return { Node, Color, Vec3, Graphics, Label, UITransform } }, mod.exports, mod)
const parent = new Node('CardVisual')
const view = new mod.exports.HandGroupBadgeView(parent)
for (const label of ['三张', '三带二', '同花顺', '十一炸']) {
  view.render({ label, tone: 'purple' })
  const node = parent.children[0], size = node.getComponent(UITransform).contentSize
  assert.equal(node.children[0].getComponent(Label).string, Array.from(label).join('\n'))
  assert.ok(node.position.x - size.width / 2 >= -38 && node.position.x + size.width / 2 < 0)
  assert.equal(node.position.y - size.height / 2, -53)
  assert.ok(node.position.y + size.height / 2 <= 17, 'label must sit below the top point strip')
}
view.render(undefined)
assert.equal(parent.children[0].active, false)
view.render({ label: '钢板', tone: 'cyan' })
assert.equal(parent.children[0].active, true)
assert.equal(parent.children.length, 1, 'repeated renders reuse a single display-only node')
const controller = fs.readFileSync(path.join(root, 'assets/scripts/ui/HandController.ts'), 'utf8')
assert.match(controller, /groupBadge: slot\?\.stackId && slot.stackIndex === slot.stackSize - 1/, 'only the bottom card of each group owns its stamp')
assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /TOUCH_|\.on\(/, 'stamps must never capture taps or swipes')
process.stdout.write('Hand group badges: rule semantics, colours, restoration, partial play, vertical geometry and reuse passed\n')
