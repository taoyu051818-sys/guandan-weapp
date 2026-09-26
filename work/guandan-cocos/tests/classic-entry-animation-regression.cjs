const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTs } = require('./support/load-typescript-module.cjs')
const root = path.resolve(__dirname, '..'), file = name => path.join(root,'assets/scripts/ui',name+'.ts')
const policy = loadTs(file('ClassicEntryAnimationPolicy'))
const { CLASSIC_ENTRY_ANIMATION:P, stepClassicEntry, classicEntryFrameRect } = policy
const clock = {elapsed:0,playing:false}
assert.equal(stepClassicEntry(clock,.01,true),0);assert.equal(clock.playing,true)
clock.elapsed=32/P.fps;assert.equal(stepClassicEntry(clock,0,true),32);assert.equal(clock.playing,true)
clock.elapsed=4+.001;assert.equal(stepClassicEntry(clock,0,true),0);assert.equal(clock.playing,true)
clock.elapsed=5;assert.equal(stepClassicEntry(clock,0,true),12)
clock.elapsed=47/P.fps;assert.equal(stepClassicEntry(clock,0,true),47)
assert.equal(stepClassicEntry(clock,1/P.fps,true),0);assert.equal(clock.playing,true)
assert.equal(stepClassicEntry(clock,1/P.fps,true),1)
for(const dt of [NaN,-1,1]){stepClassicEntry(clock,dt,true);assert.equal(clock.elapsed,0);assert.equal(clock.playing,false)}
clock.elapsed=4;stepClassicEntry(clock,.01,false);assert.equal(clock.elapsed,0)
const {stepLobbyMotion}=loadTs(file('LobbyMotionPolicy'))
const {stepStarGlint}=loadTs(file('StarGlintPolicy'))
const {LOBBY_STAR_GLINT}=loadTs(file('LobbyStarGlintPolicy'),{'./LobbyMotionPolicy':loadTs(file('LobbyMotionPolicy')),'./StarGlintPolicy':loadTs(file('StarGlintPolicy'))})
const quick={elapsed:0},glint={elapsed:0};let quickFrames=0,glintFrames=0,loops=0,previous=0
for(let t=0;t<30;t+=1/60){
  const frame=stepClassicEntry(clock,1/60,true)
  assert.equal(clock.playing,true,'no idle interval between loops')
  if(frame<previous)loops++
  previous=frame
  const q=stepLobbyMotion(quick,1/60,true)
  const g=stepStarGlint(glint,1/60,true,LOBBY_STAR_GLINT.quickStart[1].profile)
  if(q>=0)quickFrames++
  if(g>0)glintFrames++
}
assert.equal(loops,7,'continuous four-second loops')
assert.ok(quickFrames>150&&glintFrames>0,'quick-start effects play independently')
const lobbySource=fs.readFileSync(path.join(root,'assets/scripts/scenes/front-pages/LobbyPageDomain.ts'),'utf8')
assert.doesNotMatch(lobbySource,/classicEntryClock\.playing/,'classic entry must not suppress quick-start effects')
for(let i=0;i<P.frames;i++){
  const r=classicEntryFrameRect(i)
  assert.equal(r.page,Math.floor(i/16));assert.ok(r.x>=2&&r.y>=2)
  assert.ok(r.x+r.width+2<=(P.width+4)*4&&r.y+r.height+2<=(P.height+4)*4)
}
class Node {
  constructor(name){this.name=name;this.children=[];this.components=[];this.layer=1;this.isValid=true;this.scale={x:1}}
  set parent(n){this.owner=n;n.children.push(this)}get parent(){return this.owner}
  addComponent(Type){const c=new Type();c.node=this;this.components.push(c);return c}
}
class Sprite {static SizeMode={CUSTOM:1};isValid=true}
class SpriteFrame {reset(o){Object.assign(this,o)}destroy(){this.destroyed=true}}
class UITransform {setContentSize(width,height){Object.assign(this,{width,height})}}
class Rect {constructor(x,y,width,height){Object.assign(this,{x,y,width,height})}}
class Size {constructor(width,height){Object.assign(this,{width,height})}}
class Texture2D {
  constructor(width=1456,height=1344){Object.assign(this,{width,height,refs:0})}
  addRef(){this.refs++;return this}decRef(){this.refs--}
}
let requests=[],cancelled=0;const events=new Map()
const cc={Node,Sprite,SpriteFrame,UITransform,Rect,Size,Texture2D,Component:class{isValid=true},_decorator:{ccclass:()=>t=>t},
  Game:{EVENT_HIDE:'hide',EVENT_SHOW:'show'},game:{on:(key,fn,c)=>events.set(key,[fn,c]),off:key=>events.delete(key)}}
const {attachClassicEntryAnimation}=loadTs(file('ClassicEntryAnimation'),{cc,'./ClassicEntryAnimationPolicy':policy,
  '../services/GameAssetLoader':{loadGameAsset:(name,Type,cb)=>{requests.push({name,cb});return()=>{cancelled++;cb(new Error('cancelled'),null)}}}})
function create(){
  requests=[];const parent=new Node('EntryArtwork'),state={elapsed:0,playing:false};let allowed=true
  attachClassicEntryAnimation(parent,{width:180,height:166,allowed:()=>allowed,clock:state,pressTarget:parent})
  const node=parent.children[0],c=node.components[0];c.onEnable()
  return {parent,node,c,state,setAllowed:v=>{allowed=v}}
}
const {parent,node,c,state,setAllowed}=create()
assert.equal(node.layer,parent.layer);assert.equal(node.components[1].width,180)
assert.equal(requests.length,1,'small poster first; no synchronous atlas load')
const poster=new Texture2D(360,332);requests[0].cb(null,poster)
assert.equal(c.sprite.enabled,true);assert.equal(c.sprite.spriteFrame,c.poster)
const owned=[poster]
for(let page=0;page<3;page++){
  c.update(.01);assert.equal(state.playing,false)
  assert.equal(requests.at(-1).name,P.assetPrefix+page+'/texture')
  c.update(.01);assert.equal(requests.length,page+2,'one request in flight')
  const texture=new Texture2D();owned.push(texture);requests.at(-1).cb(null,texture)
}
assert.equal(c.frames.length,48)
state.elapsed=32/P.fps;c.update(0)
assert.equal(c.sprite.spriteFrame,c.frames[32]);assert.equal(state.playing,true)
parent.scale.x=.96;c.update(.01);assert.equal(state.playing,false);assert.equal(c.sprite.spriteFrame,c.poster);parent.scale.x=1
state.elapsed=4;setAllowed(false);c.update(.01);assert.equal(state.elapsed,0);setAllowed(true)
c.preference={matches:true};state.elapsed=4;c.update(.01);assert.equal(state.playing,false);c.preference=null
state.elapsed=4;c.update(0);events.get('hide')[0].call(c);assert.equal(state.playing,false)
events.get('show')[0].call(c);c.update(.01);assert.equal(c.sprite.spriteFrame,c.poster)
const allFrames=[c.poster,...c.frames];c.onDisable();c.onDestroy()
assert.equal(events.size,0);assert.equal(cancelled,4);assert.ok(allFrames.every(f=>f.destroyed));assert.ok(owned.every(t=>t.refs===0))
const late=new Texture2D();requests[1].cb(null,late);assert.equal(late.refs,0);assert.equal(c.frames.length,0)
const failed=create();const fallback=new Texture2D(360,332);requests[0].cb(null,fallback)
failed.c.update(.01);requests.at(-1).cb(new Error('unavailable'),null)
for(let i=0;i<100;i++)failed.c.update(.1)
assert.equal(requests.length,2,'no retry loop');assert.equal(failed.c.sprite.spriteFrame,failed.c.poster);assert.equal(failed.state.playing,false)
failed.c.onDisable();failed.c.onDestroy()
const reduced=create();reduced.c.preference={matches:true};reduced.c.update(.1);assert.equal(requests.length,1,'no atlas load for reduced motion')
reduced.c.onDisable();reduced.c.onDestroy()
function jpegSize(b){
  let pos=2
  while(pos<b.length){assert.equal(b[pos++],255);const marker=b[pos++],len=b.readUInt16BE(pos)
    if([192,193,194].includes(marker))return {width:b.readUInt16BE(pos+5),height:b.readUInt16BE(pos+3)}
    pos+=len
  }throw Error('Missing JPEG frame header')
}
let bytes=0
for(const suffix of ['poster',0,1,2]){
  const b=fs.readFileSync(path.join(root,'assets/game-assets',P.assetPrefix+suffix+'.jpg'));bytes+=b.length
  assert.deepEqual(jpegSize(b),suffix==='poster'?{width:360,height:332}:{width:1456,height:1344})
}
assert.ok(bytes<2*1024*1024,'compressed asset budget under 2 MiB')
const source=fs.readFileSync(file('ClassicEntryAnimation'),'utf8')
assert.doesNotMatch(source,/TOUCH_|BlockInputEvents|setTimeout|setInterval|requestAnimationFrame|getContext/)
console.log(`Classic entry: 48 frames/12 fps, continuous loops, independent quick-start, load fallback, lifecycle and ${bytes} asset bytes passed`)
