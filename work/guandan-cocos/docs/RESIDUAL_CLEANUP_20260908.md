# 残留代码清理与包体复验

日期：2026-09-08。基于上一轮退役清理后的工作区继续实施，不包含此前用户的其他未提交修改。

## 本轮结果

- Cocos 运行目录：217 → 211 个 TypeScript 文件，31,330 → 30,007 行，净减 1,323 行（包含注释和空行）。
- 再移走 7 个完整运行模块，并新增一个 23 行公共统计模块 `game/RoundRecord.ts`。累计退役清单为 17 个整文件；此前 20 个音频归档本轮未变。
- 默认客户端 76 项回归脚本全部通过；共享规则 15 个文件、78 项测试通过；服务端检查和完整静态、平台、WebSocket 回归链通过。
- Creator 3.8.8 微信与 Web 发行构建完成，启动/恢复兼容、选牌坐标及包内退役扫描通过。
- 不改美术、布局、服务端业务代码或数据；没有部署、上传或进行手机操作。

## 清理边界

| 残留职责 | 本轮处置 | 保留的正式能力 |
| --- | --- | --- |
| 单机开局、本地 AI、延时出牌与本地下一局 | 5 个控制器移至 `tests/support/local-match`；删除 `GameManager` 的本地入口与回合钟的本地超时动作 | 服务端机器人、联机命令待确认、四人准备下一局、权威 deadline |
| 旧战役/双明/难度缓存 | 会话 schema 升到 3，恢复时不接收 `gameMode`、`difficulty`、`campaignProgress`；删除结算战役尾注及旧双明分支 | 既有偏好、女声、统计、历史结果；服务端授权的队友手牌/好友房观战 |
| 单机事件文件中的炸弹统计 | 抽为 `game/RoundRecord.ts`，联机和测试各自导入 | 只统计当前玩家，保留同花顺是否算炸弹的规则开关与服务端统计优先级 |
| 商城兑换/下单和订单类型 | 网关及契约移至 `migration/platform`，正式网关工厂不再包含 shop；预览域只有展示依赖 | 商城商品预览、账户积分查询；服务端商品/订单数据及契约测试 |
| 无实现的流程特效 | 删除 `FlowEffectTypes`、`renderFlow`、旧开场/匹配成功/出完/托管/聊天脉冲/贡还空调用及其游标；清除从未登记节点的集合 | 发牌入场、飞牌、正式牌型 renderer、聊天气泡和语音、出完/十张提示 |
| 胜负音效的绕行调用 | 结算阶段直接调用音频语义接口，并保留已有去重及恢复静默条件 | 正常胜负人声音频，不补播历史结算 |
| 共享 AI 兼容门面生成副本 | 同步策略明确排除孤立的 `lib/ai.ts`，保留其共享源；同步/校验使用同一策略，覆盖 POSIX/Windows 路径 | 其余 36 个共享模块与源完全一致，旧端兼容和服务端 AI 不受影响 |

迁出的本地控制器仍参与类型检查及自动测试，不是废弃副本，也没有产品入口。迁移网关仍有契约测试。原模块 metadata 和退役类型保存在 `asset-library/retired-runtime-20260908`；可追溯，但不应直接放回 `assets`。

没有因为静态调用图未命中就删除序列化组件、类型契约、服务端 CLI 或共享兼容入口。共享 types 中供旧端使用的战役/模式兼容声明仍保留；它们不是 Cocos 会话字段，TypeScript 编译后不产生对应运行代码。当前三端源码清单无待说明孤立项，仍保留 3 个已说明的非游戏入口。**静态可达和回归通过不代表每个分支都经过真机验证。**

## 防回流约束

- `verify-retirement.mjs` 同时扫描源码和构建包：禁止旧本地控制器、旧商城网关、兑换路径及空流程调度返回运行包。
- 新增 `residual-cleanup-regression.cjs`：旧缓存实际恢复并重新落盘，保留用户偏好/统计，观战不计战绩；出牌/不要只发网络意图、不先改手牌；退役方法不存在。
- 同步门禁验证 36 个镜像源码和显式兼容排除项，不能手改生成业务代码。
- 行数上限收紧：`GameManager` 500 → 250（实际 222），`EffectController` 500 → 380（实际 342），`TableMatchCoordinator` 480 → 440（实际 409）；新增 `ShopPageDomain` 60 行上限（实际 45）。
- 新职责继续拆到独立模块，不能重新扩大组合根或用空实现承诺未支持的能力。

## 微信包对照

| 项目 | 上一轮记录 | 本轮构建 | 减少 |
| --- | ---: | ---: | ---: |
| 主包 | 3,105,949 B | 3,070,654 B | 35,295 B |
| game-assets 子包 | 13,433,169 B | 13,433,169 B | 0 B |
| 总包 | 16,539,118 B | 16,503,823 B | 35,295 B |
| main/index.js | 780,628 B | 745,333 B | 35,295 B |

本轮主包约 2.93 MiB，总包约 15.74 MiB。对比基线是上一轮本地构建记录，不声称是隔离工作树中重建的严格 A/B。核验器显示的累计减少 408,589 B 使用更早基线，不能误算为本轮独立收益。源码行数降幅不会等比例反映到压缩后 JS 包体。

当前 main/index.js SHA-256：`58cd08e7965772faa0218a68b1170f17407d2f113046522c37924f9dd30df4d6`。机器可读结果见 [residual-cleanup-result-20260908.json](residual-cleanup-result-20260908.json)。

## 验证与复现

已执行：

- `npm test`：76 个脚本，包括客户端与临时本地服务端契约测试。
- `npm run typecheck:runtime`、`typecheck:ci-core`、`typecheck:migration`。
- `npm run verify:architecture`、`verify:health`、`verify:core-sync`。
- `npm run test:core`：类型、78 项规则测试及构建。
- 服务端目录 `npm run check:server && npm run test:server`。
- Creator 微信/Web build；`finalize:wechat-build`、`verify:wechat-build`，Web release finalize/verify 及双端退役扫描。
- `git diff --check`。

Web release finalize 首次因为未提供环境端点被安全门禁拒绝；补上既有 HTTPS/WSS 配置后通过，没有放宽检查。类型/能力清理后，一些旧源码断言仍要求已退役方法存在，已替换为禁止回流断言；动态规则、选牌、网络、音频生命周期与节点池测试保留。

Web 复现使用既有公开端点配置：

```sh
GUANDAN_PLATFORM_ENDPOINT=https://api.yutechhn.cn/guandan \
GUANDAN_LOBBY_ENDPOINT=wss://api.yutechhn.cn/guandan/weapp \
npm run finalize:web-build
```

微信 release 仍强制既有业务域名，不含本地或未批准服务器回退。

## 真实测试边界

启动/恢复和 Cocos 交互回归有 mock；服务端 smoke 使用临时本地测试实例，不是生产联调。本轮未进行真实微信设备测试，不能据此宣称真机全部无问题。

建议下一次上传前在手机检查：微信邀请入桌 → 连续理牌/滑选 → 切后台恢复 → 正常结算音效且重连不补播 → 四人准备下一局；再确认商城仍为商品预览、旧战役提示不再出现。
