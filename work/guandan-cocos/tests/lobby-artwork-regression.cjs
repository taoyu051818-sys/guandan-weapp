const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('./support/typescript.cjs').loadTypeScript()
const root = path.resolve(__dirname, '..')
class Node {
  static EventType = { NODE_DESTROYED: 'destroyed' }
  constructor(name) { this.name = name; this.children = []; this.components = []; this.events = {}; this.isValid = true }
  set parent(value) { value.children.push(this) }
  setPosition(value) { this.position = value }
  addComponent(Type) { const component = new Type(); this.components.push(component); return component }
  on(name, callback) { this.events[name] = callback }
  destroy() { this.isValid = false; this.events.destroyed?.() }
}
class Color { constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }) } }
class Rect { constructor(x, y, width, height) { Object.assign(this, { x, y, width, height }) } }
class Vec3 { constructor(x, y, z) { Object.assign(this, { x, y, z }) } }
class Size { constructor(width, height) { Object.assign(this, { width, height }) } }
class Sprite { static SizeMode = { CUSTOM: 0 } }
class SpriteFrame { reset(value) { Object.assign(this, value) } destroy() { this.destroyed = true } }
class UITransform { setContentSize(width, height) { Object.assign(this, { width, height }) } }
let pending, cancelled = 0
const moduleUnderTest = { exports: {} }
const code = ts.transpileModule(fs.readFileSync(path.join(root, 'assets/scripts/ui/LobbyMenuView.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
new Function('module', 'exports', 'require', code)(moduleUnderTest, moduleUnderTest.exports, name => {
  if (name === 'cc') return { Node, Color, Rect, Vec3, Size, Sprite, SpriteFrame, UITransform, Texture2D: class {} }
  if (name === '../services/GameAssetLoader') return { loadGameAsset: (path, Type, callback) => { pending = callback; return () => cancelled++ } }
  if (name === './LobbyLayoutPolicy') return { LOBBY_DESIGN: {} }
  throw Error(name)
})
const { lobbyArtwork, lobbyLabel } = moduleUnderTest.exports
const parent = new Node('root'), texture = { width: 600, height: 800 }
const card = lobbyArtwork(parent, 'card', 'original', { x: 0, y: 0, width: 180, height: 166 }, .74)
pending(null, texture)
const frame = card.children[0].components.find(c => c instanceof Sprite).spriteFrame
assert.equal(frame.texture, texture, 'reuse source texture')
assert.ok(frame.rect.y + frame.rect.height <= texture.height * .74, 'baked bottom captions must be cropped out')
assert.ok(Math.abs(frame.rect.width / frame.rect.height - 180 / 166) < 1e-9)
card.destroy()
assert.equal(frame.destroyed, true)
const shop = lobbyArtwork(parent, 'shop', 'chick', { x: 0, y: 0, width: 70, height: 70 }, 1, 50.8 / 70)
pending(null, { width: 512, height: 512 })
const sprites = shop.children.map(n => n.components.find(c => c instanceof Sprite))
assert.equal(sprites.length, 25)
assert.equal(sprites[0].color.a, 255)
assert.ok(sprites.at(-1).color.a < 6)
for (let i = 1; i < sprites.length; i++) assert.ok(sprites[i].color.a < sprites[i - 1].color.a)
assert.ok(Math.abs(shop.children.reduce((sum, n) => sum + n.components[0].height, 0) - 70) < 1e-9)
shop.destroy()
assert.ok(sprites.every(s => s.spriteFrame.destroyed))
const late = lobbyArtwork(parent, 'late', 'chick', { x: 0, y: 0, width: 70, height: 70 })
late.destroy(); pending(null, texture)
assert.equal(late.children.length, 0, 'navigation before load must not resurrect art')
assert.equal(cancelled, 3)
const label = lobbyLabel({ outlinedLabel: () => ({ fontSize: 20, outlineWidth: 4 }) }, '商城', 0, 0, 15.4, 70, 1, undefined, undefined, 1.89)
assert.equal(label.fontSize, 15.4); assert.equal(label.outlineWidth, 1.89)
console.log('Lobby artwork: cover crop, monotonic fade, exact typography and load/disposal passed')
