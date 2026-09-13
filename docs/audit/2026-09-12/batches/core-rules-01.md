# 核心规则审计：core-rules-01

- 审计日期：2026-09-12。
- 仓库：`/Users/mac/Documents/Codex/2026-08-02/wo-yi`。
- HEAD：`1d58999dc6e5455b049e1643660bbba3deee1406`。
- 完整逐项审查：8 个文件，1,506 行；`types/game.ts` 的实际位置是 `shared-core/src/types/game.ts`。
- 结论：确认 2 项 P3 兼容 API 缺陷；本批未确认 P0/P1/P2 缺陷。两项均不位于现行 `transition` 主流程，不能据此宣称当前线上牌局受影响。
- 仅写本报告和同名 JSON；未改业务代码、用户原有修改或 Git 提交，未执行网络/线上状态变更。

## 审查范围与逐项结果

| 文件 | 行数 | 已检查项目与结论 |
| --- | ---: | --- |
| `shared-core/src/lib/engine.ts` | 413 | 构造、手牌归属、重复/空牌、轮次与版本、阶段及行动者验证、终局边界、提交原子性、兼容出牌/过牌/换局。主状态机未确认缺陷；兼容换局遗失赛制、兼容过牌依赖对象引用，见下文。 |
| `shared-core/src/lib/turn.ts` | 152 | 活跃座位推进、搭档接风、每轮过牌集合重置、出完标记、事件与状态的牌/语义对象隔离。完整单牌模拟与既有测试通过。 |
| `shared-core/src/lib/settlement.ts` | 218 | 双下及 1/2/3/4 级奖、历史 K/A 规则、显式必打目标、攻关队伍判断、A-reset 计数、定局个人排名、转蛋个人累计、分数有限性与复制隔离。未确认缺陷。 |
| `shared-core/src/lib/tribute.ts` | 403 | 27×4 正牌校验、级牌一致性、抗贡、进贡排除红心级牌、低牌还贡及无低牌回退、双贡大小/同值接收者、双选后统一转移、先手授权、阶段/版本/原子性及牌守恒。2,496 组完整周期通过。 |
| `shared-core/src/lib/matchFormat.ts` | 78 | 历史缺省区分、格式/级数/目标/开关组合、转蛋专属字段、复式映射、固定/随机级数及随机数非法边界。未确认缺陷。 |
| `shared-core/src/lib/variantRules.ts` | 56 | 三/六分制及复式得分表、52 张抽签牌边界、双持有人同队、单人持两张不换座、顺时针换队、身份/手牌保持、个人累计。未确认缺陷；单人双持不换座为测试明确确认的规则。 |
| `shared-core/src/lib/classicModes.ts` | 31 | 3 模式×4 底分队列、quick 别名、无效队列、经典/不洗牌/连打过 A 格式投影。未确认缺陷。 |
| `shared-core/src/types/game.ts` | 155 | 牌、玩家、牌型、语义、回合元信息、历史兼容结构和可选字段与上述代码的使用一致性。未确认缺陷；TypeScript 类型不是外部 JSON 的运行时解析器。 |

准确 SHA-256 见同名 JSON。辅助读取仅用于核实契约/调用链，不计入这 8 个已审文件。

## 已确认问题

### CORE-RULES-01-001 / P3：兼容换局丢失赛制，下一轮提前结束个人排名局

- 定位：`shared-core/src/lib/engine.ts:247`（返回对象 247–255；238 行已读取 `previous.matchFormat?.dealMode`）。
- 触发：带有 `matchFormat` 的合法 `EngineState` 通过公开导出的 `dealNextRound` 换局。
- 证据：该函数仅返回级数、规则、玩家、座位和本轮字段，未带回 `matchFormat`。设置 `kind: independent, individualRanking: true` 后，同队 `p1,p3` 前两名时，换局前 `isRoundOver` 为 `false`；换局后赛制为 `undefined`，相同前两名使 `isRoundOver` 为 `true`，无法继续判定真实第三名。
- 影响：兼容 API 使用者失去比赛格式；具体可复现为个人排名局提前终止。函数也没有传递可选累计个人积分，但本条结论不依赖该额外观察。
- 范围/严重性：全仓排除生成、dist、build 和 node_modules 后，仅 `shared-core/tests/round-smoke.cjs:27` 调用 `dealNextRound`；未发现现行生产调用者。故定 P3，不上升为线上主流程事故。
- 验证：从当前 TypeScript 源码内存转译运行，断言 `previous.matchFormat !== undefined`、`next.matchFormat === undefined`、前后终局判断分别为 `false/true`，均通过。
- 建议：显式保留跨局格式与应保留的累计字段，并补个人排名/不洗牌多次换局回归；或明确弃用该入口并限制其接受历史状态。不要将本轮抽签牌不加区分地沿用到下一轮。

### CORE-RULES-01-002 / P3：兼容过牌用引用查找末次出牌，JSON 恢复后提前清轮

- 定位：`shared-core/src/lib/engine.ts:276`（276–277）。
- 触发：合法兼容 `EngineState` 的 `playArea` 已有旧过牌，当前末次有效出牌以后尚不足一轮过牌；状态经过 JSON 序列化/恢复，再调用 `passTurn`。
- 证据：`action === last` 依赖 `playArea` 和 `lastValidPlay` 共用对象引用。JSON 恢复后虽然内容相同，却没有引用相等项，`lastIndex` 变为 -1，`slice(0)` 把历史全部过牌计入本轮。
- 具体序列：p1 出 3 → p2 过 → p3 过 → p4 出 6 → JSON 恢复 → p1 过。所有人还有手牌。正确结果/未序列化结果为 `currentTurn: p2, lastValidPlay.playerId: p4`；恢复后的实际结果为 `currentTurn: p4, lastValidPlay: null`，p2/p3 失去跟牌机会，p4 获得新轮领出权。
- 影响：继续使用兼容接口恢复牌局、或向其传递分别克隆 action 的状态时，轮次可提前清空。
- 范围/严重性：现行 `transition` 使用显式 `trick.passedPlayerIds`，不执行此逻辑；服务端主入口 `dispatchMatchIntent` 调用 `transition`。兼容函数仍由导出的 `runAiTurns` 使用，但未发现该模拟入口的现行生产调用，故定 P3。
- 验证：同一合法动作序列，分别对原状态及其 JSON 恢复副本执行 p1 过牌；两组返回值断言通过，确认仅引用结构差异即可触发。
- 建议：按最后一条非 Pass 动作的位置或稳定动作标识定位，或统一使用显式 trick 状态；补 JSON 恢复后存在旧过牌的回归。

## 可重放的源码最小复现

在仓库根目录执行以下本地命令；它内存转译源码，不编译/覆盖 `dist`，不写业务文件。

```sh
node <<'NODE'
const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('./shared-core/node_modules/typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, file);
const e = require('./shared-core/src/lib/engine.ts');
const { createDeck } = require('./shared-core/src/lib/deck.ts');

// CORE-RULES-01-001
const previous = e.createGame(2);
previous.matchFormat = { kind: 'independent', levelMode: 'fixed', levelRank: 2,
  tributeEnabled: false, doubleDown: 3, individualRanking: true };
previous.finishedPlayers = ['p1', 'p3'];
assert.equal(e.isRoundOver(previous), false);
const next = e.dealNextRound(previous, 2, 'p1');
next.finishedPlayers = ['p1', 'p3'];
assert.equal(next.matchFormat, undefined);
assert.equal(e.isRoundOver(next), true);

// CORE-RULES-01-002: deliberately small, legal remaining hands.
let state = e.createGame(2);
const deck = createDeck(2);
const pick = (suit, rank) => deck.find(c => c.suit === suit && c.rank === rank);
state.players.p1.hand = [pick('spade', 3), pick('spade', 8)];
state.players.p2.hand = [pick('heart', 4), pick('heart', 9)];
state.players.p3.hand = [pick('club', 5), pick('club', 10)];
state.players.p4.hand = [pick('diamond', 6), pick('diamond', 'J')];
state = e.playCards(state, 'p1', [state.players.p1.hand[0]]);
state = e.passTurn(state, 'p2');
state = e.passTurn(state, 'p3');
state = e.playCards(state, 'p4', [state.players.p4.hand[0]]);
const original = e.passTurn(state, 'p1');
const restored = e.passTurn(JSON.parse(JSON.stringify(state)), 'p1');
assert.equal(original.currentTurn, 'p2');
assert.equal(original.lastValidPlay.playerId, 'p4');
assert.equal(restored.currentTurn, 'p4');
assert.equal(restored.lastValidPlay, null);
console.log('Both P3 compatibility defects reproduced against current source');
NODE
```

## 已执行验证

1. `shared-core` 目录运行：

   ```sh
   node_modules/.bin/vitest run --cache=false tests/engine-transition.test.ts tests/tribute-settlement.test.ts tests/match-format.test.ts tests/variant-rules.test.ts tests/turn-immutability.test.ts
   ```

   结果：5 个测试文件、28 项测试通过（2026-09-12 14:03:49，Node v26.7.0）。未使用会清空/覆盖 dist 的 build 脚本。

2. 贡还源码属性检查：LCG 固定种子 `0x912c0de`（`seed = imul(seed,1664525)+1013904223`，无符号 32 位），13 级×24 排名×8 种发牌，共 2,496 次准备、10,088 次 transition；含 603 次抗贡与 75 次双贡等值。逐步断言旧状态 JSON 不变、revision +1、全体手牌恰有 108 张唯一牌、双贡接收者不重复、完成后各 27 张、计算的领出者开始游戏。全部通过。

3. 完整出牌状态机模拟：固定种子 `0x912a11`，13 级×6 种格式×3 样本，共 234 局、53,573 次 transition；格式包括历史、团队定局、个人排名定局、A-reset 升级、顺时针三分转蛋、抽签六分转蛋。只选择合法单牌或合法过牌；均在每局 1,000 步限制内结算。逐步断言旧状态不变、版本单增、手牌加出牌历史为 108 张唯一牌、空手集合与完成人员一致、lastValidPlay/trick 一致、终局完整排名及有限分数。全部通过。

4. 上述 2 个 P3 的最小复现均从源码执行，未依赖可能过时的 `dist`。

## 边界、排除项及辅助读取

- 未将“可构造任意畸形对象”直接当作外部可利用漏洞；核心公开命令类型按 TypeScript 契约使用，外部协议解析另批审查。本批检查了类型内的空/重复/越权/过期/错误级数等非法值及现有回归。
- 历史 K/A 路径与显式 `upgradeTarget` 路径行为有意不同；A-reset 第三次失败回 2、单人持两张抽签牌保持座位、单贡两张任意王可抗贡均有现行测试明确约定，未凭规则偏好列为 bug。
- 2,496 个贡还周期覆盖随机到的等值/抗贡情况，不等于穷尽所有 108 张牌分配。234 局只覆盖单牌/过牌推进，不替代牌型解析的专项审计。
- 辅助完整读取但未按独立代码审计计数：上述 5 个测试文件、`shared-core/tests/tribute-regression.cjs`、`shared-core/src/lib/deck.ts`、`shared-core/src/ai/simulation.ts`、`shared-core/src/index.ts`、`shared-core/package.json`、`shared-core/tsconfig.json`。
- 辅助局部读取/搜索：`shared-core/src/lib/rules.ts`、用户已有修改的 `shared-core/tests/rules-regression.cjs`、`shared-core/tests/round-smoke.cjs`、`work/guandan-windows-source/server/game-session.js`，以及仓库内兼容 API 调用点搜索。未将检索命中的其他文件计入审查数。
