# 第十批：完整匹配、机器人补位、权威统计与底分预留

root 完整审阅 9 文件 / 1,019 行，基线 `1d58999dc6e5455b049e1643660bbba3deee1406`；原五处修改保留。
本批无新增确认缺陷。[逐文件哈希与结论](matchmaking-accounting-10.json)。

## 审阅范围

- 平台 `matchmaking-service.js` / 测试，`match-bot-fill.js`：排队、分档、3秒补位、固定赛事分配分支、过期/取消/恢复。
- 游戏侧 `weapp-match-bot-seats.js` / 测试：已验证票据的bot映射、首席真人、bot不占连接或恢复令牌。
- `game-stats.js` / 测试：权威已接受动作的出牌/贡还/超时/托管统计及结果边界。
- 平台 `commerce-service.js` / 测试：底分预留、可用积分、商品/钱包数值守卫、兑换幂等及原子扣减。

实际读完整固定赛事匹配分支，但本批公共队列验证不等于完成整个赛事审计。
公开匹配 bot 有 system 用户和钱包，好友房 friendbot 则不产生平台账号；两种模型不可混为一谈。账号保留/排行榜可见性另有后续边界任务。

## 验证结果

四项既有测试全部通过：

```sh
node work/guandan-windows-source/server/platform/matchmaking-service.test.mjs
node work/guandan-windows-source/server/weapp-match-bot-seats.test.mjs
node work/guandan-windows-source/server/game-stats.test.mjs
node work/guandan-windows-source/server/platform/commerce-service.test.mjs
node docs/audit/2026-09-12/repro/matchmaking-accounting-10.mjs
```

[补充跨模块探针](../repro/matchmaking-accounting-10.mjs) 也退出 0：

| 场景 | 实际核验 |
| --- | --- |
| quick + 12 个公共档，各 1/2/3/4 真人 | 52 组合，130 张真实签名票据；排队隔离、补位人数、四席唯一、恢复保持bot映射 |
| 平台票据到实际 room metadata | 机器人身份一致，socket/resume为空，真实入场票属于相应真人 |
| 正常开局→人工终态结果 | 每参与者统计一次；12底分档积分零和；quick示例奖励合计200；重试不重复 |
| 16 人同时加入 | 4 个独立满员桌，每人只在一个活动匹配 |
| bot补位持久失败→重试 | 无半套账号、钱包、席位、票据或队列提交；恢复后只一组bot；入桌期限到期释放活动索引 |
| 2,999ms / 3,000ms取消 | 前者成功且以后不补；后者已分配不能取消，后续status取得匹配结果 |
| 匹配与兑换并发，两种入队顺序 | 匹配先成功则兑换不能侵占底分；兑换先扣至不足则匹配被拒绝 |
| 兑换落盘失败、20次同key重试 | 失败无部分库存/订单/钱包/记录；恢复后只扣1积分、1库存并产生1订单 |

统计 builder 的 `ranking/userIdsBySeat/teamLevels` 是引用，不能称为深冻结；已追到实际 pending/stage 调用与 reporter 的快照所有权边界，未确认独立可达的数据变异缺陷。统计 DTO 对计数和已知牌型作限制，不能由客户端意图直接累加。

## 验证边界

全是合成用户、人工时钟、内存 persist 和不建立连接的 endpoint；未启动 HTTP/WS 服务器、读真实用户数据、发网络回调或部署。
52 个终态结果只验证席位和计分映射，**不是实际玩完52场**，不证明策略胜率。
相邻已审 facade/metadata/outbox 只辅助使用；未把 crypto、完整平台总测试或赛事依赖的导入算作完整审阅。

