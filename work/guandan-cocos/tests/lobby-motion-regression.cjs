const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const ts = require('./support/typescript.cjs').loadTypeScript()
const root = path.resolve(__dirname, '..')
function compile(file, deps = {}) {
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true } }).outputText
  new Function('module', 'exports', 'require', code)(module, module.exports, name => {
    if (!(name in deps)) throw Error(name)
    return deps[name]
  })
  return module.exports
}
const policy = compile('assets/scripts/ui/LobbyMotionPolicy.ts')
const { stepLobbyMotion, LOBBY_MOTION } = policy
const clock = { elapsed: 0 }
assert.equal(LOBBY_MOTION.delay, 1)
assert.equal(LOBBY_MOTION.repeatDelay, 1)
for (let i = 0; i < 9; i++) assert.equal(stepLobbyMotion(clock, .1, true), -1)
assert.ok(stepLobbyMotion(clock, .15, true) >= 0)
let seen = new Set()
clock.elapsed = LOBBY_MOTION.delay
for (let i = 0; i < 67; i++) seen.add(stepLobbyMotion(clock, 1/60, true))
assert.equal(seen.size, 17, 'all 16 frames and rest are sampled')
const duration = LOBBY_MOTION.frames / LOBBY_MOTION.fps
for (let cycle = 0; cycle < 4; cycle++) {
  const start = LOBBY_MOTION.delay + cycle * (duration + 1)
  clock.elapsed = start + .001
  assert.equal(stepLobbyMotion(clock, 0, true), 0, 'each repeat starts at first frame')
  clock.elapsed = start + duration - .001
  assert.equal(stepLobbyMotion(clock, 0, true), 15, 'last frame is never cut off')
  for (const pause of [.001, .5, .999]) {
    clock.elapsed = start + duration + pause
    assert.equal(stepLobbyMotion(clock, 0, true), -1, 'one full second of rest after each flash')
  }
}
assert.equal(stepLobbyMotion(clock, .1, false), -1)
assert.equal(clock.elapsed, 0, 'modal/reduced/off/recovery reset quiet delay')
assert.equal(stepLobbyMotion(clock, 120, true), -1)
assert.equal(clock.elapsed, 0, 'background gaps do not fast-forward')
assert.equal(stepLobbyMotion(clock, NaN, true), -1)
// Component lifecycle, async resource failure and no touch interception.
class Node {
  constructor(name) { this.name = name; this.children = []; this.components = []; this.isValid = true; this.scale = { x: 1 } }
  set parent(n) { this.owner = n; n.children.push(this) } get parent() { return this.owner }
  setPosition(x,y) { this.position = {x,y} }
  addComponent(Type) { const c = new Type(); c.node = this; this.components.push(c); return c }
}
class Component { isValid = true }
class Graphics { roundRect() {} stroke() {} }
class Sprite { static SizeMode = {CUSTOM: 1}; isValid = true }
class SpriteFrame { reset(v) { Object.assign(this, v) } destroy() { this.destroyed = true } }
class UITransform { setContentSize(w,h) { this.width=w; this.height=h } }
class Shape { constructor(...args) { this.args = args } }
const events = new Map()
const game = { on: (e, cb, owner) => events.set(e, [cb, owner]), off: e => events.delete(e) }
let callback, cancels = 0
const { attachLobbyAmbientMotion } = compile('assets/scripts/ui/LobbyAmbientMotion.ts', {
  cc: { _decorator:{ ccclass: () => Type => Type }, Component, Node, Graphics, Sprite, SpriteFrame, UITransform, UIOpacity: class {}, Color: Shape, Rect: Shape, Size: Shape, Texture2D: class {}, game, Game:{ EVENT_HIDE:'hide', EVENT_SHOW:'show' } },
  './UiFrameStyle': compile('assets/scripts/ui/UiFrameStyle.ts', {}),
  './LobbyMotionPolicy': policy,
  '../services/GameAssetLoader': { loadGameAsset: (asset, type, cb) => { assert.ok(asset.endsWith('/texture')); callback = cb; return () => cancels++ } },
})
let allowed = true
const button = new Node('Button'), state = { elapsed: 0 }
attachLobbyAmbientMotion(button, { width:210,height:46,scale:1,clock:state,allowed:()=>allowed })
const component = button.children[0].components[0]
component.onEnable()
assert.equal(events.size,2)
component.update(.1)
assert.equal(state.elapsed,0,'wait for optional asset without blocking button')
callback(null,{width:384,height:96})
assert.equal(component.frames.length,16)
const owned = [...component.frames]
state.elapsed=LOBBY_MOTION.delay+.4; component.update(1/60)
assert.equal(component.star.enabled,true)
assert.ok(component.rim.opacity <=55)
allowed=false; component.update(1/60)
assert.equal(component.star.enabled,false)
assert.equal(component.rim.opacity,0)
allowed=true; state.elapsed=LOBBY_MOTION.delay+.4; button.scale.x=.96; component.update(1/60)
assert.equal(component.star.enabled,false,'press takes priority')
button.scale.x=1; state.elapsed=LOBBY_MOTION.delay+.4; component.update(1/60)
component.motionPreference={matches:true}; component.update(1/60)
assert.equal(component.star.enabled,false,'OS reduced motion also suppresses decoration')
component.motionPreference.matches=false
events.get('hide')[0].call(component)
assert.equal(component.star.enabled,false)
assert.equal(state.elapsed,0)
events.get('show')[0].call(component); component.update(1/60)
assert.equal(component.star.enabled,false,'resume is quiet')
component.onDisable(); component.onDestroy()
assert.equal(events.size,0)
assert.equal(cancels,1)
assert.ok(owned.every(f=>f.destroyed))
component.isValid=false; callback(null,{width:384,height:96})
assert.equal(component.frames.length,0,'late callbacks cannot resurrect disposed frames')
const failedButton=new Node('Failure')
attachLobbyAmbientMotion(failedButton,{width:210,height:46,scale:1,clock:{elapsed:0},allowed:()=>true})
callback(new Error('fixture missing'),null)
failedButton.children[0].components[0].update(.1)
assert.equal(failedButton.children[0].components[0].star.enabled,false)
// Validate shipped file actually is 16 RGBA cells, not painted transparency.
const png=fs.readFileSync(path.join(root,'assets/game-assets/effects/lobby-v1/button-glint.png'))
assert.equal(png.readUInt32BE(16),384); assert.equal(png.readUInt32BE(20),96); assert.equal(png[25],6)
let offset=8, idat=[]
while(offset<png.length){ const size=png.readUInt32BE(offset), type=png.toString('ascii',offset+4,offset+8); if(type==='IDAT') idat.push(png.subarray(offset+8,offset+8+size)); offset+=12+size }
const pixels=zlib.inflateSync(Buffer.concat(idat)), stride=384*4+1
let maxAlpha=0
for(let y=0;y<96;y++) for(let x=0;x<384;x++) maxAlpha=Math.max(maxAlpha,pixels[y*stride+1+x*4+3])
assert.ok(maxAlpha>100 && maxAlpha<=210)
assert.equal(pixels[4],0,'edge alpha must be real zero')
assert.equal(LOBBY_MOTION.frames,16)
console.log('Lobby motion: timing, all frames, pause, press priority, optional failure, disposal and RGBA passed')
