# 平台生命周期修复

范围：PR-08-001、TO-11-001、PS-08-001、PF-06-001（4项P2）。仅修改和测试；不提交、不部署、不修改原审计文档或原有5处dirty文件。

## 实施

| ID | 修复与边界 |
| --- | --- |
| PR-08-001 | `match-participants.js`独立承载成员/结算席位规则：已cancelled的历史不进入四席映射，当前四席/四用户必须唯一，禁止按数组顺序覆盖。`game-result-service.js`收尾保留cancelled历史状态。保留已终止参赛者的原结果接收语义；不清历史、不新增机器人账户。 |
| PF-06-001 | 新成员和cancelled成员复活共用12人容量门禁，检查发生于签票之前；已活动成员的同ID重试和恢复不受满员影响。保留旧尝试撤销、待离席确认、封禁、观战关闭和运行时容量防线。 |
| PS-08-001 | 仅进行中好友房的observer离席不使用大厅开房租约；时间下界改用已确认开局时间。事件归属、真实observer身份、序号、未来时钟、回执幂等及坐席不得离席规则保持。未开局离席仍受原lease+5分钟边界限制。 |
| TO-11-001 | 已blocked赛事的当前轮其他合法分配桌可独立记录blocked并释放用户；run保留首次暂停原因/桌号/时间。每桌match绑定、当前轮、重复原因校验保持，未来轮仍不推进；run验证允许当前轮多张blocked桌。 |

## 回归

新增`platform-lifecycle-test-fixture.mjs`：全合成身份/密钥、人工时钟、MemoryPlatformStore；可注入单次persist失败和从合成快照重建服务。未读取环境状态文件、真实用户或外部服务。新增27个原生`node:test`场景，产品修复前确认25失败、2个正常lease边界通过；修复后27/27通过。

- `friend-membership-regression.test.mjs`（18场景）：普通/复式×邀请/房号×大厅/进行中共8种满员旧成员重入，拒绝时全状态不变且未签票；活动成员重试、恢复和空出一人后重入成功。历史席位重用×顺/逆数组×真人/机器人4种真实规则引擎升级终局，注入持久失败无部分入账、6次并发结果仅计一次、冷恢复幂等；重复当前席位拒绝。lease+299999/300000/300001ms及+24h的observer退出，由真实SpectatorEventReporter和内存outbox首次按序交付seat-left/play，冷恢复重复回执、非法成员/坐席、开局前时间及未来时钟对照。
- `tournament-closure-regression.test.mjs`（9场景）：4种首个异常桌×顺序/交错回调8组合，16人均释放，赛事保持blocked且后续轮pending，首因不变，重复回调和冷恢复不改分。附后续桌persist失败回滚/重试、错误match/room/轮次/重复原因反例。

执行：

```sh
node --test work/guandan-windows-source/server/platform/friend-membership-regression.test.mjs work/guandan-windows-source/server/platform/tournament-closure-regression.test.mjs
node --test work/guandan-windows-source/server/platform/friend-room-service.test.mjs work/guandan-windows-source/server/platform/game-result-service.test.mjs work/guandan-windows-source/server/platform/spectator-domain.test.mjs work/guandan-windows-source/server/platform/spectator-event-service.test.mjs work/guandan-windows-source/server/platform/tournament-orchestrator.test.mjs work/guandan-windows-source/server/platform/tournament-pairing.test.mjs work/guandan-windows-source/server/platform/tournament-service.test.mjs work/guandan-windows-source/server/platform/storage-contract.test.mjs
node --test work/guandan-windows-source/server/platform/friend-room.test.mjs work/guandan-windows-source/server/platform/tournament-live.test.mjs
git diff --check
```

上述全部通过。后两项HTTP测试经核使用显式test配置、合成种子、memory store、127.0.0.1临时端口和拒绝微信调用的存根，finally关闭服务；16人赛事完整3轮正常计分路径通过。未执行生产入口、WS/真机联机、真实文件断电恢复或上线验收。升级终局是目标6合法状态后3次真实PLAY，不声称完整随机对局从2打到6。原审计复现仍保留“断言旧缺陷”的语义，未改成虚假的修复通过报告。

本范围无未完成代码修复；真机及交付包验收由主整改流程另行执行。
