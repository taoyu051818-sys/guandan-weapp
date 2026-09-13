# 第十一批：16 人赛事编排、报名、推进与结算投影

基线 HEAD：`1d58999dc6e5455b049e1643660bbba3deee1406`。root 完整审阅 9 文件 / 1,251 行，新增 1 项 P2：TO-11-001。具体文件哈希和结论见 [JSON](tournament-progression-11.json)。仅审计，未修复产品。

## 本批范围

统一前缀 `work/guandan-windows-source/server/platform/`：

| 文件 | 行数 | 重点 |
| --- | ---: | --- |
| tournament-orchestrator.js | 305 | 16人锁名单、3×4分桌、当前轮状态/重复回调、异常暂停 |
| tournament-pairing.js | 68 | 行/列/循环对角线，三轮不重复同桌，稳定assignment |
| tournament-service.js | 240 | 报名/取消/检录事务、receipt、免费fixed16约束和只读投影 |
| tournament-standings.js | 40 | 3/2/1/0个人积分排序、同分顺序、前8资格投影 |
| tournament-live.test.mjs | 312 | 本地真实HTTP完整3轮服务契约，签名门票续发和结果上传 |
| tournament-orchestrator.test.mjs | 123 | 当前轮、四桌完成后推进、单桌异常和幂等 |
| tournament-pairing.test.mjs | 66 | 人数、唯一性、每轮出现一次、72不重复同桌对 |
| tournament-service.test.mjs | 47 | 价格/幂等、免费取消/重报、锁名单，静态导入standings测试 |
| tournament-standings.test.mjs | 50 | 同分排序、冻结输入、DTO隔离与8/9名资格边界 |

辅助追查 result/matchmaking/事件/store/facade/票据/游戏入口及客户端检录调用，没有借此虚增覆盖。报名和检录是两个操作，客户端明确“检录会占用正式比赛名额”；仅报名人数可多于16，不直接判为超额参赛。收费旧赛事和种子目录仍在运营边界待核项中。

## TO-11-001（P2）：暂停赛事后，其他桌的正常收尾被一起拒绝

位置：

- `platform/spectator-event-service.js:300–323`：逐桌关闭与赛事阻断在同一事务。
- `platform/tournament-orchestrator.js:274–305`，尤其286行：只有 round-active 可阻断；幂等分支只接受同一张已blocked桌。
- `platform/matchmaking-service.js:261–264`：其他模式请求仍被该用户旧活动匹配挡住。
- 生产来源：`weapp-room-expiry.js:13`、`weapp-ws.js:231–240,456–475`，未正常结束的空房超时会产生 `room-closed/empty-timeout` 并回收本地房间。

触发过程：

1. 固定赛事已满16人，四桌均已分配并完成开局 claim。
2. 第一桌异常关闭：run变为blocked，平台关闭该桌并清掉4人活动索引。
3. 第二桌也异常关闭。事件处理先清理这一桌，但随后调用blockTournamentAssignment时因全局run已blocked抛出RUN_NOT_ACTIVE；整个事务回滚。
4. 该桌仍被平台标为playing、成员仍占活动索引；重试同一合法事件仍失败。第三、四桌同样受影响。

[复现脚本](../repro/tournament-progression-11.mjs) 分别将四桌作为首个关闭桌，均得到：首桌正确关闭且重复幂等，其余三桌各两次回调被拒绝，保留12个活动用户。后续用户转入quick被ALREADY_MATCHING拒绝，取消旧匹配被MATCH_NOT_CANCELLABLE拒绝。重建合成MemoryPlatformStore与PlatformService后仍失败；首桌用户作为对照可正常转入quick。

**影响边界**：确认平台事务与占用释放问题，不是“暂停赛事”策略本身有误；不要求自动补赛、改分或自动继续。未通过16个真实WS做全员断线/计时实测，也没有声称这会停止所有牌桌出牌、堵住全平台队列或永久不可恢复。

建议：保留首次暂停原因，同时让已暂停赛事内其他合法分配桌独立完成关闭/索引释放/幂等回执。仍校验赛事、轮次、assignment与match的绑定；不要以跳过所有校验方式解决。新增多桌顺序/并发终止、重试和恢复测试。原单桌blocked测试没有覆盖这一跨桌生命周期。

## 已执行验证

```sh
node work/guandan-windows-source/server/platform/tournament-pairing.test.mjs
node work/guandan-windows-source/server/platform/tournament-orchestrator.test.mjs
node work/guandan-windows-source/server/platform/tournament-service.test.mjs
node work/guandan-windows-source/server/platform/tournament-live.test.mjs
node docs/audit/2026-09-12/repro/tournament-progression-11.mjs
```

全部退出0。复现脚本对已确认缺陷作明确断言，所以退出0不表示缺陷修好了。

补充正常路径验证：

- 256组确定性名单置换，每组3轮、72个不重复同桌对；不是穷举16!。
- 每轮4桌全部24种完成顺序，共72轮顺序案例、288次完成；冻结输入不变，重复完成不重复推进。不是穷举24³种整场组合。
- 真实facade/store：第16人检录落盘失败无半锁名单；8次并发重试只锁一次；取消报名落盘失败也保持原报名。
- 每轮第四人加入时注入一次失败，共3次：没有半签票/半分配；重试按assignment顺序落座而非网络到达顺序。
- 3次票据到期续签保留match、room、seat、entryAttempt；票内赛制仍为随机级牌、独立一副、不进贡、个人排名。
- 3轮12桌逐桌开局事件与人工终局fixture；每份结果12个并发重复提交只入账一次。每轮最后一桌提交持久失败时完全回滚，重试仅推进一次。
- 每轮中途从合成快照重建store/service，共3次，完整状态保持。最终48条玩家轮次结果、16人各3局、9个不同同桌者；独立累计分值和opponentPoints相符，前8资格已持久保存。
- 终场再次重放全部12结果，整个状态不变。

限制：现有live测试仅在127.0.0.1临时端口、显式test环境、默认memory store运行，finally关闭服务，WeChat verifier为拒绝调用的存根；没有请求微信或线上服务器。补充探针没有网络，票据endpoint只是未连接字符串。终局ranking为人工fixture，不是实际打完12副27张牌；内存重建不等于JSON落盘断电/真机回归。产品文件未改。
