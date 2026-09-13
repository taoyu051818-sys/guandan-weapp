# 最高档 AI、候选服务与提示审计：core-ai-03

- 日期：2026-09-12；仓库：`/Users/mac/Documents/Codex/2026-08-02/wo-yi`。
- HEAD：`1d58999dc6e5455b049e1643660bbba3deee1406`；启动时五处用户修改保留。
- 已先重读审计 README；完整审查指定 7 个文件、400 行，前两批不重复计入。
- 本批未确认新增生产缺陷，`findings: []`；保留 1 项可复现但已检查生产路径有防护的缓存边界 concern，不计为已确认事故。
- 只写本报告与同名 JSON；未改业务、用户修改、测试、dist、Git 提交或线上状态，不刷新总清单。

## 逐文件审查

| 文件 | 行数 | 已审项目及结论 |
| --- | ---: | --- |
| `shared-core/src/ai/engine.ts` | 69 | 配置快照冻结、实例私有 RNG/规则缓存/候选缓存/日志、唯一 master runner、checkpoint 校验再恢复、restore/reset 清理、指标/trace 复制边界。未确认当前生产缺陷。reset 保留 RNG 位置是实际行为，不应假设它回到初始 seed。 |
| `shared-core/src/ai/candidates.ts` | 91 | 结构候选而非 rank-only 裁剪、跟牌权威过滤、LRU 边界、WeakMap 解析缓存、清空及指标。ID-only 缓存要求跨级 reset，见 C01；正常同一局牌义固定时与规则一致。 |
| `shared-core/src/ai/scoring.ts` | 4 | `CachedPlayInfo` 与 Bomb/StraightFlush/Rocket 的统一识别，不再存在旧档评分分支。未确认缺陷。 |
| `shared-core/src/ai/resourceProtection.ts` | 38 | 自然同点牌与配分开计数、部分炸弹/三张/对子损耗、完整组与空出牌边界、配计数、加权值及输入不变。1,716 组精确 oracle 通过。 |
| `shared-core/src/ai/decisionRunner.ts` | 59 | 规则实例不匹配拒绝、全部历史档位进入同一 master 决策、只投影其他座位队伍/余牌数、公开历史/级数/轮次/版本、同队策略调用、trace 与日志、finally 耗时指标。未确认缺陷。 |
| `shared-core/src/hints/handHintPolicy.ts` | 98 | 同一 `chooseTeamPlay`、锁牌时保留全部实体候选、只允许全用或完全不用锁组、观察信息边界、固定 seed、结果合法性与损耗元信息。312 个视图的首选/锁牌/合法性对照通过。 |
| `shared-core/src/hints/model.ts` | 41 | 只读提示/锁组/损耗契约，observation 类型排除 hand/lastPlay/profile 覆写，调用端再将权威 hand/lastPlay/profile 放在展开之后。未确认缺陷。 |

全部 SHA-256 见同名 JSON，交付前再次按当前源码核对。

## 关键调用关系与边界

- `engine.ts:39` 创建唯一 runner；`decisionRunner.ts:41` 与 `handHintPolicy.ts:93` 都调用同一个 `chooseTeamPlay`。旧 difficulty 参数不选择弱档。项目团队策略的 objective 为 `team-first-place`，不以单纯个人减牌数替代团队头游。
- runner 对其他玩家只读取 `player.hand.length`，传入策略的是 `id/team/count`。本地真实玩家/对手手牌对象即使带具体牌面，也没有因此传进策略。当前服务端 `master-bot-policy.js` 还先将其他座位替换为空洞数组；提示调用端 `LocalHandSelectionController.ts` 只提供公开座位数据与当前玩家的手牌。
- 候选服务使用 `structuralLegalMoves` 保留花色/配/组尾结构；跟牌由实际 `canPlay` 过滤。提示有锁时改用 `legalMoves`，避免把“同牌面另一实体副本”过早合并后误认为无合法不拆锁解。
- 锁牌表示不能部分拆组，并非整组永远不能出。提示在调用策略前过滤部分锁组，返回的 ranked 集合来自已过滤候选；客户端还再次进行同样的锁组检查。尾牌规划会查看结构候选，但不能将部分锁组动作重新加入本次输出。
- checkpoint 由实际 seeded RNG 与私有日志构成。`restore` 先在临时 RNG/日志验证器中校验，再修改实例；候选及规则缓存不持久化，恢复后冷启动。14 类坏 checkpoint 的 RNG/日志/trace/指标原子性已验证。
- `reset` 清日志/缓存/trace/指标，但不倒退 RNG。四人下一局通过 `policy.reset()` 延续随机流同时清除上一局牌义；复式自动动作新建 engine 并恢复 checkpoint，同样是冷缓存。
- 七文件中的 runner 是同步函数，耗时只用于指标，不依赖墙钟决定走哪条策略；既有墙钟跳变测试通过。节点预算/异步 worker 取消、过期结果接纳及服务端超时调度不是这七文件的完整审查范围。不得将桌面 CPU 回归通过表述为手机时延承诺。

## 保留 concern：CORE-AI-03-C01

**ID-only 缓存跨级复用需要 reset；未确认当前生产路径失效。**

- 定位：`shared-core/src/ai/candidates.ts:56`；辅助读取的 `shared-core/src/ai/ruleMemo.ts` 也用物理 ID 集合作规则缓存键。
- 可复现条件：同一个裸 `createAIEngine` 实例在换级之后继续使用相同物理卡 ID，而调用方没有 `reset`/冷恢复。候选缓存键不含 value、级牌/配标记、级数或 roundId，命中时还返回旧 Card 对象。
- 复现：打 2 的红心 2（`card-14`）与黑桃 7（`card-6`）可作为对子跟 66；缓存此查询后改打 3，同两个 ID 已是普通 2+7，权威 `canPlay` 为 false，旧缓存仍提供两张牌的 Pair 候选。`engine.reset()` 后再次查询返回 0 候选。
- 当前生产防线已核实：`weapp-match-lifecycle.js:404` 下一局调用现存 policy 的 reset；`duplicate-auto-policy.js:9` 每次需要策略时重建/恢复实例。裸 worker 的连续 checkpoint 热缓存可能面临同一契约，但本批没有确认其跨级生产调用链。
- 状态：**不是本批 confirmed finding**。已经证明 API 复用边界的失效模式，但未证明当前产品入口绕过防线，也没有改代码。
- 建议：后续 worker/生命周期批次继续核查所有复用入口；可将“换级必须 reset”的契约明确化，或将牌义/回合代际纳入候选及规则缓存键后增加回归。

## 已执行验证

| 检查 | 结果 |
| --- | --- |
| 既有测试 | 6 文件、62 项通过；Node v26.7.0 / Vitest 4.1.10；2026-09-12 14:33:11 开始。含唯一 master 档、同队让牌/保护、隐藏牌 Proxy、开局留炸、完整退出路线、节点/CPU 上限、墙钟跳变、锁牌、worker checkpoint 热/冷缓存对照。 |
| 共同决策属性矩阵 | 13 级×2 规则×4 当前座位×领出/敌方领出/同队领出＝312 个视图。相同 seed 和公开观察下，提示第一推荐与新建自动策略一致；所有非空输出是当前手牌且合法；同队让牌时两者一致返回无推荐。 |
| 锁组矩阵 | 同 312 视图另加实体对子锁组；全部返回动作只全用或完全不用该锁组，均合法，`splitsLockedGroup=false`。 |
| 信息隔离/复制 | 所有其他手牌使用只允许读取 length 的 Proxy，312 视图无隐藏牌读取；原 hand/lastPlay 序列化内容不变。 |
| checkpoint 续接 | 每个视图在一次决策后序列化 checkpoint，冷恢复到另一实例，下一次决策与原实例的牌 ID/完整 checkpoint 一致。 |
| 资源损耗 | 13 级、自然同点持牌数 1–8、出牌数 0–持牌数、用配数 0–2：1,716 组与显式损耗公式完全一致，输入不变。 |
| 坏 checkpoint | 14 组空/格式/版本/规则键/RNG 算法或范围/日志字段异常全部拒绝，并保持已有 RNG、日志、trace、metrics 不变。向外获取的 checkpoint 和 trace 的篡改不影响实例。 |
| reset 边界 | 验证 reset 清空日志/指标且不倒退 RNG；C01 的换级旧候选在 reset 后消失。 |

既有测试命令（`shared-core` 目录）：

```sh
node_modules/.bin/vitest run --cache=false tests/ai-engine.test.ts tests/ai-team-policy.test.ts tests/ai-strength-hints.test.ts tests/hand-hint-policy.test.ts tests/ai-random.test.ts tests/ai-worker-runtime.test.ts
```

## 可安全复制的 C01 复现及防线检查

在仓库根目录执行，内存转译当前源码，不写 dist 或业务文件：

```sh
node <<'NODE'
const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('./shared-core/node_modules/typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, file);
const { createAIEngine } = require('./shared-core/src/ai/engine.ts');
const { createDeck } = require('./shared-core/src/lib/deck.ts');
const { getRuleProfile, resolvePlay, canPlay } = require('./shared-core/src/lib/rules.ts');
const profile = getRuleProfile('classic');
const engine = createAIEngine({ ruleProfile: profile, seed: 9 });
const atLevel = level => {
  const deck = createDeck(level);
  const hand = [deck.find(c => c.suit === 'heart' && c.rank === 2),
    deck.find(c => c.suit === 'spade' && c.rank === 7)];
  const cards = deck.filter(c => c.rank === 6).slice(0, 2);
  const resolution = resolvePlay(cards, profile);
  return { hand, last: { playerId: 'p2', cards, type: resolution.type, resolution } };
};
const first = atLevel(2), second = atLevel(3);
assert.equal(engine.getPossiblePlays(first.hand, first.last).some(p => p.length === 2), true);
assert.equal(engine.getPossiblePlays(second.hand, second.last).some(p => p.length === 2), true);
assert.equal(canPlay(second.hand, second.last, profile), false);
engine.reset();
assert.equal(engine.getPossiblePlays(second.hand, second.last).length, 0);
console.log('C01 reproduced only without reset; current production reset defense restores correct candidates');
NODE
```

## 可复制的 312 场景精简探针

以下是本批实际矩阵的完整可执行重放，同样仅内存执行。每个视图同时核对提示/自动首选、checkpoint 下一步一致、锁组和只读公开信息边界。

```sh
node <<'NODE'
const fs = require('node:fs'), assert = require('node:assert/strict');
const ts = require('./shared-core/node_modules/typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, f);
const { createAIEngine } = require('./shared-core/src/ai/engine.ts');
const { createDeck } = require('./shared-core/src/lib/deck.ts');
const { getRuleProfile, canPlay, resolvePlay } = require('./shared-core/src/lib/rules.ts');
const { MATCH_LEVELS } = require('./shared-core/src/lib/matchFormat.ts');
const { rankHintMoves } = require('./shared-core/src/hints/handHintPolicy.ts');
const ids = ['p1', 'p2', 'p3', 'p4'];
const key = cards => cards?.map(c => c.id).sort() ?? null;
let views = 0, hiddenReads = 0, lockViews = 0;
for (const level of MATCH_LEVELS) for (const preset of ['classic', 'tournament']) for (let seat = 0; seat < 4; seat++) {
  const deck = createDeck(level), profile = getRuleProfile(preset);
  const ranks = MATCH_LEVELS.filter(r => r !== level);
  const take = (r, n = 1) => deck.filter(c => c.rank === r).slice(0, n);
  const hand = [...take(ranks[1], 2), ...take(ranks[4], 2), ...take(ranks[7]), ...take('Big')];
  const self = ids[seat], mate = ids[(seat + 2) % 4], enemy = ids[(seat + 1) % 4];
  const teamOf = id => (ids.indexOf(id) + seat) % 2 === 0 ? 'teamA' : 'teamB';
  const team = teamOf(self);
  const seats = ids.map(id => ({ id, team: teamOf(id), count: id === self ? hand.length : id === mate ? 8 : 9 }));
  const players = Object.fromEntries(seats.map(s => [s.id, {
    ...s, name: '', isAI: true, role: 'normal', hand: s.id === self ? hand : new Proxy(new Array(s.count), {
      get(target, name) {
        if (name !== 'length') { hiddenReads++; throw new Error('hidden face read'); }
        return target.length;
      },
    }),
  }]));
  for (const leader of [null, enemy, mate]) {
    const cards = take(ranks[0]), resolution = resolvePlay(cards, profile);
    const last = leader ? { playerId: leader, cards, type: resolution.type, resolution } : null;
    const seed = 912003 + seat;
    const observation = { self, team, seats, order: ids, history: last ? [last] : [],
      historyComplete: false, level, finishedPlayers: [], roundId: 3, revision: 9 };
    const context = { currentLevel: level, teamLevels: { teamA: level, teamB: level },
      roundMeta: null, ruleProfile: profile, turnOrder: ids, finishedPlayers: [], roundId: 3, revision: 9 };
    const before = JSON.stringify({ hand, last });
    const engine = createAIEngine({ ruleProfile: profile, seed });
    const automatic = engine.makeDecision(hand, last, 'master', team, players, self, context);
    const hinted = rankHintMoves({ hand, lastPlay: last, ruleProfile: profile, observation, seed, protectedGroups: [] });
    assert.deepEqual(key(hinted[0]?.cards), key(automatic));
    if (automatic) {
      assert.ok(canPlay(automatic, last, profile));
      assert.ok(automatic.every(c => hand.some(h => h.id === c.id)));
    } else assert.ok(last);
    for (const h of hinted) assert.ok(canPlay(h.cards, last, profile));
    const restored = createAIEngine({ ruleProfile: profile, seed: 1 });
    restored.restore(JSON.parse(JSON.stringify(engine.checkpoint())));
    const expected = engine.makeDecision(hand, last, 'master', team, players, self, context);
    const actual = restored.makeDecision(hand, last, 'master', team, players, self, context);
    assert.deepEqual(key(actual), key(expected));
    assert.deepEqual(restored.checkpoint(), engine.checkpoint());
    const group = { id: 'pair-lock', kind: 'locked', cardIds: hand.slice(0, 2).map(c => c.id) };
    const locked = rankHintMoves({ hand, lastPlay: last, ruleProfile: profile, observation, seed, protectedGroups: [group] });
    for (const h of locked) {
      const count = group.cardIds.filter(id => h.cards.some(c => c.id === id)).length;
      assert.ok(count === 0 || count === group.cardIds.length);
      assert.equal(h.damage.splitsLockedGroup, false);
      assert.ok(canPlay(h.cards, last, profile));
    }
    assert.equal(JSON.stringify({ hand, last }), before);
    views++; lockViews++;
  }
}
assert.equal(views, 312); assert.equal(hiddenReads, 0); assert.equal(lockViews, 312);
console.log({ views, lockViews, hiddenReads, status: 'passed' });
NODE
```

## 辅助读取与限制

- 辅助完整读取但不计本批覆盖：上述 6 个测试文件；`ai/ruleMemo.ts`、`ai/random.ts`、`ai/checkpoint.ts`、`ai/types.ts`、`ai/workerRuntime.ts`、`ai/team/policy.ts`、`ai/team/journal.ts`、`ai/team/types.ts`；`server/master-bot-policy.js`、`server/duplicate-auto-policy.js`、`server/bot-turn-pacing.js`；客户端 `game/LocalHandSelectionController.ts`。
- 局部核对 `server/weapp-match-lifecycle.js` 与其他调用点检索，不因命中而增加已审文件数。上述缩写路径分别位于 `shared-core/src`、`work/guandan-windows-source`、`work/guandan-cocos/assets/scripts`。
- 312 个视图是固定牌组/观察组合，不是穷举全部真实牌局，不证明团队策略最优。更底层 belief、route、outlook 的策略质量与跨进程调度仍需专项审查。
- 仅确认本批所列契约/边界；不把“62 项测试通过”替代其他模块逐文件审查。
