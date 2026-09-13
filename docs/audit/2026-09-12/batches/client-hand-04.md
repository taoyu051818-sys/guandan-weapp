# client-hand-04 — 手牌分组、锁牌与拖动状态审计

审查人：audit_client_state。仓库：`/Users/mac/Documents/Codex/2026-08-02/wo-yi`。HEAD：`1d58999dc6e5455b049e1643660bbba3deee1406`。

结论：本批完整审阅 **6 个文件、1280 行；新增确认缺陷 0 项；待验证候选 1 项**。这是代码状态审计，不是界面重设计；回归通过不等于全场景无缺陷。

## 范围与完整性

开始前重新读取审计 README、核对 coverage：六个目标为 pending。旧 STATUS 所含 `HandInteractionState.ts`、`HandInteractionPolicy.ts`、`LocalHandSelectionController.ts` 已在 client-state-01 完整审阅，本批仅交叉核验，不重复计数。与复式桌身份相关的 CS-01-001 不重复算新发现。

| 完整审阅文件（均位于 work/guandan-cocos/assets/scripts/game/） | 行数 | 审阅要点 |
| --- | ---: | --- |
| HandWorkspace.ts | 204 | 语义签名、跨局重置、恢复失效、baseline、锁决策与重投影 |
| HandGroupingState.ts | 264 | 拷贝/比较、单一归属、去重、无效锁/组释放与顺序 |
| HandHintProtectionProjector.ts | 74 | 牌ID投影、锁优先、提示权限、核心保护契约 |
| HandGrouping.ts | 590 | 锁合法性、整组/底牌选择、权威同步、理牌/拆组/还原/提交 |
| HandDragSelectionPolicy.ts | 103 | 起点反向状态、阈值/长按、一次claim、pointer、点按、取消 |
| HandGroupPresentationCache.ts | 45 | 牌面/规则键、缓存隔离、容量、清理 |

逐文件 SHA-256 与详细 notes 见同名 JSON。6 个目标均无 git diff；落盘后再次核对 hash。`shasum` 因当前 `C.UTF-8` locale 失败，使用 Node crypto 计算，不影响源码。HEAD 未变。既有 5 处 dirty 完整保留：`shared-core/tests/rules-regression.cjs`、`GameScene.ts`、`TablePhasePresenter.ts`、`RELEASE_ACCEPTANCE_20260910.md`、`table-phase-presenter-regression.cjs`。仅新增本批两份报告，未改业务/测试/清单，未提交/部署/连接线上。

## UI/UX 技能的实际使用

主审完整读取 `/Users/mac/.codex/skills/ui-ux-pro-max/SKILL.md` 后，已在 commentary 告知使用原因。查询：

```sh
python3 /Users/mac/.codex/skills/ui-ux-pro-max/scripts/search.py "dragging movements cancellation" --domain ux
```

命中 Dragging Movements 的单指非拖动替代建议。这里只用它检查现有原生游戏点按、起点、取消契约，不把网页 WCAG 机械当作产品缺陷。`HandDragSelectionPolicy.end` 79–86 行保留点按，`HandGrouping.getPlaySelectionForCard` 200–204 行保留整组点按，真实 CardView→HandController→policy 回归覆盖点按/长按/滑选/取消。未改布局、控件或美术。

## 已验证的关键边界

- Workspace 60–92 行对牌面、规则和 roundId 建签名；同局恢复使缓存失效但保留合法手工锁，跨局重用牌 ID 清锁。78–80 行在权威变化时废弃理牌 baseline，不通过还原复活移除牌。
- GroupingState 200–227 行对缺卡、变牌、规则改变重新验证；权威同步由 Grouping 234–240 行传 `releaseInvalidManualLocks=true`。组与单牌表示保持独占，snapshot 拷贝不能回写内部状态。
- Workspace 111–139 行拒绝部分锁组、混选、重复/失效 ID；Grouping 200–204 行使每个锁组成员都选择整组。自动分组/同花顺入口从 editable cards 排除锁牌。
- 提示投影的 locked 分类优先于普通类别；核心提示候选和本地选择器都禁止部分使用锁组。`straight-flush` 被投影为 structured 未报策略缺陷：当前核心 `rankHintMoves` 69–97 行并不按普通 damage 分类排序，它只把锁作为硬约束。
- Gesture 显式 cancel 后迟到 move/end/长按均无效；另一 pointer 的 cancel 不取消当前手势。已发生的逐牌选择不在 cancel 中回滚，符合现有“逐项即时选牌”实现，未无依据要求拖动撤销事务。
- 展示缓存按真实牌面与规则失效、徽章返回副本；90 个不同键后保持 64 项，clear 归零。炸弹剩两张后不复用炸弹徽章。

`applySuggestion` 与 `restoreSnapshot` 的任意外部输入未当作可达漏洞：生产 workspace 使用已校验锁入口和仍有效的私有 baseline。辅助 `TableHandInteractionController`、`HandController`、`CardView`、`TableMatchCoordinator`、提示核心及测试仅交叉读取，不计本批完整审阅。

## CH-04-C01（待验证，不计确认发现）

辅助渲染器在仍可交互的权威手牌更新后，可能继续消费旧触摸手势。

位置：`work/guandan-cocos/assets/scripts/ui/HandController.ts:118`（118–123 行）；关联本批 `HandDragSelectionPolicy.ts:80`（80–86 行）。前者仅在 `interactive=false` 时取消，后者把未取消的旧 end 转为起始卡点按。

合成触发：a 上 TOUCH_START → 服务端手牌更新移除另一张 b，render 仍为 `interactive=true` 且清空选择 → 存活 a 的 TOUCH_END。真实 renderer 和 CardView 事件方法输出 `toggled=["a"]`；在更新间插入 `interactive=false` render 的对照输出 `[]`。`TableMatchCoordinator.ts:78–85` 不传手牌代次，恢复 165–169 行只让 workspace 失效；选择投影本身会在手牌改变时清空旧选择（已审 NetworkMatchSnapshotController 126–131 行）。

边界：只确认该注入事件顺序下的组件行为；绘制、Cocos 调度与事件时间由存根控制。尚未通过设备或完整网络/自动动作链证明生产场景及“跨更新连续预选”是否违反契约，因此 **不列 P 级缺陷**。显式 cancel，以及 pending、托管、观战等导致非交互 render 的路径会正常取消，不声称这些路径出错。

下一步仅建议后续控制器批次完整审查：确认恢复/超时更新能否在起始 CardView 存活、interactive 持续 true 时到达；重放旧 TOUCH_END/长按。若需废弃旧选择事务，可按权威代次取消 gesture 与 long-press，不能每次选择/倒计时 render 都取消。

## 安全验证

已检查以下测试及 TypeScript 加载支持的源码行为，再以 Node v26.7.0 本地执行；均无源码写入、网络/部署、构建动作：

```sh
cd /Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-cocos
node tests/hand-grouping-regression.cjs
node tests/hand-group-badge-regression.cjs
node tests/straight-flush-grouping-regression.cjs
node tests/selection-regression.cjs
node tests/simple-hand-arrangement-regression.cjs
node tests/table-hand-interaction-controller-regression.cjs
node tests/hand-touch-coordinates-regression.cjs
```

7 项全部退出 0。selection 输出 `web build not requested`；simple-hand-arrangement 的 104 样本 Node 耗时不当作手机性能结论。以下两个附加探针均已执行退出 0，可从仓库根目录直接复制重跑，不产生测试文件。

### 探针 A：真实状态类与提示引擎的不变式

```sh
node <<'NODE'
const fs=require('node:fs'),assert=require('node:assert/strict');
const ts=require('./work/guandan-cocos/tests/support/typescript.cjs').loadTypeScript();
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,f);
const base='./work/guandan-cocos/assets/scripts/';
const {HandWorkspace}=require(base+'game/HandWorkspace.ts');
const {HandDragSelectionPolicy}=require(base+'game/HandDragSelectionPolicy.ts');
const {projectHintProtectedGroups,requestTableHandHint}=require(base+'game/HandHintProtectionProjector.ts');
const {HandGroupPresentationCache}=require(base+'game/HandGroupPresentationCache.ts');
const {getRuleProfile,rankHintMoves}=require(base+'core/generated/index.ts');
const profile=getRuleProfile('classic'),options={roundId:1,levelRank:2,direction:'desc',autoSort:true,ruleProfile:profile};
const card=(id,rank,suit='spade')=>({id,rank,suit,value:rank,isLevelCard:false});
const pair=[card('a',8),card('b',8,'heart')],hand=[...pair,card('c',9)];
const workspace=new HandWorkspace();workspace.syncAuthoritativeHand(hand,options);
assert.equal(workspace.applySelectionLock(['a','b'],profile),true);
assert.deepEqual(workspace.getLockDecision(profile,['a']),{kind:'unavailable',reason:'partial-lock'});
assert.deepEqual(workspace.getLockDecision(profile,['a','b','c']),{kind:'unavailable',reason:'mixed-selection'});
for(const id of ['a','b'])assert.deepEqual(new Set(workspace.playSelectionForCard(id)),new Set(['a','b']));
const protectedGroups=projectHintProtectedGroups(hand,workspace.snapshot.groups,profile);
assert.equal(protectedGroups.find(g=>g.cardIds.includes('a')).kind,'locked');
const hints=rankHintMoves({hand,lastPlay:null,ruleProfile:profile,protectedGroups,seed:7});
assert.ok(hints.length);for(const hint of hints){const ids=new Set(hint.cards.map(c=>c.id));assert.equal(ids.has('a'),ids.has('b'));}
workspace.toggleArrangement({direction:'desc',allowAceLowStraight:true});
workspace.syncAuthoritativeHand([pair[0],hand[2]],options);
assert.deepEqual(workspace.lockedCardIds,[]);
assert.equal(workspace.toggleArrangement({direction:'desc',allowAceLowStraight:true}),'fallback-restored');
assert.deepEqual(new Set(workspace.snapshot.displayCardIds),new Set(['a','c']));
workspace.syncAuthoritativeHand(hand,options);workspace.applySelectionLock(['a','b'],profile);
workspace.invalidateAuthoritativeHand();workspace.syncAuthoritativeHand(hand,options);
assert.deepEqual(new Set(workspace.lockedCardIds),new Set(['a','b']));
workspace.syncAuthoritativeHand(hand,{...options,roundId:2});assert.deepEqual(workspace.lockedCardIds,[]);
workspace.applySelectionLock(['a','b'],profile);
const mutated=workspace.snapshot;mutated.groups[0].cardIds.push('not-in-hand');
assert.equal(workspace.snapshot.displayCardIds.includes('not-in-hand'),false);
workspace.syncAuthoritativeHand([card('a',8),card('b',10,'heart'),hand[2]],{...options,roundId:2});
assert.deepEqual(workspace.lockedCardIds,[]);
const triplePair=[card('t1',6),card('t2',6,'heart'),card('t3',6,'club'),card('p1',9),card('p2',9,'heart')];
workspace.syncAuthoritativeHand(triplePair,{...options,roundId:3});
assert.equal(workspace.applySelectionLock(triplePair.map(c=>c.id),profile),true);
workspace.syncAuthoritativeHand(triplePair,{...options,roundId:3,ruleProfile:{...profile,enableTripleWithPair:false}});
assert.deepEqual(workspace.lockedCardIds,[]);
let submit=0;
const snap={phase:'playing',actionPending:false,state:{players:{p1:{hand}},currentTurn:'p1',finishedPlayers:[]}};
for(const [snapshot,settings] of [
  [null,{trustee:false,ruleProfile:profile}],
  [{...snap,actionPending:true},{trustee:false,ruleProfile:profile}],
  [snap,{trustee:true,ruleProfile:profile}],
  [{...snap,phase:'tribute'},{trustee:false,ruleProfile:profile}],
  [{...snap,phase:'settlement'},{trustee:false,ruleProfile:profile}],
  [{...snap,state:{...snap.state,currentTurn:'p2'}},{trustee:false,ruleProfile:profile}]
])requestTableHandHint(snapshot,'p1',settings,workspace,()=>submit++);
assert.equal(submit,0);
workspace.resetForTableExit();assert.deepEqual(workspace.snapshot.handCardIds,[]);
const drag=new HandDragSelectionPolicy();drag.begin(1,'a',false,{x:0,y:0});
drag.move(1,{x:8,y:0});assert.equal(drag.claim('a'),true);
drag.cancel(2);assert.equal(drag.claim('b'),true);drag.cancel(1);
assert.equal(drag.move(1,{x:50,y:0}),null);assert.equal(drag.claim('c'),null);
assert.equal(drag.end(1),null);assert.equal(drag.activateLongPress(1),null);
drag.begin(2,'a',true,{x:0,y:0});assert.deepEqual(drag.end(2),{cardId:'a',selected:false});
const cache=new HandGroupPresentationCache();
const bomb=[0,1,2,3].map(n=>card('bomb'+n,8,['spade','heart','club','diamond'][n]));
const grouping={layoutMode:'smart-arranged',ruleProfile:profile,groups:[{id:'g',origin:'auto',kind:'bomb',locked:false,cardIds:bomb.map(c=>c.id)}]};
let projected=cache.project(bomb,grouping);assert.equal(projected[0].badge.label,'四炸');
projected[0].badge.label='external mutation';assert.equal(cache.project(bomb,grouping)[0].badge.label,'四炸');
assert.equal(cache.project(bomb.slice(0,2),grouping)[0].badge,undefined);
for(let i=0;i<90;i++)cache.project(bomb.map(c=>({...c,id:c.id+i})),{...grouping,groups:[{...grouping.groups[0],cardIds:bomb.map(c=>c.id+i)}]});
assert.equal(cache.entries.size,64);cache.clear();assert.equal(cache.entries.size,0);
console.log(JSON.stringify({workspace:'lock/partial-hand/face/rule/round/recovery/exit checks passed',hint:'all-or-none lock candidates and eligibility passed',drag:'wrong-pointer/cancel/late-input/tap passed',cache:'face key/copy isolation/64-entry bound passed',hintCandidateCount:hints.length}));
NODE
```

输出包含 `hintCandidateCount:2`，其余四类检查均 passed。卡组测试是小型确定性手牌，不是 108 张牌所有可能组合穷举。

### 探针 B：保留组件代次候选的可重现证据

复用现有安全测试的纯内存 Cocos 与几何 harness；真实 `render`、`CardView` 输入转发、drag policy 都执行，绘制绑定/位置与 Tween 被存根，不要求启动 Cocos。

```sh
node <<'NODE'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),Module=require('node:module');
const file=path.resolve('work/guandan-cocos/tests/hand-touch-coordinates-regression.cjs');
const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));
m._compile(fs.readFileSync(file,'utf8')+'\nmodule.exports={harness,cc,flat};',file);
const {harness,cc,flat}=m.exports;
cc.Tween={stopAllByTarget(){}};
const card=id=>({id,rank:8,suit:'spade',value:8,isLevelCard:false});
function prepare(){
  const h=harness(1,{x:0,y:0},flat);
  h.controller.getComponent=()=>({contentSize:{width:1040}});
  for(const node of h.controller.cards.values()){
    node.position={equals:()=>true};node.setSiblingIndex=()=>{};node.destroy=()=>{node.isValid=false;};
  }
  for(const view of h.views.values()){
    view.bind=model=>{view.card=model;};view.configureFanHitArea=()=>{};view.configureStackHitArea=()=>{};
  }
  h.controller.render(flat.map(x=>card(x.id)),[],'desc',true,undefined,[],undefined,false);
  h.views.get('a').handleTouchStart(h.event({x:122,y:60}));
  return h;
}
const changed=prepare();
changed.controller.render(['a','c','d','e'].map(card),[],'desc',true,undefined,[],undefined,false);
changed.views.get('a').handleTouchEnd(changed.event({x:122,y:60}));
assert.deepEqual(changed.toggled,['a']);
const cancelled=prepare();
cancelled.controller.render(['a','c','d','e'].map(card),[],'desc',false,undefined,[],undefined,false);
cancelled.controller.render(['a','c','d','e'].map(card),[],'desc',true,undefined,[],undefined,false);
cancelled.views.get('a').handleTouchEnd(cancelled.event({x:122,y:60}));
assert.deepEqual(cancelled.toggled,[]);
console.log(JSON.stringify({changedAuthoritativeHandOldTap:changed.toggled,withBlockedRenderOldTap:cancelled.toggled,note:'Synthetic input ordering; presentation and Cocos scheduling stubbed. Not a device reproduction.'}));
NODE
```

输出：`changedAuthoritativeHandOldTap:["a"]`，`withBlockedRenderOldTap:[]`。该探针证实有限组件行为，不扩大成线上手势失效或提交错误的结论。
