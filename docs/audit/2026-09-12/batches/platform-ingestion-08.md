# 第八批：平台事件接收、结算事务及存储契约

审核人：root。基线 HEAD：`1d58999dc6e5455b049e1643660bbba3deee1406`，原五处未提交修改保留。
完整审阅 11 文件 / 1,964 行；逐文件 SHA-256、行数和结论见 [JSON](platform-ingestion-08.json)。辅助阅读和执行依赖不计覆盖。

## 结论

新增 2 项 P2；现有 4 项专项测试通过。问题均由真实模块和合成内存数据复现，不是线上事故断言。
本批未修改业务代码，没有部署、重启、构建、真实用户资料读取或外部请求。

### PR-08-001：旧席位历史覆盖当前参赛者

位置：`work/guandan-windows-source/server/platform/game-result-service.js:78–79`。
`resolveMatch` 把所有有 seat 的 participants 转成席位映射，没有排除 cancelled；相同键由后项覆盖。

可正常到达的操作：

1. u1 在 p2，离席被平台确认。
2. u4 进入 p2，随后离席也被确认。
3. u1 再次加入 p2；u2、u3 补齐其余席位，正式开局。
4. 实际开局 roster 为 p2=u1，但历史 u4/cancelled/p2 留在 participants 数组较后位置。
5. 升级赛完成，真实 `buildGameResultEvent` 的正确结果被拒绝：“结算席位用户与匹配分配不一致”。

[独立复现](../repro/result-roster-08.mjs) 使用真实平台建房/签名票据、游戏侧入桌/离席、开局 roster 接收，以及真实规则引擎终局。
两次相同结果重试均失败；整个平台快照保持原状，没有部分入账。只在测试内存过滤非活动历史后，同一结果立即接受，再次提交返回 duplicate；当前四人各统计一次，u4 不记分。
无换座历史的同构对照正常。

影响边界：已确认升级好友房的排名结算路径；定局/转蛋 `match-ended` 和复式专用计分不能据此一并判定有问题。人工终局 fixture 从目标 6 的合法状态完成三次 PLAY，不是随机从 2 完整打到目标，也不是实际手机联机。

建议：使用开局确认的四席权威 roster／明确的活动参赛记录验证结果；席位唯一性要单独检查，历史记录不混入映射。保留历史，而非全局粗暴删除。增加旧成员重入、多人先后占同座、机器人替代与数组顺序回归。

### PS-08-001：进行中观战离席误受大厅租约限制

位置：`work/guandan-windows-source/server/platform/spectator-domain.js:210–214`。
全部 `seat-left` 被限制在 `friendRoomExpiresAt + 5分钟` 以内，未区分开局状态。

相邻契约明确允许长局继续：`FriendRoomService.hasExpired` 不让原开房租约结束 playing 对局；`SpectatorEventService` 允许 playing 中 observer 离席。
游戏侧真实 RoomExit 会移除该观战者并发送离席事件，但平台的时间检查更早拒绝它。

同一 [复现](../repro/result-roster-08.mjs) 的两个对照：

| 离开时间 | 结果 |
| --- | --- |
| 原开房租约 + 300,000 ms | observer 释放成功，后续 play 正常上报 |
| 原开房租约 + 300,001 ms | FRIEND_SEAT_EVENT_AFTER_LEASE；游戏侧已离开，平台仍保留 playing 身份和 activeMatch |

默认租约为 30 分钟。第二分支用实际 SpectatorEventReporter 和内存 JsonSpectatorOutboxStore 连续重试队头 seat-left，后续 play 从未发出，两条持久待发记录仍保留，随后受控停止测试。
不是整个游戏动作停止，也没有证明独立的排名结算通道停止；确认的是同场公开事件通道堵塞，以及平台残留观战成员。

建议：未开局席位释放才使用 lobby lease；进行中观战者离开按对局状态、身份绑定及相应时间边界处理，保留序号/重放/时钟保护。补租约 ±1ms、长局、重复回执、后续事件及在座玩家不能离席的反例。

## 其余核验

完整文件清单（统一前缀 `work/guandan-windows-source/server/platform/`）：

- `spectator-domain.js`、`spectator-event-service.js` 及各自测试。
- `game-result-service.js` 及测试。
- `service.js`、`storage.js`、`storage-contract.test.mjs`、`state-collections.js`、`errors.js`。

已核事件分型、私有字段剔除、roster 原子提交、结果和公开流独立到达、重复/乱序/改体拒绝、终态围栏、转蛋分数和 bot 不造平台账号。
Facade 中仍有 season task/回放/公开观战查询，不能只因已委派主要业务就称所有职责都已审完；账户、赛事、商家领域需继续独立审阅。
存储明确是单实例快照事务；没有将 Redis 原型称为可多实例一致性实现。

运行命令：

```sh
node work/guandan-windows-source/server/platform/spectator-domain.test.mjs
node work/guandan-windows-source/server/platform/spectator-event-service.test.mjs
node work/guandan-windows-source/server/platform/game-result-service.test.mjs
node work/guandan-windows-source/server/platform/storage-contract.test.mjs
node docs/audit/2026-09-12/repro/result-roster-08.mjs
node docs/audit/2026-09-12/repro/platform-ingestion-08.mjs
```

全部退出 0。后两项是“成功重现预期问题”和正常边界验证，并非产品无问题。

[接收事务补充探针](../repro/platform-ingestion-08.mjs) 验证：

- 13 种事件有效输入、嵌套复制和 13 种未知字段拒绝。
- 实际 start 接收及结果结算两个 persist 故障点，均不提交部分状态。
- 25 次并发相同结果仅 1 次实际结算；改体和第二个事件 ID 重结算被拒绝。
- 结果先到，尾部动作后到；最终序号和延迟两条件共同控制公开终态，错误末事件不写入。
- 已完成后的重复 game-start 不复活比赛，离桌清理 room-closed 不把胜负改成中止。
- 尾部补写更新回放，公开事件不暴露内部 ID／roster。

边界：所有测试使用合成数据、人工时钟、内存持久端口和替代 fetch。未验证 HTTP 签名入口、生产 JSON/Redis 故障、完整 16 人/双桌流程、真机画面或性能。当前 legacy publicTimeline 的兼容净化与主 stream 分开记录，未把无活动生产者的推测升级为新问题。

