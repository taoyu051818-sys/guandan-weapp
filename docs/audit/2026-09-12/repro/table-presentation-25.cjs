// Audit-only: actual first-party HUD/played-area/coordinator with in-memory Cocos nodes.
// Reuses installed engine Tween algorithms; no GPU, network or product writes.
'use strict'
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const app=path.resolve(__dirname,'../../../../work/guandan-cocos'),root=path.resolve(app,'../..')
const src=p=>path.join(app,'assets/scripts',p)
const ts=require(path.join(app,'tests/support/typescript.cjs')).loadTypeScript()
const engineText=fs.readFileSync(path.join(__dirname,'effect-orchestration-23.cjs'),'utf8')
const marker='function playbackFixture () {'
assert.equal(engineText.split(marker).length,2)
const runtime=new Function('require','__dirname',engineText.slice(0,engineText.indexOf(marker))+
  '\nreturn {cc,manager,loadedEngine,step,EffectActionPresentationCoordinator}') (require,__dirname)
const {cc,manager,loadedEngine,step,EffectActionPresentationCoordinator}=runtime
const {Node,Vec3,UITransform,Graphics}=cc
cc.Vec2=class {constructor(x,y){Object.assign(this,{x,y})}}
Node.EventType.TOUCH_MOVE='move'
Node.prototype.setSiblingIndex=function(index){const p=this.parent;if(!p)return;p.children.splice(p.children.indexOf(this),1);p.children.splice(index,0,this)}
Node.prototype.getComponentInChildren=function(T){return this.getComponent(T)||this.children.map(n=>n.getComponentInChildren(T)).find(Boolean)||null}
for(const name of ['circle','arc','moveTo','lineTo','close','bezierCurveTo'])Graphics.prototype[name]=function(){}
const worldRect=n=>{
  let x=0,y=0,sx=1,sy=1
  const chain=[];for(let p=n;p;p=p.parent)chain.unshift(p)
  for(const p of chain){x+=p.position.x*sx;y+=p.position.y*sy;sx*=p.scale.x;sy*=p.scale.y}
  const size=n.getComponent(UITransform)?.contentSize||{width:0,height:0}
  return {left:x-size.width*sx/2,bottom:y-size.height*sy/2,width:size.width*sx,height:size.height*sy}
}
UITransform.prototype.hitTest=function(p){const r=worldRect(this.node);return p.x>=r.left&&p.x<=r.left+r.width&&p.y>=r.bottom&&p.y<=r.bottom+r.height}
const cache=new Map()
class CardView {bind(c){this.card=c}getBombReactionRoot(){return this.node}}
const ports={
  [src('ui/RuntimeUiFactory.ts')]:{applyForegroundTextStyle:label=>label},
  [src('ui/CardView.ts')]:{CardView},
  [src('effects/CardFlightController.ts')]:{PLAYED_CARD_FINAL_SCALE:.8,resolvePlayedCardSpacing:n=>Math.min(42,210/Math.max(1,n-1))},
}
function load(file){
  file=path.resolve(file)
  if(ports[file])return ports[file]
  if(cache.has(file))return cache.get(file).exports
  assert(file.startsWith(path.join(app,'assets/scripts')+'/')||file.startsWith(path.join(root,'shared-core/src')+'/'))
  const module={exports:{}};cache.set(file,module)
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,experimentalDecorators:true}}).outputText
  new Function('module','exports','require',code)(module,module.exports,key=>{
    if(key==='cc')return cc
    assert(key.startsWith('.'),'unexpected dependency '+key)
    let dep=path.resolve(path.dirname(file),key)
    if(!fs.existsSync(dep+'.ts'))dep=path.join(dep,'index')
    return load(dep+'.ts')
  })
  return module.exports
}
const {PlayAreaController}=load(src('ui/PlayAreaController.ts'))
const layout=load(src('ui/TableHudLayoutPolicy.ts')),played=load(src('ui/PlayedCardLayout.ts'))
const foundation=load(src('ui/TableGameHudFoundation.ts'))
const {TableGameHud}=load(src('ui/TableGameHud.ts'))
const ids=['p1','p2','p3','p4']
const card=(id,rank=4)=>({id,rank,value:rank,suit:'club',isLevelCard:false,isRedJoker:false})
const action=(id,playerId,type='Single')=>({playerId,type,cards:type==='Pass'?[]:[card(id)]})
const near=(a,b)=>assert(Math.abs(a-b)<1e-8,a+' != '+b)
const area=()=>{const n=new Node('PlayArea');n.addComponent(UITransform);return n.addComponent(PlayAreaController)}
const countTree=n=>1+n.children.reduce((sum,c)=>sum+countTree(c),0)
const result={}

function passLifetime(){
  let cases=0
  for(const hz of [60,120])for(const playerId of ids)for(const reset of [false,true]){
    manager.removeAllActions()
    const p=area(),a=action('first','p1'),pass=action('none',playerId,'Pass')
    p.resetPresentation(2);p.render([a,pass],'p1',a)
    assert(p.node.getChildByName('play-'+playerId)?.getChildByName('PassText'))
    step(.4,hz);if(reset){p.resetPresentation(2);p.render([a,pass],'p1',a)}
    step(1,hz);assert(!p.node.getChildByName('play-'+playerId))
    p.render([a,pass],'p1',a);assert(!p.node.getChildByName('play-'+playerId),'expired pass must not revive')
    p.clearPresentation();p.resetPresentation(2);p.render([a,pass],'p1',a)
    assert(p.node.getChildByName('play-'+playerId),'new round clears expiry tombstones')
    p.clearPresentation();step(2,hz);assert.equal(p.node.children.length,0)
    p.node.destroy();cases++
  }
  return cases
}
function seating(){
  const permutations=a=>a.length?a.flatMap((v,i)=>permutations(a.filter((_,j)=>j!==i)).map(rest=>[v,...rest])):[[]]
  let cases=0
  for(const order of permutations(ids))for(const human of ids)for(const author of ids){
    const p=area(),a=action('seat',author)
    p.setSeatOrder(order);p.resetPresentation(1);p.render([a],human,a)
    const expected=played.playedCardPosition({width:1280,height:720},(order.indexOf(author)-order.indexOf(human)+4)%4)
    const actual=p.node.getChildByName('play-'+author).position
    near(actual.x,expected.x);near(actual.y,expected.y);p.clearPresentation();p.node.destroy();cases++
  }
  return cases
}
function hudLifecycle(){
  const host=new Node('Host'),other=new Node('OtherHost'),calls=[]
  const hud=new TableGameHud({onSuitSelect:s=>calls.push(s),onArrange:()=>calls.push('arrange')})
  hud.mount(host)
  const hints=['hint','pass','play'].map(name=>{const n=new Node(name);foundation.configureTransform(n,140,69.6);return n})
  hud.setTurnActionNodes(hints)
  let state={...foundation.freshTableGameHudState(),trusteeVisible:true}
  let maxNodes=0,cases=0
  for(let i=0;i<80;i++){
    state={...state,turnPlace:layout.TABLE_HUD_SEAT_PLACES[i%4],turnVisible:i%5!==0,availableSuits:i%2?['heart','club']:[],
      selectedSuit:'heart',counterExpanded:!!(i%2),counterEnabled:i%7!==0,trusteeActive:i%2===0,arrangeRestoreAvailable:i%3===0}
    hud.render(state)
    maxNodes=Math.max(maxNodes,countTree(hud.node))
    assert.equal(hud.operationOverlay.active,state.turnVisible&&state.turnPlace==='bottom')
    assert.equal(hud.counterPanel.active,state.counterEnabled)
    assert(hud.suitBar.active,'empty suits retain the component')
    assert.equal(hud.state.selectedSuit,i%2?'heart':null)
    const t=hud.turnTimer.node
    assert.equal(t.active,state.turnVisible)
    assert.equal(t.parent===hud.operationOverlay,state.turnVisible&&state.turnPlace==='bottom')
    if(state.counterEnabled) assert.equal(hud.counterPanel.getComponent(UITransform).contentSize.height,state.counterExpanded?82:foundation.BASE_COUNTER_CLOSED_HEIGHT)
    cases++
  }
  const stable=countTree(hud.node)
  for(let i=0;i<40;i++)hud.render(state)
  assert.equal(countTree(hud.node),stable,'no per-render silhouette/node growth')
  const club=hud.suitButtons.get('club').node
  hud.render({...state,availableSuits:[],selectedSuit:null});club.emit('start');club.emit('end');assert.equal(calls.length,0)
  hud.render({...state,availableSuits:['club'],selectedSuit:null});club.emit('start');club.emit('end');assert.deepEqual(calls,['club'])
  club.emit('start');club.emit('end');assert.deepEqual(calls,['club',null])
  hud.setVisible(false);assert(!hud.hitTestInteractiveScreenPoint({x:0,y:0}))
  hud.setVisible(true);assert.equal(hud.mount(other).parent,other);assert.equal(host.children.length,0)
  hud.dispose();assert.equal(other.children.length,0);assert(hints.every(n=>!n.isValid))
  host.destroy();other.destroy()
  return {cases,maxNodes,stableNodes:stable,stableRenders:40}
}
function geometry(){
  let cases=0,minimumGap=Infinity
  const sizes={backSize:{width:134.4,height:69.6},roundSize:{width:240,height:84},seatSize:{width:280,height:100},
    suitSize:{width:480,height:69.6},toolbarSize:{width:451.2,height:69.6}}
  for(const width of [960,1280,1565,1792])for(const height of [589,720,900])for(const safe of [0,24,60]){
    const viewport={width,height,safeLeft:safe,safeRight:safe/2,safeTop:10,safeBottom:12}
    const frame=layout.resolveTableHudFrameLayout({viewport,...sizes})
    for(const value of [frame.top.back,frame.top.round,...Object.values(frame.seats),...Object.values(frame.bottom)])
      assert([value.x,value.y,value.scale].every(Number.isFinite))
    const top=[]
    for(const h of [foundation.BASE_COUNTER_CLOSED_HEIGHT,82]){
      const counter=layout.resolveTableHudCounterPlacement(viewport,{width:596,height:h},82)
      top.push(counter.position.y+h*frame.bounds.scale/2)
    }
    near(top[0],top[1])
    const one=played.playedCardPosition(viewport,1,1)
    for(const count of [1,2,5,6,8,10]){
      const p=played.playedCardPosition(viewport,1,count)
      near(p.x+(count-1)*played.playedCardSpacing(count)*.8/2,one.x)
    }
    const row=layout.resolveTableHudOperationRow([134.4,134.4,153.6])
    near(row.actionXs[0]-134.4/2,-row.actionXs[2]-153.6/2)
    minimumGap=Math.min(minimumGap,row.actionXs[1]-row.actionXs[0]-134.4)
    cases++
  }
  assert(minimumGap>=9.999999)
  return {cases,minimumOperationGap:minimumGap}
}
function overlaps(){
  const {auditTableLayoutOverlaps}=load(src('ui/TableLayoutOverlapAudit.ts'))
  let seed=25,cases=0
  const next=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n}
  const has=(r,x,y)=>x>=r.left&&x<r.left+r.width&&y>=r.bottom&&y<r.bottom+r.height
  for(let i=0;i<250;i++){
    const regions=[0,1].map(k=>({id:''+k,label:'r'+k,role:'cards',rect:{left:0,bottom:0,width:12,height:12},
      parts:Array.from({length:5},()=>({left:next(15)-2,bottom:next(15)-2,width:next(5)+1,height:next(5)+1}))}))
    regions[0].parts.push(regions[0].parts[0])
    let expected=0
    for(let x=0;x<12;x++)for(let y=0;y<12;y++)if(regions.every(r=>r.parts.some(p=>has(p,x,y))))expected++
    const frozen=JSON.stringify(regions)
    const overlap=auditTableLayoutOverlaps(regions,{width:12,height:12},{minimumAreaPx2:0}).overlaps[0]
    assert.equal(overlap?.areaPx2??0,expected);assert.equal(JSON.stringify(regions),frozen);cases++
  }
  return cases
}
function observerReprojection(){
  const from=src('scenes/TableMatchCoordinator.ts')
  class Bridge{constructor(_events,h){this.h=h}mount(){}dispose(){}}
  ports[src('scenes/TableNetworkEventBridge.ts')]={TableNetworkEventBridge:Bridge}
  ports[src('scenes/TablePhasePresenter.ts')]={TablePhasePresenter:class{clear(){}layoutActionControls(){}renderPhaseOverlay(){}animateEntrance(){}}}
  ports[src('scenes/TableProgressPresentation.ts')]={TableProgressPresentation:class{renderProgressNotifications(){}seedRecovery(){}reset(){}}}
  ports[src('scenes/TableSnapshotPresenter.ts')]={projectTableViewer:()=>({levelLabel:'',settlementTitle:null,settlementWon:false})}
  ports[src('game/TeammateHandProjector.ts')]={TeammateHandProjector:class{project(){return null}reset(){}}}
  const {TableMatchCoordinator}=load(from),rows=[]
  for(const oldViewer of ids)for(const newViewer of ids.filter(x=>x!==oldViewer)){
    const p=area(),co=new EffectActionPresentationCoordinator(),a=action('same','p3'),state={
      turnOrder:ids,currentTurn:'p2',playArea:[a],lastValidPlay:a,finishedPlayers:[],
      players:Object.fromEntries(ids.map((id,i)=>[id,{hand:[card(id)],team:i%2}]))}
    const session={snapshot:{myPlayerId:oldViewer,isObserver:true,isMultiplayer:true}}
    const dep={session,playArea:p,layoutSeats:()=>{},playerSeats:new Map(),lobby:{events:{},snapshot:{roomId:'123456',roomStatus:'ready',roomRole:'observer',myPlayerId:oldViewer,members:ids}},
      manager:{node:new Node('Manager')},handInteraction:{submit:()=>({hand:[],playSelectedCardIds:[],sortOrder:'point',interactive:false}),invalidateAuthoritativeHand:()=>{}},
      hand:{node:new Node('Hand'),render:()=>{},consumeEntranceCompletion:()=>null},hud:{render:()=>{}},controls:{},audio:{},
      frontPages:{handoffFriendRoomReservation:()=>{},hideAll:()=>{}},setTableVisible:()=>{},
      effects:{resetForRecovery:n=>co.resetForRecovery(n),syncActions:(...args)=>co.syncActions(...args,()=>{},()=>{})}}
    const c=new TableMatchCoordinator(dep),snapshot={state,phase:'playing',teamLevels:{},settlement:null,hint:''}
    dep.manager.applyServerState=()=>c.render(snapshot)
    const {LobbyMessageRouter}=load(src('network/LobbyMessageRouter.ts')),listeners=new Map()
    const router=new LobbyMessageRouter({
      snapshot:()=>dep.lobby.snapshot,isRoomCleaning:()=>false,listen:(kind,fn)=>listeners.set(kind,fn),
      patch:patch=>{Object.assign(dep.lobby.snapshot,patch);if(patch.myPlayerId)session.snapshot.myPlayerId=patch.myPlayerId},
      emit:(kind,packet)=>{if(kind==='guandan:network-state')c.applyNetworkState(packet)},
    })
    router.bind()
    listeners.get('roomView')({roomId:'123456',roomRole:'observer',myPlayerId:oldViewer,version:10,gameVersion:5,state,phase:'playing'})
    const before=p.node.getChildByName('play-p3').position.clone()
    listeners.get('roomView')({roomId:'123456',roomRole:'observer',myPlayerId:newViewer,version:11,gameVersion:5,state,phase:'playing'})
    const after=p.node.getChildByName('play-p3').position.clone(),expected=p.getActionWorldPosition('p3',newViewer)
    assert.deepEqual(after,before,'cached action keeps old position even after recovery')
    assert(Math.abs(after.x-expected.x)>1||Math.abs(after.y-expected.y)>1)
    c.refresh();assert.deepEqual(p.node.getChildByName('play-p3').position,after)
    p.layout({width:1280,height:720});assert.deepEqual(p.node.getChildByName('play-p3').position,expected,'explicit resize is a successful control')
    rows.push({oldViewer,newViewer,actual:{x:after.x,y:after.y},expected:{x:expected.x,y:expected.y}})
    p.clearPresentation();p.node.destroy();dep.manager.node.destroy();dep.hand.node.destroy()
  }
  return rows
}
function lockHighlight(){
  const host=new Node('lock-host'),hud=new TableGameHud();hud.mount(host)
  const rows=[]
  for(const decision of [{kind:'unavailable',reason:'empty-selection'},{kind:'lock',cardIds:['a','b']},{kind:'unlock',groupIds:['one']}]){
    hud.render({...foundation.freshTableGameHudState(),lockDecision:decision})
    const actual=[...hud.lockButton.graphics.fillColor.values]
    const control=new Node('control'),view=foundation.createTableHudButton(control,'lock','锁牌',0,134.4,69.6,34)
    foundation.drawTableHudButton(view,decision.kind!=='unavailable',false)
    const expected=[...view.graphics.fillColor.values]
    rows.push({decision:decision.kind,actual,expected})
    assert.equal(hud.lockButton.label.string,decision.kind==='unlock'?'恢复':'锁牌')
    if(decision.kind!=='unavailable')assert.notDeepEqual(actual,expected)
    else assert.deepEqual(actual,expected)
    control.destroy()
  }
  hud.dispose();host.destroy();return rows
}
function responsePolicy(){
  const rules=load(path.join(root,'shared-core/src/lib/rules.ts'))
  const moves=load(path.join(root,'shared-core/src/lib/legalMoves.ts'))
  const {createDeck}=load(path.join(root,'shared-core/src/lib/deck.ts'))
  let enumerationCalls=0,cases=0,subsets=0,seed=25001
  ports[src('core/generated/index.ts')]={canPlay:rules.canPlay,enumerateCandidateMoves:hand=>{enumerationCalls++;return moves.enumerateCandidateMoves(hand)}}
  const {TablePlayActionPolicy}=load(src('ui/TablePlayActionPolicy.ts'))
  for(const level of [2,3,4,5,6,7,8,9,10,'J','Q','K','A'])for(const preset of ['classic','tournament']){
    const deck=createDeck(level),profile=rules.getRuleProfile(preset)
    for(let sample=0;sample<4;sample++){
      const pool=deck.slice(),hand=[]
      for(let n=0;n<8;n++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;hand.push(pool.splice(seed%pool.length,1)[0])}
      if(sample===0){hand.splice(0,2,...deck.filter(c=>c.isRedJoker));const seen=new Set();for(let i=hand.length-1;i>=0;i--){if(seen.has(hand[i].id))hand.splice(i,1);else seen.add(hand[i].id)}}
      const targetCards=sample===0?deck.filter(c=>c.rank===7).slice(0,2):sample===1?deck.filter(c=>c.rank===8).slice(0,4):sample===2?deck.filter(c=>c.suit==='joker'):deck.filter(c=>c.rank===9).slice(0,1)
      const resolution=rules.resolvePlay(targetCards,profile);assert(resolution)
      const last={playerId:'p2',cards:targetCards,type:resolution.type,resolution}
      let possible=false
      for(let mask=1;mask<(1<<hand.length);mask++){
        const cards=hand.filter((_,i)=>mask&(1<<i));if(rules.canPlay(cards,last,profile))possible=true;subsets++
      }
      const policy=new TablePlayActionPolicy(),state={players:{p1:{hand}},lastValidPlay:last,ruleProfile:profile}
      const expected=possible?['hint','pass','play']:['pass']
      assert.deepEqual(policy.resolve(state,'p1'),expected)
      const before=enumerationCalls
      assert.deepEqual(policy.resolve(JSON.parse(JSON.stringify(state)),'p1'),expected)
      assert.equal(enumerationCalls,before,'clock/selection redraws reuse semantic cache')
      assert.deepEqual(policy.resolve({...state,lastValidPlay:null},'p1'),['hint','play'])
      assert.deepEqual(policy.resolve({...state,players:{p1:{hand:[]}}},'p1'),[])
      cases++
    }
  }
  return {cases,subsets,enumerationCalls}
}
function hudInput(){
  let cases=0
  for(const viewport of [{width:1280,height:720},{width:1280,height:589},{width:1565,height:720,safeLeft:32,safeRight:48}]){
    const host=new Node('input'),hud=new TableGameHud();hud.mount(host)
    const buttons=[134.4,134.4,153.6].map((width,i)=>foundation.createTableHudButton(host,'action'+i,'action',0,width,69.6,34).node)
    hud.setTurnActionNodes(buttons);hud.layout(viewport);hud.render({...foundation.freshTableGameHudState(),turnVisible:true})
    const hit=n=>{const r=worldRect(n);return hud.hitTestInteractiveScreenPoint({x:r.left+r.width/2,y:r.bottom+r.height/2})}
    buttons.forEach(n=>assert(hit(n)))
    const a=worldRect(buttons[1]),b=worldRect(buttons[2])
    assert(!hud.hitTestInteractiveScreenPoint({x:(a.left+a.width+b.left)/2,y:a.bottom+a.height/2}),'gap does not mask underlying hand')
    const expanded=h=>{hud.update({counterExpanded:h});const r=worldRect(hud.counterPanel);return r.bottom+r.height}
    near(expanded(false),expanded(true));hud.update({counterExpanded:false})
    const old=hud.counterPanel.position.clone(),handle=hud.counterDragHandle
    handle.emit('start');handle.emit('move',{getUIDelta:()=>({x:-30,y:-20})});handle.emit('end')
    near(hud.counterPanel.position.x,old.x-30);near(hud.counterPanel.position.y,old.y-20)
    near(expanded(false),expanded(true))
    hud.setVisible(false);assert(!hit(buttons[1]));hud.dispose();host.destroy();cases++
  }
  return cases
}
result.responsePolicy=responsePolicy()
result.hudInput=hudInput()
result.passLifetime=passLifetime()
result.seatPermutations=seating()
result.hudLifecycle=hudLifecycle()
result.geometry=geometry()
result.overlapOracle=overlaps()
result.observerReprojection=observerReprojection()
result.lockHighlight=lockHighlight()
result.loadedEngine=loadedEngine
manager.removeAllActions()
process.stdout.write(JSON.stringify(result,null,2)+'\n')
