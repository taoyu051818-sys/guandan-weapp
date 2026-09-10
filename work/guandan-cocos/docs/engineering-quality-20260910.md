# 工程质量优化（2026-09-10）

范围：处理上一轮剩余门禁与关键测试耦合；不更改玩法、页面风格、路由或线上配置，不提交其他轮次的工作区修改。

## 赛事排名职责

- `server/platform/tournament-standings.js` 独占排名与公开结果投影，不依赖事务或 HTTP。
- 对手分在排序前为每名玩家计算一次，不再在比较器中重复遍历对手记录。
- 排序返回独立的记录与对手列表，不修改输入。排序优先级、重复对手计分与晋级规则不变。
- `GameResultService` 在原结算事务中显式保存 rank、opponentPoints 和 advanced。查询排名不承担隐式写入职责。
- 赛事服务预算从 270 收紧为 245 行，排名模块预算 55 行；未通过抬高预算掩盖超限。

## 倒计时刷新

- 同一次控制器刷新只采样一次房间状态和当前时间，再将同一投影交给文字与 HUD。
- reset/dispose 立即隐藏并清零显示，清除文字；没有新快照时旧 tick 不再刷新。
- 阶段、服务端 deadline 与观看席位仍是唯一依据，不从节点 active 状态推断牌局。
- 非法时间或不存在的截止席位不显示看似有效的倒计时；客户端不自动推进规则。

## 行为测试替代源码写法检查

- `table-phase-presenter-regression.cjs` 直接调用 Presenter 公共入口，覆盖合法操作列表、贡还权限、托管、观战、四席准备/取消准备及终局按钮。合法动作查询与 Cocos 节点采用显式测试替身，不伪称真实引擎验收。
- `table-turn-clock-controller-regression.cjs` 复用已有 TS 加载器，覆盖 32 组席位投影、截止时间边界、40/60 秒房间、5→1 秒音效去重、恢复隐藏、重置/销毁与延迟回调。
- 移除其他测试中针对上述职责的具体变量名/计算表达式断言；保留退役 API 和装配边界检查。
- 服务端纯排名测试覆盖同分排序、输入/输出隔离与晋级边界；真实 16 人三轮服务集成测试额外核对持久排名与接口结果一致。

## 验证结果

- 客户端 `pnpm test:ci` 通过；另以 `GUANDAN_FORCE_PACKAGE_TYPESCRIPT=1` 完整重跑通过，不依赖本机 Cocos 的 TypeScript 实现。共享核心 16 个测试文件、86 个用例通过，其余客户端回归全部通过。
- `typecheck:runtime`（含类型契约）与 `typecheck:migration` 通过。
- 服务端 `pnpm test:server` 全部通过，包含平台服务、16 人三轮集成、四人/八人房间、托管机器人及恢复持久化。
- 服务端架构门禁通过：85 个生产 JS 文件、37 个行数预算；客户端架构、核心同步、健康清单通过；`git diff --check` 通过。
- Cocos Creator 3.8.8 Web 与微信构建均完成（CLI 退出码 36 且日志标记 Finished）。Web 构建后选牌/音效检查通过，微信正式配置和包体核验通过。
- 微信主包 3,328,263 字节，资源分包 13,743,105 字节，总计 17,071,368 字节（16.28 MiB）。启动和恢复检查含 Cocos/native/network 测试替身，不等于手机实测。

日志：`/tmp/guandan-engineering-client-20260910.log`、`/tmp/guandan-engineering-client-ci-20260910.log`、`/tmp/guandan-engineering-server-20260910.log`、`/tmp/guandan-engineering-*-build-20260910.log`、`/tmp/guandan-engineering-wechat-verify-20260910.log`。

未提交 Git、未部署服务端、未上传微信版本。现有工作区其他修改保留。真机验收、发布版本收口、容量测试与备份演练不由这些测试替代。
