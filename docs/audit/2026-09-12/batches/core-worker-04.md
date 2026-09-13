# core-worker-04：checkpoint / Worker / 模拟边界

审阅人：`/root/audit_core_rules`；日期：2026-09-12；仓库：`/Users/mac/Documents/Codex/2026-08-02/wo-yi`；HEAD：`1d58999dc6e5455b049e1643660bbba3deee1406`。

本批完整审阅 8 文件、475 行，新增 confirmed findings 为 0。八项在开批 coverage（99/629，更新时间 `2026-09-12T06:45:02.504Z`）均 pending；上批辅助阅读不重复计覆盖。逐文件 SHA-256 和审查 notes 见同名 JSON，结束前二次核对。本批不刷新总清单。

原有五处 dirty 的路径、内容哈希及 HEAD 保持不变；只添加本批 Markdown/JSON。未改生产代码/测试断言/生成副本，未构建、提交、部署或进行外部状态写入。

## 结论与可达性

- **原 concern `CORE-AI-03-C01` 得到真实 worker `handle()` 层复现，但没有确认生产事故。** `workerRuntime.ts:35-41` 检测传入 checkpoint 正好等于上次完成结果后跳过 `engine.restore()`，保留候选和规则热缓存；`ruleMemo.ts:17-22,56,73-75` 和已审 candidates 的 ID-only 键不区分跨级牌义。打 2 的红心 2 + 黑桃 7 可以跟 66；同 runtime、同 profile/seed、成功 checkpoint 连续送入打 3 请求时仍给旧两张牌，当前正牌验证不合法。新 runtime 或显式冷恢复正确返回 null。与旧根因共用编号，不新增 finding。
- 调用搜索覆盖 shared-core、Cocos、Windows server 和 scripts：实例创建仅核心测试与 `work/guandan-cocos/tests/support/local-match/SynchronousLocalAIEngine.ts:33,62,90,97`；生成目录只是同源定义。没有活动 `new Worker` 或 AI `postMessage` 传输/响应消费者；`WechatFriendCanvas.ts:40` 的 postMessage 属于好友榜 open-data canvas，与 AI 无关。已运行只读 retirement verifier，确认 17 个退役 runtime 模块不在活动源码，活动 assets 不引用 tests/archive；20 个归档音效哈希通过。
- 当前生产主路径仍不受已复现的跨级热缓存场景影响：`work/guandan-windows-source/server/master-bot-policy.js:36` 直接建 engine；`weapp-match-lifecycle.js:404` 下一局执行 policy.reset；`duplicate-auto-policy.js:9` 每次决策重建/恢复引擎。不能把保留 API 的孤立调用当线上 worker 事故。
- checkpoint 验证先用临时 RNG 和 journal 校验，再由 engine 提交。seed/state 的 uint32 边界和回放通过。Worker 错误会清除 continuation marker，避免错误后错误跳过恢复；重复明确 checkpoint 的决策和 checkpoint 一致。elapsedMs 是实际计时，不要求回放数值一致。
- 取消/过期应答：核心 runtime 是同步函数，不负责异步接纳、取消或 deadline。退役同步适配器在提交响应 checkpoint 前检查 disposed/generation；退役调度器同时检查代际与 MatchVersion，隔离探针通过。这里没有真实异步 Worker 集成可验证，不报告缺少 monotonic id 为线上缺陷。
- 模拟器默认决策只读取他人 `hand.length`；一轮内存探针零隐藏牌面读取、输入状态未改、非法注入出牌仍被兼容 engine 拒绝。`runAiTurns` 仅 `shared-core/tests/round-smoke.cjs:14` 调用；其沿用 legacy playCards/passTurn，因此 JSON 历史对象身份问题沿用 `CORE-RULES-01-002`，不重复报。

`assertAIWorkerRequest` 是内部 envelope 检查，不是完整外部 schema；Player 输入本身也不是隐藏信息运输边界。默认 runner 才投影公开牌数。未发现把该 API 直接作为公网消息入口的活动调用，故不凭类型/校验缺口推断安全事故。

## 逐文件完整审查范围

| 文件（均位于 shared-core/src/ai） | 行数 | 检查重点 |
| --- | ---: | --- |
| checkpoint.ts | 22 | v1/v2、profile、临时 RNG、journal、原子恢复 |
| random.ts | 49 | uint32、算法范围、checkpoint、非法恢复前置验证 |
| ruleMemo.ts | 119 | 键语义、null/false 命中、LRU、generation/clear、旧 C01 |
| types.ts | 92 | 唯一 master、公开上下文、checkpoint 及引擎接口契约 |
| workerProtocol.ts | 87 | 工厂覆盖顺序、profile/seed、id、错误和 checkpoint |
| workerRuntime.ts | 62 | 配置重建、冷热 continuation、错误恢复、同步边界 |
| index.ts | 2 | 重导出与模块初始化可达性 |
| simulation.ts | 42 | 停止条件、当前席、公开历史、非法动作、兼容路径 |

辅助源/测试/可达性读取清单在 JSON，不计入这 8 文件。

## 已运行验证

执行前检查了测试和 retirement 脚本：仅本地读取/内存计算。使用当前源码 TypeScript 内存转译，不改 dist，也不调用会清理 dist 的 build。Vitest 关闭缓存。

```sh
cd /Users/mac/Documents/Codex/2026-08-02/wo-yi/shared-core
node_modules/.bin/vitest run --cache=false tests/ai-worker-protocol.test.ts tests/ai-worker-runtime.test.ts tests/ai-random.test.ts tests/ai-engine.test.ts
```

Node v26.7.0 / Vitest 4.1.10：4 文件、24 测试通过，开始于 2026-09-12 14:50:13（Asia/Shanghai）。

```sh
cd /Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-cocos
node scripts/verify-retirement.mjs
```

结果：17 removed runtime modules / 20 hash-verified archived clips，通过；active replay/observer retained，laboratory excluded。没有使用 --web / --wechat 构建检查选项。

### 探针 1：连续 worker checkpoint 的旧 C01、恢复及畸形输入

在仓库根目录执行。完整输入 JSON 往返模拟数据传输，但没有创建线程或联网。预期热缓存返回 `["card-6","card-14"]`；当前牌组合不合法；冷路径/错误恢复返回 null；11 类坏输入被捕获。探针断言的是已知 concern 的存在，不是将错误行为认定为正确规则。

```sh
node <<'NODE'
const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('./shared-core/node_modules/typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,f);
const {createAIEngine}=require('./shared-core/src/ai/engine.ts'),{createAIWorkerRuntime}=require('./shared-core/src/ai/workerRuntime.ts'),{createAIWorkerRequest}=require('./shared-core/src/ai/workerProtocol.ts'),{createDeck}=require('./shared-core/src/lib/deck.ts'),{getRuleProfile,resolvePlay,canPlay}=require('./shared-core/src/lib/rules.ts');
const profile=getRuleProfile('classic'),seed=9,clone=v=>JSON.parse(JSON.stringify(v));
const input=(level,roundId)=>{const deck=createDeck(level),hand=[deck.find(c=>c.suit==='heart'&&c.rank===2),deck.find(c=>c.suit==='spade'&&c.rank===7)],cards=deck.filter(c=>c.rank===6).slice(0,2),resolution=resolvePlay(cards,profile);return {hand,lastPlay:{playerId:'p2',cards,type:resolution.type,resolution},difficulty:'master',myTeam:'teamA',myPlayerId:'p1',players:Object.fromEntries(['p1','p2','p3','p4'].map((id,i)=>[id,{id,name:'',isAI:true,role:'normal',team:i%2?'teamB':'teamA',hand:i===0?hand:new Array(10)}])),aiContext:{currentLevel:level,teamLevels:{teamA:level,teamB:level},roundMeta:null,ruleProfile:profile,roundId,revision:1}};};
const old=input(2,1),next=input(3,2),initial=createAIEngine({ruleProfile:profile,seed}).checkpoint(),request=createAIWorkerRequest(1,old,{seed},initial),worker=createAIWorkerRuntime();
const first=worker.handle(clone(request));assert.equal(first.error,undefined);assert.equal(first.decision.length,2);
const secondRequest=createAIWorkerRequest(2,next,{seed},first.checkpoint),warm=worker.handle(clone(secondRequest)),cold=createAIWorkerRuntime().handle(clone(secondRequest));
assert.equal(warm.error,undefined);assert.equal(warm.decision.length,2);assert.equal(cold.error,undefined);assert.equal(cold.decision,null);assert.equal(canPlay(next.hand,next.lastPlay,profile),false);
const recoveryWorker=createAIWorkerRuntime(),beforeError=recoveryWorker.handle(clone(request));assert.equal(recoveryWorker.handle({id:99}).error,'invalid AI worker request');
const recovered=recoveryWorker.handle(createAIWorkerRequest(2,next,{seed},beforeError.checkpoint));assert.equal(recovered.error,undefined);assert.equal(recovered.decision,null);
const replayWorker=createAIWorkerRuntime(),one=replayWorker.handle(clone(request)),repeat=replayWorker.handle(clone(request));assert.deepEqual(repeat.decision,one.decision);assert.deepEqual(repeat.checkpoint,one.checkpoint);assert.equal(repeat.id,one.id);assert.equal(repeat.error,one.error);
const malformed=[null,{}, {id:1}, {...clone(request),id:1.5},{...clone(request),engine:null},{...clone(request),aiContext:null},{...clone(request),hand:null},{...clone(request),players:null},{...clone(request),engine:{seed,ruleProfile:getRuleProfile('tournament')}},{...clone(request),checkpoint:{...initial,engineRuleProfileKey:'0:0:0'}},{...clone(request),checkpoint:{...initial,random:{algorithm:'bad',state:-1}}}];
for(const bad of malformed){let response;assert.doesNotThrow(()=>response=createAIWorkerRuntime().handle(bad));assert.equal(typeof response.error,'string');assert.ok(response.error.length);}
console.log(JSON.stringify({workerProbe:{concern:'CORE-AI-03-C01',warmAcrossLevelDecision:warm.decision.map(c=>c.id),warmCacheHits:warm.metrics.cacheHitAllPlays,canonicalCurrentPairPlayable:false,coldDecision:cold.decision,recoveredAfterError:recovered.decision,exactCheckpointReplay:true,malformedCaught:malformed.length,productionScope:'Only tests/retired support instantiate the worker; not an online incident.'}}));
NODE
```

### 探针 2：模拟隔离、退役取消守卫、随机与规则缓存

在仓库根目录执行。退役 adapter 在内存转译时把 generated import 显式映射到当前源 API，没有改文件。人为在同步 `handle` 返回前调用 reset/dispose，仅验证提交前的代际守卫，不能外推为真实异步 Worker 传输测试。

```sh
node <<'NODE'
const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('./shared-core/node_modules/typescript');
const compile=f=>ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
require.extensions['.ts']=(m,f)=>m._compile(compile(f),f);
const {createAIEngine}=require('./shared-core/src/ai/engine.ts'),{createAIWorkerRuntime}=require('./shared-core/src/ai/workerRuntime.ts'),{createAIWorkerRequest}=require('./shared-core/src/ai/workerProtocol.ts'),{createDeck}=require('./shared-core/src/lib/deck.ts'),{getRuleProfile,resolvePlay}=require('./shared-core/src/lib/rules.ts'),{runAiTurns}=require('./shared-core/src/ai/simulation.ts'),{createSeededRandom}=require('./shared-core/src/ai/random.ts'),{createRuleMemoService}=require('./shared-core/src/ai/ruleMemo.ts');
const profile=getRuleProfile('classic'),deck=createDeck(2),card=rank=>deck.find(c=>c.suit==='spade'&&c.rank===rank),self=[card(3)],ids=['p1','p2','p3','p4'];
let hiddenReads=0;
const hidden=()=>new Proxy(new Array(2),{get(target,key){if(key==='length')return target.length;hiddenReads++;throw new Error('hidden hand accessed: '+String(key));}});
const state={currentLevel:2,ruleProfile:profile,players:Object.fromEntries(ids.map((id,i)=>[id,{id,name:id,isAI:id!=='p1',role:'normal',team:i%2?'teamB':'teamA',hand:id==='p2'?self:hidden()}])),turnOrder:ids,currentTurn:'p2',playArea:[],lastValidPlay:null,finishedPlayers:[]};
const after=runAiTurns(state,'master',1);assert.equal(after.playArea.length,1);assert.equal(after.currentTurn,'p3');assert.equal(after.players.p2.hand.length,0);assert.equal(state.players.p2.hand.length,1);assert.equal(hiddenReads,0);
let injectedCalls=0;const forbiddenAI={makeDecision(){injectedCalls++;throw new Error('unexpected call');}};
for(const [s,budget] of [[state,0],[{...state,currentTurn:'p1'},12],[{...state,finishedPlayers:['p1','p3']},12]])assert.equal(runAiTurns(s,'master',budget,forbiddenAI),s);
assert.equal(injectedCalls,0);assert.throws(()=>runAiTurns(state,'master',1,{makeDecision:()=>[card(5)]}),/不属于/);
const {LocalTurnScheduler}=require('./work/guandan-cocos/tests/support/local-match/LocalTurnScheduler.ts'),queue=[],scheduler=new LocalTurnScheduler(cb=>queue.push(cb));let version=1,fired=0;
scheduler.schedule(1,v=>v===version,()=>fired++,0);scheduler.schedule(1,v=>v===version,()=>fired++,0);queue.shift()();assert.equal(fired,0);queue.shift()();assert.equal(fired,1);
scheduler.schedule(1,v=>v===version,()=>fired++,0);scheduler.cancel();queue.shift()();assert.equal(fired,1);
scheduler.schedule(1,v=>v===version,()=>fired++,0);version=2;queue.shift()();assert.equal(fired,1);
const adapterModule={exports:{}};new Function('require','exports','module',compile('./work/guandan-cocos/tests/support/local-match/SynchronousLocalAIEngine.ts'))(name=>{assert.equal(name,'../../../assets/scripts/core/generated');return {createAIEngine,createAIWorkerRuntime,createAIWorkerRequest};},adapterModule.exports,adapterModule);
const adapter=new adapterModule.exports.SynchronousLocalAIEngine({ruleProfile:profile,seed:9}),initial=adapter.checkpoint(),context={currentLevel:2,teamLevels:{teamA:2,teamB:2},roundMeta:null,ruleProfile:profile},oldHandle=adapter.runtime.handle.bind(adapter.runtime);
adapter.runtime.handle=message=>{const result=oldHandle(message);adapter.reset();return result;};
assert.equal(adapter.makeDecision(self,null,'master','teamB',state.players,'p2',context),null);assert.deepEqual(adapter.checkpoint(),initial);
const originalHandle=adapter.runtime.handle.bind(adapter.runtime);adapter.runtime.handle=message=>{const result=originalHandle(message);adapter.dispose();return result;};
assert.equal(adapter.makeDecision(self,null,'master','teamB',state.players,'p2',context),null);assert.deepEqual(adapter.checkpoint(),initial);assert.throws(()=>adapter.makeDecision(self,null,'master','teamB',state.players,'p2',context),/disposed/);
let randomSamples=0,invalidRandom=0;
for(const state of [0,0xffffffff]){const rng=createSeededRandom(3);rng.restore({algorithm:'mulberry32-v1',state});const cp=rng.checkpoint(),values=Array.from({length:100},()=>rng());values.forEach(v=>assert.ok(v>=0&&v<1));rng.restore(cp);assert.deepEqual(Array.from({length:100},()=>rng()),values);randomSamples+=values.length;for(const bad of [-1,0x100000000,0.5,NaN,Infinity]){const before=rng.checkpoint();assert.throws(()=>rng.restore({algorithm:'mulberry32-v1',state:bad}));assert.deepEqual(rng.checkpoint(),before);invalidRandom++;}}
const metrics={cacheHitPlayInfo:0,cacheMissPlayInfo:0,cacheHitCanPlay:0,cacheMissCanPlay:0},memo=createRuleMemoService({metrics,cacheLimit:2,getRuleProfile:()=>profile});
assert.equal(memo.getPlayInfo([card(3),card(5)]),null);assert.equal(memo.getPlayInfo([card(5),card(3)]),null);assert.equal(metrics.cacheHitPlayInfo,1);
const targetCards=[card(7)],resolution=resolvePlay(targetCards,profile),target={playerId:'p1',cards:targetCards,type:resolution.type,resolution};assert.equal(memo.canPlay([card(3)],target),false);assert.equal(memo.canPlay([card(3)],target),false);assert.equal(metrics.cacheHitCanPlay,1);
memo.getPlayInfo([card(3)]);memo.getPlayInfo([card(5)]);const misses=metrics.cacheMissPlayInfo;memo.getPlayInfo([card(3),card(5)]);assert.equal(metrics.cacheMissPlayInfo,misses+1);memo.clear();const missesAfterClear=metrics.cacheMissCanPlay;memo.canPlay([card(3)],target);assert.equal(metrics.cacheMissCanPlay,missesAfterClear+1);
console.log(JSON.stringify({simulation:{actions:after.playArea.length,hiddenReads,stopConditions:3,illegalInjectedDecisionRejected:true},retiredAdapter:{schedulerCases:4,generationCases:2,disposedRejected:true},random:{samples:randomSamples,rejectedAtomic:invalidRandom},memo:{nullAndFalseHits:true,lruAndClear:true}}));
NODE
```

实测输出：simulation actions=1、hiddenReads=0、stopConditions=3；schedulerCases=4、generationCases=2；random samples=200、rejectedAtomic=10；memo null/false 命中、LRU、clear 通过。无 hard deadline、手机性能或异步传输质量结论。

## 边界与后续

只有表列 8 文件计完整覆盖；辅助读取和已审旧文件不扩充分子。零新增 finding 不代表全仓无问题。将来重新引入本地/异步 worker 时，应把 C01 的连续 checkpoint 跨级用例和真实响应接纳/取消测试纳入接入门槛；此处没有代替用户实施修复。
