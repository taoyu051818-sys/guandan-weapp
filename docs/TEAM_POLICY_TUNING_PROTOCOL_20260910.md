# 机器人参数跑分协议

本轮只调整 `shared-core/src/ai/team/parameters.ts` 的决策评分权重。提示、托管、机器人共用唯一参数；不增加可选低档策略，不改一键理牌参数或真人模拟等待。

## 比较方式（验证前冻结）

- 参照是本轮开始时的 `team-first-v1`，不是更早的低档机器人。参数抽取后先与抽取前编译快照逐手比较，动作、诊断分数、随机状态和检查点均须一致。
- 每个种子发同一副牌，候选分别执 A/B 队各打一场；两队随机数初态相同、独立推进。按组轮换先手，覆盖级牌 2、5、9、Q、A。每场由正式规则引擎推进，直到出现头游，至多 600 次行动。
- 唯一主要目标是本队获得头游；不是自身头游、出牌张数、分组估值或最终升级分。先到头游即停止，不把后续双上得分混入目标。
- 真正的决策 CPU 时间单独测量，含候选生成、推断、路线和评分，不含 0.5–3 秒及额外延迟。候选按种子交错执行，降低预热/机器负载偏差。
- 对手手牌传入只允许读取 `length` 的代理。每手检查卡牌归属、重复卡和规则合法性；非法动作、超出回合限制立即中止，不丢弃失败局。
- 场景计数记录强/中/弱牌力，以及上家、下家、队友进入 10 张以内的行动。它是场景覆盖计数，不是各场景的独立胜率。

## 三阶段

1. 筛选：种子 2700000–2700031，7 套候选各 32 对（64 场）对照原参数。取有效候选中头游率最高的两套，若相同优先 P95 较低者。
2. 复赛选参：种子 3100000–3100063，两套各 64 对（128 场）对照原参数；按头游率排序，相同则优先 P95 更低者，再比较参数偏移量。这个阶段仍属于训练，不作为最终效果证明。
3. 独立验证：先冻结最终候选，再使用种子 3700000–3700255 的 256 对（512 场）对照原参数。按整对牌局做 10000 次 bootstrap，不能把两场关联比赛当作独立样本。验证后不再据此调参重测同一批牌。

替换条件：独立验证头游率的配对 95% 区间下限严格超过 50%；P95 决策时间不超过同场原参数的 1.5 倍；非法动作、首手炸弹均为零。若不满足，保留原参数，报告没有足够证据支持替换。

这里的“最优”仅指本轮候选、这些对手与目标下的实测选择，不代表数学全局最优或真人胜率。

## 运行与隔离

```sh
pnpm --dir shared-core build
node scripts/verify-team-parameter-harness.mjs /path/to/pre-extraction/dist
node scripts/benchmark-team-parameters.mjs screen 32 2700000 exit,control,support,pressure,reserve,precise,balanced reference /tmp/team-parameters-screen.json
node scripts/benchmark-team-parameters.mjs finalist 64 3100000 CANDIDATE1,CANDIDATE2 reference /tmp/team-parameters-finalist.json
node scripts/benchmark-team-parameters.mjs holdout 256 3700000 FROZEN_CANDIDATE reference /tmp/team-parameters-holdout.json
```

实验脚本复制编译后的核心到操作系统临时目录，每个实验独立装载模块，只替换冻结的参数常量。不存在生产运行时注入开关；候选目录位于 `scripts/support`，不会同步到 Cocos。原始结果保留每场种子、执方、先手、级牌、动作摘要 hash、胜负和完整参数 hash。
