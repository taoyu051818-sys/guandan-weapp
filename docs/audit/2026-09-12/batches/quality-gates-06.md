# quality-gates-06：架构门禁与离线参数实验

2026-09-12，root；HEAD `1d58999dc6e5455b049e1643660bbba3deee1406`。完整审阅 **10 文件 / 1086 行**，逐文件哈希与 notes 见 [JSON](quality-gates-06.json)。新增确认问题 0；不撤销其他批次发现。

## 范围与职责

| 文件 | 行数 | 审查重点 |
| --- | ---: | --- |
| work/guandan-cocos/scripts/check-architecture.mjs | 294 | TS AST提取import/export/type/literal dynamic依赖，metadata必备/uuid唯一/孤儿、migration/分层/开发适配器边界、runtime DFS环、cc依赖传递闭包、CI strict/unused与纯模块roots、根测试注册、62行数预算 |
| work/guandan-cocos/tests/architecture-regression.cjs | 350 | 核源文件/meta存在、固定版式/构建/资源及职责抽取正则、前台/牌桌生命周期接线文本、退役约束、真实健康检查子进程和unused选项 |
| scripts/verify-team-parameter-harness.mjs | 55 | 两个隔离模块树参数分离/原dist不变、隐藏手牌访问代理、配对自对弈哈希/互补胜负、4场影子权威transition与public-history一致；可选旧dist 5级逐步decision/trace/checkpoint相等 |
| scripts/support/team-policy-benchmark.mjs | 123 | loadExperiment只替换冻结参数模块、cp每树隔离、代码hash仅policy.js；publicPlayers封闭其他人hand读、context显式级牌/公开history、直到头游停止、候选归属/重复/合法校验、同牌换边、自愿shadow transition/legacy状态一致、整对bootstrap |
| scripts/support/team-policy-experiments.mjs | 27 | reference+7实验权重同9键、freeze、0..3界限、三段不同种子、头游目标与confidence/耗时/合法性/首炸阈值 |
| scripts/support/team-policy-selection.mjs | 17 | 非法/首手炸/1.5倍P95剔除；胜率、P95、权重偏移稳定排序；独立paired下限严格>0.5才替换，否则保留reference |
| scripts/team-policy-benchmark.test.mjs | 39 | 完整核8参数对象/同键/正有限/种子互斥，排序优先级/慢和非法拒绝，独立下限边界/首炸，配对自对弈固定区间 |
| scripts/benchmark-team-ai.mjs | 65 | 旧离线基线CLI样本/seed检验、同牌两队对弈到首游、当前/旧engine区分、合法性/首炸/耗时记录 |
| scripts/benchmark-team-parameters.mjs | 65 | CLI正整数/上限/候选唯一白名单、隔离module树、按seed交错候选和换队、正式helper断言、场景/CPU与pair数据、固定bootstrap，显式output可写且未执行真实文件写 |
| scripts/report-team-parameters.mjs | 51 | 三阶段名/固定样本seed/codeHash、opponent/parameterHash、game/pair数量/胜数/耗时行动数、每seed两队、前二/最终候选、一套holdout与fallback |

## 架构门禁验证

当前检查器通过 **239 模块、62 体量预算**，架构回归通过。后者主要是源码正则/路径/meta/构建配置约束，另真实运行健康扫描子进程；不能把这些结果表述为 Cocos 行为或视觉验收。

```sh
node docs/audit/2026-09-12/repro/architecture-gates-06.cjs
```

探针转译当前检查器，在内存覆盖 readFile/readdir，保持真实 TypeScript AST、配置解析和项目文件。18 组检查：

- 正常基线通过。
- 12 类错误被拒绝：缺失/损坏 meta、缺 UUID、UUID 冲突、孤儿 meta、找不到模块、底层运行时引用 scene、运行时循环、字面量动态 import 违反分层、迁移源码越界、未注册根测试、超体量预算。
- 3 类 type-only import/export 对照不误判运行时循环。
- 2 个已知语法边界：CommonJS require、变量 dynamic import 不进入此 AST 依赖图。当前 assets TS 检索没有这些生产依赖，故只记录工具能力边界，不报现存业务错误。含 type import('cc') 的类型引用正常被 allModuleSpecifiers 识别。

source-only retained/migration 文件和第三方资产不由此单一门禁全覆盖。line budget 也不是职责单一或高质量设计模式的证明，仍须逐文件审阅。

## 离线实验链路验证

既有 `node --test scripts/team-policy-benchmark.test.mjs` 的 4 项测试通过。

```sh
node docs/audit/2026-09-12/repro/benchmark-contracts-06.cjs
```

执行真实 verifier、两种 benchmark 和结果汇总器；把 mkdtemp/cp、独立模块加载缓存及输出文件换成内存映射。四棵独立虚拟模块树，实际磁盘复制/写入为零。为在 CJS 审计容器中执行 ESM，仅降低 import.meta URL 并重命名局部 require 绑定；没有替换 AI 决策、选择或统计函数。

- 默认 verifier 的参数隔离、原 dist 不变、暗牌代理、4 场影子自对弈、权威 transition/public-history 与兼容入口一致通过。
- 老 CLI 用相同当前核心进行 2 对 / 4 场自对照，pairWins=[1,1]，非法动作零。
- 新参数 CLI 两候选各 2 对，共 8 场真实当前编译核心对弈通过；reference 自对照两对均一胜一负。只是小样本链路验证，未据此重新选参。
- 合成完整三阶段记录验证下限恰等于 50% 时保留 reference；错误 stage、破坏同牌配对 seed、参数 hash 不符均被真实汇总器拒绝。
- 把已提交的 `docs/TEAM_POLICY_BENCHMARK_20260910.json` 三阶段资料输入真实汇总器，重建 summary 与原文件完全相同；重算全部 10 个结果的配对 95% 区间也逐项相同。核对的是 **1,216 条历史游戏记录**，不是本批重跑 1,216 场；历史结论仍为未达独立验证门槛、保留 reference。

## 限制与下一步

旧 `benchmark-team-ai` 会直接传其他玩家完整 hand，且只独立检查 canPlay；当前新版参数工具才有暗牌代理与卡牌归属/重复断言。当前生产策略已由前批真实公开信息探针验证，本批未借旧 CLI 证明任意旧 baseline 不窥牌。

默认 verifier 未提供抽取前 dist，因此其可选 5 场旧版本逐手迁移比对未运行。现有编译产物未重建；结果 codeHash 仅覆盖 policy.js，不是完整源码/依赖/编译配置取证。汇总器信任自有跑分产生的时间与置信区间，独立核算本轮归档字段一致不代表实测时间可复现或真人胜率校准。

只新增本批审计报告与两个隔离探针，五处原始 dirty 保留；没有改变产品、测试断言、AI 参数、构建产物或旧跑分档案，没有线上操作。
