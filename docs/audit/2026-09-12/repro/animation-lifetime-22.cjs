// Audit-only: first-party source + installed Cocos 3.8.8 tween algorithms.
// Node/rendering/asset/clock ports are synthetic; no GPU/network/build/source writes.
'use strict'
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const app=path.resolve(__dirname,'../../../../work/guandan-cocos')
const src=p=>path.join(app,'assets/scripts',p)
const {loadTs}=require(path.join(app,'tests/support/load-typescript-module.cjs'))
const ts=require(path.join(app,'tests/support/typescript.cjs')).loadTypeScript()
const engine='/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/resources/3d/engine/cocos'
class Vec3 {static ONE=new Vec3(1,1,1);static ZERO=new Vec3(0,0,0);constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z})}clone(){return new Vec3(this.x,this.y,this.z)}}
class Node {
  static EventType={TOUCH_START:'start',TOUCH_END:'end',TOUCH_CANCEL:'cancel'}
  constructor(name){Object.assign(this,{name,children:[],components:[],handlers:new Map(),isValid:true,active:true,scale:Vec3.ONE.clone(),position:Vec3.ZERO.clone()})}
  set parent(n){if(this.owner)this.owner.children=this.owner.children.filter(c=>c!==this);this.owner=n;if(n)n.children.push(this)}
  get parent(){return this.owner}
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
  assert.ok(Math.abs(held-(delay<.2?1:.96))<1e-8)
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
const {EffectHandle,CompositeEffectHandle}=loadTs(src('effects/EffectHandle.ts'))
async function handles(){
  let cases=0
  for(const reason of ['completed','skipped','replaced','recovery','destroyed','quality-off','unavailable','failed']){
    const order=[],h=new EffectHandle(r=>order.push('first:'+r))
    h.addCleanup(()=>{order.push('broken');throw Error('cleanup')})
    const detach=h.addCleanup(()=>order.push('detached'));detach()
    h.addCleanup(r=>order.push('last:'+r));h.onFinish(r=>order.push('listener:'+r))
    reason==='completed'?h.complete():h.cancel(reason);h.cancel('destroyed');h.complete()
    assert.deepEqual(order,['last:'+reason,'broken','first:'+reason,'listener:'+reason])
    assert.equal(await h.finished,reason);assert.equal(h.isActive,false)
    let late=0;h.addCleanup(r=>{assert.equal(r,reason);late++});h.onFinish(()=>late++);assert.equal(late,2)
    cases++
  }
  for(const reason of ['completed','recovery','destroyed']){
    const a=new EffectHandle(),b=new EffectHandle(),parent=new CompositeEffectHandle([a,b]),removed=new EffectHandle()
    parent.add(removed);assert.equal(parent.remove(removed),true)
    reason==='completed'?parent.complete():parent.cancel(reason)
    assert.equal(await a.finished,reason);assert.equal(await b.finished,reason);assert.equal(removed.isActive,true)
    const late=new EffectHandle();parent.add(late);assert.equal(await late.finished,reason);assert.equal(parent.childCount,0);cases++
  }
  return cases
}
const {TransientEffectNodePool}=loadTs(src('effects/TransientEffectNodePool.ts'),{cc})
const pool=new TransientEffectNodePool(),poolReport={cycles:0}
pool.registerType('label',()=>new Node('pooled'))
assert.throws(()=>pool.registerType('label',()=>new Node()),/already/)
assert.throws(()=>pool.acquire('missing'),/not registered/)
for(let i=0;i<200;i++){
  const n=pool.acquire('label'),c=n.addComponent(Component),child=new Node('child');child.parent=n
  tween(n).to(1,{scale:new Vec3(2,2,1)}).start();tween(c).delay(1).call(()=>assert.fail('released component callback')).start()
  tween(child).delay(1).call(()=>assert.fail('released child callback')).start()
  assert.equal(pool.release(n),true);assert.equal(pool.release(n),false);assert.equal(pool.activeCount,0);step(1.1)
  assert.equal(pool.pooledCount(),1);assert.equal(n.active,false);child.destroy();n.components=[];poolReport.cycles++
}
const dead=pool.acquire('label');dead.destroy();assert.equal(pool.activeCount,0)
pool.registerType('acquire-failure',()=>new Node('broken'),()=>{throw Error('reset')})
assert.throws(()=>pool.acquire('acquire-failure'),/reset/);assert.equal(pool.activeCount,0)
pool.registerType('release-failure',()=>new Node('release'),(_n,phase)=>{if(phase==='release')throw Error('reset')})
const rel=pool.acquire('release-failure');pool.release(rel);assert.equal(rel.isValid,false)
pool.clear();assert.equal(pool.pooledCount(),0);assert.equal(pool.hasType('label'),false)
const policy=loadTs(src('ui/LobbyMotionPolicy.ts'))
const motionSamples=[]
for(const rate of [15,30,60,120]){
  const clock={elapsed:0},seen=new Set(),samples=rate*60
  for(let i=0;i<samples;i++){const frame=policy.stepLobbyMotion(clock,1/rate,true);assert.ok(frame>=-1&&frame<16);seen.add(frame)}
  assert.equal(seen.size,17);policy.stepLobbyMotion(clock,.01,false);assert.equal(clock.elapsed,0)
  for(const dt of [NaN,Infinity,-1,.251,10])assert.equal(policy.stepLobbyMotion(clock,dt,true),-1)
  motionSamples.push({rate,samples})
}
async function snapshots(){
  const pending=[],cached=new Map(),cardA={id:'a',suit:'heart',rank:2},cardB={id:'b',suit:'spade',rank:'K'}
  const skin=loadTs(src('ui/CardSkinResolver.ts'))
  const types=loadTs(src('effects/EffectTypes.ts'),{'../ui/CardPresentationMapper':loadTs(src('ui/CardPresentationMapper.ts'))})
  const frames=plan=>new Map(skin.classicCardAssetNames(plan).map(k=>[k,{key:k}]))
  const module=loadTs(src('effects/VfxCardSnapshot.ts'),{
    cc,'./EffectTypes':types,'../ui/ClassicCardGeometry':loadTs(src('ui/ClassicCardGeometry.ts')),'../ui/CardSkinResolver':skin,
    '../ui/ClassicCardFrameStore':{
      getCachedClassicCardFrames:plan=>cached.get(plan.key),
      requestClassicCardFrames:plan=>new Promise(resolve=>pending.push({plan,resolve})),
      preloadClassicCardFrames:async plans=>plans.length>=0,
    },
  })
  const {EffectNodePool}=loadTs(src('effects/EffectNodePool.ts'),{cc,'./VfxCardSnapshot':module})
  const p=new EffectNodePool(),n=p.acquireCard(cardA),old=pending.shift()
  p.releaseCard(n)
  const reused=p.acquireCard(cardB);assert.equal(n,reused)
  const current=pending.shift()
  old.resolve(frames(old.plan));await Promise.resolve();await Promise.resolve()
  const snap=n.getComponent(module.VfxCardSnapshot)
  assert.equal(snap.artworkRoot.active,false,'old pooled load cannot paint new binding')
  current.resolve(frames(current.plan));await Promise.resolve();await Promise.resolve()
  assert.equal(snap.artworkRoot.active,true)
  assert.equal(snap.layers.get('cornerRank').spriteFrame.key,'num_black_13')
  p.releaseCard(n);assert.equal(snap.artworkRoot.active,false)
  for(const layer of snap.layers.values())assert.equal(layer.spriteFrame,null)
  const c=p.acquireCard(cardA),late=pending.shift()
  p.releaseCard(c);p.clear();late.resolve(frames(late.plan));await Promise.resolve();await Promise.resolve()
  assert.equal(c.isValid,false);assert.equal(snap.artworkRoot.active,false)
  const plan=skin.resolveClassicCardPlan(types.cardDisplay(cardA));cached.set(plan.key,frames(plan))
  const made=module.createVfxCardSnapshot(new Node('parent'),cardA,{width:164,height:236})
  assert.equal(await made.ready,true)
  const v=made.node.getComponent(module.VfxCardSnapshot)
  assert.deepEqual(made.node.getComponent(UITransform).contentSize,{width:164,height:236})
  assert.equal(v.layers.get('background').node.getComponent(UITransform).contentSize.width,152)
  assert.equal(await module.preloadVfxCardFrames([cardA,cardB]),true)
  assert.equal(await module.preloadVfxCardFrames([{id:'invalid',suit:'invalid',rank:2}]),false)
  assert.equal(await v.bind({id:'invalid',suit:'invalid',rank:2}),false);assert.equal(v.artworkRoot.active,false)
  return 6
}
Promise.all([handles(),snapshots()]).then(([handleCases,snapshotCases])=>{assert.deepEqual(warns,[]);console.log(JSON.stringify({pressResults,explicitStopControl:control.scale.x,pageCancelledCallbacks:selected,handleCases,snapshotCases,poolReport,motionSamples,loadedEngine},null,2))}).catch(e=>{console.error(e);process.exitCode=1})
