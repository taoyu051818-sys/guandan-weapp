// Audit only: remaining UI source + installed Cocos Tween algorithms.
// Real rendering owners; synthetic nodes, drawing, asset, API, and scheduler ports.
'use strict'
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const repo=path.resolve(__dirname,'../../../..'),app=path.join(repo,'work/guandan-cocos'),src=p=>path.join(app,'assets/scripts',p)
const {loadTs}=require(path.join(app,'tests/support/load-typescript-module.cjs'))
const ts=require(path.join(app,'tests/support/typescript.cjs')).loadTypeScript()
const old=fs.readFileSync(path.join(__dirname,'animation-lifetime-22.cjs'),'utf8'),marker='const {RuntimeUiFactory}=loadTs('
assert.equal(old.split(marker).length,2)
const {cc,manager,loadedEngine,warns}=new Function('require','__dirname',old.slice(0,old.indexOf(marker))+'\nreturn {cc,manager,loadedEngine,warns}')(require,__dirname)
const {Node,Vec3,UITransform,Component,Sprite,Label,Graphics}=cc
Node.EventType.NODE_DESTROYED='destroyed'
Node.prototype.setScale=function(v,y,z){this.scale=typeof v==='number'?new Vec3(v,y,z):v.clone()}
Node.prototype.setSiblingIndex=function(i){this.siblingIndex=i}
Node.prototype.getChildByName=function(name){return this.children.find(n=>n.name===name)||null}
Node.prototype.pauseSystemEvents=function(){this.paused=true}
Node.prototype.resumeSystemEvents=function(){this.paused=false}
Object.defineProperty(Node.prototype,'worldPosition',{get(){const p=this.parent?.worldPosition||Vec3.ZERO;return new Vec3(this.position.x+p.x,this.position.y+p.y,this.position.z+p.z)}})
Node.prototype.getComponentInChildren=function(T){return this.getComponent(T)||this.children.map(c=>c.getComponentInChildren(T)).find(Boolean)||null}
Component.prototype.getComponent=function(T){return this.node.getComponent(T)}
Component.prototype.addComponent=function(T){return this.node.addComponent(T)}
Component.prototype.scheduleOnce=function(f,s){this.scheduled ??=[];this.scheduled.push({f,s})}
class Frame {constructor(){this.isValid=true;this.destroyCount=0}reset(v){Object.assign(this,v)}destroy(){this.isValid=false;this.destroyCount++}}
cc.SpriteFrame=Frame
cc.Rect=class {constructor(x,y,width,height){Object.assign(this,{x,y,width,height})}}
cc.Size=class {constructor(width,height){Object.assign(this,{width,height})}}
cc.BlockInputEvents=class {}
cc.Color.WHITE=new cc.Color(255,255,255)
Label.HorizontalAlign.LEFT=0
for(const m of ['moveTo','lineTo','circle','ellipse','arc'])Graphics.prototype[m]=function(){}
Graphics.prototype.rect=function(...v){this.rects ??=[];this.rects.push(v)}
const step=s=>{for(let i=0;i<Math.ceil(s*120);i++)manager.update(1/120)}
const micro=async()=>{for(let i=0;i<40;i++)await Promise.resolve()}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
const find=(root,name)=>all(root).find(n=>n.name===name)
const all=root=>root.children.flatMap(n=>[n,...all(n)])
const strings=root=>all(root).map(n=>n.getComponent(Label)).filter(Boolean).map(l=>l.string)
const frameStyle=loadTs(src('ui/UiFrameStyle.ts'))
const warnings=[],requests=[],timers=new Map();let timerId=0
function load(file,deps,globals={}){
  const m={exports:{}},r=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,experimentalDecorators:true},reportDiagnostics:true})
  assert.equal((r.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0)
  new Function('exports','require',...Object.keys(globals),r.outputText)(m.exports,k=>{assert.ok(k in deps,k+' needs explicit port');return deps[k]},...Object.values(globals))
  return m.exports
}
const assetLoader=load(src('services/GameAssetLoader.ts'),{cc:{assetManager:{getBundle:()=>({load:(p,t,cb)=>requests.push({p,cb})})}}},{setTimeout:(f,ms)=>{timers.set(++timerId,{f,ms});return timerId},clearTimeout:id=>timers.delete(id)})
const runtime=loadTs(src('ui/RuntimeUiFactory.ts'),{cc,'./UiFrameStyle':frameStyle,'../services/GameAssetLoader':assetLoader})
const coastal=loadTs(src('ui/CoastalUi.ts'),{cc})
const layout=loadTs(src('ui/LobbyLayoutPolicy.ts'))
const menu=load(src('ui/LobbyMenuView.ts'),{cc,'../services/GameAssetLoader':assetLoader,'./LobbyLayoutPolicy':layout},{console:{warn:(...v)=>warnings.push(v)}})
const loading=loadTs(src('ui/StartupLoadingOverlay.ts'),{cc,'./UiFrameStyle':frameStyle,'./RuntimeUiFactory':runtime})
const {PlayerSeatController}=loadTs(src('ui/PlayerSeatController.ts'),{cc,'./UiFrameStyle':frameStyle,'./RuntimeUiFactory':runtime})
const {TableSettlementView}=loadTs(src('ui/TableSettlementView.ts'),{cc,'./RuntimeUiFactory':runtime,'./CoastalUi':coastal})
const vp=(width=1280,height=720,left=0,right=0,top=0,bottom=0)=>({width,height,halfWidth:width/2,halfHeight:height/2,safeLeft:left,safeRight:right,safeTop:top,safeBottom:bottom})
function geometry(){
  let cases=0
  for(const width of [874,960,1280,1565,1792])for(const height of [402,589,720,960])for(const leftInset of [0,24,55])for(const rightInset of [0,44]){
    const f=Object.freeze({width:width-leftInset-rightInset,height:height-24,left:-width/2+leftInset,right:width/2-rightInset,top:height/2-8,bottom:-height/2+16})
    const r=layout.resolveLobbyLayout(f)
    for(const k of ['classic','friend','tournament','quick','account','shop']){
      const box=r[k],eps=1e-7
      assert.ok(box.x-box.width/2>=f.left-eps&&box.x+box.width/2<=f.right+eps)
      assert.ok(box.y-box.height/2<=f.top+eps&&box.y-box.height/2>=f.bottom-eps)
      assert.ok(Math.abs(box.width/box.height-layout.LOBBY_DESIGN[k].width/layout.LOBBY_DESIGN[k].height)<1e-12)
    }
    assert.ok(r.classic.x+r.classic.width/2<r.friend.x-r.friend.width/2)
    cases++
  }
  return cases
}
async function artwork(){
  let frames=0,slices=0,cycles=0,minCropCoordinate=0
  for(const fade of [undefined,layout.LOBBY_DESIGN.shopFadeStart])for(const scale of [.5,1,1.8])for(const ratio of [.74,1])for(const texture of [{width:600,height:800},{width:512,height:512},{width:1280,height:720}]){
    const root=new Node('root'),before=requests.length,r={x:4,y:9,width:70*scale,height:70*scale}
    const art=menu.lobbyArtwork(root,'art','synthetic',r,ratio,fade);await micro();assert.equal(requests.length,before+1);requests.at(-1).cb(null,texture)
    const pieces=art.children,expected=fade===undefined?1:25;assert.equal(pieces.length,expected)
    let sum=0,last=Infinity,frameList=[]
    for(const n of pieces){const sprite=n.getComponent(Sprite),f=sprite.spriteFrame,t=n.getComponent(UITransform).contentSize;frameList.push(f)
      minCropCoordinate=Math.min(minCropCoordinate,f.rect.x,f.rect.y)
      assert.equal(f.texture,texture);assert.equal(f.packable,false);assert.ok(f.rect.x>=-1e-7&&f.rect.y>=-1e-7,JSON.stringify(f.rect))
      assert.ok(f.rect.x+f.rect.width<=texture.width+1e-7&&f.rect.y+f.rect.height<=texture.height*ratio+1e-7)
      assert.ok(Math.abs(f.rect.width/f.rect.height-t.width/t.height)<1e-6)
      const alpha=sprite.color.values[3];assert.ok(alpha<=last);last=alpha;sum+=t.height
    }
    assert.ok(Math.abs(sum-r.height)<1e-7);root.destroy();assert.ok(frameList.every(f=>f.destroyCount===1))
    assert.equal(root.children.length,0);frames+=expected;slices+=expected;cycles++
  }
  let late=0
  for(let i=0;i<40;i++){const root=new Node('root'),art=menu.lobbyArtwork(root,'late','synthetic',{x:0,y:0,width:70,height:70});await micro();const req=requests.at(-1);root.destroy();req.cb(null,{width:512,height:512});assert.equal(art.children.length,0);late++}
  assert.equal(timers.size,0)
  return {cycles,slices,freedFrames:frames,lateCompletions:late,cancelWarnings:warnings.length,minCropCoordinate}
}
async function startup(){
  let overlayCases=0,coordinatorCases=0
  for(const texture of [null,{width:1280,height:590}])for(const viewport of [vp(),vp(1565,720,55,80,8,30),vp(874,402,24,44,0,16)]){
    manager.removeAllActions();const root=new Node('root'),o=new loading.StartupLoadingOverlay(root,texture,1280,590);o.resize(viewport)
    assert.deepEqual(o.node.getComponent(UITransform).contentSize,{width:viewport.width,height:viewport.height})
    const art=find(o.node,'LoadingArtwork').getComponent(UITransform).contentSize
    assert.ok(art.width>=viewport.width-1e-8&&art.height>=viewport.height-1e-8)
    for(const progress of [-1,0,.001,.5,1,2,NaN,Infinity]){
      o.setProgress(progress,'stage');const p=Number.isFinite(progress)?Math.max(0,Math.min(1,progress)):0
      assert.equal(find(o.node,'LoadingPercent').getComponent(Label).string,Math.round(p*100)+'%')
    }
    for(const code of ['GD-S01','GD-S02','GD-S03','GD-S04']){
      let retry=0;o.showError('error',()=>retry++,code);const button=find(o.node,'RetryButton')
      assert.equal(button.active,true);const text=find(o.node,'RetryLabel').getComponent(Label).string
      assert.equal(text,code==='GD-S01'||code==='GD-S02'?'重试加载':'重新进入')
      for(let i=0;i<8;i++)button.emit(Node.EventType.TOUCH_END)
      assert.equal(retry,1);assert.equal(button.active,false)
    }
    const promise=o.fadeOut();assert.equal(o.fadeOut(),promise);step(.1);o.dispose();await promise;step(.6)
    assert.equal(root.children.length,0);o.setProgress(.3,'late');o.showError('late',()=>assert.fail('disposed retry'),'GD-S01')
    overlayCases++
  }
  for(const failedStage of ['none','bundle','background','cards','initialize']){
    manager.removeAllActions();const root=new Node('root'),bundles=[],backgrounds=[],cards=[],errors=[]
    let initialized=0,ready=0,restarts=0
    const {StartupCoordinator}=load(src('scenes/StartupCoordinator.ts'),{
      cc:{game:{restart:()=>{restarts++;return restarts===1?Promise.reject(Error('synthetic restart failure')):Promise.resolve()}}},
      '../services/GameAssetLoader':{ensureGameAssetBundle:()=>{const d=deferred();bundles.push(d);return d.promise}},
      '../ui/ClassicCardFrameStore':{preloadAllClassicCardFrames:()=>{const d=deferred();cards.push(d);return d.promise}},
      '../ui/StartupLoadingOverlay':loading,
    },{console:{error:(...v)=>errors.push(v)}})
    const c=new StartupCoordinator({sceneRoot:root,startupTexture:null,initialViewport:vp(),backdrop:{preload:()=>{const d=deferred();backgrounds.push(d);return d.promise}},
      initializeApplication:()=>{initialized++;if(failedStage==='initialize')throw Error('initialize')},resizeApplication:()=>{},onReady:()=>ready++})
    c.begin();c.begin();assert.equal(bundles.length,1);c.markSceneStarted()
    if(failedStage==='bundle'){bundles[0].reject(Error('bundle'));await micro()}
    else {bundles[0].resolve({});await micro();if(failedStage==='background'){backgrounds[0].reject(Error('art'));cards[0].resolve(true)}
      else {backgrounds[0].resolve();cards[0].resolve(failedStage!=='cards')}await micro()}
    if(['bundle','background','cards'].includes(failedStage)){
      assert.ok(strings(root).some(t=>t?.includes(failedStage==='bundle'?'GD-S01':'GD-S02')));assert.equal(initialized,0)
      const button=find(root,'RetryButton');button.emit(Node.EventType.TOUCH_END);button.emit(Node.EventType.TOUCH_END);assert.equal(bundles.length,2)
      bundles[1].resolve({});await micro();backgrounds.at(-1).resolve();cards.at(-1).resolve(true);await micro()
    }
    if(failedStage==='initialize'){
      assert.equal(initialized,1);assert.equal(ready,0);find(root,'RetryButton').emit(Node.EventType.TOUCH_END);await micro()
      assert.ok(strings(root).some(t=>t?.includes('GD-S04')));find(root,'RetryButton').emit(Node.EventType.TOUCH_END);await micro();assert.equal(restarts,2);assert.equal(initialized,1)
    }else {assert.equal(initialized,1);assert.equal(ready,1);step(.5);await micro();assert.equal(root.children.length,0)}
    c.dispose();c.begin();c.markSceneStarted();step(.4);coordinatorCases++
  }
  // A late bundle callback after disposal cannot construct the application.
  const late=deferred(),root=new Node('root')
  const {StartupCoordinator}=loadTs(src('scenes/StartupCoordinator.ts'),{cc:{game:{}},'../services/GameAssetLoader':{ensureGameAssetBundle:()=>late.promise},'../ui/ClassicCardFrameStore':{preloadAllClassicCardFrames:()=>assert.fail('late cards')},'../ui/StartupLoadingOverlay':loading})
  const c=new StartupCoordinator({sceneRoot:root,startupTexture:null,initialViewport:vp(),backdrop:{preload:()=>assert.fail('late art')},initializeApplication:()=>assert.fail('late init'),resizeApplication:()=>{},onReady:()=>assert.fail('late ready')})
  c.begin();c.dispose();late.resolve({});await micro();assert.equal(root.children.length,0);coordinatorCases++
  return {overlayCases,coordinatorCases}
}
function seats(){
  let cases=0
  for(const team of ['teamA','teamB'])for(const viewer of ['teamA','teamB'])for(const n of [27,11,10,2,1,0])for(const place of [0,1,2,3,4]){
    manager.removeAllActions();const root=new Node('root'),c=root.addComponent(PlayerSeatController);c.onLoad()
    const player={name:'audit',team,hand:Array(n).fill({id:'x'})}
    c.render(player,false,viewer,false,place);const text=find(root,'SeatText').getComponent(Label).string
    assert.ok(text.includes(team===viewer?'我方':'对方'))
    if(place)assert.ok(text.endsWith(['头游','二游','三游','末游'][place-1]))
    else if(n<=10)assert.ok(text.includes('剩余 '+n+' 张'));else assert.ok(!text.includes('剩余'))
    c.render(player,true,viewer);step(.2);assert.ok(root.scale.x>1);c.render(player,false,viewer);step(.8);assert.equal(root.scale.x,1)
    c.setOffline(true);assert.equal(find(root,'ConnectionStatus').active,true)
    c.setOffline(false);const old=c.scheduled.at(-1);assert.equal(old.s,1.5)
    c.setOffline(true);old.f();assert.equal(find(root,'ConnectionStatus').active,true,'old recovery cannot hide new offline')
    c.setOffline(false);c.clearConnectionStatus();c.scheduled.at(-1).f();assert.equal(find(root,'ConnectionStatus').active,false)
    const origin=c.getPlayOriginWorldPosition();assert.notEqual(origin,root.worldPosition)
    manager.removeAllActions();root.destroy();cases++
  }
  return cases
}
function settlements(){
  let cases=0,stable=0
  for(const width of [500,608,760,1200])for(const multiline of [false,true]){
    const root=new Node('root'),overlay=new Node('Overlay');overlay.parent=root;overlay.addComponent(UITransform).setContentSize(width,480)
    const label=overlay.addComponent(Label),view=new TableSettlementView()
    const content={title:'本局结束',summary:'本次结果',footer:'下一局准备 2/4',players:['p1','p2','p3','p4'].map((name,i)=>({name:i===2?'长昵称快乐掼蛋牌友测试🌊':name,team:i===0?'我':i===2?'队友':'对手',ready:multiline?'本轮得 3 分\n本局完成':'已准备'}))}
    view.render(label,content);const first=find(root,'SettlementSurface'),count=all(root).length
    for(let i=0;i<20;i++){view.render(label,{...content,players:content.players.map(v=>({...v}))});assert.equal(find(root,'SettlementSurface'),first);assert.equal(all(root).length,count);stable++}
    assert.equal(first.scale.x,Math.min(1,width/760));assert.equal(label.string,'')
    assert.equal(all(root).filter(n=>n.name.startsWith('SettlementRank-')).length,4)
    assert.ok(strings(root).some(t=>t.endsWith('…')))
    view.render(label,{...content,footer:'下一局准备 3/4'});assert.equal(first.active,false);assert.equal(first.isValid,false);assert.equal(all(root).length,count)
    view.clear();view.clear();assert.equal(overlay.children.length,0);root.destroy();cases++
  }
  return {cases,stableRenders:stable}
}
async function tournament(){
  manager.removeAllActions()
  const tournamentModel=loadTs(src('scenes/front-pages/TournamentCenterModel.ts')),tournamentViews=[],apiCalls=[]
  let enrolled=false
  const router={current:'menu',open(route){this.current=route;return {}}}
  const {TournamentCenterController}=loadTs(src('scenes/front-pages/TournamentCenterController.ts'),{
    './TournamentCenterModel':tournamentModel,'./TournamentCenterView':{renderTournamentCenter:(_ui,_vp,view,actions)=>tournamentViews.push({view:structuredClone(view),actions})},
  })
  const tournament={id:'audit-cup',format:'fixed16-latin-3',capacity:16,roundsTotal:3,entryPoints:0,status:'open',enrolled:false}
  const tournamentState=()=>({phase:'check-in',capacity:16,checkedInCount:0,roundNumber:1,roundsTotal:3,viewerEntry:{enrolled,checkedIn:false,rosterLocked:false}})
  const ctrl=new TournamentCenterController({router,gateways:{configured:true,tournaments:{listTournaments:async()=>{apiCalls.push('list');return [tournament]},getState:async()=>tournamentState(),getStandings:async()=>null,enroll:async(id,points)=>{assert.equal(id,'audit-cup');assert.equal(points,0);enrolled=true;apiCalls.push('enroll')}}},screen:{viewport:vp()},isDisposed:()=>false,scheduleOnce:()=>{},setTableVisible:()=>{},showMenu:()=>{},enter:()=>assert.fail('not enrolled yet')})
  const modes=loadTs(path.join(repo,'shared-core/src/lib/classicModes.ts'))
  const catalog=loadTs(src('scenes/front-pages/LobbyPageCatalog.ts'),{cc,'../../core/generated/lib/classicModes':modes})
  const deps={cc,'../../ui/LobbyLayoutPolicy':layout,'../../ui/LobbyMenuView':menu,'../../ui/LobbyAmbientMotion':{attachLobbyAmbientMotion:()=>{}},'./LobbyPageCatalog':catalog,'../../core/generated/lib/classicModes':modes}
  for(const key of ['./FriendRoomSettingsPresenter','./FriendRoomPlatformFlow','./FriendRoomWaitingPresenter','../../services/WechatFriendInvite','./LobbyPlayerProfilePresenter'])deps[key]={}
  const {LobbyPageDomain}=loadTs(src('scenes/front-pages/LobbyPageDomain.ts'),deps)
  const root=new Node('menu'),ui=new runtime.RuntimeUiFactory(root),domain=Object.create(LobbyPageDomain.prototype)
  domain.dependencies={router:{current:'menu',open:()=>ui},screen:{safeSize:()=>({x:1280,y:720}),safeLeftX:m=>-640+m,safeRightX:m=>640-m,safeTopY:m=>360-m,safeBottomY:m=>-360+m},currentPageRequest:()=>0,lobby:{snapshot:{recoveryAvailable:false}},showCompetition:()=>ctrl.open(),showShop:()=>{},gateways:{configured:true}}
  domain.playerProfilePresenter={render:()=>{}};domain.reflowing=true;domain.ambientClock={elapsed:0};domain.recoveryPending=false
  domain.renderMenu();await micro();step(.4)
  const card=find(root,'TournamentEntryCard');assert.ok(strings(card).includes('筹备中'))
  card.emit(Node.EventType.TOUCH_END);step(.3);await micro()
  assert.equal(router.current,'tournament-center')
  const action=tournamentModel.tournamentAction(tournamentViews.at(-1).view);assert.equal(action.label,'免费报名')
  tournamentViews.at(-1).actions.action();await micro();assert.ok(apiCalls.includes('enroll'))
  assert.equal(tournamentModel.tournamentAction(tournamentViews.at(-1).view).label,'确认检录')
  // All local artwork requests must settle or cancel before probe exits.
  root.destroy();for(const req of requests)req.cb(null,{width:600,height:800});await micro();assert.equal(timers.size,0);ctrl.destroy()
  return {menuLabel:'筹备中',destination:router.current,availableAction:action.label,afterEnrollment:'确认检录',source:'valid synthetic free fixed16 response; no production API or GPU'}
}
;(async()=>{const result={geometryCases:geometry(),artwork:await artwork(),startup:await startup(),seats:seats(),settlements:settlements(),tournament:await tournament()};assert.deepEqual(warns,[]);result.loadedEngine=loadedEngine;console.log(JSON.stringify(result,null,2))})().catch(e=>{console.error(e);process.exitCode=1})
