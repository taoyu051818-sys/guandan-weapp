const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { loadTs } = require('./support/load-typescript-module.cjs')
const file = name => path.resolve(__dirname, '../assets/scripts', name)
const policy = loadTs(file('ui/StarGlintPolicy.ts'))
const { STAR_GLINT, TOURNAMENT_TROPHY_GLINT, stepStarGlint, sampleStarGlint } = policy
const motion=loadTs(file('ui/LobbyMotionPolicy.ts'))
const {LOBBY_STAR_GLINT,quickStartGlintGain}=loadTs(file('ui/LobbyStarGlintPolicy.ts'),{'./LobbyMotionPolicy':motion,'./StarGlintPolicy':policy})
for (const profile of Object.values(STAR_GLINT)) {
  const clock = { elapsed: 0 }
  assert.equal(stepStarGlint(clock, .01, true, profile), 0)
  clock.elapsed = profile.delay + profile.duration / 2
  assert.ok(Math.abs(stepStarGlint(clock, 0, true, profile) - profile.strength) < .0001)
  clock.elapsed = profile.delay + profile.duration + .01
  assert.equal(stepStarGlint(clock, 0, true, profile), 0, 'fully hidden, not a dim persistent ray')
  if (profile.period) {
    clock.elapsed = profile.delay + profile.period + profile.duration / 2
    assert.ok(stepStarGlint(clock, 0, true, profile) > .8)
  } else {
    assert.equal(clock.completed, true)
    clock.elapsed = 0
    assert.equal(stepStarGlint(clock, .2, true, profile), 0, 'one-shot never restarts on a ready-state redraw')
  }
  clock.completed = false
  assert.equal(stepStarGlint(clock, .016, false, profile), 0)
  assert.equal(clock.elapsed, 0)
  assert.equal(stepStarGlint(clock, 12, true, profile), 0)
  assert.equal(stepStarGlint(clock, NaN, true, profile), 0)
}
const peakPhases=[]
for (const points of [...Object.values(LOBBY_STAR_GLINT), TOURNAMENT_TROPHY_GLINT]) {
  assert.equal(points.length,3)
  const [small,main,tail]=points
  assert.ok(small.profile.size<tail.profile.size&&tail.profile.size<main.profile.size)
  assert.ok(small.profile.delay<main.profile.delay&&main.profile.delay<tail.profile.delay)
  if (points !== TOURNAMENT_TROPHY_GLINT) peakPhases.push((main.profile.delay+main.profile.duration/2)%main.profile.period)
  const seen=new Set()
  for(let t=0;t<10;t+=.01){
    let visible=0
    for(const [i,p] of points.entries()){
      assert.ok(p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1)
      const value=sampleStarGlint(t,p.profile)
      assert.ok(value>=0&&value<=p.profile.strength)
      if(value>.05){visible++;seen.add(i)}
    }
    assert.ok(visible<=2,'never three bright points on one icon')
  }
  assert.equal(seen.size,3,'each point appears every round')
  for(const p of points){
    const peak=p.profile.delay+p.profile.duration/2
    assert.ok(Math.abs(sampleStarGlint(peak,p.profile)-sampleStarGlint(peak+2.2,p.profile))<1e-10)
  }
}
assert.equal(new Set(peakPhases).size,4,'entry main stars have staggered peaks')
assert.equal(quickStartGlintGain(0),1)
assert.ok(Math.abs(quickStartGlintGain(motion.LOBBY_MOTION.delay+8/15)-.55)<1e-10)
assert.equal(quickStartGlintGain(motion.LOBBY_MOTION.delay+2),1)
class Node {
  static EventType={TOUCH_END:'touch-end'}
  constructor(name) { this.name=name;this.children=[];this.components=[];this.events={};this.layer=0;this.isValid=true;this.scale={x:1,y:1} }
  set parent(v) { this.owner=v;v.children.push(this) } get parent() {return this.owner}
  setPosition(x,y,z) {this.position=typeof x==='object'?x:{x,y,z}} setScale(x,y,z) {this.scale=typeof x==='object'?x:{x,y,z}}
  addComponent(Type) {const c=new Type();c.node=this;this.components.push(c);return c}
  getComponent(Type) {return this.components.find(c=>c instanceof Type)}
  on(event,handler) {this.events[event]=handler}
}
class Sprite {static SizeMode={CUSTOM:1};isValid=true}
class SpriteFrame {reset(v){Object.assign(this,v)} destroy(){this.destroyed=true}}
class Color {constructor(r,g,b,a){Object.assign(this,{r,g,b,a})}}
class UITransform {setContentSize(width,height){Object.assign(this,{width,height})}}
class Texture2D {refs=0;addRef(){this.refs++;return this}decRef(){this.refs--}}
const events=new Map();let callback,cancelled=0
const cc={Node,Color,UITransform,Sprite,SpriteFrame,Texture2D,Component:class{isValid=true},
  _decorator:{ccclass:()=>t=>t},Game:{EVENT_HIDE:'hide',EVENT_SHOW:'show'},
  game:{on:(e,fn,owner)=>events.set(e,[fn,owner]),off:e=>events.delete(e)}}
const {attachStarGlint,attachStarGlintSequence}=loadTs(file('ui/StarGlint.ts'),{
  cc,'./StarGlintPolicy':policy,'../services/GameAssetLoader':{loadGameAsset:(asset,type,cb)=>{
    assert.equal(asset,policy.STAR_GLINT_TEXTURE);callback=cb;return ()=>cancelled++
  }},
})
const parent=new Node('Button');parent.layer=123
const clock={elapsed:0};let allowed=true
const node=attachStarGlint(parent,{x:80,y:16,scale:2,profile:STAR_GLINT.victory,clock,allowed:()=>allowed,pressTarget:parent})
const c=node.components[0];c.onEnable()
const sprite=c.points[0].sprite
assert.equal(node.layer,parent.layer);assert.deepEqual(node.position,{x:80,y:16,z:0})
assert.equal(node.components.find(v=>v instanceof UITransform).width,220)
c.update(.016);assert.equal(sprite.enabled,false)
const texture=new Texture2D();callback(null,texture);const frame=c.frame
assert.equal(texture.refs,1)
const peak=()=>{clock.elapsed=STAR_GLINT.victory.delay+STAR_GLINT.victory.duration/2;c.update(0)}
peak();assert.equal(sprite.enabled,true);assert.ok(sprite.color.a>230)
parent.scale.x=.96;c.update(.016);assert.equal(sprite.enabled,false,'button feedback wins');parent.scale.x=1
peak();allowed=false;c.update(.016);assert.equal(sprite.enabled,false);allowed=true
c.preference={matches:true};peak();assert.equal(sprite.enabled,false);c.preference.matches=false
peak();events.get('hide')[0].call(c);assert.equal(sprite.enabled,false)
events.get('show')[0].call(c);c.update(.016);assert.equal(sprite.enabled,false)
clock.completed=true;c.onDisable();c.onDestroy()
assert.equal(events.size,0);assert.equal(clock.completed,true);assert.equal(frame.destroyed,true);assert.equal(cancelled,1)
assert.equal(texture.refs,0)
c.isValid=false;callback(null,{width:256,height:256});assert.equal(c.frame,null,'late resource cannot resurrect nodes')
const sequenceClock={elapsed:0};let gain=1
const sequenceNode=attachStarGlintSequence(parent,{width:200,height:100,scale:2,points:LOBBY_STAR_GLINT.friend,
  allowed:()=>allowed,clock:sequenceClock,pressTarget:parent,intensity:()=>gain})
const group=sequenceNode.components[0];group.onEnable()
assert.equal(sequenceNode.children.length,3)
group.update(.1);assert.equal(sequenceClock.elapsed,0,'clock waits for the shared texture')
const groupTexture=new Texture2D();callback(null,groupTexture);assert.equal(groupTexture.refs,1,'one reference for all points')
assert.ok(group.points.every(p=>p.sprite.spriteFrame===group.frame),'one sprite frame shared across three points')
group.update(.1);assert.equal(sequenceClock.elapsed,.1,'clock advances once, not once per point')
const main=LOBBY_STAR_GLINT.friend[1]
sequenceClock.elapsed=main.profile.delay+main.profile.duration/2;group.update(0)
assert.equal(group.points[1].sprite.color.a,Math.round(255*main.profile.strength))
assert.deepEqual(group.points[1].node.position,{x:(main.x-.5)*200,y:(.5-main.y)*100,z:0})
gain=.5;group.update(0);assert.equal(group.points[1].sprite.color.a,Math.round(255*main.profile.strength*.5))
group.update(1);assert.ok(group.points.every(p=>!p.sprite.enabled),'stall resets all points')
group.preference={matches:true};group.update(.1);assert.ok(group.points.every(p=>!p.sprite.enabled));group.preference=null
allowed=false;group.update(.1);assert.equal(sequenceClock.elapsed,0);allowed=true
events.get('hide')[0].call(group);group.update(.1);assert.ok(group.points.every(p=>!p.sprite.enabled))
events.get('show')[0].call(group);group.update(.1)
const groupFrame=group.frame;group.onDisable();group.onDestroy()
assert.equal(groupTexture.refs,0);assert.equal(groupFrame.destroyed,true);assert.equal(cancelled,2);assert.equal(events.size,0)
const lateTexture=new Texture2D();callback(null,lateTexture);assert.equal(lateTexture.refs,0)
const missing=attachStarGlintSequence(parent,{width:70,height:70,points:LOBBY_STAR_GLINT.shop,allowed:()=>true}).components[0]
callback(new Error('optional asset unavailable'),null);missing.update(.1)
assert.ok(missing.points.every(p=>!p.sprite.enabled));missing.onDestroy()
const source=fs.readFileSync(file('ui/StarGlint.ts'),'utf8')
assert.doesNotMatch(source,/TOUCH_|BlockInputEvents|setTimeout|setInterval|requestAnimationFrame|getContext/)
const png=fs.readFileSync(path.resolve(__dirname,'../assets/game-assets/effects/lobby-v1/metal-star-glint.png'))
assert.equal(png.readUInt32BE(16),256);assert.equal(png.readUInt32BE(20),256);assert.equal(png[25],6)
assert.ok(png.length<32*1024,'small shared transparent asset')

// Exercise the real tournament view as well as the lobby policy: the inner page must not regress to a single star.
class RuntimeUiFactory {
  constructor(parent){this.parent=parent}
  panel(name,x,y,w,h){const n=new Node(name);n.parent=this.parent;n.setPosition(x,y,0);n.addComponent(UITransform).setContentSize(w,h);return n}
  image(name,asset,x,y,w,h){return this.panel(name,x,y,w,h)}
  label(name,x,y){return {node:this.panel(name,x,y,0,0)}}
  button(name,label,x,w,h){return this.panel(name,x,0,w,h)}
}
const tournamentModel=loadTs(file('scenes/front-pages/TournamentCenterModel.ts'))
const {renderTournamentCenter}=loadTs(file('scenes/front-pages/TournamentCenterView.ts'),{
  cc:{...cc,Label:{Overflow:{SHRINK:1}},Vec3:class{constructor(x,y,z){Object.assign(this,{x,y,z})}}},
  '../../ui/RuntimeUiFactory':{RuntimeUiFactory},
  '../../ui/TableButtonMetrics':loadTs(file('ui/TableButtonMetrics.ts')),
  '../../ui/StarGlint':{attachStarGlintSequence},'../../ui/StarGlintPolicy':policy,
  './TournamentCenterModel':tournamentModel,
})
const trophyClock={elapsed:1.4}
for (const tab of ['status','standings','rules']) {
  const page=new Node('TournamentPage')
  renderTournamentCenter(new RuntimeUiFactory(page),{width:874,height:402},
    {tournament:null,state:null,standings:null,busy:false,error:'',tab,rankingPage:0},
    {back(){},withdraw(){},action(){},tab(){},page(){}},{clock:trophyClock,allowed:()=>true})
  const surface=page.children[0],artwork=surface.children.find(n=>n.name==='TournamentArtwork')
  assert.equal(artwork.getComponent(UITransform).width,244)
  assert.equal(artwork.getComponent(UITransform).height,244,'trophy keeps its proportions')
  const sequence=artwork.children.find(n=>n.name==='MetalStarGlintSequence')
  assert.equal(sequence.children.length,3,'inner-page trophy uses three anchors')
  assert.ok(!surface.children.some(n=>n.name==='MetalStarGlint'),'legacy single star removed')
  const effect=sequence.components[0];effect.onEnable()
  const texture=new Texture2D();callback(null,texture)
  assert.equal(effect.clock,trophyClock,'tab and polling redraws keep the controller clock')
  const elapsed=trophyClock.elapsed;effect.update(0);assert.equal(trophyClock.elapsed,elapsed)
  const appeared=new Set()
  for(let frame=0;frame<300;frame++){
    effect.update(1/60)
    effect.points.forEach((p,i)=>{if(p.sprite.enabled&&p.sprite.color.a>12)appeared.add(i)})
    assert.ok(effect.points.filter(p=>p.sprite.enabled&&p.sprite.color.a>12).length<=2)
  }
  assert.equal(appeared.size,3,'all trophy points play over repeated rounds')
  assert.ok(effect.points.every(p=>p.sprite.spriteFrame===effect.frame&&Object.keys(p.node.events).length===0))
  effect.preference={matches:true};effect.update(.016)
  assert.ok(effect.points.every(p=>!p.sprite.enabled))
  effect.onDisable();effect.onDestroy();assert.equal(texture.refs,0);assert.equal(events.size,0)
}
assert.equal(STAR_GLINT.tournamentTrophy,undefined,'retired single-point tuning removed')
console.log('Metal star glint: lobby and tournament three-point loops, tab redraw clocks, shared texture, one-shot, reduced motion, input isolation and disposal passed')
