const assert = require('node:assert/strict')
const path = require('node:path')
const { loadTs } = require('./support/load-typescript-module.cjs')
class Node {
  constructor(name) { this.name=name; this.children=[]; this.components=[]; this.layer=1; this.scale={x:1};this.position={x:0,y:0} }
  set parent(v) {this.owner=v;v.children.push(this)} get parent(){return this.owner}
  addComponent(T) {const c=new T();c.node=this;this.components.push(c);return c}
  getComponent(T) {return this.components.find(c=>c instanceof T)}
  setPosition(x,y,z) {this.position={x,y,z}}
}
class Graphics {strokes=0;clears=0;clear(){this.strokes=0;this.clears++}moveTo(){}lineTo(){}stroke(){this.strokes++}}
class Sprite {}
class UITransform {setContentSize(width,height){Object.assign(this,{width,height})}}
const events=new Map()
const cc={Node,Graphics,Sprite,UITransform,UIOpacity:class{},Component:class{},Color:class{},
  _decorator:{ccclass:()=>T=>T},Game:{EVENT_HIDE:'hide',EVENT_SHOW:'show'},
  game:{on:(e,fn,owner)=>events.set(e,[fn,owner]),off:e=>events.delete(e)}}
const {attachFriendEntrySteam,projectFriendSpout,sampleFriendSteam,FRIEND_STEAM_PERIOD}=loadTs(path.resolve(__dirname,'../assets/scripts/ui/FriendEntrySteam.ts'),{cc})
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`)
for(const [width,height] of [[184,92],[120,60],[276,138],[184,110],[210,85]]) {
  for(const resolution of [1,.5,2]) {
    const texture={width:675*resolution,height:900*resolution}
    const cover=Math.max(width/texture.width,height/(texture.height*.74))
    const crop={width:width/cover,height:height/cover}
    crop.x=(texture.width-crop.width)/2;crop.y=(texture.height*.74-crop.height)/2
    const a=projectFriendSpout(texture,crop,{width,height})
    near((a.x/width+.5)*crop.width+crop.x,156*resolution)
    near((.5-a.y/height)*crop.height+crop.y,276*resolution)
  }
}
for(let lane=0;lane<3;lane++)for(let u=0;u<=1;u+=.05) {
  const first=sampleFriendSteam(u,0,lane),last=sampleFriendSteam(u,FRIEND_STEAM_PERIOD,lane)
  for(const key of ['x','y','strength']) near(first[key],last[key])
  const before=sampleFriendSteam(u,FRIEND_STEAM_PERIOD-1e-6,lane),after=sampleFriendSteam(u,1e-6,lane)
  assert.ok(Math.abs(before.x-after.x)<.0001&&Math.abs(before.strength-after.strength)<.0001,'loop seam is continuous')
}
for(let t=0;t<12;t+=.016) {
  let sourceStrength=0
  for(let lane=0;lane<3;lane++) {
    const p=sampleFriendSteam(0,t,lane)
    near(p.x,0);near(p.y,0);sourceStrength+=p.strength
  }
  near(sourceStrength,2.28) // Staggered waves have constant summed density at the source.
}
let allowed=true
const artwork=new Node('art'),button=new Node('button')
attachFriendEntrySteam(artwork,{scale:1,allowed:()=>allowed,pressTarget:button})
const effect=artwork.children[0].components[0]
effect.onEnable();effect.update(.1);assert.equal(effect.opacity.opacity,0,'wait for image')
const slice=new Node('ArtworkSlice');slice.parent=artwork
slice.addComponent(Sprite).spriteFrame={texture:{width:675,height:900},rect:{x:0,y:164.25,width:675,height:337.5}}
slice.addComponent(UITransform).setContentSize(184,92)
const anchor=projectFriendSpout(slice.getComponent(Sprite).spriteFrame.texture,slice.getComponent(Sprite).spriteFrame.rect,slice.getComponent(UITransform))
for(let i=0;i<400;i++) {
  effect.update(1/60)
  near(effect.node.position.x,anchor.x);near(effect.node.position.y,anchor.y)
  assert.ok(effect.opacity.opacity>=0&&effect.opacity.opacity<=255)
}
assert.equal(effect.opacity.opacity,255)
assert.equal(effect.graphics.strokes,240,'geometry is cleared, not accumulated')
assert.ok(effect.graphics.clears>=199&&effect.graphics.clears<=201,'render capped at 30 Hz')
assert.ok(anchor.y+52>48&&anchor.y+52<78,'bounded card-top overflow')
const assertHidden=()=>assert.equal(effect.opacity.opacity,0)
allowed=false;effect.update(.016);assertHidden()
allowed=true;button.scale.x=.96;effect.update(.016);assertHidden()
button.scale.x=1;effect.preference={matches:true};effect.update(.016);assertHidden()
effect.preference=null;effect.update(NaN);assertHidden()
effect.update(20);assertHidden()
events.get('hide')[0].call(events.get('hide')[1]);effect.update(.016);assertHidden()
events.get('show')[0].call(events.get('show')[1]);effect.update(.1);assert.ok(effect.opacity.opacity>0)
effect.onDisable();assertHidden();assert.equal(events.size,0)
effect.onDestroy();assert.equal(effect.options,null);assert.equal(effect.graphics,null)
console.log('Friend steam: source-pixel projection across crops/sizes, fixed spout, seamless constant-density cycle, bounded 30Hz geometry and lifecycle passed')
