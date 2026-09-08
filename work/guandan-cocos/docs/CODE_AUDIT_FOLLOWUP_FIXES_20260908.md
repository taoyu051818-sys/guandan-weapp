# 第二轮抽查修复（2026-09-08）

范围：上一轮抽查 8 个文件中，4 个文件的 5 类行为缺陷，以及 `storage.js` 的职责拆分建议。不修改大厅/牌桌视觉、玩法、素材或线上部署。不是一次全仓库安全审计，也不把抽查比例当成全仓缺陷率。

## 已修复

| 缺陷 | 修复边界 | 回归证据 |
| --- | --- | --- |
| 退出登录后，迟到 401 重新登录并重试旧请求 | `PlatformApiClient.request` 捕获认证代次；取 token、首次响应、刷新及重试响应后均校验。旧成功响应同样拒绝 | 迟到 200/401、发送前退出、刷新后重试期间退出；20 个并发 401 仍合并为一次登录 |
| 好友房旧请求误取消新请求已接管的同一幂等房间 | `FriendRoomReservationCleanup` 独占保留、移交、待释放和在途释放。尚有入桌请求时延后清理，已移交游戏流程的房间不再由页面取消 | 新旧两种返回顺序、实际 HTTP gateway 复用 entryAttemptId、恢复入桌、不同房间、失败、销毁、取消期间再次创建 |
| 结算/观战回执校验不充分，误删待发送事件 | `report-event-contract.js` 要求 accepted=true 且 eventId 一致；观战还核对 matchId、sequence。合法 duplicate 确认可接受 | 空结果、accepted=false、错误 ID/房间/序号均保留 outbox；后续正确回执才删除 |
| 排队事件引用可变，发送正文与落盘快照不一致 | stage、恢复调度及直接 report API 都取得独立 JSON DTO；签名、请求头、重试、删除及 Map 清理使用同一份自有数据 | 入队后修改 eventId、matchId、sequence、嵌套牌数据；重试期间修改原始对象，不影响持久事件与实际发送 |
| 观战 stop 不能终止在途请求和内部重试 | `ReportDeliveryLifetime` 按 matchId 管理 AbortController 与全部等待计时器；涵盖 fetch、response.json、内层/外层退避 | fetch/body 挂起、不响应 abort 的 transport、超时、队列后续事件、内外层退避、停止一桌不影响另一桌 |

测试不会把“客户端已退出”解释成能撤销服务端已经执行的业务：认证代次隔离防止迟到结果回写和旧请求重新发送，服务端事务仍由平台负责。

## 存储拆分

- `storage.js` 从 421 行降为 168 行，保留存储适配器、写入串行化、快照隔离及持久化；历史版本迁移进入 `state-migrations.js`。
- `normalizeAccountId`、`findAvailableAccountId` 仍从旧路径重新导出，调用方无需改动。
- 保持 schemaVersion=9、账号分配、初始积分补齐、索引重建、种子数据补齐的原有顺序和行为。不改已有数据文件，不执行线上迁移。
- 新增存储契约测试覆盖迁移幂等、输入不变、旧数据优先、账号冲突、读隔离、事务顺序、mutator/persist 失败回滚与后续事务恢复。
- JSON 和 Redis 原型仍不提供跨进程事务或多实例生产一致性，本轮拆分不改变这项限制。

## 架构门禁

新增职责分为四个运行模块：客户端的 `FriendRoomReservationCleanup`，服务端的 `report-event-contract`、`report-delivery-lifetime`、`state-migrations`。均可独立测试；没有新运行时依赖环或待核对孤立文件。

新的模块及被修复模块加入行数预算；未提高任何原有预算。客户端纯模块加入 CI strict/unused 类型检查；新增服务端回归加入默认 npm test 链。

当前清单：223 个客户端文件（含 37 个生成副本）、37 个共享源码文件、65 个服务端 JS 文件，共 325 个。静态测试提及不等于覆盖率。

## 验证结果

- 客户端完整 `npm test` 通过，包括客户端/真实本地平台契约测试。
- 服务端完整 `npm test` 通过，包括票据入桌、好友房、机器人补位、终局、下一局和重启持久化 smoke。
- `typecheck:runtime`、`typecheck:ci-core`、`verify:core-sync`、`verify:architecture`、`verify:health`、`check:server` 通过。
- HTTP 回执收紧后，几处旧 smoke 模拟响应缺少真实平台已有的身份字段。测试夹具已补齐这些字段；未降低生产校验或放宽断言。
- 微信发行包重新构建；Creator 日志显示 Finished，进程沿用当前环境已有的退出码 36。后续 finalize 和 verify 独立通过：主包 3.04 MiB、总包 16.13 MiB；包含触摸起点、96% 启动和恢复随机数校验（后两者使用运行时 mock）。
- 未部署服务器、未上传体验版，浏览器历史构建地址也未替换。

## 手机验收

构建目录：`build/wechatgame`。上传前仍需实际测试：创建好友房后快速返回再创建；微信邀请入桌；切后台后继续牌局；四人准备下一局；连续理牌与滑动选牌。HTTP 乱序、挂起及持久化故障由本地夹具注入，不等同真机网络验证。服务端变更部署后才会在线上生效。
