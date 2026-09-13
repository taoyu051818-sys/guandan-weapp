// Regression: actual first-party code and installed Cocos 3.8.8 tween algorithms.
// Node/rendering/asset/clock ports are synthetic; no GPU/network/build/source writes.
'use strict'
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const app=path.resolve(__dirname,'..')
const src=p=>path.join(app,'assets/scripts',p)
const {loadTs}=require(path.join(app,'tests/support/load-typescript-module.cjs'))
const ts=require(path.join(app,'tests/support/typescript.cjs')).loadTypeScript()
const engine=process.env.COCOS_ENGINE_ROOT || '/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/resources/3d/engine/cocos'
if (!fs.existsSync(path.join(engine, 'tween/tween.ts'))) {
  if (process.argv.includes('--require-engine') || process.env.REQUIRE_COCOS_ENGINE === '1') throw Error('Cocos engine required: set COCOS_ENGINE_ROOT to the installed 3.8.8 cocos source directory')
  console.log('SKIP runtime-button-motion: installed Cocos engine unavailable; real-tween press behavior was NOT verified (use --require-engine in Creator validation)')
  process.exit(0)
}
class Vec3 {static ONE=new Vec3(1,1,1);static ZERO=new Vec3(0,0,0);constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z})}clone(){return new Vec3(this.x,this.y,this.z)}}
class Node {
  static EventType={TOUCH_START:'start',TOUCH_END:'end',TOUCH_CANCEL:'cancel'}
  constructor(name){Object.assign(this,{name,children:[],components:[],handlers:new Map(),isValid:true,active:true,scale:Vec3.ONE.clone(),position:Vec3.ZERO.clone()})}
  set parent(n){if(this.owner)this.owner.children=this.owner.children.filter(c=>c!==this);this.owner=n;if(n)n.children.push(this)}
  get parent(){return this.owner}
  get activeInHierarchy(){return this.isValid && this.active && (!this.parent || this.parent.activeInHierarchy)}
  addComponent(T){const c=new T();c.node=this;c.isValid=true;this.components.push(c);return c}
  getComponent(T){return this.components.find(c=>c instanceof T)||null}
  setPosition(v,y,z){this.position=typeof v==='number'?new Vec3(v,y,z||0):v.clone()}
  setScale(v){this.scale=v.clone()}
  setRotationFromEuler(...v){this.rotation=v}
  on(e,f,o){this.handlers.set(e,[...(this.handlers.get(e)||[]),{f,o}])}
  off(e,f,o){this.handlers.set(e,(this.handlers.get(e)||[]).filter(c=>c.f!==f||c.o!==o))}
  emit(e,...args){for(const c of [...(this.handlers.get(e)||[])])c.f.apply(c.o,args)}
  removeFromParent(){this.parent=null}
  destroy(){if(!this.isValid)return;this.emit('destroyed',this);this.isValid=false;this.active=false;for(const c of [...this.children])c.destroy();this.removeFromParent()}
}
class NodePool {
  constructor(){this.items=[]}
  get(){return this.items.pop()||null}size(){return this.items.length}
  put(n){n.removeFromParent();if(!this.items.includes(n))this.items.push(n)}
  clear(){this.items.splice(0).forEach(n=>n.destroy())}
}
class Component {}
class Color{constructor(...v){this.values=v}}
class Graphics{clear(){}rect(){}roundRect(){}fill(){}stroke(){}}
class UITransform{setContentSize(w,h){this.contentSize={width:w,height:h}}}
class UIOpacity{opacity=255}
class Label{static Overflow={SHRINK:1};static HorizontalAlign={CENTER:1};static VerticalAlign={CENTER:1}}
class Sprite{static Type={SIMPLE:1};static SizeMode={CUSTOM:1}}
class SpriteFrame{}
const loadedEngine=[],cache=new Map(),tweenSystem={instance:null},warns=[]
function loadEngine(relative){
  const file=path.resolve(engine,relative)
  assert.ok(file.startsWith(engine+'/tween/')||file===engine+'/core/algorithm/easing.ts')
  if(cache.has(file))return cache.get(file).exports
  const module={exports:{}};cache.set(file,module)
  const source=fs.readFileSync(file,'utf8')
  loadedEngine.push({path:file,sha256:crypto.createHash('sha256').update(source).digest('hex')})
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText
  const debug={warnID:(...v)=>warns.push(v),warn:(...v)=>warns.push(v),errorID:(...v)=>{throw Error('engine error '+v)},logID:()=>{}}
  new Function('module','exports','require',code)(module,module.exports,request=>{
    if(request==='./tween-system')return {TweenSystem:tweenSystem}
    if(/\/core$/.test(request))return {...debug,macro:{FLT_EPSILON:1.192092896e-7},cclegacy:{},easing:loadEngine('core/algorithm/easing.ts')}
    if(request.endsWith('/core/platform/debug'))return debug
    if(request.endsWith('/core/data/object'))return {isCCObject:v=>v instanceof Node||v instanceof Component}
    if(request.endsWith('/core/global-exports'))return {legacyCC:{},VERSION:'3.8.8'}
    if(request.endsWith('/scene-graph'))return {Node,NodeEventType:{ACTIVE_CHANGED:'active-changed',NODE_DESTROYED:'destroyed'}}
    if(request.endsWith('/misc/renderer'))return {Renderer:class{}}
    assert.ok(request.startsWith('.'),'no ambient dependency')
    return loadEngine(path.relative(engine,path.resolve(path.dirname(file),request+'.ts')))
  })
  return module.exports
}
const {ActionManager}=loadEngine('tween/actions/action-manager.ts')
const manager=new ActionManager();tweenSystem.instance={ActionManager:manager}
const {tween,Tween}=loadEngine('tween/tween.ts')
const cc={Node,NodePool,Vec3,Component,Color,Graphics,UITransform,UIOpacity,Label,Sprite,SpriteFrame,Tween,tween,
  _decorator:{ccclass:()=>T=>T},Texture2D:class{},Rect:class{},Size:class{}}
const {RuntimeUiFactory}=loadTs(src('ui/RuntimeUiFactory.ts'),{cc,'./UiFrameStyle':loadTs(src('ui/UiFrameStyle.ts')),'../services/GameAssetLoader':{loadGameAsset:()=>()=>{}}})
const step=(s,rate=120)=>{for(let i=0;i<Math.round(s*rate);i++)manager.update(1/rate)}
const clean=()=>manager.removeAllActions()
const pressResults=[]
for(const kind of ['button','imageCard']) for(const rate of [60,120]) for(const delay of [.02,.05,.1,.3]) {
  clean()
  const root=new Node('root'),ui=new RuntimeUiFactory(root)
  const n=kind==='button'?ui.button('play','出牌',0):ui.imageCard('classic','synthetic',0,0,200,300,()=>{})
  step(delay,rate);n.emit('start');step(.4,rate)
  const held=n.scale.x
  assert.ok(Math.abs(held-.96)<1e-8, 'held press must win over every old entry tween')
  n.emit('cancel');step(.3,rate);assert.equal(n.scale.x,1)
  pressResults.push({kind,rate,pressAt:delay,heldScale:held,afterCancel:n.scale.x})
  root.destroy()
}
clean()
const control=new Node('control'),entry=tween(control).to(.2,{scale:Vec3.ONE}).start()
control.setScale(new Vec3(.9,.9,1));step(.02)
entry.stop();tween(control).to(.06,{scale:new Vec3(.96,.96,1)}).start();step(.4)
assert.equal(control.scale.x,.96,'explicit instance stop is a successful held-state control')
clean()
const root=new Node('delayed-callback'),ui=new RuntimeUiFactory(root),target=new Node('card');target.parent=root;let selected=0
ui.makeInteractive(target,()=>selected++);target.emit('end');step(.02)
Tween.stopAllByTarget(target);target.destroy();step(.5)
assert.equal(selected,0,'page cleanup cancels pending selection; no zombie-route claim')

for (const kind of ['button', 'imageCard']) for (const rate of [60, 120]) {
  clean()
  let selections = 0, unrelatedDone = 0
  const root = new Node('rapid-root'), ui = new RuntimeUiFactory(root)
  const target = kind === 'button' ? ui.button('play', '出牌', 0) : ui.imageCard('card', 'synthetic', 0, 0, 200, 300, () => selections++)
  tween(target).to(.3, { position: new Vec3(40, 50, 0) }).call(() => unrelatedDone++).start()
  step(.02, rate); target.emit('start'); step(.02, rate); target.emit('end')
  step(.02, rate); target.emit('start'); step(.4, rate)
  assert.equal(target.scale.x, .96)
  assert.equal(selections, 0, 'a superseded release callback must not fire')
  assert.equal(unrelatedDone, 1, 'press only cancels its scale owner, not another node animation')
  assert.equal(target.position.x, 40)
  target.emit('cancel'); step(.2, rate); assert.equal(target.scale.x, 1)
  target.emit('start'); step(.1, rate); target.emit('end'); step(.2, rate)
  assert.equal(selections, kind === 'imageCard' ? 1 : 0)
  target.emit('end'); root.active = false; step(.2, rate)
  assert.equal(selections, kind === 'imageCard' ? 1 : 0, 'hidden page cannot run an old selection callback')
  root.destroy()
}
assert.deepEqual(warns, [])
clean()
console.log('UI-22-001: 16 real-tween hold timings + 4 rapid press/cancel/owner-isolation sequences passed')
