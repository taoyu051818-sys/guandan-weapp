# client-input-05 — 客户端输入与桌面状态集成审计

审查人：audit_client_state；HEAD：`1d58999dc6e5455b049e1643660bbba3deee1406`。

结论：完整审阅 **4 个文件、869 行**；确认 **1 项 P3**，是上一批 CH-04-C01 的证据闭合升级，不新增第二个同根因问题。无新增独立待验证候选。仅写本批 MD/JSON，未修改产品、构建、推送、线上或全库清单。

## 范围与基线

开始前完整重读 README、STATUS；coverage 为 128/629，四目标均 pending。HEAD 与原有五处 dirty 未变：`shared-core/tests/rules-regression.cjs`，以及 Cocos 的 `GameScene.ts`、`TablePhasePresenter.ts`、`RELEASE_ACCEPTANCE_20260910.md`、`table-phase-presenter-regression.cjs`。目标在审阅开始记录 SHA-256，结束重新核对，详见同名 JSON。

| 完整审阅文件（相对 work/guandan-cocos/assets/scripts/） | 行数 | 要点 |
| --- | ---: | --- |
| ui/HandController.ts | 270 | 输入订阅/解绑、真实点按/长按/滑选、手牌重绑、目标布尔值、取消、动画完成屏障 |
| scenes/TableHandInteractionController.ts | 249 | live settings/阶段权限、锁整选与混选、贡还单选、提示/理牌/恢复、出牌重复校验 |
| scenes/TableMatchCoordinator.ts | 313 | 事件桥、权威状态与手牌呈现、同局预选/跨阶段、恢复/关闭/托管/观战、生命周期 |
| scenes/TableMatchPorts.ts | 37 | 依赖能力范围与所有权、手牌/状态/呈现接口接线 |

辅助核验 GameScene、CardView、NetworkMatchSnapshotController、HandInteractionPolicy、TableNetworkEventBridge、TeammateHandProjector、server lifecycle/action executor/turn clock 和既有测试等，不计额外完整覆盖。此前已审手牌状态文件亦不重复计数。CS-01-001 权威桌身份问题及 CN-02-C01 旧消息边界不重复登记。

主审再次完整读取 UI/UX 技能并在 commentary 告知，再执行 `python3 /Users/mac/.codex/skills/ui-ux-pro-max/scripts/search.py "dragging movements cancellation" --domain ux`。命中单指非拖动替代建议；这里只据其检查已存在的点按和取消，结合仓库契约审计，不机械套网页 WCAG、不重设计或修改美术。

## CI-05-001 / P3：权威清理选择后，未取消的旧触点可重新选牌

主位置：`work/guandan-cocos/assets/scripts/ui/HandController.ts:120`（120–123 行）。升级来源：`CH-04-C01`。

### 触发与证据

1. 正常出牌阶段，真人尚未托管、无本地 actionPending；p1 领出，有 a、c、b 三张牌，b 最小。p1 已预选 c，然后手指按下未选中的存活牌 a，但尚未松手。
2. 真人第一次期限到达。真实 `weapp-match-lifecycle.js:322–342` 只把连续超时从 0 加至 1（默认第 2 次才托管），且领出时自动出最后的最小牌 b。真实动作执行器提交/发布新状态，轮到 p2。
3. 真实客户端事件桥→`TableMatchCoordinator.applyNetworkState` 159–169 行→GameManager/NetworkMatchSnapshotController 接受状态。后者 124–131 行因为自己的回合离开和手牌改变而清空原预选 c。
4. `TableMatchCoordinator.render` 78–85 行继续向 HandController 提交 `interactive=true`：当前规则允许正常出牌阶段非本回合预选，首次超时也未托管。HandController 118–123 行覆盖选择，但只有 `!interactive` 才取消 gesture 和长按，没有消费上述“选择事务失效”的信息。
5. a 的 CardView 没被移除；旧 TOUCH_END 经 `HandController` 211–214 行、`HandDragSelectionPolicy.end` 80–86 行将旧 start 的目标布尔值送回 `applySelectionTarget` 264–268 行。`TableHandInteractionController` 86–103 行在新状态下允许本地预选；a 又进入 GameManager.selectedCardIds。

同一合法手牌更新通过 incremental 和 recovery 入口均复现。Recovery 的 `TableMatchCoordinator` 165–167 行只重建效果基线并 invalidates workspace，并未取消旧手势。该额外对照不是声称某次实际网络重连已现场发生。

### 为何不是正常预选保护

仓库现有契约 `docs/profile-preselection-polish-20260907.md:10–11` 明确：非本回合允许预选；同局、本人手牌不变时他人更新保留；自己的出牌/不要、手牌改变、新局、结算清理。当前 `NetworkMatchSnapshotController` 注释和判断也实现了这个分界。

探针同时验证“他人出牌”：c 保持，旧 a 触点完成后得到 c+a，这是预选契约下的正常保留，不能一律禁止。缺陷在于明确应失效的本人权威事务仅清了选择容器，旧输入事务还活着。修复不能简单在每个网络 revision 或每次 render 上 cancel。

### 影响边界与优先级

**已确认影响仅为本地选择清理被旧触点绕回**：原预选 c 被清掉，却出现来自更新前按下的 a；若 a 属于仍有效的锁组，可将整个锁组重新选中。用户仍需再次点选调整；没有自动提交。探针在 p2 回合尝试正常 `playSelected` 入口，网络发送数仍为 0。锁组成员仍全选/全不选，未发生拆锁。

这不是服务端状态/手牌权限绕过，也不是“错误牌已出”或账号数据问题。触发需要触摸跨过首次超时/其他持续可交互权威更新，故定 P3。真实 Cocos 手指调度、绘制/移动命中与机型体验未实测；内存输入事件和可控时钟不冒充真机验收。

### 建议

在权威选择需要清理时产生独立的 selection/gesture epoch，贯穿桌面协调器与 HandController，同时取消 gesture 和长按回调；至少覆盖手牌/局/阶段失效及自己完成动作。保留他人更新、普通选牌渲染和倒计时刷新下的连续预选。增加真实输入→首次服务端超时/恢复→旧 TOUCH_END 与旧长按回调，以及正常他人动作的对照回归。

## 验证结果与其余结论

已先检查测试和内存 TypeScript loader；在 Cocos 目录逐个执行以下 6 个已有脚本，全部退出 0：

```sh
node tests/table-match-coordinator-regression.cjs
node tests/table-network-event-bridge-regression.cjs
node tests/table-hand-interaction-controller-regression.cjs
node tests/network-round-state-regression.cjs
node tests/hand-touch-coordinates-regression.cjs
node tests/selection-regression.cjs
```

附加探针（下文完整命令）已从 Markdown 提取重跑：

- incremental/recovery 权威更新前预选 c，更新后 `[]`，旧 end 后 `[a]`；本次探针实际无网络发送。
- 真实 server lifecycle 默认首次 deadline 路径得到 `consecutiveTimeouts.p1=1`、`trustee=null`、`turnTimedOut`，经客户端全链得到同样 `[a]`；没有导入运行 WS 入口。服务端默认 dispatch 使用仓库现有 `shared-core/dist`，本批未构建或将该产物计人工源覆盖；客户端主对照另执行当前生成 TS 核心 transition。
- 显式 TOUCH_CANCEL、托管、观战、actionPending 均取消旧输入；他人动作保留正常预选；锁组重选依旧原子；贡还 deadline 换人后非交互 render 取消旧触点，进入 playing 也不恢复（贡还为权限夹具，不是完整服务端贡还回放）。
- TableMatch mount/dispose 与事件桥解绑由现有回归及实际实例验证。手牌出口 workspace reset 在 GameScene 隐藏/销毁接线存在；旧输入事务仍归本项统一问题，不另记第二项。普通失效卡 ID 还会被本地规则选择器拒绝。
- `playSelected` 在 scene authority 与 GameManager 双层检查当前阶段/回合/合法性；提示读取当前锁组；状态投影的托管/观战权限优先。未确认新增越权或锁保护缺陷。

## 可复制隔离探针

从仓库根目录运行。复用既有只读测试的 Cocos/几何存根；执行真实 CardView 输入方法、HandController、TableHandInteractionController、GameManager/权威投影、TableNetworkEventBridge、TableMatchCoordinator 以及共享核心 transition。仅视觉/音频、Session/transport 外围与调度是存根，无网络、无文件写入、无引擎构建。

```sh
node <<'NODE'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),Module=require('node:module');
const file=path.resolve('work/guandan-cocos/tests/hand-touch-coordinates-regression.cjs');
const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));
m._compile(fs.readFileSync(file,'utf8')+'\nmodule.exports={harness,cc,load,cache};',file);
const {harness,cc,load,cache}=m.exports,src=path.resolve('work/guandan-cocos/assets/scripts');
const fake=(p,exports)=>cache.set(path.join(src,p+'.ts'),{exports});
fake('session/GameSession',{GameSession:class{}});
fake('network/LobbyController',{LobbyController:class{}});
fake('scenes/TablePhasePresenter',{TablePhasePresenter:class{clear(){} layoutActionControls(){} renderPhaseOverlay(){} animateEntrance(){}}});
fake('scenes/TableProgressPresentation',{TableProgressPresentation:class{reset(){} seedRecovery(){} renderProgressNotifications(){}}});
fake('scenes/TableSnapshotPresenter',{projectTableViewer:()=>({levelLabel:'',settlementWon:false,settlementTitle:''})});
cc.Tween={stopAllByTarget(){}};cc.Node.EventType={TOUCH_END:'touch-end'};
class Events {
  constructor(){this.listeners=[];}
  on(type,fn,owner){this.listeners.push({type,fn,owner});}
  off(type,fn,owner){this.listeners=this.listeners.filter(x=>x.type!==type||x.fn!==fn||x.owner!==owner);}
  emit(type,...args){for(const x of this.listeners.slice())if(x.type===type)x.fn.apply(x.owner,args);}
}
const {GameManager}=load(path.join(src,'game/GameManager.ts'));
const {TableHandInteractionController}=load(path.join(src,'scenes/TableHandInteractionController.ts'));
const {TableMatchCoordinator}=load(path.join(src,'scenes/TableMatchCoordinator.ts'));
const core=load(path.join(src,'core/generated/index.ts')),profile=core.getRuleProfile('classic');
const card=(id,rank,suit='spade')=>({id,rank,suit,value:rank,isLevelCard:false});
const players={
  p1:{id:'p1',name:'p1',team:'teamA',hand:[card('a',8),card('c',9),card('b',3)]},
  p2:{id:'p2',name:'p2',team:'teamB',hand:[card('2a',4),card('2b',5)]},
  p3:{id:'p3',name:'p3',team:'teamA',hand:[card('3a',6),card('3b',7)]},
  p4:{id:'p4',name:'p4',team:'teamB',hand:[card('4a',10),card('4b',7,'heart')]}
};
const initial=core.createMatchState({players,ruleProfile:profile,currentLevel:2,levelTeam:'teamA',teamLevels:{teamA:2,teamB:2},dealerId:'p1'});
const play=(state,playerId,cardIds)=>{
  const out=core.transition(state,{type:'PLAY_CARDS',playerId,cardIds,roundId:state.roundId,expectedRevision:state.revision});
  assert.equal(out.ok,true,out.reason);return out.state;
};
function setup(first=initial){
  const h=harness(1,{x:0,y:0},['a','b','c'].map((id,index)=>({id,x:100+index*50,y:30,width:48,height:100})));
  h.controller.getComponent=()=>({contentSize:{width:1040}});
  for(const node of h.controller.cards.values()){
    node.position={equals:()=>true};node.setSiblingIndex=()=>{};node.destroy=()=>{node.isValid=false};
  }
  for(const view of h.views.values()){
    view.bind=model=>{view.card=model};view.configureFanHitArea=()=>{};view.configureStackHitArea=()=>{};
  }
  const session={snapshot:{myPlayerId:'p1',roomId:'test',isMultiplayer:true,isObserver:false,status:'playing'},
    beginPlay(){this.snapshot.status='playing'},beginTribute(){this.snapshot.status='tribute'},beginSettlement(){this.snapshot.status='settlement'}};
  const lobby={events:new Events(),snapshot:{roomId:'test',roomStatus:'ready',connected:true,trustees:{},members:['p1','p2','p3','p4']},
    sent:[],play(ids){this.sent.push(ids);return 1;}};
  const manager=new GameManager();manager.node=new Events();manager.session=session;manager.lobby=lobby;
  let table;
  const handInteraction=new TableHandInteractionController({
    ruleAuthority:manager,getHumanId:()=>session.snapshot.myPlayerId,
    getRuntimeSettings:()=>({sortOrder:'desc',autoSort:true,ruleProfile:profile,multiplayer:true,
      trustee:Boolean(session.snapshot.isObserver||lobby.snapshot.trustees.p1),deadlinePlayerId:lobby.snapshot.deadlinePlayerId??null}),
    refresh:()=>table.refresh(),showToast(){},showNotice(){},validationHint:()=>'',captureSelectedOrigins(){}
  });
  const emit=h.controller.node.emit.bind(h.controller.node);
  h.controller.node.emit=(name,...args)=>name==='guandan:card-toggle'?handInteraction.handleCardToggle(...args):emit(name,...args);
  table=new TableMatchCoordinator({session,manager,lobby,audio:{playEvent(){}},
    effects:{waitForPresentation(){},syncActions(){},resetForRecovery(){}},hand:h.controller,
    playArea:{setSeatOrder(){},render(){}},playerSeats:new Map(),
    frontPages:{handoffFriendRoomReservation(){},hideAll(){},renderLobby(){}},
    overlays:{showToast(){}},turnClock:{reset(){}},handInteraction,hud:{render(){}},controls:{},controlsY:()=>0,
    layoutSeats(){},setTableVisible(){},setFriendRoomWaitingVisible(){}});
  table.mount();
  const publish=(state,mode='incremental')=>lobby.events.emit('guandan:network-state',{roomId:'test',effectSync:{mode},state});
  publish(first);
  return {h,session,lobby,manager,table,publish,handInteraction};
}
const after=play(initial,'p1',['b']);assert.equal(after.currentTurn,'p2');
const outputs=[];
for(const mode of ['incremental','recovery']){
  const x=setup();x.manager.toggleCard('c');
  x.h.views.get('a').handleTouchStart(x.h.event({x:122,y:60}));
  x.publish(after,mode);
  assert.deepEqual([...x.manager.selectedCardIds],[]);assert.equal(x.h.controller.interactive,true);
  x.h.views.get('a').handleTouchEnd(x.h.event({x:122,y:60}));
  assert.deepEqual([...x.manager.selectedCardIds],['a']);
  x.handInteraction.playSelected();assert.deepEqual(x.lobby.sent,[]);
  outputs.push({mode,oldTouchEndSelection:[...x.manager.selectedCardIds],currentTurn:x.manager.state.currentTurn,networkSends:x.lobby.sent.length});
  x.table.dispose();assert.equal(x.lobby.events.listeners.length,0);
}
for(const block of ['cancel','trustee','observer','pending']){
  const x=setup();x.h.views.get('a').handleTouchStart(x.h.event({x:122,y:60}));
  if(block==='cancel')x.h.views.get('a').handleTouchCancel(x.h.event({x:122,y:60}));
  if(block==='trustee')x.lobby.snapshot.trustees.p1={reason:'timeout'};
  if(block==='observer')x.session.snapshot.isObserver=true;
  if(block==='pending'){x.manager.toggleCard('b');x.manager.playSelected();assert.equal(x.manager.actionPending,true);}
  x.table.refresh();x.publish(after);
  x.h.views.get('a').handleTouchEnd(x.h.event({x:122,y:60}));assert.deepEqual([...x.manager.selectedCardIds],[]);
  outputs.push({block,selection:[...x.manager.selectedCardIds]});x.table.dispose();
}
const others={...initial,currentTurn:'p2'};
const x=setup(others);x.manager.toggleCard('c');x.h.views.get('a').handleTouchStart(x.h.event({x:122,y:60}));
x.publish(play(others,'p2',['2a']));assert.deepEqual([...x.manager.selectedCardIds],['c']);
x.h.views.get('a').handleTouchEnd(x.h.event({x:122,y:60}));
assert.deepEqual(new Set(x.manager.selectedCardIds),new Set(['a','c']));
outputs.push({otherPlayerActionSelection:[...x.manager.selectedCardIds]});x.table.dispose();
// Lock ownership remains atomic even when the stale gesture reselects the group.
const lockedInitial={...initial,players:{...initial.players,p1:{...initial.players.p1,
  hand:[card('a',8),card('c',8,'heart'),card('b',3)]}}};
const locked=setup(lockedInitial);locked.manager.replaceSelectedCards(['a','c']);
locked.handInteraction.handleLockAction();locked.manager.clearRuleSelection();
locked.h.views.get('a').handleTouchStart(locked.h.event({x:122,y:60}));
locked.publish(play(lockedInitial,'p1',['b']));assert.deepEqual([...locked.manager.selectedCardIds],[]);
locked.h.views.get('a').handleTouchEnd(locked.h.event({x:122,y:60}));
assert.deepEqual(new Set(locked.manager.selectedCardIds),new Set(['a','c']));
outputs.push({lockedGroupOldTouchSelection:[...locked.manager.selectedCardIds]});locked.table.dispose();
// Capability-only tribute fixture, not a claimed full server tribute replay.
const tributeInitial={...initial,phase:'tribute',tribute:{mode:'single',status:'selecting_tribute',
  exchanges:[{from:'p1',to:'p2',tributeCardId:null,returnCardId:null}]}};
const tribute=setup(tributeInitial);tribute.lobby.snapshot.deadlinePlayerId='p1';tribute.table.refresh();
assert.equal(tribute.h.controller.interactive,true);
tribute.h.views.get('a').handleTouchStart(tribute.h.event({x:122,y:60}));
tribute.lobby.snapshot.deadlinePlayerId='p2';tribute.table.refresh();
assert.equal(tribute.h.controller.interactive,false);
tribute.publish({...initial,revision:1});
tribute.h.views.get('a').handleTouchEnd(tribute.h.event({x:122,y:60}));
assert.deepEqual([...tribute.manager.selectedCardIds],[]);
outputs.push({tributeDeadlineChangedOldTouchSelection:[...tribute.manager.selectedCardIds]});tribute.table.dispose();
console.log(JSON.stringify(outputs,null,2));
// Run a genuine first deadline through the server lifecycle and action executor.
// No WS entry is imported; timers, persistence and publication are memory ports.
;(async()=>{
  const {createWeAppMatchLifecycle}=await import(path.join(process.cwd(),'work/guandan-windows-source/server/weapp-match-lifecycle.js'));
  const x=setup(),ids=['p1','p2','p3','p4'],noop=()=>{};
  const flags=v=>Object.fromEntries(ids.map(id=>[id,v]));
  const room={roomId:'test',version:1,gameVersion:0,state:structuredClone(initial),
    roomSettings:{format:'rounds',rounds:4,turnSeconds:20,trusteeSeconds:15,totalTimeMinutes:0},
    seats:flags('fake-connection'),trustees:flags(null),consecutiveTimeouts:flags(0),roundSequence:0};
  const timers=new Map(),jobs=[],events=[];
  const lifecycle=createWeAppMatchLifecycle({
    playerIds:ids,rooms:new Map([['test',room]]),connections:new Map(),
    turnTimeoutMs:20000,friendSecondMs:1000,totalMinuteMs:60000,now:()=>1000,
    isShuttingDown:()=>false,enqueueServerOperation:fn=>{const job=Promise.resolve().then(fn);jobs.push(job);return job},
    ensureLiveMetadata:noop,isFriendRoom:()=>true,isMatchRoom:()=>false,isBotPlayer:()=>false,
    botPolicyForRoom:noop,existingBotPolicyForRoom:()=>null,shuffleRandom:()=>0.5,
    persistRuntimeState:noop,commitRuntimeState:async()=>{},stagePendingSideEffects:noop,
    broadcast:(r,type,payload)=>{
      events.push(type);x.lobby.snapshot.trustees=structuredClone(r.trustees);
      if(type==='turnTimedOut')x.lobby.events.emit('guandan:turn-timeout',payload);
    },send:noop,phaseFor:r=>r.state.phase,liveMetadataFor:()=>({}),publishTurnStatus:noop,
    publishState:r=>x.publish(r.state),publishTribute:noop,publishRoundEnded:noop,
    recordRoomAction:noop,reportSpectatorEvent:noop,reportSpectatorAction:noop,
    reportSpectatorRoundEnd:noop,reportCompletedGame:noop,closeRoomWithoutAck:noop,
    log:{error:(...args)=>{throw Error(args.join(' '))}},
    scheduleTimeout:(fn,delay)=>{const key={unref:noop};timers.set(key,{fn,delay});return key},
    cancelTimeout:key=>timers.delete(key)
  });
  try{
    x.manager.toggleCard('c');x.h.views.get('a').handleTouchStart(x.h.event({x:122,y:60}));
    lifecycle.armTurnDeadline(room);
    const scheduled=timers.entries().next().value;timers.delete(scheduled[0]);scheduled[1].fn();await jobs.shift();
    assert.equal(room.consecutiveTimeouts.p1,1);assert.equal(room.trustees.p1,null);
    assert.equal(room.state.currentTurn,'p2');assert.deepEqual(room.state.players.p1.hand.map(c=>c.id),['a','c']);
    assert.deepEqual(room.state,after,'server default dispatch agrees with current TS transition for this action');
    assert.deepEqual([...x.manager.selectedCardIds],[]);assert.equal(x.h.controller.interactive,true);
    x.h.views.get('a').handleTouchEnd(x.h.event({x:122,y:60}));
    assert.deepEqual([...x.manager.selectedCardIds],['a']);assert.deepEqual(x.lobby.sent,[]);
    console.log(JSON.stringify({realServerFirstTimeout:room.consecutiveTimeouts.p1,trustee:room.trustees.p1,
      events,oldTouchEndSelection:[...x.manager.selectedCardIds],networkSends:x.lobby.sent.length}));
  }finally{lifecycle.dispose();x.table.dispose();}
})().catch(error=>{console.error(error);process.exitCode=1;});
NODE
```
