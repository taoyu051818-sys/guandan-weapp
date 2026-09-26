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
assert.equal(LOBBY_MOTION.repeatDelay, 2)
assert.equal(LOBBY_MOTION.frames, 16)
assert.equal(LOBBY_MOTION.fps, 15)
assert.equal(LOBBY_MOTION.contentInset, 5, 'exclude the authored transparent border, not the button edges')
assert.deepEqual([LOBBY_MOTION.frameWidth, LOBBY_MOTION.frameHeight, LOBBY_MOTION.columns, LOBBY_MOTION.rows], [210, 46, 4, 4])
for (let i = 0; i < 9; i++) assert.equal(stepLobbyMotion(clock, .1, true), -1)
assert.ok(stepLobbyMotion(clock, .15, true) >= 0)
let seen = new Set()
clock.elapsed = LOBBY_MOTION.delay
for (let i = 0; i < 67; i++) seen.add(stepLobbyMotion(clock, 1/60, true))
assert.equal(seen.size, 17, 'all 16 frames and rest are sampled')
const duration = LOBBY_MOTION.frames / LOBBY_MOTION.fps
for (let cycle = 0; cycle < 4; cycle++) {
  const start = LOBBY_MOTION.delay + cycle * (duration + 2)
  clock.elapsed = start + .001
  assert.equal(stepLobbyMotion(clock, 0, true), 0, 'each repeat starts at first frame')
  clock.elapsed = start + duration - .001
  assert.equal(stepLobbyMotion(clock, 0, true), 15, 'last frame is never cut off')
  for (const pause of [.001, .5, 1, 1.5, 1.999]) {
    clock.elapsed = start + duration + pause
    assert.equal(stepLobbyMotion(clock, 0, true), -1, 'two full seconds hidden after each flash')
  }
}
assert.equal(stepLobbyMotion(clock, .1, false), -1)
assert.equal(clock.elapsed, 0, 'modal/reduced/off/recovery reset quiet delay')
clock.elapsed = LOBBY_MOTION.delay + .4
assert.equal(stepLobbyMotion(clock, 120, true), -1)
assert.equal(clock.elapsed, 0, 'background gaps do not fast-forward')
assert.equal(stepLobbyMotion(clock, NaN, true), -1)
// Component lifecycle, async resource failure and no touch interception.
class Node {
  constructor(name) { this.name = name; this.children = []; this.components = []; this.isValid = true; this.scale = { x: 1 }; this.layer = 0 }
  set parent(n) { this.owner = n; n.children.push(this) } get parent() { return this.owner }
  setPosition(x,y) { this.position = {x,y} }
  addComponent(Type) { const c = new Type(); c.node = this; this.components.push(c); return c }
}
class Component { isValid = true }
class Sprite { static SizeMode = {CUSTOM: 1}; isValid = true }
class SpriteFrame { reset(v) { Object.assign(this, v) } destroy() { this.destroyed = true } }
class UITransform { setContentSize(w,h) { this.width=w; this.height=h } }
class Shape { constructor(...args) { this.args = args } }
const events = new Map()
const game = { on: (e, cb, owner) => events.set(e, [cb, owner]), off: e => events.delete(e) }
let callback, cancels = 0
const { attachLobbyAmbientMotion } = compile('assets/scripts/ui/LobbyAmbientMotion.ts', {
  cc: { _decorator:{ ccclass: () => Type => Type }, Component, Node, Sprite, SpriteFrame, UITransform, Rect: Shape, Size: Shape, Texture2D: class {}, game, Game:{ EVENT_HIDE:'hide', EVENT_SHOW:'show' } },
  './LobbyMotionPolicy': policy,
  '../services/GameAssetLoader': { loadGameAsset: (asset, type, cb) => { assert.equal(asset, LOBBY_MOTION.texture); callback = cb; return () => cancels++ } },
})
let allowed = true
const button = new Node('Button'), state = { elapsed: 0 }
button.layer = 33554432
attachLobbyAmbientMotion(button, { width:315,height:69,clock:state,allowed:()=>allowed })
const component = button.children[0].components[0]
assert.equal(button.children[0].layer, button.layer)
assert.equal(component.node.children.length, 1, 'only the supplied star sprite, no extra animated rim')
assert.equal(component.star.node.name, 'QuickStartStar')
assert.equal(component.star.node.layer, button.layer)
assert.deepEqual(component.star.node.components[0], Object.assign(new UITransform(), { node: component.star.node, width: 315, height: 69 }))
assert.equal(component.star.node.position, undefined, 'centered, not positioned in a corner')
component.onEnable()
assert.equal(events.size,2)
component.update(.1)
assert.equal(state.elapsed,0,'wait for optional asset without blocking button')
callback(null,{width:840,height:184})
assert.equal(component.frames.length,16)
for (let i = 0; i < 16; i++) {
  assert.deepEqual(component.frames[i].rect.args, [i % 4 * 210 + 5, Math.floor(i / 4) * 46 + 5, 200, 36], 'row-major order with the same content crop in every cell')
  assert.deepEqual(component.frames[i].originalSize.args, [200, 36], 'fixed content bounds fill the full button without frame jitter')
  assert.equal(component.frames[i].packable, false)
}
const owned = [...component.frames]
state.elapsed=LOBBY_MOTION.delay+.4; component.update(1/60)
assert.equal(component.star.enabled,true)
assert.equal(component.rim, undefined, 'old rim implementation is removed')
state.elapsed=LOBBY_MOTION.delay+duration+.5; component.update(1/60)
assert.equal(component.star.enabled,false,'rest really hides the sprite, not just freezes it')
allowed=false; component.update(1/60)
assert.equal(component.star.enabled,false)
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
state.elapsed=LOBBY_MOTION.delay+.4; component.update(1/60)
component.onDisable()
assert.equal(state.elapsed,0,'page disable resets a partially played sequence')
component.onEnable(); component.update(1/60)
assert.equal(component.star.enabled,false,'page resume waits instead of completing an old flash')
component.onDisable(); component.onDestroy()
assert.equal(events.size,0)
assert.equal(cancels,1)
assert.ok(owned.every(f=>f.destroyed))
component.isValid=false; callback(null,{width:840,height:184})
assert.equal(component.frames.length,0,'late callbacks cannot resurrect disposed frames')
const failedButton=new Node('Failure')
attachLobbyAmbientMotion(failedButton,{width:210,height:46,clock:{elapsed:0},allowed:()=>true})
callback(new Error('fixture missing'),null)
failedButton.children[0].components[0].update(.1)
assert.equal(failedButton.children[0].components[0].star.enabled,false)
failedButton.children[0].components[0].onDestroy()
const wrongButton=new Node('WrongAtlas')
attachLobbyAmbientMotion(wrongButton,{width:210,height:46,clock:{elapsed:0},allowed:()=>true})
callback(null,{width:384,height:96})
assert.equal(wrongButton.children[0].components[0].frames.length,0,'old or malformed atlas must fail safely')
wrongButton.children[0].components[0].onDestroy()
// Validate the supplied RGBA PNG, including PNG row filters (not raw compressed bytes).
const png=fs.readFileSync(path.join(root,'assets/game-assets/effects/lobby-v1/quick_start_star_fx_210_sheet.png'))
assert.equal(png.readUInt32BE(16),840); assert.equal(png.readUInt32BE(20),184)
assert.equal(png[24],8); assert.equal(png[25],6); assert.equal(png[28],0)
let offset=8, idat=[]
while(offset<png.length){ const size=png.readUInt32BE(offset), type=png.toString('ascii',offset+4,offset+8); if(type==='IDAT') idat.push(png.subarray(offset+8,offset+8+size)); offset+=12+size }
const raw=zlib.inflateSync(Buffer.concat(idat)), stride=840*4, pixels=Buffer.alloc(stride*184)
assert.equal(raw.length,(stride+1)*184)
const paeth=(a,b,c)=>{ const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c }
for(let y=0;y<184;y++) {
  const filter=raw[y*(stride+1)]
  assert.ok(filter<=4)
  for(let x=0;x<stride;x++) {
    const i=y*stride+x,a=x>=4?pixels[i-4]:0,b=y?pixels[i-stride]:0,c=y&&x>=4?pixels[i-stride-4]:0
    pixels[i]=(raw[y*(stride+1)+1+x]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255
  }
}
let transparent=0,translucent=0,visible=0
for(let i=3;i<pixels.length;i+=4){const a=pixels[i];if(a===0)transparent++;else{visible++;if(a<255)translucent++}}
assert.ok(transparent>0 && translucent>0 && visible>0,'real transparent and translucent pixels must survive import')
const edgeHits = new Set()
for (let f=0; f<16; f++) for (let y=0; y<46; y++) for (let x=0; x<210; x++) {
  const alpha=pixels[(((Math.floor(f/4)*46+y)*840+(f%4)*210+x)*4)+3]
  if (alpha<=16) continue
  assert.ok(x>=5 && x<=204 && y>=5 && y<=40, 'content crop must retain all visible sweep pixels')
  if(x===5) edgeHits.add('left'); if(x===204) edgeHits.add('right')
  if(y===5) edgeHits.add('top'); if(y===40) edgeHits.add('bottom')
}
assert.equal(edgeHits.size,4,'the animation reaches all four button edges after removing source padding')
for(const file of ['assets/game-assets/effects/lobby-v1/button-glint.png','assets/game-assets/effects/lobby-v1/button-glint.png.meta','scripts/generate-lobby-glint.mjs']) {
  assert.equal(fs.existsSync(path.join(root,file)),false,`retired glint must not ship or regenerate: ${file}`)
}
const source=fs.readFileSync(path.join(root,'assets/scripts/ui/LobbyAmbientMotion.ts'),'utf8')
assert.doesNotMatch(source,/CornerGlint|SoftRim|UIOpacity|Graphics|drawUiFrame/)
const lobbySource=fs.readFileSync(path.join(root,'assets/scripts/scenes/front-pages/LobbyPageDomain.ts'),'utf8')
const render=lobbySource.slice(lobbySource.indexOf('private renderQuickStart ('),lobbySource.indexOf('private refreshPrimaryAction ('))
assert.doesNotMatch(render, /QuickStartInnerRim/, 'retired inner rim must not cover the beach artwork')
assert.ok(render.indexOf("lobbyArtwork(button, 'QuickStartBeach'")>=0)
assert.ok(render.indexOf("lobbyArtwork(button, 'QuickStartBeach'")<render.indexOf('attachLobbyAmbientMotion(button'))
assert.ok(render.indexOf('attachLobbyAmbientMotion(button')<render.indexOf("const title = lobbyLabel(ui, '快速开始'"),'decoration before text, never over it')
console.log('Lobby star sheet: 4x4 frames, 15fps, 2s hidden pause, full-button bounds, text layering, input isolation, lifecycle and old-asset retirement passed')
