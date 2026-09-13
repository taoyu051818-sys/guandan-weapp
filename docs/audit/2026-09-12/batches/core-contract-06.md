# core-contract-06：公共契约与回归断言

审阅人 `/root/audit_core_rules`，2026-09-12；仓库 `/Users/mac/Documents/Codex/2026-08-02/wo-yi`；HEAD `1d58999dc6e5455b049e1643660bbba3deee1406`。

完整审阅 **9 文件、898 行**（任务预估约 996 行，按源码实数记），开批 README/STATUS/coverage 基线 156/629、更新时间 `2026-09-12T07:15:06.232Z`，九项均 pending。新增 1 项 P3 **测试断言盲点**，不表示当前业务抗贡错误；无新增 concern。逐文件 SHA-256/notes 见同名 JSON，结束前再次核对。

## CORE-CONTRACT-06-001 / P3：免抗贡事件断言检查了不存在的名字

位置：`shared-core/tests/match-format.test.ts:102`。

目标测试“starts the next independent hand at its supplied authoritative level without tribute”检查 `result.events.some(event => event.type === 'ANTI_TRIBUTE')` 为 false。实际 `GameEvent` 名为 `ANTI_TRIBUTE_DECLARED`（`shared-core/src/lib/engine.ts:142`），当前实现由 `shared-core/src/lib/tribute.ts:177` 发出该名。旧名不存在，因此这条断言不能检出真实命名的抗贡事件误入独立局。

内存验证先从真实升级局 prepare 取得 `{ type: 'ANTI_TRIBUTE_DECLARED', mode: 'double' }`，将其追加至真实独立局 prepare 结果，再运行原目标 `it` 的完整函数体：六个断言仍全部通过。仅在内存将名字更正为 `ANTI_TRIBUTE_DECLARED` 后，同一变异被拒绝。完整探针 1 如下。

影响只限这一回归的漏检能力。**当前未变异的独立局实现没有错误抗贡事件**，且测试中其他 state/tribute/roundMeta 断言仍有效；不报告错误发牌或线上事故。建议另行修复事件名，或断言完整允许事件集合并加入变异对照。当前 `tsconfig.json` 只包括 src，Vitest 转译测试，因此源码类型检查通过并不能发现测试内这个名字错误。本任务未修改产品或测试断言。

## 公共契约核验

- index 的 18 组重导出经真实加载和 `tsc --noEmit`；lib/ai 是主 AI 入口的同绑定兼容重导出，不是另一套策略。四个旧可变贡还 API 不再暴露，automaticReturnCard 仍保留。旧兼容 engine/模拟问题仍引用既有 `CORE-RULES-01-001/002`，不重复报。
- protocol 包含 31 项需 requestId 命令、6 项需 expectedVersion 命令。正安全 requestId / 非负安全 version、missing/stale 分支用各 578 个输入矩阵验证。Readonly/union 不是运行时安全保证，但真实普通 gateway + game handler + game-session 会分别验证版本、从连接推导 playerId、从权威 state 推导 roundId/revision；探针 2 确认伪造 payload 中三个字段不会覆盖权威值。
- 普通 gateway 拒绝 updateState/未知协议；未知 type 不在协议表时 helper 返回 null 并不表示实际路由接受它。ViewerCard 类型允许明暗牌是投影契约，不因此推断隐藏牌泄漏；selection domain events 当前仅带 playerId，transfer 后才公布卡 ID。
- `LobbyCommandSender.ts:30` 按共享分类填入 gameVersion。`weapp-ws.js` 在普通 gateway 前分流复式，复式 runtime 独立要求正安全 requestId；其 fillBots/watchTable 未在共享列表不能直接算漏鉴权。复式 `playDuplicate` 对 expectedVersion 采用提供才比较的既有边界，本批未证明因此产生错误业务结果，不升级缺陷。

## 九文件的实际覆盖

| 文件 | 行数 | 实际检查/断言范围 |
| --- | ---: | --- |
| src/index.ts | 18 | 18 组重导出、运行时绑定与类型检查 |
| src/lib/ai.ts | 1 | 兼容入口只重导出主 AI |
| src/protocol.ts | 170 | 命令分类、viewer 类型、数值边界、实际调用 |
| tests/context-resolution.test.ts | 201 | 5 测试：Plate/Tube、最小足够三带二、记录解释、炸弹/四王/配花色 |
| tests/engine-transition.test.ts | 146 | 5 测试：一次 revision、5 类拒绝不变、收轮/接风、原子结算 |
| tests/turn-immutability.test.ts | 117 | 2 测试：事件与 state 牌数据/基础 resolution、结算嵌套数据隔离 |
| tests/round-meta-authority.test.ts | 51 | 2 测试：prepare provenance、旧贡还 API 导出边界 |
| tests/variant-rules.test.ts | 71 | 4 测试：3 套记分、轮转、52 配对标记、JSON/prepare 积分延续 |
| tests/match-format.test.ts | 123 | 9 测试：个人排名、关口/A 失败、13 桶级数、独立局记分/prepare/配置；上述错名断言 |

测试使用局部合成状态和直接写入 finishedPlayers 的结算夹具，不伪称每条都从发牌打到结算。turn-immutability 覆盖实际触及的字段，不是任意全状态深冻结证明。随机级数测试验证 13 个区间中点的映射，不是统计随机性证明。context-resolution 最后一项分别比较同花、混花两手，不代表单手所有歧义穷举。辅助文件清单见 JSON，不加入九文件覆盖。

## 已执行安全检查

读取过配置/测试后执行；没有 build/clean、未生成输出，Vitest 关闭缓存。

```sh
cd /Users/mac/Documents/Codex/2026-08-02/wo-yi/shared-core
node_modules/.bin/vitest run --cache=false tests/context-resolution.test.ts tests/engine-transition.test.ts tests/turn-immutability.test.ts tests/round-meta-authority.test.ts tests/variant-rules.test.ts tests/match-format.test.ts
node_modules/.bin/tsc --noEmit -p tsconfig.json
```

2026-09-12 15:21:25（Asia/Shanghai），Node v26.7.0 / Vitest 4.1.10：6 文件 / 27 测试通过；源码类型检查通过（不包含测试文件）。以下两段均在仓库根目录执行，仅内存 TypeScript 转译、合成数据和本地模块读取。

### 探针 1：执行原测试体并注入真实事件名

原 `it` 函数体完全保留；最小 expect 适配器只实现该函数使用的 toBe/toHaveLength/toMatchObject，用 Node assert 检查；不是宣称运行整套 Vitest 变异测试。baseline 和变异都执行同一原测试的六个断言。

```sh
node <<'NODE'
const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('./shared-core/node_modules/typescript');const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;require.extensions['.ts']=(m,f)=>m._compile(compile(fs.readFileSync(f,'utf8')),f);
const core=require('./shared-core/src/index.ts'),seeded=require('./shared-core/src/ai/random.ts').createSeededRandom,source=fs.readFileSync('shared-core/tests/match-format.test.ts','utf8'),testName='starts the next independent hand at its supplied authoritative level without tribute';
const initial=core.createGame(2,'p1',core.getRuleProfile('classic'),seeded(9)),base=core.createMatchState({...initial,levelTeam:'teamA',teamLevels:{teamA:2,teamB:2},dealerId:'p1'}),settled=core.settleMatchState({...base,finishedPlayers:['p1','p3']}).state;
const actual=core.transition(settled,{type:'PREPARE_NEXT_ROUND',roundId:settled.roundId,expectedRevision:settled.revision,dealtHands:core.dealCards(core.createDeck(5))});assert.equal(actual.ok,true);const realEvent=actual.events.find(e=>e.type==='ANTI_TRIBUTE_DECLARED');assert.deepEqual(realEvent,{type:'ANTI_TRIBUTE_DECLARED',mode:'double'});
const partial=(value,expected)=>{if(expected&&typeof expected==='object'){for(const key of Object.keys(expected))partial(value[key],expected[key]);}else assert.deepEqual(value,expected);};
const run=(text,inject)=>{let ran=0,assertions=0,injected=0;const expect=value=>({toBe:expected=>{assertions++;assert.equal(value,expected);},toHaveLength:expected=>{assertions++;assert.equal(value.length,expected);},toMatchObject:expected=>{assertions++;partial(value,expected);}});const vitest={describe:(_name,callback)=>callback(),it:(name,callback)=>{if(name===testName){ran++;callback();}},expect};const exports={};new Function('require','exports','module',compile(text))(name=>{if(name==='vitest')return vitest;assert.equal(name,'../src');return {...core,transition:(...args)=>{const result=core.transition(...args);if(inject&&result.ok&&args[0].matchFormat?.kind==='independent'&&args[1].type==='PREPARE_NEXT_ROUND'){injected++;return {...result,events:[...result.events,{...realEvent}]};}return result;}};},exports,{exports});assert.equal(ran,1);return {ran,assertions,injected};};
const baseline=run(source,false),mutant=run(source,true);assert.equal(mutant.injected,1);assert.throws(()=>run(source.replace("event.type === 'ANTI_TRIBUTE'","event.type === 'ANTI_TRIBUTE_DECLARED'"),true),assert.AssertionError);console.log(JSON.stringify({realEvent,baseline,mutantOriginalAssertionPassed:mutant,correctedAssertionRejectedMutant:true,scope:'test-only mutation; current independent production transition does not emit anti-tribute'}));
NODE
```

实测 baseline `{ran:1,assertions:6,injected:0}`；旧断言变异仍通过 `{ran:1,assertions:6,injected:1}`；内存更正后的断言拒绝变异。没有修改任何测试/业务文件。

### 探针 2：真实普通命令链与协议边界

导入 gateway/router/game handler/game-session 的真实模块（不导入整个服务器入口），把 game-session 对 dist 的 require 临时映射到当前源码导出。房间、send、持久提交为内存端口，不开 socket、不触碰真实数据。10 个失败场景验证零业务修改；正常带伪造 actor/round/revision 的客户端请求仍由真实 handler/session/core 使用权威字段。

```sh
node <<'NODE'
const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('./shared-core/node_modules/typescript'),Module=require('node:module'),{pathToFileURL}=require('node:url'),path=require('node:path');require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,f);
const core=require('./shared-core/src/index.ts'),compat=require('./shared-core/src/lib/ai.ts'),ai=require('./shared-core/src/ai/index.ts');assert.equal(core.createAIEngine,compat.createAIEngine);assert.equal(core.runAiTurns,compat.runAiTurns);assert.deepEqual(Object.keys(compat).sort(),Object.keys(ai).sort());for(const name of ['createTribute','giveTribute','returnTribute','tributeLeader'])assert.equal(name in core,false);
const values=[undefined,null,false,true,'1',{},[],NaN,Infinity,-Infinity,-1,0,0.5,1,2,Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER+1];let requestChecks=0,versionChecks=0;for(const type of [...core.MUTATING_COMMAND_TYPES,'listRooms','ping','unknown'])for(const value of values){assert.equal(core.validateCommandRequestId(type,value)===null,!core.MUTATING_COMMAND_TYPES.includes(type)||(Number.isSafeInteger(value)&&value>0));requestChecks++;const result=core.validateExpectedVersion(type,value,2),versioned=core.VERSIONED_ROOM_COMMAND_TYPES.includes(type);assert.equal(result?.code??null,!versioned?null:!Number.isSafeInteger(value)||value<0?'missing-version':value!==2?'stale-version':null);versionChecks++;}
(async()=>{const server=name=>import(pathToFileURL(path.resolve('work/guandan-windows-source/server/'+name)));const originalLoad=Module._load;Module._load=function(request,parent,isMain){if(request==='../../../shared-core/dist')return core;return originalLoad.apply(this,arguments);};const[{createCommandGateway},{createCommandRouter},{createGameCommandHandler,GAME_COMMAND_TYPES},{dispatchMatchIntent}]=await Promise.all(['weapp-command-gateway.js','weapp-command-router.js','weapp-game-command-handler.js','game-session.js'].map(server));Module._load=originalLoad;
const ids=['p1','p2','p3','p4'],deck=core.createDeck(2),players=Object.fromEntries(ids.map((id,i)=>[id,{id,name:id,team:i%2?'teamB':'teamA',isAI:false,role:'normal',hand:deck.filter(c=>c.suit==='spade'&&c.rank===i+3).slice(0,2)}]));let state=core.createMatchState({ruleProfile:core.getRuleProfile('classic'),currentLevel:2,levelTeam:'teamA',teamLevels:{teamA:2,teamB:2},dealerId:'p1',players,roundId:3,revision:7});const room={roomId:'audit',version:11,gameVersion:7,state,trustees:{},matchEnded:null},rooms=new Map([['audit',room]]),connection={id:'own',roomId:'audit',acceptedCacheKeys:new Map()},sent=[];let applied=0,commits=0;const playerIn=(_room,id)=>id==='own'?'p1':null,send=(_c,type,body)=>sent.push({type,...body});const handler=createGameCommandHandler({ids,rooms,playerIn,ensureLiveMetadata:()=>{},applyPlayerAction:(target,intent)=>{const result=dispatchMatchIntent(target.state,intent);if(!result.ok)throw new Error(result.reason);applied++;target.state=result.state;target.gameVersion=result.state.revision;target.version++;return result;},commitPlayerAction:async(target,outcome,options)=>options.acceptance.accept(target)});const gateway=createCommandGateway({rooms,acceptedActions:new Map(),idempotentActionTypes:new Set(),actionCacheKey:()=>null,actionFingerprint:()=>'',validateCommandRequestId:core.validateCommandRequestId,validateExpectedVersion:core.validateExpectedVersion,playerIn,isFriendRoom:()=>false,commitRuntimeState:async()=>{commits++;},stagePendingSideEffects:()=>{},rememberAccepted:()=>{},listRooms:()=>[],send,router:createCommandRouter([{types:GAME_COMMAND_TYPES,handle:handler}])});
let rejected=0;const invalid=[{type:'play',payload:{cardIds:[players.p1.hand[0].id],expectedVersion:7}},{type:'play',requestId:0,payload:{expectedVersion:7}},{type:'play',requestId:1,payload:{cardIds:[],expectedVersion:6}},{type:'play',requestId:2,payload:{cardIds:[]}},{type:'play',requestId:3,payload:{cardIds:[players.p2.hand[0].id],expectedVersion:7}},{type:'play',requestId:4,payload:{cardIds:[players.p1.hand[0].id,players.p1.hand[0].id],expectedVersion:7}},{type:'play',requestId:5,payload:{cardIds:{bad:true},expectedVersion:7}},{type:'updateState',requestId:6,payload:{state:{}}},{type:'unknown',requestId:7}];for(const message of invalid){const before=JSON.stringify(room);await gateway(connection,message);assert.equal(sent.at(-1).type,'error');assert.equal(JSON.stringify(room),before);rejected++;}await gateway({...connection,id:'observer'}, {type:'play',requestId:8,payload:{expectedVersion:7,cardIds:[players.p1.hand[0].id]}});assert.equal(sent.at(-1).code,'OBSERVER_READ_ONLY');assert.equal(applied,0);rejected++;
await gateway(connection,{type:'play',requestId:9,payload:{roomId:'audit',expectedVersion:7,cardIds:[players.p1.hand[0].id],playerId:'p2',roundId:999,expectedRevision:999}});assert.equal(applied,1);assert.equal(commits,1);assert.equal(sent.at(-1).type,'actionAccepted');assert.equal(room.state.lastValidPlay.playerId,'p1');assert.equal(room.state.roundId,3);assert.equal(room.state.revision,8);assert.equal(room.state.currentTurn,'p2');console.log(JSON.stringify({requestChecks,versionChecks,aliasExportsMatch:true,retiredExportsAbsent:true,gatewayRejectedWithoutMutation:rejected,authoritativeActor:'p1',authoritativeRound:3,committedRevision:8,currentTurn:'p2',scope:'real gateway/router/game-handler/session/core; memory ports, no network or persistence'}));})().catch(error=>{console.error(error);process.exitCode=1;});
NODE
```

实测 requestChecks=578、versionChecks=578、gatewayRejectedWithoutMutation=10；成功提交 actor=p1、round=3、revision=8、下一席 p2。此探针未测试真实持久队列/回执回滚；相关已确认问题沿用其他批次编号。

## 完成边界

九个 reviewed 源哈希、HEAD 和原有五处 dirty 哈希收尾保持一致。只添加本批 MD/JSON，没有改产品/测试/生成副本，也没有提交、构建、部署或更新 manifest/coverage/STATUS。辅助阅读不计覆盖；本批测试通过及契约探针不等于全仓已健康。
