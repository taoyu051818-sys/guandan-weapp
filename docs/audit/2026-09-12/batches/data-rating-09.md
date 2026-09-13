# 第九批：数据迁移、评分、选桌与底分计算

基线 HEAD：`1d58999dc6e5455b049e1643660bbba3deee1406`。root 完整审阅 6 文件 / 601 行，未发现新增确认缺陷。
每文件 SHA-256 和具体结论见 [JSON](data-rating-09.json)。本批不是生产数据迁移或匹配公平性认证。

## 文件与结论

统一前缀：`work/guandan-windows-source/server/platform/`。

| 文件 | 完整审查重点 |
| --- | --- |
| state-migrations.js（257行） | 输入副本、旧集合/目录增量补齐、8位账号与索引、评级和钱包兼容、队列、稳定入场ID、活动匹配唯一性 |
| seeds.js（43行） | 样例目录归属、实例隔离、与运行入口 fallback 的关系、已运营记录优先 |
| rating.js（122行） | 先验胜率、经验/base、Elo增量、队伍均分、四人唯一、数值和输入所有权 |
| classic-stakes.js（44行） | 核心12档唯一来源、固定成对积分转移、余额检查、零和与不修改输入 |
| rating-matchmaking.js（38行） | 同队列/未满桌、等待扩差、spread/distance/年龄/ID排序和确定性 |
| rating-matchmaking.test.mjs（97行） | 断言与实际契约一致、默认测试链注册及不足覆盖 |

`rating-matchmaking.test.mjs` 不在 package 命令中直接列出，但由 `platform.test.mjs:2` 静态 import；默认测试链和 check-server 的递归登记检查实际覆盖它，不是僵尸测试。

种子文件仍包含旧赛事、样例商品和无结束日期的联调赛季。运行入口默认使用这些作为 fallback；迁移不覆盖既有 closed 赛季或自定义目录数据。**这部分的运营目录、客户端可达性及退役归属仍待专项核验**，本批不擅自删样例，不假定生产正在显示或发奖。

综合分由胜率/经验基础分与 Elo 偏移组成，所以综合分本身不保证零和；Elo 偏移和底分转移才按相应守恒契约检查。公共匹配还会先运行机器人补位，不能把纯选桌函数的 105 秒扩差样例描述成真实用户一定等 105 秒。

## 已运行

```sh
node work/guandan-windows-source/server/platform/rating-matchmaking.test.mjs
node work/guandan-windows-source/server/platform/storage-contract.test.mjs
node docs/audit/2026-09-12/repro/data-rating-09.mjs
node work/guandan-windows-source/server/check-server.mjs
```

全部退出 0。check-server 核验 85 个生产 JS、37 项预算以及传递测试登记；不重复计它为新增审阅文件。

[隔离探针](../repro/data-rating-09.mjs)：

- 1,000 个合成旧账号，混合重复/无效/有效账号；生成索引无重号，反转输入键顺序后结果稳定。
- 保留已有 500 个钱包，仅为缺失的 500 个创建初始钱包及一次记录；再次迁移没有变化或重复补赠。
- 保留输入/自定义目录/扩展字段；取消成员、机器人不进入活动索引，观战成员仍进入；发现同人多个活动匹配时拒绝，不猜一个覆盖。
- 512 组四人评分：交换队伍与胜方一致、Elo对称、局数胜场准确、下限/有限数和不变输入；固定场次数下胜率提高时基础分不下降。
- 12 个底分档 × 2 个胜方 × 4 类余额，共 96 组零和/非负/守恒检查；各组不足一个积分时拒绝。
- 12 个等待档的允许分差与超出 1 分边界、跨档禁止、反转同等候选、满桌/已匹配排除。

限制：合成内存数据，无真实资料、线上迁移或服务启动；不是任意损坏数据恢复、超大规模性能、分布式存储、统计校准或全局最优匹配证明。commerce/账户/赛事完整业务和默认种子生产归属继续待审。

