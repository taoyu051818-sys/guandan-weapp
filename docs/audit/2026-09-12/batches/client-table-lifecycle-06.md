# 桌面布局与计时生命周期 · client-table-lifecycle-06

2026-09-12，审阅人 audit_client_state。仓库 `/Users/mac/Documents/Codex/2026-08-02/wo-yi`，HEAD `1d58999dc6e5455b049e1643660bbba3deee1406`。

本批完整审阅 6 文件、539 行，新增 1 项 P3（CTL-06-001），concerns 0。六目标已逐项查询当前 coverage 和所有既有 batch reviewed，均未先前计入；不重复计算 client-presentation-06 或根线程资源专项。原 5 处 dirty 保留，只新增本报告/同名 JSON，不修改产品、测试、生成、总 inventory/coverage/STATUS，不构建/提交/部署/访问线上。

## 完整范围与方法

下列文件位于 `work/guandan-cocos/assets/scripts/scenes/`；完整哈希及逐文件 notes 见同名 JSON。

| 文件 | 行数 | 审阅重点 |
| --- | ---: | --- |
| TableLayoutAuditBridge.ts | 214 | QA浏览器门禁、DOM/全局owner、可见parts、像素缩放与timer归属 |
| TableSceneLayout.ts | 57 | resize、安全边距、HUD/旧按钮所有权、相对席位 |
| TableSceneNodes.ts | 82 | Inspector复用、缺失节点组装、幂等与返回引用 |
| TableProgressPresentation.ts | 50 | 完成/10张阈值游标、恢复seed与局边界 |
| TableTurnClockController.ts | 104 | 单tick、采样、音效去重、reset/dispose |
| TableTurnClockProjection.ts | 32 | deadline/phase/seat/finite门禁、ceil、观察相对位置 |

重新完整读取 ui-ux-pro-max。首查 `responsive viewport safe area --domain ux` 主要返回 Web viewport；重试 `touch safe areas --domain web` 命中 Safe Area Insets（iOS/Android/React Native）。仅按“交互内容避开系统区域”的原则检查现有 Cocos 安全边距接线，不把 pt/dp/CSS px 混为一个标准，不重新设计界面。

辅助读取 ScreenAdapter、GameScene、Hand/Input/Manager/Coordinator/Phase、Router、PlayArea、OverlapAudit 和测试等，不计这些文件完整覆盖。恢复结算的历史提示候选已排除：LobbyMessageRouter.ts:143–147 先发 network-state、coordinator 的 recovery 路径 seedRecovery，再发 roundEnded；未当作新问题。已知 CS/CI/SA 问题没有重复记入。

## CTL-06-001 · P3 · 选牌刷新可吞掉最后五秒计时提示音

位置：TableTurnClockController.ts:85–89（相关入口43–49、73–75）。影响仅本地提示音，不改变视觉倒计时、服务器截止时间/托管/规则，没有错误出牌、网络提交或越权证据。

控制器用 `remainingSeconds` 同时保存“最近一次绘制的秒数”和“tick 是否需要播音”的比较基准。普通 update 调用 `renderClock(false)`，虽不播音，却仍先更新这一值；随后同秒 tick 发现值相同便不再发 `playCountdown`。所以一次合法点按落在秒数变化之后、该次定时 tick 之前，足以吞掉该秒音；连续同序可漏多个，不是每次使用都必然漏完整五声。

真实输入链已核源并在内存执行：CardView → HandController → TableHandInteractionController.ts:99–102 → GameManager.ts:66–72/171–180 的 guandan:state → TableMatchCoordinator.ts:53/126 → **实际** TablePhasePresenter.ts:57 → **实际** clock.update。不是只手动调用 private renderClock 的假造入口。

明确的现有契约：`work/guandan-cocos/docs/ARCHITECTURE.md:77` 说明控制器驱动最后 5 秒音效；`docs/gameplay-audio-effects-spec.md:90`（相对客户端目录）要求 warning5 至 warning1。现有 `table-turn-clock-controller-regression.cjs` 只在 tick 中连续跨秒，无法捕获无声 update 先更新游标的情况。

可复制时序（人工时钟，仅重排客户端合法事件，无需服务器故障）：

1. 权威 deadline 固定 6000ms，初始显示 6 秒。
2. 1001ms 点按 a，选择事件刷新展示至 5 秒但不播音；1100ms 触发 tick，仍是 5 秒，比较相同而跳过音。
3. 分别在 2001/3001/4001/5001ms 同样点按，2100/3100/4100/5100ms 执行 tick。
4. 点按组输出音效调用 []；无点按对照为 [5,4,3,2,1]。两组文字/HUD 均正确到 1 秒，网络发送均为 0。

建议：把“已播报游标”从“最近绘制秒数”独立出来，并按 deadline/actor/action 等时段身份适当地 reset；同一 tick 的数据仍只采样一次，普通刷新可无声但不可消耗未播音。增加两个顺序、重复同秒render、恢复与时段切换对照，不简单地让每次 update 都重播音。

## 其他核验与安全回归

- builder 仅补缺失绑定，重复调用不分配第二套节点；mounted HUD 保留自己的回合按钮布局权。resize 向手牌/出牌区、overlay/effect roots 和安全边缘节点传递几何，沿用既有布局。
- Bridge 的显式 browser/query 开关不会阻塞小游戏启动；dispose 只移除自己的 global owner 与 QA 控件。卡面 parts 排除空白，operation 的对称 padding 不算占用，位于 operation 内的 timer 不重复当成独立 HUD 面积。报告按 canvas CSS 尺寸换算，不等于 GPU 帧缓冲像素或设备遮挡验收。
- progress 恢复seed拷贝数据、跨10张阈值只触发一次、重复render不重播；reset/新局游标和不改权威状态对照通过。
- clock 在 rejoining/pending/settlement/matchEnded/非法时间或席位隐藏，不在客户端到期后自动执行业务；reset 后无新snapshot不更新，dispose取消精确tick且迟到回调无效。该正确边界不掩盖上面音频游标缺陷。

以下 6 个脚本先检查为只读/内存本地测试，再实际执行，全部退出 0：

```sh
cd /Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-cocos
node tests/table-turn-clock-controller-regression.cjs
node tests/table-layout-overlap-audit-regression.cjs
node tests/table-scene-assembly-regression.cjs
node tests/table-progress-presentation-regression.cjs
node tests/round-view-boundary-regression.cjs
node tests/table-match-coordinator-regression.cjs
```

### 探针 A：真实输入链复现与 tick-only 对照

直接执行当前实际业务 TypeScript；沿用已检查的触摸回归提供内存 Cocos 设备/绘制端口。仅 peripheral 展示、网络和session服务为存根，真正的 PhasePresenter、clock、GameManager 与输入状态代码被执行。tick、wall time 和音频端口人工控制，**不是 Cocos 调度/手机听感验收**；不写文件、不联网。

```sh
cd /Users/mac/Documents/Codex/2026-08-02/wo-yi
node <<'NODE'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),Module=require('node:module');
const file=path.resolve('work/guandan-cocos/tests/hand-touch-coordinates-regression.cjs');
const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));
m._compile(fs.readFileSync(file,'utf8')+'\nmodule.exports={harness,cc,load,cache};',file);
const {harness,cc,load,cache}=m.exports,src=path.resolve('work/guandan-cocos/assets/scripts');
const fake=(p,exports)=>cache.set(path.join(src,p+'.ts'),{exports});
fake('session/GameSession',{GameSession:class{}});
fake('network/LobbyController',{LobbyController:class{}});
fake('ui/TablePlayActionPolicy',{TablePlayActionPolicy:class{resolve(){return []}}});
fake('ui/TableSettlementView',{TableSettlementView:class{clear(){} render(){}}});
fake('scenes/SettlementPresentation',{projectSettlementContent:()=>({})});
fake('scenes/MatchEndedPresentation',{projectMatchEndedPresentation:()=>({title:'',detail:''})});
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
const {TableTurnClockController}=load(path.join(src,'scenes/TableTurnClockController.ts'));
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
  let table,now=0,tick;
  const sounds=[],hudUpdates=[];
  const label={string:'',node:{active:false,setPosition(value){this.position=value}}};
  Object.assign(lobby.snapshot,{turnDeadlineAt:6000,deadlinePlayerId:'p1',deadlineAction:'play',roomSettings:{turnSeconds:20}});
  const clock=new TableTurnClockController({label,tableHud:()=>({update:patch=>hudUpdates.push(patch)}),
    isMultiplayer:()=>true,lobbySnapshot:()=>lobby.snapshot,now:()=>now,playCountdown:seconds=>sounds.push(seconds),
    schedule:fn=>{tick=fn},unschedule:()=>{}});

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
    overlays:{showToast(){}},turnClock:clock,handInteraction,hud:{render(){}},controls:{},controlsY:()=>0,
    layoutSeats(){},setTableVisible(){},setFriendRoomWaitingVisible(){}});
  table.mount();
  const publish=(state,mode='incremental')=>lobby.events.emit('guandan:network-state',{roomId:'test',effectSync:{mode},state});
  publish(first);
  return {h,session,lobby,manager,table,publish,handInteraction,clock,label,sounds,hudUpdates,tick:()=>tick(),setNow:value=>{now=value}};
}

const results=[];
for(const inputBeforeTick of [false,true]){
  const x=setup();
  for(let second=1;second<=5;second++){
    x.setNow(second*1000+1);
    if(inputBeforeTick){
      // Real CardView -> HandController -> hand interaction -> manager event ->
      // actual TableMatchCoordinator -> actual TablePhasePresenter -> clock.update(false).
      x.h.views.get('a').handleTouchStart(x.h.event({x:122,y:60}));
      x.h.views.get('a').handleTouchEnd(x.h.event({x:122,y:60}));
      assert.equal(x.label.string,(6-second)+'s');
    }
    x.setNow(second*1000+100);
    x.tick();
    assert.equal(x.label.string,(6-second)+'s');
    assert.equal(x.hudUpdates.at(-1).turnSeconds,6-second);
  }
  assert.deepEqual(x.sounds,inputBeforeTick?[]:[5,4,3,2,1]);
  assert.equal(x.lobby.sent.length,0);
  results.push({inputBeforeTick,warnings:x.sounds,finalLabel:x.label.string,networkSends:x.lobby.sent.length});
  x.clock.reset();const afterReset=x.hudUpdates.length;x.tick();assert.equal(x.hudUpdates.length,afterReset);
  x.clock.dispose();x.table.dispose();const afterDispose=x.hudUpdates.length;x.tick();assert.equal(x.hudUpdates.length,afterDispose);
}
console.log(JSON.stringify({countdownRegression:results}));
NODE
```

终版实际输出（前面的原手势回归通过行省略）：

```text
{"countdownRegression":[{"inputBeforeTick":false,"warnings":[5,4,3,2,1],"finalLabel":"1s","networkSends":0},{"inputBeforeTick":true,"warnings":[],"finalLabel":"1s","networkSends":0}]}
```

### 探针 B：投影/恢复游标/Bridge 几何控制流

将既有测试临时导出 fixture 到内存，不改测试文件；重跑原测试后追加 24 个 turnOrder 全排列 × 4 viewer × 4 actor × 3 phase × 6 时间点 = 6912 对照，以及恢复阈值与实际 Bridge 的非等比 CSS 尺度、timer reparent去重、隐藏过滤和重排seat标签。

```sh
cd /Users/mac/Documents/Codex/2026-08-02/wo-yi
node <<'NODE'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),Module=require('node:module');
const base=path.resolve('work/guandan-cocos');
function fixture(name,bindings){
  const file=path.join(base,'tests',name+'.cjs'),m=new Module(file,module);
  m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));
  m._compile(fs.readFileSync(file,'utf8')+'\nmodule.exports={'+bindings+'};',file);
  return m.exports;
}
const clock=fixture('table-turn-clock-controller-regression','projectTurnClock,createSnapshot');
const ids=['p1','p2','p3','p4'];
const permutations=a=>a.length?a.flatMap((x,i)=>permutations(a.filter((_,j)=>j!==i)).map(t=>[x,...t])):[[]];
let projections=0;
for(const order of permutations(ids))for(const viewer of ids)for(const actor of ids)
for(const phase of ['playing','tribute','settlement'])for(const now of [0,1,1000,4999,5000,9000]){
  const snapshot=clock.createSnapshot({phase});snapshot.state.turnOrder=order;
  const lobby={roomStatus:'ready',turnDeadlineAt:5000,deadlinePlayerId:actor,deadlineAction:phase==='tribute'?'returnTribute':'play',roomSettings:{turnSeconds:40}};
  const result=clock.projectTurnClock(snapshot,viewer,lobby,true,now);
  assert.equal(result.turnVisible,phase!=='settlement');
  assert.equal(result.turnSeconds,phase==='settlement'?0:Math.max(0,Math.ceil((5000-now)/1000)));
  assert.equal(result.turnPlace,['bottom','right','top','left'][(order.indexOf(actor)-order.indexOf(viewer)+4)%4]);
  projections++;
}
const progress=fixture('table-progress-presentation-regression','TableProgressPresentation,create');
const notices=[],p=new progress.TableProgressPresentation({showToast:text=>notices.push(text)});
const original=progress.create();original.state.finishedPlayers=['p2'];original.state.players.p2.hand.length=0;original.state.players.p3.hand.length=9;
const before=JSON.stringify(original);p.seedRecovery(original.state);p.renderProgressNotifications(original,'p1');assert.deepEqual(notices,[]);
const next=structuredClone(original);next.state.finishedPlayers.push('p3');next.state.players.p3.hand.length=0;
p.renderProgressNotifications(next,'p1');p.renderProgressNotifications(next,'p1');assert.deepEqual(notices,['p3 已出完 · 二游']);
p.reset();p.seedRecovery(next.state);p.renderProgressNotifications(next,'p3');assert.equal(notices.length,1);
p.renderProgressNotifications(progress.create(),'p3');const crossed=progress.create();crossed.state.players.p4.hand.length=10;
p.renderProgressNotifications(crossed,'p3');assert.deepEqual(notices,['p3 已出完 · 二游','p4 仅剩 10 张牌']);
assert.equal(JSON.stringify(original),before);

const audit=fixture('table-layout-overlap-audit-regression','createBridgeRuntime,geometryNode');
const rect=(left,bottom,width,height)=>({left,bottom,width,height});
const geom=audit.geometryNode,handBox=rect(0,0,100,100),visible=rect(0,0,30,100);
const hand=geom('Hand',handBox,[geom('card',visible,[geom('CardVisual',visible)])]);
const buttonRect=rect(80,0,20,30),timerRect=rect(55,0,20,30);
const button=geom('PlayButton',buttonRect),timer=geom('CircularTurnTimer',timerRect);
const operations=geom('FloatingOperationGroup',handBox,[button,timer]),hud=geom('hud',handBox,[operations]);
operations.parent=hud;timer.parent=operations;button.parent=operations;
const doc={getElementById:()=>({getBoundingClientRect:()=>({width:400,height:100})})};
const runtime=audit.createBridgeRuntime(true,{URLSearchParams,document:doc,location:{search:'?layoutAudit=1'}},{
  viewport:()=>({width:800,height:400}),handNode:()=>hand,hudRoot:()=>hud
});
runtime.instance.install();const live=runtime.sandbox.__guandanLayoutAudit;
let report=live.snapshot();
assert.deepEqual(report.viewportPx,{width:400,height:100});
assert.equal(report.regionCount,2,'child timer counts inside operations only');
assert.equal(report.overlaps.length,0,'empty clamp padding stays unoccupied');
timerRect.left=10;report=live.snapshot();assert.equal(report.overlaps.length,1);
assert.equal(report.overlaps[0].areaPx2,20*30*.5*.25);
operations.children=[button];hud.children.push(timer);timer.parent=hud;
report=live.snapshot();assert.equal(report.regionCount,3,'top-level timer has its own region');
timer.activeInHierarchy=false;report=live.snapshot();assert.equal(report.regionCount,2);assert.equal(report.overlaps.length,0);
const playRect=rect(200,200,40,40),playRoot=geom('PlayArea',playRect,[geom('play-p1',playRect,[geom('played',playRect,[geom('CardVisual',playRect)])])]);
const seats=audit.createBridgeRuntime(true,{URLSearchParams,document:doc,location:{search:'?layoutAudit=1'}},{
  playArea:()=>({node:playRoot}),humanId:()=> 'p3',seatOrder:()=>['p3','p1','p4','p2']
});
const regions=seats.instance.collectPlayRegions();assert.equal(regions[0].id,'play-1');assert.equal(regions[0].label,'右家出牌区');
runtime.instance.dispose();assert.equal(runtime.sandbox.__guandanLayoutAudit,undefined);
console.log(JSON.stringify({clockProjections:projections,recoveryThresholdCursor:true,geometryScaleAndPadding:true,timerOwnership:true,rotatedPlayLabels:true}));
NODE
```

终版附加结果：

```text
{"clockProjections":6912,"recoveryThresholdCursor":true,"geometryScaleAndPadding":true,"timerOwnership":true,"rotatedPlayLabels":true}
```

两段终版探针已在报告保存前分别实际执行退出 0；保存前再次核对 6 个源 SHA-256 与起始相同，git diff --check 通过，HEAD 与原 5 处 dirty 保留。收到根线程“长期目标已 paused”的通知时报告已保存，此后仅收尾文字记录，未再启动审查/测试或从落盘报告提取复跑。真实屏幕、安全区旋转、Cocos 销毁帧、系统音频播放和其他声道覆盖仍需后续专项；本报告不作相应验收通过声明。
