# 牌型、候选与发牌审计：core-dealing-02

- 日期：2026-09-12；仓库：`/Users/mac/Documents/Codex/2026-08-02/wo-yi`。
- HEAD：`1d58999dc6e5455b049e1643660bbba3deee1406`；保留启动时五处用户修改。
- 本批完整审查 5 个指定文件、875 行；不重复计入前批 8 个文件。`deck.ts` 在前批仅是辅助读取，本批才按完整审查计数。
- 结论：未确认新增缺陷，`findings: []`。这不是全仓无缺陷或全量审计完成的结论。
- 已重读审计 README。只写本 Markdown 与同名 JSON；没有修改业务代码、测试、构建输出、提交或线上状态。覆盖清单交由根任务汇总。

## 逐文件审查

| 文件 | 行数 | 已检查项目与结果 |
| --- | ---: | --- |
| `shared-core/src/lib/rules.ts` | 435 | 两套不可变规则、实体牌与模拟牌面值、非红心级牌不参与连续牌型、所有基础牌型、红心配 2–15 点/非王花色解释、两张配的值/花色枚举缩减、解释去重、上下文最小充分解释、炸弹比较与诊断一致性。未确认缺陷。 |
| `shared-core/src/lib/legalMoves.ts` | 255 | 实体组合及组间 ID 排他、对子/三张/炸弹、三带对、全部顺子/钢板/连对窗口、王炸、候选完整性、物理/结构/代表类三种去重边界、跟牌过滤、缓存语义键、排序及输入不变。未确认缺陷。 |
| `shared-core/src/lib/deck.ts` | 93 | 两副 52+2 正牌、108 个唯一 ID、每花色/牌面两张、8 张级牌/2 张红心配/4 张王、面值、Fisher–Yates 下标、按座位分发与降序排列、复制边界。未确认受支持入口下的缺陷。 |
| `shared-core/src/lib/dealing.ts` | 22 | 发牌模式白名单、每次 RNG 取值的有限数及 [0,1) 验证、保持普通随机发牌原行为、不洗牌委托链。未确认缺陷。 |
| `shared-core/src/lib/noShuffleDeal.ts` | 70 | 普通自然顺子包排除当前级牌、自然同点包、王单独处理、剩余池移除、容量 27 的整包/尾拆、匿名槽位到座位的最后随机映射、输入不变、终止与极端有效随机值。未确认缺陷。 |

逐文件 SHA-256 在同名 JSON；交付前再次与当前源码逐一核对。

## 关键判定依据

### 红心配与牌型序

- `WILDCARD_VALUES` 明确为 2–15，不含小王 16/大王 17；模拟花色仅四种普通花色。解释入库还再次拒绝王点数或王花色。
- 两张纯红心配直接作为本级对子，不能补王；红心配可与**真实王对子**同处合法三带对，但那不等于红心配替代王。因此未使用“所有含配又含王的组合都必须非法”这种错误泛化。
- 经典同花顺的比较值为 `5500 + 顶点`，位于五张炸弹与六张炸弹之间。四王由 `compareBombResolutions` 的显式分支处理，仍高于数值可能超过 10000 的十张炸弹。
- tournament 的禁 A2345、同花顺按普通顺子处理，以及普通级牌不能加入连续牌型，都是本仓现有契约/回归明确约定；本批不以外部玩法偏好替换项目规则。

### 候选完备性与去重的静态论证范围

对来源于当前 108 张正牌、ID 唯一且最多两张红心配的手牌：

1. 基础解析器可接受的组型只有单张、同值对/三张/四张以上炸弹、三带对、五张顺子/同花顺、六张三连对/钢板、四王。
2. 候选器对 2–17 每值枚举同值实体组合；只对 2–15 补入红心配，覆盖所有同值牌组。三带对取不同目标点数的三张与对子，并要求实体 ID 不相交。
3. 连续牌型使用与规则一致的非普通级牌集合，枚举 2–A 的完整窗口和独立 A2345 窗口；红心配可进入每个缺口，但组间 ID 排他禁止重复使用同一张配。
4. 四王独立枚举。规则配置禁止的候选由实际解析/跟牌校验过滤。
5. `legalMoves` 只按物理 ID 集合去重；`structuralLegalMoves` 按 rank/value/suit/级牌/配标记合并可互换副本；代表候选另外按默认解析的 type/value/length 合并。该代表接口不承诺保留每种花色结构，正式 AI/提示需要结构候选的调用确实使用结构接口。

全子集测试提供独立于候选生成过程的对照：它直接枚举手牌每个非空子集，再问规则解析器是否合法。此对照验证候选器是否漏牌/多牌，不单独证明解析器符合外部规则；另有红心配全花色替代、炸弹层级及项目规则回归检验解析器。

### 发牌边界与真实调用

- `engine.ts` 的 `createGame` 调用 `dealGameCards`；服务端下一局 `weapp-match-lifecycle.js:395` 也经该入口发牌再送权威 `PREPARE_NEXT_ROUND`。
- `dealGameCards` 包装的同一 `checkedRandom` 同时传入初次洗牌和集束全过程，不只校验第一次取数。后段注入非法取值也会被拒绝。
- `shuffleDeck`、`dealCards`、`dealClusteredDeck` 是接受受信参数的底层函数，未把直接传入任意长度/重复牌/非法 RNG 的构造误报为现行生产入口漏洞。生产发牌入口自身生成正牌并校验 RNG。
- 集束算法的自然顺子包和同点包只移动真实牌，牌包分配不读取玩家身份/钱包/输赢。统计中自然炸弹增加约 2.18 倍是样本观察，不是严格公平性证明，也不是每局“六组”保证。
- 前批 `CORE-RULES-01-001` 是兼容 `dealNextRound` 不保留 `matchFormat`，不在本批重复立项；正常 `dealGameCards` 的模式传递本身未发现问题。

## 已执行的本地验证

| 检查 | 实际结果 |
| --- | --- |
| 既有 Vitest | 4 个文件、19 项测试通过；Node v26.7.0 / Vitest 4.1.10；14:19:41 开始。 |
| 用户已有 `rules-regression.cjs` | 未改文件内容，使用内存转译当前源码替换其 `../dist` 引用后原样执行，通过。 |
| 候选全子集对照 | 13 级×2 预设，普通同点/连续/王与配混合三类 8 张手牌，另加打 7 的十张炸弹手牌：80 组、21,936 非空子集、11,354 合法子集，物理候选集合完全一致。 |
| 跟牌及去重 | 240 个不与手牌共用 ID 的跟牌视图对照通过；结构候选集合/默认代表类集合完整且无重复，反转手牌输入得到相同结果，实体卡片取自原手牌，输入不变。 |
| 红心配花色枚举对照 | 打 2/7/A×两预设×7 类针对性牌组，共 42 组；对每张配独立穷举 14 个点数×4 花色，共 94,752 次替代，所得解析 type/value/length 集合与优化解析器完全一致。含普通炸弹、十炸、同花/非同花、钢板/连对歧义、真实王对子和非法王替代。 |
| 炸弹/同花窗口矩阵 | 2,808 个物理 4–10 张炸弹配置、320 个允许的自然同花窗口、6,896 次压制比较通过；四王保持最高，经典同花顺位于 5 与 6 张炸弹之间。 |
| 发牌属性 | 13 级×2 模式×100 种种子＝2,600 副；每家 27 张、与对应级数 108 张正牌逐字段一致、排序、标记全部通过。种子 912000–912099，LCG 参数见可重放代码。 |
| 极端/非法随机值 | 26 个集束边界样本（0、最接近 1 的有效浮点数）保持正牌与输入不变；10 项初次非法值检查及 3 项集束后段非法值检查通过。 |

2,600 副样本的自然炸弹组数：random 7,163；no-shuffle 15,606；比值 2.1786960770626833。既有发牌测试另含每模式 3,000 副固定种子分布警报和跨级别 780 个集束守恒样本，均通过。

测试探针更正记录：最初尝试在恒定 0.5 RNG 的第 300 次调用注入 NaN，但该路径只调用 266 次，因此“应抛错”断言不适用；先测得次数后改为第 108、125、266 次注入，均被正确拒绝。该探针设计问题不是产品缺陷。

## 可安全重放的命令

既有测试在 `shared-core` 目录运行，不运行清空 dist 的 build：

```sh
node_modules/.bin/vitest run --cache=false tests/rules.test.ts tests/context-resolution.test.ts tests/dealing.test.ts tests/no-shuffle-arrangement.test.ts
```

以下在仓库根目录运行的精简审计重放不生成文件、不导入服务端，也不依赖 dist。它复核候选全子集、13 级双模式物理发牌、王替代/5.5 序及后段 RNG 校验；更大的上述矩阵为同类固定枚举扩展。

```sh
node <<'NODE'
const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('./shared-core/node_modules/typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, file);
const r = require('./shared-core/src/lib/rules.ts');
const l = require('./shared-core/src/lib/legalMoves.ts');
const { createDeck } = require('./shared-core/src/lib/deck.ts');
const { dealGameCards } = require('./shared-core/src/lib/dealing.ts');
const { MATCH_LEVELS } = require('./shared-core/src/lib/matchFormat.ts');
const key = cards => cards.map(c => c.id).sort().join(',');
const rng = seed => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const byId = (a, b) => a.id.localeCompare(b.id);
let subsets = 0;
for (const level of MATCH_LEVELS) {
  const deck = createDeck(level), wild = deck.filter(c => c.isRedJoker);
  const rank = MATCH_LEVELS.find(v => v !== level);
  const hand = [...deck.filter(c => c.rank === rank).slice(0, 6), ...wild];
  for (const preset of ['classic', 'tournament']) {
    const profile = r.getRuleProfile(preset), expected = [];
    for (let mask = 1; mask < 2 ** hand.length; mask++) {
      const cards = hand.filter((_, i) => mask & (1 << i));
      subsets++;
      if (r.getPlayInfos(cards, profile).length) expected.push(key(cards));
    }
    const actual = l.legalMoves(hand, null, profile).map(key);
    assert.deepEqual([...actual].sort(), expected.sort());
    assert.equal(actual.length, new Set(actual).size);
    assert.deepEqual(l.legalMoves([...hand].reverse(), null, profile).map(key), actual);
    for (const joker of deck.filter(c => c.suit === 'joker')) {
      assert.equal(r.resolvePlay([wild[0], joker], profile), null);
    }
  }
  for (const mode of ['random', 'no-shuffle']) {
    const hands = dealGameCards(level, mode, rng(912000));
    assert.deepEqual(Object.values(hands).map(h => h.length), [27, 27, 27, 27]);
    assert.deepEqual(Object.values(hands).flat().sort(byId), [...deck].sort(byId));
  }
}
const deck = createDeck(2), profile = r.getRuleProfile('classic');
const flush = [3, 4, 5, 6, 7].map(rank => deck.find(c => c.rank === rank && c.suit === 'spade'));
const rank8 = deck.filter(c => c.rank === 8), rocket = deck.filter(c => c.suit === 'joker');
const action = cards => {
  const resolution = r.resolvePlay(cards, profile);
  return { playerId: 'p2', cards, type: resolution.type, resolution };
};
assert.equal(r.canPlay(flush, action(rank8.slice(0, 5)), profile), true);
assert.equal(r.canPlay(flush, action(rank8.slice(0, 6)), profile), false);
assert.equal(r.canPlay(rank8.slice(0, 6), action(flush), profile), true);
assert.equal(r.canPlay(rocket, action([...rank8, ...deck.filter(c => c.isRedJoker)]), profile), true);
let total = 0;
dealGameCards(2, 'no-shuffle', () => { total++; return 0.5; });
for (const nth of [108, 125, total]) {
  let count = 0;
  assert.throws(() => dealGameCards(2, 'no-shuffle', () => ++count === nth ? NaN : 0.5), /INVALID_DEAL_RANDOM/);
}
console.log({ status: 'passed', subsets, deals: 26, delayedRandomChecks: 3 });
NODE
```

## 辅助读取、限制与后续边界

- 既有测试四文件、`shared-core/tests/rules-regression.cjs`、`work/guandan-cocos/assets/scripts/ui/TablePlayActionPolicy.ts` 为辅助完整读取，但未单独按产品文件逐项审计，不计覆盖。
- `shared-core/src/ai/candidates.ts`、`shared-core/src/hints/handHintPolicy.ts`、`work/guandan-windows-source/server/weapp-match-lifecycle.js` 为调用链局部读取；其他 rg 命中同样不算审查。
- 主 AI 在 `candidates.ts:60` 使用结构候选；提示在 `handHintPolicy.ts:71` 对锁牌选择物理候选、无锁使用结构候选；客户端操作按钮在 `TablePlayActionPolicy.ts:18` 用候选及真实规则判断能否跟牌。本批未重审上述整个跨模块流程。
- 未声称穷尽所有 27 张手牌或所有 108 张牌分配，未作设备实测/严格统计公平性证明；性能、跨模块缓存和房间协议由相应批次继续审查。
