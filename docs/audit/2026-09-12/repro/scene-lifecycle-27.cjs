// Audit only: real application controllers, source protocol, Cocos 3.8.8 Tween algorithms.
// Synthetic nodes, drawing, socket, bundle, and timer ports. No product, network, or build writes.
'use strict'
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const crypto = require('node:crypto')
const repo = path.resolve(__dirname, '../../../..'), app = path.join(repo, 'work/guandan-cocos')
const src = p => path.join(app, 'assets/scripts', p)
const {loadTs} = require(path.join(app, 'tests/support/load-typescript-module.cjs'))
const ts = require(path.join(app, 'tests/support/typescript.cjs')).loadTypeScript()
const engineSource = fs.readFileSync(path.join(__dirname, 'animation-lifetime-22.cjs'), 'utf8')
const marker = 'const {RuntimeUiFactory}=loadTs('
assert.equal(engineSource.split(marker).length, 2)
const {cc,manager,loadedEngine,warns} = new Function('require','__dirname',engineSource.slice(0,engineSource.indexOf(marker))+'\nreturn {cc,manager,loadedEngine,warns}')(require,__dirname)
const {Node,Vec3,UITransform,UIOpacity,Sprite,SpriteFrame,Graphics,Label} = cc
Node.prototype.setSiblingIndex = function(i) { this.siblingIndex=i }
SpriteFrame.prototype.isValid = true
SpriteFrame.prototype.destroy = function(){this.isValid=false;this.destroyCount=(this.destroyCount||0)+1}
Graphics.prototype.rect = function(...v){this.rectangles ??=[];this.rectangles.push(v)}
ColorWhite()
function ColorWhite(){cc.Color.WHITE = new cc.Color(255,255,255)}
class Events {
  constructor(){this.listeners=new Map()}
  on(e,f,o){this.listeners.set(e,[...(this.listeners.get(e)||[]),{f,o}])}
  off(e,f,o){this.listeners.set(e,(this.listeners.get(e)||[]).filter(v=>v.f!==f||v.o!==o))}
  emit(e,...args){for(const v of [...(this.listeners.get(e)||[])])v.f.apply(v.o,args)}
}
const micro=async()=>{for(let i=0;i<30;i++)await Promise.resolve()}
const step=s=>{for(let i=0;i<Math.ceil(s*120);i++)manager.update(1/120)}
function loadWithGlobals(file,deps,globals={}) {
  const result=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,experimentalDecorators:true}})
  assert.equal((result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0)
  const m={exports:{}}
  new Function('exports','require',...Object.keys(globals),result.outputText)(m.exports,key=>{assert.ok(key in deps,key+' needs explicit port');return deps[key]},...Object.values(globals))
  return m.exports
}
const protocol=loadTs(path.join(repo,'shared-core/src/protocol.ts'))
const duplicateModel=loadTs(src('network/DuplicateRoomModel.ts'))
const models=loadTs(src('network/LobbyModels.ts'),{'./DuplicateRoomModel':duplicateModel})
const {LobbyCommandSender}=loadTs(src('network/LobbyCommandSender.ts'),{'../core/generated/protocol':protocol})
const {LobbyConnectionEventCoordinator}=loadTs(src('network/LobbyConnectionEventCoordinator.ts'))
const {LobbyCleanupTracker}=loadTs(src('network/LobbyCleanupTracker.ts'))
const {TableNetworkEventBridge}=loadTs(src('scenes/TableNetworkEventBridge.ts'))
function cleanup() {
  const tracker=new LobbyCleanupTracker(),tasks=[],pending=new Map();let id=0,observations=0
  const verify=()=>{for(const room of ['A','B','C']){assert.equal(tracker.isCleaning(room),[...pending.values()].includes(room));observations++}}
  for(let i=0;i<120;i++){
    const room=['A','B','C'][i%3]
    tracker.request(room,r=>{assert.equal(r,room);pending.set(++id,r);return id},f=>tasks.push({id,f}))
    verify()
    if(i%3===0){const target=[...pending.keys()][0];assert.equal(tracker.consumeResult(target),true);pending.delete(target);verify()}
    if(i%5===0){const task=tasks.shift();pending.delete(task.id);task.f();task.f();verify()}
  }
  for(const task of tasks){pending.delete(task.id);task.f();verify()}
  assert.equal(tracker.consumeResult(-1),false)
  tracker.request('A',()=>{throw Error('offline')},()=>assert.fail('must not schedule'));verify()
  assert.equal(tracker.requestRooms.size,0)
  return {requests:id,roomObservations:observations}
}
function commands(){
  const types=[...new Set([...protocol.MUTATING_COMMAND_TYPES,'watchTable','fillBots'])]
  let cases=0,allowed=0
  for(const role of ['player','observer'])for(const host of [false,true])for(const seat of [null,'A1'])
    for(const gate of ['normal','no-room','joining','rejoining','ended','starting'])for(const type of types){
      const snapshot={...models.createLobbySnapshot(),roomRole:role,isRoomHost:host,duplicate:seat?{mySeat:seat}:null,roomId:gate==='no-room'?null:'audit-room',roomStatus:['joining','rejoining'].includes(gate)?gate:'ready',matchEnded:gate==='ended'?{}:null,gameStartPending:gate==='starting',gameVersion:9}
      const sent=[],errors=[]
      const sender=new LobbyCommandSender({snapshot:()=>snapshot,client:()=>({send:(...v)=>{sent.push(v);return 41}}),emitResult:v=>errors.push(v),reportError:v=>errors.push(v)})
      const data=Object.freeze({marker:'payload'}),request=sender.roomIntent(type,data)
      const hostAllowed=host&&['startGame','kickMember','addBot','removeBot','fillBots'].includes(type)
      const observerAllowed=['sitDown','standUp','watchPlayer','watchTable'].includes(type)||(seat&&['readyNextRound','cancelRoundReady'].includes(type))
      const expect=gate==='normal'&&(role!=='observer'||hostAllowed||observerAllowed)
      assert.equal(request,expect?41:null);assert.equal(sent.length,expect?1:0)
      if(expect){allowed++;assert.equal(sent[0][1].roomId,'audit-room');assert.equal(sent[0][1].expectedVersion,protocol.VERSIONED_ROOM_COMMAND_TYPES.includes(type)?9:undefined);assert.equal(sent[0][1].marker,'payload')}
      cases++
    }
  return {cases,allowed,versioned:protocol.VERSIONED_ROOM_COMMAND_TYPES}
}
function connections(){
  let connected=0,disconnected=0
  const fixture=(s,values)=>{const calls=[],snapshot={...models.createLobbySnapshot(),...s}
    const coordinator=new LobbyConnectionEventCoordinator({
      snapshot:()=>snapshot,resumeToken:()=>values.token,matchedConnected:()=>values.matched,matchedDisconnected:()=>values.outcome,
      resumePending:()=>values.pending,startResumeWatchdog:()=>calls.push('watchdog'),recordResumeFailure:()=>{calls.push('failure');return values.exhausted},
      beginEntry:(...v)=>{calls.push(['begin',...v]);return values.request},invalidateEntry:()=>calls.push('invalidate'),
      closeForRecovery:()=>calls.push('close'),requestPlatformRecovery:()=>calls.push('recover'),refreshRooms:()=>calls.push('refresh'),
      patch:v=>{calls.push(['patch',v]);Object.assign(snapshot,v)},reportDisconnect:()=>calls.push('error'),
    });return {coordinator,calls,snapshot}}
  for(const matched of [true,false])for(const room of [null,'A'])for(const player of [null,'p2'])for(const token of [null,'token'])for(const request of [null,4]){
    const f=fixture({roomId:room,myPlayerId:player},{matched,token,request});f.coordinator.handleConnected()
    const names=f.calls.map(v=>Array.isArray(v)?v[0]:v),can=room&&player&&token
    assert.deepEqual(names,matched?[]:can?request===null?['patch','begin','close','recover']:['patch','begin']:['patch','refresh'])
    if(!matched){assert.equal(f.snapshot.connected,true);assert.equal(f.snapshot.roomStatus,can?'rejoining':'idle')}
    if(can&&!matched)assert.deepEqual(f.calls[1].slice(1),['rejoinRoom','roomRejoined',room,{roomId:room,myPlayerId:player,resumeToken:token},player])
    connected++
  }
  for(const outcome of ['none','retrying','failed'])for(const room of [null,'A'])for(const token of [null,'token'])for(const pending of [true,false])for(const exhausted of [true,false]){
    const f=fixture({roomId:room},{outcome,token,pending,exhausted});f.coordinator.handleDisconnected()
    const local=outcome==='none'&&room&&token,names=f.calls.map(v=>Array.isArray(v)?v[0]:v)
    const expected=outcome==='failed'?[]:[...(local&&!pending?['watchdog']:[]),...(local?['failure']:[]),...(local&&exhausted?[]:['invalidate','patch','error'])]
    assert.deepEqual(names,expected)
    if(names.includes('patch')){assert.equal(f.snapshot.connected,false);assert.equal(f.snapshot.roomStatus,outcome==='retrying'?'joining':room&&token?'rejoining':'idle')}
    disconnected++
  }
  return {connected,disconnected}
}
function bridges(){
  let delivered=0,lateChecks=0
  const names=['onLobby','onNetworkState','onRoundPrepared','onRoundEnded','onMatchEnded','onNetworkResult','onNetworkError','onRoomClosed','onPresentationChanged','onTurnTimeout']
  for(let i=0;i<100;i++){
    const bus=new Events(),payload={i},handlers=Object.fromEntries(names.map(n=>[n,(...args)=>{if(n!=='onPresentationChanged')assert.equal(args[0],payload);delivered++}]))
    const unrelated=()=>{},bridge=new TableNetworkEventBridge(bus,handlers);bus.on('guandan:lobby',unrelated,null)
    bridge.mount();bridge.mount()
    const retained=[...bus.listeners].flatMap(([event,items])=>items.filter(v=>v.f!==unrelated).map(v=>({event,...v})))
    assert.equal(retained.length,12)
    for(const v of retained)bus.emit(v.event,payload,{compensateReservation:false})
    const before=delivered;bridge.dispose();bridge.dispose();bridge.mount()
    for(const v of retained){v.f.call(v.o,payload);bus.emit(v.event,payload);lateChecks++}
    assert.equal(delivered,before)
    assert.equal([...bus.listeners.values()].flat().length,1)
  }
  return {cycles:100,delivered,lateChecks}
}
const frameStyle=loadTs(src('ui/UiFrameStyle.ts')),metrics=loadTs(src('ui/TableButtonMetrics.ts'))
cc.BlockInputEvents=class {}
const {TableOverlayController}=loadTs(src('scenes/TableOverlayController.ts'),{cc,'../ui/UiFrameStyle':frameStyle,'../ui/TableButtonMetrics':metrics})
const viewport=w=>({width:w,height:720,halfWidth:w/2,halfHeight:360,safeLeft:0,safeRight:0,safeTop:0,safeBottom:0})
const descendants=root=>root.children.flatMap(n=>[n,...descendants(n)])
const find=(root,name)=>descendants(root).find(n=>n.name===name)
function overlayFixture(){
  const root=new Node('root'),events=new Events(),timers=new Map(),sent=[],errors=[]
  const snapshot={...models.createLobbySnapshot(),roomId:'audit-room',roomStatus:'ready',roomRole:'player',dissolveVote:null}
  let mode='ok',controller
  const sender=new LobbyCommandSender({snapshot:()=>snapshot,client:()=>({send:(...v)=>{if(mode==='throw')throw Error('socket disconnected');sent.push(v);return 8}}),emitResult:r=>errors.push(r),reportError:t=>errors.push(t)})
  const lobby={snapshot,events,proposeDissolve:()=>sender.roomIntent('proposeDissolve'),voteDissolve:agree=>sender.roomIntent('dissolveVote',{agree})}
  const ui={
    label:(name,x,y,fontSize)=>{const n=new Node(name);n.parent=root;n.setPosition(x,y);n.addComponent(UITransform);const l=n.addComponent(Label);l.fontSize=fontSize;return l},
    button:(name,text,x,width,height,fontSize)=>{const n=new Node(name);n.parent=root;n.setPosition(x,0);n.addComponent(UITransform).setContentSize(width,height);n.text=text;n.fontSize=fontSize;return n},
  }
  controller=new TableOverlayController({root,ui,lobby,initialViewport:viewport(1280),getHumanId:()=> 'p1',isMultiplayer:()=>true,shouldLeaveImmediately:()=>false,playerName:id=>id,leaveTable:()=>{},schedule:(f,t)=>timers.set(f,t),scheduleOnce:(f,t)=>timers.set(f,t),unschedule:f=>timers.delete(f)})
  const vote={initiator:'p2',expiresAt:Date.now()+60_000,votes:{p1:'pending',p2:'agree',p3:'pending',p4:'pending'}}
  const publish=()=>{snapshot.dissolveVote=vote;events.emit('guandan:dissolve-vote',{vote,outcome:null})}
  return {root,events,timers,snapshot,sent,errors,controller,publish,vote,setMode:v=>mode=v}
}
function overlays(){
  const geometry=[]
  for(const kind of ['exit','notice','vote'])for(const width of [1565,1792]){
    const f=overlayFixture()
    if(kind==='exit')f.controller.requestLeave();else if(kind==='notice')f.controller.showNotice('notice');else f.publish()
    const name={exit:'ExitTableDialog',notice:'DevelopmentDialog',vote:'DissolveVoteDialog'}[kind],shade=find(f.root,name)
    assert.deepEqual(shade.getComponent(UITransform).contentSize,{width:1280,height:720})
    f.controller.resize(viewport(width))
    assert.equal(shade.getComponent(UITransform).contentSize.width,1280)
    assert.deepEqual(shade.getComponent(Graphics).rectangles[0],[-640,-360,1280,720])
    assert.equal(f.controller.blocksHandInput,true,'hand guard remains active despite stale physical shade')
    geometry.push({kind,width,shadeWidth:1280,uncoveredWidth:width-1280})
    f.controller.clearDialogs()
    if(kind==='exit')f.controller.requestLeave();else if(kind==='notice')f.controller.showNotice('notice');else f.publish()
    assert.equal(find(f.root,name).getComponent(UITransform).contentSize.width,width,'reopen repairs geometry')
    f.controller.dispose()
  }
  const voteFailures=[]
  for(const mode of ['throw','rejoining'])for(const agree of [false,true]){
    const f=overlayFixture();f.publish();const held=find(f.root,agree?'DissolveAgree':'DissolveRefuse')
    if(mode==='throw')f.setMode(mode);else f.snapshot.roomStatus=mode
    held.emit(Node.EventType.TOUCH_END)
    assert.equal(f.sent.length,0);assert.equal(f.snapshot.dissolveVote.votes.p1,'pending')
    assert.equal(find(f.root,'DissolveVoteDialog'),undefined);assert.equal(f.controller.blocksHandInput,false)
    for(const cb of [...f.timers.keys()])cb()
    f.snapshot.roomStatus='ready';f.setMode('ok')
    f.events.emit('guandan:lobby',f.snapshot)
    assert.equal(find(f.root,'DissolveVoteDialog'),undefined,'network/lobby refresh alone does not recreate the pending vote')
    voteFailures.push({mode,agree,pending:'pending',dialogPresent:false,clientErrors:f.errors.length})
    f.publish();assert.ok(find(f.root,'DissolveVoteDialog'),'fresh vote message can recover; not permanent')
    find(f.root,agree?'DissolveAgree':'DissolveRefuse').emit(Node.EventType.TOUCH_END)
    assert.equal(f.sent.length,1);assert.equal(f.sent[0][0],'dissolveVote');assert.equal(f.sent[0][1].agree,agree)
    f.controller.dispose()
  }
  let toastCases=0
  for(const at of [.04,.1,.19,.4,1.6]){
    manager.removeAllActions();const f=overlayFixture();f.controller.showToast('first');step(at)
    if(at===1.6){const hide=[...f.timers].find(([,seconds])=>seconds===1.6)[0];hide();step(.08)}
    f.controller.showToast('replacement');step(.4)
    const toast=find(f.root,'FinishToast');assert.equal(toast.active,true);assert.equal(toast.getComponent(Label).string,'replacement');assert.equal(toast.getComponent(UIOpacity).opacity,255)
    const retained=[...f.timers.keys()];f.controller.dispose();retained.forEach(cb=>cb());step(2)
    assert.equal(f.root.children.length,0);assert.equal(f.timers.size,0);toastCases++
  }
  return {geometry,voteFailures,toastCases}
}
async function backdrops(){
  const results=[]
  for(const failure of ['callback-error','timeout']){
    manager.removeAllActions()
    const timers=new Map(),requests=[],warnings=[]
    let timerId=0
    const bundle={load:(p,t,cb)=>requests.push({p,cb})},assets=loadWithGlobals(src('services/GameAssetLoader.ts'),{cc:{assetManager:{getBundle:()=>bundle}}},{setTimeout:(f,ms)=>{timers.set(++timerId,{f,ms});return timerId},clearTimeout:id=>timers.delete(id)})
    const {SceneBackdropController,SCENE_BACKDROP_ASSETS}=loadWithGlobals(src('scenes/SceneBackdropController.ts'),{cc,'../services/GameAssetLoader':assets},{console:{warn:(...v)=>warnings.push(v)}})
    const root=new Node('root'),controller=new SceneBackdropController(root,()=>viewport(1280))
    const lobbyTexture={width:1600,height:719,isValid:true},tableTexture={width:1280,height:720,isValid:true}
    const primed=controller.preload('lobby');await micro();requests.find(r=>r.p===SCENE_BACKDROP_ASSETS.lobby.path).cb(null,lobbyTexture);await primed
    controller.mount();await micro()
    const tableRequest=requests.find(r=>r.p===SCENE_BACKDROP_ASSETS.table.path)
    if(failure==='callback-error')tableRequest.cb(Error('synthetic transient failure'),null)
    else {assert.equal(timers.size,1);const watchdog=[...timers.values()][0];assert.equal(watchdog.ms,15000);watchdog.f()}
    await micro();step(.3)
    const sprite=root.children[0].getComponent(Sprite);assert.equal(sprite.spriteFrame.texture,lobbyTexture)
    assert.equal(controller.pendingLoads.size,0);assert.equal(warnings.length,1)
    tableRequest.cb(null,tableTexture);await micro()
    for(let i=0;i<5;i++){controller.setMode('table');step(.4);controller.resize(viewport(1565));controller.setMode('lobby');step(.4)}
    controller.setMode('table');step(.4)
    assert.equal(requests.length,2);assert.equal(sprite.spriteFrame.texture,lobbyTexture)
    const failed={failure,requestsAfterFiveEntries:requests.length,displayed:'lobby'}
    const retry=controller.preload('table');await micro();assert.equal(requests.length,3);requests.at(-1).cb(null,tableTexture);await retry;step(.4)
    assert.equal(sprite.spriteFrame.texture,tableTexture,'explicit preload is a recovery control')
    const frames=[...controller.frames.values()];controller.dispose();assert.ok(frames.every(f=>f.destroyCount===1))
    results.push({...failed,explicitPreloadRecovers:true})
  }
  // Real Tween mode switching and disposal controls with both frames preloaded.
  let transitions=0
  for(const delay of [0,.03,.11,.25]){
    manager.removeAllActions();const warnings=[],textures={lobby:{width:1600,height:719},table:{width:1280,height:720}}
    const {SceneBackdropController}=loadWithGlobals(src('scenes/SceneBackdropController.ts'),{cc,'../services/GameAssetLoader':{loadGameAssetAsync:p=>Promise.resolve(p.includes('lobby')?textures.lobby:textures.table)}},{console:{warn:(...v)=>warnings.push(v)}})
    const root=new Node('root'),c=new SceneBackdropController(root,()=>viewport(1280));c.mount();await micro();step(.4)
    c.setMode('table');step(delay);c.setMode('lobby');step(.6)
    assert.equal(root.children[0].getComponent(Sprite).spriteFrame.texture,textures.lobby)
    c.setMode('table');step(delay);c.dispose();step(.6);assert.equal(root.children.length,0);assert.equal(warnings.length,0);transitions++
  }
  return {failures:results,transitionControls:transitions}
}
function presentations(){
  const dep=loadTs(src('scenes/DuplicateTablePresentation.ts'))
  const ended=loadTs(src('scenes/MatchEndedPresentation.ts'),{'./DuplicateTablePresentation':dep})
  const settlement=loadTs(src('scenes/SettlementPresentation.ts'),{'./MatchEndedPresentation':ended})
  let endCases=0,settlementCases=0
  for(const viewer of ['p1','p2','p3','p4'])for(const winner of ['teamA','teamB',null])for(const reason of ['passed-a','single-round','fixed-rounds','time-limit']){
    const r=ended.projectMatchEndedPresentation({reason,winnerTeam:winner,roundsPlayed:4,configuredRounds:4,scores:{teamA:6,teamB:3}},viewer)
    assert.ok(r.title.length>0&&r.detail.includes(viewer==='p1'||viewer==='p3'?'我方 6 · 对方 3':'我方 3 · 对方 6'))
    endCases++
  }
  for(const sameTeam of [['p1','p3'],['p1','p2'],['p1','p4']])for(const viewer of ['p1','p2','p3','p4'])for(const format of ['independent','rotating','upgrade'])for(const terminal of [false,true]){
    const players=Object.fromEntries(['p1','p2','p3','p4'].map(id=>[id,{name:id,team:sameTeam.includes(id)?'teamA':'teamB'}]))
    const snapshot={state:{players,currentLevel:7,matchFormat:{rotatingScoring:6}},settlement:{format,winnerTeam:'teamA',levelUp:3,pointsEarned:3,isGameWon:terminal,fullRank:['p1','p2','p3','p4'],playerPoints:{p1:6,p2:6,p3:0,p4:0},playerScores:{p1:12,p2:12,p3:0,p4:0}}}
    const r=settlement.projectSettlementContent(snapshot,viewer,null,true,['p1','p1','p2','bad'])
    assert.equal(r.players.filter(p=>p.team==='我').length,1);assert.equal(r.players.filter(p=>p.team==='队友').length,1);assert.equal(r.players.filter(p=>p.team==='对手').length,2)
    if(terminal)assert.ok(r.players.every(p=>p.ready.endsWith('本局完成')))
    else assert.ok(r.footer.endsWith('下一局准备 2/4'))
    if(format!=='upgrade')assert.ok(r.footer.includes('不升级、不进贡'))
    settlementCases++
  }
  return {endCases,settlementCases}
}
;(async()=>{
  const result={cleanup:cleanup(),commands:commands(),connections:connections(),bridge:bridges(),overlays:overlays(),backdrops:await backdrops(),presentations:presentations()}
  assert.deepEqual(warns,[])
  const engineBase='/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/resources/3d/engine/cocos'
  result.engineReadBoundary=['ui/block-input-events.ts','scene-graph/node-event-processor.ts','2d/framework/ui-transform.ts'].map(p=>({path:path.join(engineBase,p),sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(engineBase,p))).digest('hex'),scope:p.includes('block-input')?'full source read, contract checked':'hitTest/dispatch excerpts checked; not full-file review'}))
  result.loadedTweenEngine=loadedEngine
  console.log(JSON.stringify(result,null,2))
})().catch(e=>{console.error(e);process.exitCode=1})
