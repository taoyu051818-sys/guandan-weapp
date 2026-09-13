# core-team-05：公开推断与队伍头游策略

2026-09-12；审阅人 `/root/audit_core_rules`；仓库 `/Users/mac/Documents/Codex/2026-08-02/wo-yi`；HEAD `1d58999dc6e5455b049e1643660bbba3deee1406`。

本批完整审阅 **9 文件、711 行**，新增确认 finding 0，新增 concern 0。任务预估的 811 行与当前源码不符，按实际 711 行记。开批阅读 README / STATUS / coverage，九项在 `2026-09-12T07:01:51.629Z` 的 128/629 清单均 pending。完整 SHA-256 与逐文件 notes 在同名 JSON，结尾再次核对；辅助阅读不计覆盖，不更新总清单。

## 结论

- 真实调用：`decisionRunner.ts:41-50` 先把玩家变成 id/team/count，然后调用唯一 `chooseTeamPlay`；`handHintPolicy.ts:93-94` 共用同一策略。服务端 `master-bot-policy.js:45-48` 在进入 engine 之前再裁掉对手牌面；现场提示 `LocalHandSelectionController.ts:98-104` 仅构造公开座位及公开历史。26 局真实状态机 probe 中 2,484 次决策没有一次读取对手牌面。
- `policy.ts:58-66` 终手优先、对家控牌让牌、无合法候选退让；`:74-83` 只有公开库存覆盖足够且单张敌人危险、反超可安全控牌时才保护对家；`:93-103` 硬优先层先于评分；`:130-141` 只在最高层近分候选里随机。有限固定样本覆盖了开局保炸、让牌、喂对家、阻止敌方冲刺、直接终手及真实保护对家分支，未把某张牌的个人偏好当 bug。
- `belief.ts:42-60` 按物理 ID 去重、按牌面从双副库存扣除本手与公开牌，联合无放回采样；`:12-34,74-84` 过牌只作为软证据，后来打出的牌加回过去时点，对家让牌只施加很弱惩罚。公开证明不能压时为 0，否则保留小概率不确定性。模型明确不是校准胜率。
- `holdingShapes.ts` 的红心配不能替王、天然级牌不能作序列牌、同花顺 5.5、纯天然同花顺不能同时当普通顺、四王/三带二/序列开关与权威规则一致。本批 1,014 手牌、92,517 结构候选精确对照未发现差异。
- `handRoute.ts` 的同牌面计数位图适用于合法最多 27 张本手；有单牌后备、确定性节点/分支上限、近似结果标记。26 个 9 张手牌全子集分割 oracle 与 348 个出牌后路线的手数/单张数一致。整手路线只估计合法出完所需步数，不是保有出牌权或强制获胜证明。
- `handStrength.ts` 的炸弹/王/高牌/配和对家冲刺阈值是启发式；`parameters.ts:20-23` 九项冻结参数共同供最高档使用，没有引擎/网络参数切换低档。调参脚本命中不等于生产入口，本批未运行会复制/生成产物的调参脚本，也未独立复核注释里的历史竞赛统计。
- `tableOutlook.ts:12-29` 按实际席序推进 reach，头游到达后不再让后续席位稀释结果，零手牌不参与。真实 belief 保持 `0 <= finish <= beat <= 1`，本批 324 概率和 108 outlook 边界检查通过。
- `journal.ts:16-46` 限八条/60,000 字符和嵌套合法值；`:52-59` 复制隔离、换 roundId 清空、恢复先校验后替换。真实 2,484 份日志均可恢复校验、最大 12,546 字节；19 类坏恢复不改变旧记录。日志只用于诊断/检查点，不进入后续决策输入。当前 bot checkpoint 在 room/table 上，普通 publisher 与复式 snapshot 只投影 state 和列举元数据，没有发现把 team journal 发送给玩家的路径。

## 不升级为缺陷的边界

`historyComplete` 随 observation 传入，但没有直接控制模型；`belief.coverage` 实际按所需未知牌数/未知牌池算库存覆盖，不是校准置信度。常规活动 bot/hint 传入公开历史，缺省提示路径公开信息不足时也不能仅凭 flag 未用就推断错误反超。`finishedPlayers` 本身未参与模型，实际按公开剩余牌数过滤已出完玩家；权威正常状态保持两者一致。没有把非法座位顺序、超 31 张手牌或直接注入非法候选当成生产事故。

团队模块的 belief、planner、resolution memo 每次决策新建；journal 不作为策略输入。外层缓存跨级风险仍是已有 `CORE-AI-03-C01`，这里不重复编号或升级；生产换局 reset / 冷重建防线见前三/四批。

## 完整文件

| shared-core/src/ai/team/ 下文件 | 行数 |
| --- | ---: |
| belief.ts | 114 |
| handRoute.ts | 123 |
| handStrength.ts | 48 |
| holdingShapes.ts | 100 |
| journal.ts | 61 |
| parameters.ts | 23 |
| policy.ts | 151 |
| tableOutlook.ts | 33 |
| types.ts | 58 |

## 安全与既有测试

先检查 package/test 内容：以下仅 Vitest 读取与内存计算，关闭缓存，不执行 build/clean。源码探针使用内存 TypeScript 转译，不写 dist、生成副本、网络或真实用户数据。

```sh
cd /Users/mac/Documents/Codex/2026-08-02/wo-yi/shared-core
node_modules/.bin/vitest run --cache=false tests/ai-team-model.test.ts tests/ai-team-policy.test.ts tests/ai-team-parameters.test.ts tests/ai-strength-hints.test.ts tests/ai-engine.test.ts tests/hand-hint-policy.test.ts
```

2026-09-12 15:05:59（Asia/Shanghai），Node v26.7.0 / Vitest 4.1.10：6 文件、66 测试通过。

以下三个完整探针均在仓库根目录执行。

### 探针 1：能力摘要与全子集路线 oracle

牌型摘要直接对照权威 `getPlayInfos`；能力聚合检查验证只保留每类型/长度最大值不丢失 `holdingCanBeat` 能力，未冒称另写了独立炸弹比较器。路线 oracle 枚举 9 张手牌的所有物理子集，与 planner 实现独立。

```sh
node <<'NODE'
const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('./shared-core/node_modules/typescript');require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,f);
const {createDeck,shuffleDeck}=require('./shared-core/src/lib/deck.ts'),{getPlayInfo,getPlayInfos,getRuleProfile}=require('./shared-core/src/lib/rules.ts'),{structuralLegalMoves}=require('./shared-core/src/lib/legalMoves.ts'),{createSeededRandom}=require('./shared-core/src/ai/random.ts'),{summarizeHolding,holdingCanBeat}=require('./shared-core/src/ai/team/holdingShapes.ts'),{createHandRoutePlanner}=require('./shared-core/src/ai/team/handRoute.ts');
const levels=[2,3,4,5,6,7,8,9,10,'J','Q','K','A'],random=createSeededRandom(912005),sorted=m=>[...m].map(([k,v])=>[k,typeof v==='number'?v:v.maxValue]).sort();let shapeHands=0,moveCount=0,capabilityChecks=0,partitionHands=0,partitionStates=0,afterChecks=0,maxNodes=0;
for(const preset of ['classic','tournament'])for(const level of levels){const profile=getRuleProfile(preset),deck=createDeck(level),wild=deck.filter(c=>c.isRedJoker);const hands=Array.from({length:27},(_,n)=>shuffleDeck(deck,random).slice(0,n+1));for(let w=0;w<=2;w++)for(const rank of [3,7,'A','Big'])hands.push([...deck.filter(c=>c.rank===rank&&!c.isRedJoker).slice(0,6),...wild.slice(0,w)]);
for(const hand of hands){const moves=structuralLegalMoves(hand,profile),expected=new Map(),resolutions=[];for(const move of moves)for(const info of getPlayInfos(move,profile)){const key=info.type+':'+move.length;expected.set(key,Math.max(expected.get(key)??-1,info.maxValue));resolutions.push({...info,length:move.length});}const summary=summarizeHolding(hand,profile);assert.deepEqual(sorted(summary),sorted(expected),JSON.stringify({preset,level,hand}));shapeHands++;moveCount+=moves.length;for(const target of resolutions.slice(0,12))for(const whole of [undefined,hand.length]){const expectedBeat=resolutions.some(candidate=>(whole===undefined||candidate.length===whole)&&holdingCanBeat(new Map([['only',candidate]]),target,target.length));assert.equal(holdingCanBeat(summary,target,target.length,whole),expectedBeat);capabilityChecks++;}}
const hand=shuffleDeck(deck,random).slice(0,9),full=(1<<hand.length)-1,legal=[];for(let mask=1;mask<=full;mask++){const cards=hand.filter((c,i)=>mask&(1<<i)),info=getPlayInfo(cards,profile);if(info)legal.push({mask,single:Number(cards.length===1)});}const cache=new Map([[0,{turns:0,singles:0}]]);const brute=mask=>{if(cache.has(mask))return cache.get(mask);const pivot=mask&-mask;let best={turns:Infinity,singles:Infinity};for(const move of legal){if(!(move.mask&pivot)||(move.mask&mask)!==move.mask)continue;const tail=brute(mask^move.mask),candidate={turns:tail.turns+1,singles:tail.singles+move.single};if(candidate.turns<best.turns||(candidate.turns===best.turns&&candidate.singles<best.singles))best=candidate;}cache.set(mask,best);return best;};const moves=structuralLegalMoves(hand,profile),planner=createHandRoutePlanner(hand,moves,profile);const check=(estimate,mask)=>{assert.equal(estimate.exact,true);assert.deepEqual({turns:estimate.turns,singles:estimate.singles},brute(mask));};check(planner.whole(),full);for(const move of moves){let mask=full;for(const c of move)mask&=~(1<<hand.findIndex(x=>x.id===c.id));check(planner.after(move),mask);afterChecks++;}assert.ok(planner.nodes()<=1600);maxNodes=Math.max(maxNodes,planner.nodes());partitionHands++;partitionStates+=cache.size;
}
console.log(JSON.stringify({shapeHands,moveCount,capabilityChecks,partitionHands,partitionStates,afterChecks,maxNodes}));
NODE
```

实测：`shapeHands=1014, moveCount=92517, capabilityChecks=20100, partitionHands=26, partitionStates=1864, afterChecks=348, maxNodes=109`。

### 探针 2：26 局真实 transition + 隐藏牌面零读取

这是固定种子合法发牌与真实公开出牌历史，不是仅构造几个评分对象；使用 master engine、实际合法动作提交，直至结算。对手手牌 Proxy 只允许读取 length。此探针不是胜率竞赛，也不证明所有牌局或最优策略。

```sh
node <<'NODE'
const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('./shared-core/node_modules/typescript');require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,f);
const {createAIEngine}=require('./shared-core/src/ai/engine.ts'),{createGame,createMatchState,transition}=require('./shared-core/src/lib/engine.ts'),{getRuleProfile,canPlay}=require('./shared-core/src/lib/rules.ts'),{createSeededRandom}=require('./shared-core/src/ai/random.ts'),{validateTeamRecords}=require('./shared-core/src/ai/team/journal.ts');
const levels=[2,3,4,5,6,7,8,9,10,'J','Q','K','A'];let games=0,decisions=0,hiddenReads=0,checkpoints=0,maxNodes=0,maxJournalBytes=0;const reasons={};
for(const preset of ['classic','tournament'])for(const [index,level]of levels.entries()){const ruleProfile=getRuleProfile(preset),initial=createGame(level,'p1',ruleProfile,createSeededRandom(912500+index),'random');let state=createMatchState({...initial,levelTeam:'teamA',teamLevels:{teamA:level,teamB:level},dealerId:'p1'});const engine=createAIEngine({ruleProfile,seed:925000+index});let steps=0;
while(state.phase==='playing'&&steps++<1000){const id=state.currentTurn,self=state.players[id],players=Object.fromEntries(Object.entries(state.players).map(([seat,p])=>[seat,{...p,hand:seat===id?p.hand:new Proxy(new Array(p.hand.length),{get(target,key){if(key==='length')return target.length;hiddenReads++;throw new Error('hidden face access');}})}]));const context={currentLevel:level,teamLevels:state.teamLevels,roundMeta:state.roundMeta,ruleProfile,turnOrder:state.turnOrder,publicHistory:state.playHistory,finishedPlayers:state.finishedPlayers,roundId:state.roundId,revision:state.revision};const play=engine.makeDecision(self.hand,state.lastValidPlay,'master',self.team,players,id,context);assert.ok(play?canPlay(play,state.lastValidPlay,ruleProfile):state.lastValidPlay);if(play)assert.ok(play.every(card=>self.hand.some(own=>own.id===card.id)));const journal=engine.checkpoint().teamDecisions;assert.deepEqual(validateTeamRecords(journal),journal);assert.ok(journal.length<=8);maxJournalBytes=Math.max(maxJournalBytes,JSON.stringify(journal).length);maxNodes=Math.max(maxNodes,engine.getLastMetrics().endgameNodes);const reason=engine.getLastDecisionTrace().team.reason;reasons[reason]=(reasons[reason]??0)+1;const result=transition(state,{type:play?'PLAY_CARDS':'PASS',playerId:id,...(play?{cardIds:play.map(c=>c.id)}:{}),roundId:state.roundId,expectedRevision:state.revision});assert.equal(result.ok,true,result.reason);state=result.state;decisions++;checkpoints++;}assert.equal(state.phase,'settled');games++;}
assert.equal(hiddenReads,0);assert.ok(maxNodes<=1600);console.log(JSON.stringify({games,decisions,hiddenReads,checkpoints,maxNodes,maxJournalBytes,reasons}));
NODE
```

实测：26 局、2,484 次决策和日志校验；hiddenReads=0，maxNodes=350，maxJournalBytes=12546。分支：开局保控制 26、队伍路线 762、保留炸弹 293、对家让牌 488、无候选 610、直接终手 64、喂对家 65、阻止敌方冲刺 175、保护对家 1。

### 探针 3：公开库存/概率不变量与日志恢复边界

这里的完整公开库存专门测试扣牌、概率范围和去重，历史按单张合成，不宣称是合法连续对局；合法完整历史已由探针 2 验证。日志恢复测试对每次失败验证旧内容保持。

```sh
node <<'NODE'
const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('./shared-core/node_modules/typescript');require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,f);
const {createTeamJournal,validateTeamRecords}=require('./shared-core/src/ai/team/journal.ts'),{createPublicBelief}=require('./shared-core/src/ai/team/belief.ts'),{createDeck}=require('./shared-core/src/lib/deck.ts'),{getRuleProfile,getPlayInfo}=require('./shared-core/src/lib/rules.ts'),{createSeededRandom}=require('./shared-core/src/ai/random.ts'),{estimateTableOutlook}=require('./shared-core/src/ai/team/tableOutlook.ts'),{PlayType}=require('./shared-core/src/types/game.ts');
const clone=v=>JSON.parse(JSON.stringify(v)),profile=getRuleProfile('classic'),deck=createDeck(2),hand=deck.slice(0,4),history=deck.slice(13).map(card=>({playerId:'p4',cards:[card],type:PlayType.Single}));const view={hand,self:'p1',team:'teamA',level:2,profile,seats:['p1','p2','p3','p4'].map((id,i)=>({id,team:i%2?'teamB':'teamA',count:[4,2,3,4][i]})),order:['p1','p2','p3','p4'],lastPlay:null,history,historyComplete:true,finishedPlayers:[]};const before=JSON.stringify(view),belief=createPublicBelief(view,createSeededRandom(9)),withLast=createPublicBelief({...view,lastPlay:history.at(-1)},createSeededRandom(9));assert.equal(belief.coverage,1);assert.deepEqual(belief.summaries,withLast.summaries);let probabilityChecks=0;
for(const card of deck){const info=getPlayInfo([card],profile);for(const seat of ['p2','p3','p4']){const beat=belief.probability(seat,info,1),finish=belief.probability(seat,info,1,true);assert.ok(beat>=0&&beat<=1&&finish>=0&&finish<=beat);probabilityChecks++;}const outlook=estimateTableOutlook(view,info,1,belief.probability);for(const p of Object.values(outlook))assert.ok(p>=0&&p<=1);assert.ok(outlook.enemyFinish+outlook.allyFinish<=1+1e-12);}
assert.equal(belief.probability('p2',getPlayInfo(deck.filter(c=>c.rank==='Small'),profile),2,true),0);assert.equal(JSON.stringify(view),before);
const record={policy:'team-first-v1',objective:'team-first-place',player:'p1',roundId:1,revision:1,reason:'team_exit_route',priority:50,selected:['card-1'],estimatedTurns:1,historyCoverage:1,sampleCount:32,beliefs:[{player:'p2',count:3,shapes:{[PlayType.Single]:0.5}}],strength:{tier:'balanced',plan:'develop',controls:1,turns:1,singles:1},candidates:[{cards:['card-1'],type:PlayType.Single,score:1,probability:1,turns:1,allyFinish:0,enemyFinish:0,control:1}]};
const journal=createTeamJournal();for(let revision=1;revision<=10;revision++)journal.add({...record,revision});assert.deepEqual(journal.checkpoint().map(r=>r.revision),[3,4,5,6,7,8,9,10]);const snapshot=journal.checkpoint();snapshot[0].selected.length=0;assert.equal(journal.checkpoint()[0].selected.length,1);const frozen=journal.checkpoint();const mutations=[r=>r.policy='other',r=>r.objective='self',r=>r.player='p5',r=>r.reason='x'.repeat(81),r=>r.selected=['x'.repeat(129)],r=>r.priority=101,r=>r.estimatedTurns=28,r=>r.historyCoverage=-1,r=>r.sampleCount=33,r=>r.roundId=-1,r=>r.revision=Infinity,r=>r.beliefs[0].count=28,r=>r.beliefs[0].shapes[PlayType.Single]=2,r=>r.strength.controls=Infinity,r=>r.strength.plan='other',r=>r.candidates[0].score=Infinity,r=>r.candidates[0].probability=-1,r=>r.candidates[0].enemyFinish=2];for(const mutate of mutations){const bad=clone(record);mutate(bad);assert.throws(()=>journal.restore([bad]));assert.deepEqual(journal.checkpoint(),frozen);}
assert.throws(()=>journal.restore(Array.from({length:9},()=>record)));assert.deepEqual(journal.checkpoint(),frozen);journal.add({...record,roundId:2});assert.equal(journal.checkpoint().length,1);assert.equal(journal.checkpoint()[0].roundId,2);journal.restore(undefined);assert.deepEqual(journal.checkpoint(),[]);journal.add(record);journal.reset();assert.deepEqual(journal.checkpoint(),[]);assert.deepEqual(validateTeamRecords([record]),[record]);console.log(JSON.stringify({probabilityChecks,beliefDuplicateCurrentPlayInvariant:true,publicInputUnchanged:true,journalRetention:8,rejectedAtomic:mutations.length+1,roundChangeClears:true,legacyUndefinedAndResetEmpty:true}));
NODE
```

实测 324 概率、108 outlook 边界检查通过；日志最新八条保留、复制隔离、19 次非法恢复原子拒绝、换局清空、legacy undefined/reset 清空通过。

## 完成边界

原有五处 dirty 的哈希和 HEAD 保持不变，九个 reviewed 哈希在收尾重核；只写本批 MD/JSON。没有修复产品、修改测试断言、生成文件、提交、部署或读取真实数据/秘密。零发现不代表策略最优、模型概率经过实测校准或全仓已健康；只有这九份目标文件进入本批覆盖。
