# 第二十七批：场景生命周期、网络事件和弹层恢复

基线 HEAD：`1d58999dc6e5455b049e1643660bbba3deee1406`。仅审计，未修改产品行为。

本批完整审阅14个原待审文件（9个源文件、5个回归入口），共2,244行。逐文件SHA-256、说明和结构化结果见[JSON报告](scene-lifecycle-27.json)。总覆盖更新为484/629，76.95%；仍有145份第一方文件未审及独立边界专项，不是全库健康结论。

## 确认问题

| 编号 | 优先级 | 场景与影响 | 可恢复边界 |
| --- | --- | --- | --- |
| UI-27-001 | P3 | 退出/普通提示/解散弹窗保持打开时窗口变宽，遮罩与输入拦截节点仍是旧宽 | 重开弹窗会正确铺满；手牌的独立阻塞仍生效 |
| UI-27-002 | P3 | 同意/拒绝解散未成功发送，也立即关闭投票框；自己的票仍pending | 收到新的投票消息会重开；不能称永久丢票或计票错误 |
| RESOURCE-27-001 | P3 | 牌桌背景首次失败/超时后，重复入桌不再加载，持续沿用大厅背景 | 显式preload或重建scene可以重试；不阻止规则运行 |

### UI-27-001：旧弹窗没有随resize更新

位置：`TableOverlayController.ts:54`。GameScene在屏幕变化时调用owner.resize，但该方法仅更新finishToast。创建遮罩时设置的UITransform和Graphics不会再次刷新。

在1280×720打开三种弹窗，分别扩宽到1565和1792：6组旧遮罩仍为1280，新增285或512宽度没有覆盖；6组关闭再打开对照正确。核对本机Cocos3.8.8完整BlockInputEvents源码及事件分派/hitTest片段，其拦截以节点尺寸为界。探针未执行完整Cocos触摸分派或证实底层按钮误触，故影响限定于遮罩/物理拦截区域缺口；`blocksHandInput`仍为true。

建议让owner统一重排存活弹层的遮罩与panel，保留当前投票/按钮状态；验收需在不关闭弹层的情况下扩宽、缩窄。

### UI-27-002：投票发送失败后丢失直接重试入口

位置：`TableOverlayController.ts:242`。LobbyController把投票交给LobbyCommandSender，后者在socket抛错或rejoining门禁下返回null，但overlay忽略结果并销毁按钮。

合成同意/拒绝×socket异常/rejoining共4组，实际sender均无发送、投票仍pending、dialog已不存在；定时刷新、恢复ready及普通lobby事件不重新打开。4组新的dissolve-vote广播均可重开并正常发送。socket异常依然产生client-error及error反馈，不应描述为完全静默。

这是客户端错误反馈/重试问题，不与SL-02-002服务端重连未恢复offline票态混算。建议null时保留投票框和重试按钮；成功发送或服务器确认后再按明确的回执策略关闭。

### RESOURCE-27-001：背景失败后没有自动再次请求

位置：`SceneBackdropController.ts:82`。Startup只强制预加载lobby，mount额外预加载table一次。失败只warn，pending虽然释放，setMode却只apply，不补缺失frame。

联合真实GameAssetLoader，以合成Bundle callback error和15秒watchdog两种失败复现：之后迟到成功正确地被loader忽略；5次切换入桌及尺寸变化不再请求，最终仍是lobby texture，加载次数始终为初始2次。显式调用preload(table)后，两组均恢复正确背景。这不是pending永不释放，也不是头像RESOURCE-06-001的同根因。

建议缺frame的setMode触发共享、有界重试，保持旧背景兜底；须保留dispose/revision守卫，避免每帧请求。

## 验证与正常防线

5个完整读过的既有入口通过：

- table-network-event-bridge-regression
- table-scene-assembly-regression
- table-overlay-controller-regression
- scene-backdrop-controller-regression
- lobby-network-owners-regression

[隔离探针](../repro/scene-lifecycle-27.cjs)通过：

| 范围 | 验证量与结论 |
| --- | --- |
| 清理tracker | 120请求、843个房间状态观测，乱序回执/重叠同房/超时重复及send异常守恒 |
| 命令owner | 1584角色/房主/复式已坐席/就绪门禁/命令组合，162允许；使用shared-core当前源协议的6种versioned命令 |
| 连接owner | 32连接、48断连分支，matched优先、resume身份完整性、watchdog/预算/回平台恢复顺序正确 |
| 事件bridge | 100挂载销毁周期，1200正常转发、1200保留回调检查，第三方监听保留、disposed后不复活 |
| toast | 5个真实Tween中途替换/淡出替换时序，替换文本可见且旧动作取消，dispose后回调惰性 |
| 背景transition | 4个真实Tween相反切换和中途dispose对照正确；两个失败+显式重试对照如上 |
| 结算presenter | 48队伍/原因/视角终局，72动态team/格式/终场组合；人数去重、队友身份与独立局说明正确 |

首次探针的SpriteFrame替身漏设isValid，使释放次数断言失败；补齐真实引擎对象的初始有效状态后全部通过。该失败未记产品缺陷，源码未更改。

## 设计与覆盖判断

GameScene虽仍571行，但主体是装配及生命周期委托：输入、网络事件、弹层、时钟、背景和前页都有owner。当前证据不支持“应继续拆类才能健康”的笼统结论。此次问题是已有owner没完整承接失败/尺寸恢复责任，应优先补状态与回归，不是额外增加抽象层。

既有测试对这些owner主要覆盖正常路径；背景测试主动调用preload(table)、弹层测试让vote永远成功，Tween也即时执行。因此5个入口全绿不能证明新问题不存在。补充探针用了实装9份Tween/Action算法，但节点/绘图/资源/socket/计时端口仍为合成。

UI/UX技能用于弹层恢复检查。首次搜索返回通用焦点条目，第二次精确查询未命中；没有把搜索结果说成针对性规范。最终依据代码状态契约与Cocos输入源码，未改视觉风格。

辅助复读GameAssetLoader、StartupCoordinator、GameScene消费者及ui-recovery/residual等不重复计覆盖；后两测试本轮未重跑。本批没有真实微信/多人WebSocket/生产请求，没有构建、部署、业务修复或提交。旧5处未提交修改与HEAD保持不变。

