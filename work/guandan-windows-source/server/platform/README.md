# 陵水掼蛋平台 API 与生产联机契约

本目录是独立实现的平台服务基础，不包含或复制其他未授权项目代码。它与牌局规则服务分工如下：

```text
Cocos 客户端
├── HTTP /api/v1 → platform-server.js
│   ├── 微信登录、用户资料
│   ├── 积分账户与只追加流水
│   ├── 商品兑换、赛事报名
│   └── 匹配与入桌票据
└── WebSocket /weapp → weapp-ws.js
    ├── 固定席位入桌、重连
    ├── 权威牌局规则和状态
    └── 签名结算回传 → platform-server.js
```

## 启动

开发联调：

```bash
PLATFORM_ENABLE_DEV_LOGIN=true npm run server:platform
npm run server:weapp
```

默认地址：

- 平台 API：`http://127.0.0.1:3003/api/v1`
- 牌局 WebSocket：`ws://127.0.0.1:3002/weapp`

运行回归：

```bash
npm run test:server
```

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PLATFORM_HOST` | `127.0.0.1` | 平台监听地址；容器部署时显式设定 |
| `PLATFORM_PORT` | `3003` | 平台 API 端口 |
| `PLATFORM_CORS_ORIGIN` | `*` | 正式环境应限制为可信来源 |
| `PLATFORM_ENABLE_DEV_LOGIN` | `false` | 仅本地联调可设为 `true` |
| `PLATFORM_ACCESS_SECRET` | 开发密钥 | 访问令牌 HMAC 密钥，生产必填且至少32字符 |
| `GAME_TICKET_SECRET` | 开发密钥 | 平台和牌局服共享的入桌票据密钥，生产必填 |
| `GAME_RESULT_SECRET` | 开发密钥 | 平台和牌局服共享的结算回调密钥，生产必填 |
| `GAME_SPECTATOR_EVENT_SECRET` | 开发密钥 | 仅用于公开观战事件写入；生产环境必须与结算密钥不同 |
| `GAME_ENDPOINT` | `ws://127.0.0.1:3002/weapp` | 匹配完成后返回给客户端的地址 |
| `GAME_TICKET_REQUIRED` | `false` | 牌局服设为 `true` 后 create/join 强制票据 |
| `GAME_RESULT_ENDPOINT` | 空 | 牌局服结算回调地址，例如 `http://platform:3003/api/v1/game/results` |
| `GAME_SPECTATOR_EVENT_ENDPOINT` | 空 | 独立观战事件入口，例如 `http://platform:3003/api/v1/game/spectator-events` |
| `GAME_SPECTATOR_OUTBOX_FILE` | 空（关闭） | 牌局服单实例观战事件 outbox，例如 `./var/spectator-outbox.json` |
| `PLATFORM_JSON_FILE` | 空 | 设置后使用单实例 JSON 存储；空值为内存存储 |
| `WX_APPID` / `WX_SECRET` | 空 | 微信小程序 `code2Session` 配置 |
| `WX_LOGIN_TIMEOUT_MS` | `5000` | 微信登录上游超时 |

当 `NODE_ENV=production` 时，四个 HMAC 密钥没有显式配置会拒绝启动；观战写入密钥与结算密钥相同时同样拒绝启动。`code`、`openid` 和 `session_key` 不写日志；当前服务也不保存或返回 `session_key`。

## 通用 HTTP 约定

所有接口使用 JSON，并始终返回三个顶层字段：

```json
{
  "ok": true,
  "data": {},
  "error": null
}
```

错误：

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "INSUFFICIENT_POINTS",
    "message": "积分不足",
    "details": { "balance": 100, "required": 600 }
  }
}
```

需要登录的接口使用 `Authorization: Bearer <accessToken>`。兑换和报名的写操作必须携带 `Idempotency-Key`；相同 key 和相同正文返回原结果，相同 key 配不同正文返回 `409 IDEMPOTENCY_CONFLICT`。

## 登录和用户

### `POST /api/v1/auth/wx-login`

```json
{ "code": "wx.login 返回的一次性 code", "displayName": "玩家", "avatarUrl": "https://..." }
```

服务端调用微信 `jscode2session` 验证；验证失败不会创建用户。响应：

```json
{
  "accessToken": "...",
  "expiresAt": 1785840000000,
  "user": { "id": "usr_...", "accountId": "58310427", "displayName": "玩家", "avatarUrl": "", "comprehensiveScore": 5169, "createdAt": 1785753600000 }
}
```

### `POST /api/v1/auth/dev-login`

仅当 `PLATFORM_ENABLE_DEV_LOGIN=true` 可用；默认返回 `403 DEV_LOGIN_DISABLED`。

```json
{ "deviceId": "local-device-1", "displayName": "本地测试" }
```

`deviceId` 是稳定开发身份，同一值在访问令牌过期后仍返回同一用户和钱包；服务端暂时兼容旧字段 `externalId`，两者同时存在时优先 `deviceId`。

响应与微信登录相同。

### `GET /api/v1/profile` / `PATCH /api/v1/profile`

返回 `data.user`。其中 `accountId` 是服务端分配、全平台不重复的八位数字字符串，`comprehensiveScore` 是只用于实力展示和匹配的综合分；PATCH 只能提交 `displayName`、`avatarUrl`，不能修改账号或综合分。

## 个人中心、钱包、商城与赛季

### `GET /api/v1/me/dashboard`

需要登录。返回公开用户资料（包含八位 `accountId` 和 `comprehensiveScore`）、牌局统计、独立评分明细、当前赛季进度和最近十场摘要。评分明细示例：

```json
{
  "rating": {
    "games": 12,
    "wins": 7,
    "eloOffset": 81.25,
    "baseScore": 12571,
    "comprehensiveScore": 12652
  }
}
```

综合分和钱包积分是两套独立数值，不能互相换算或影响：

- `comprehensiveScore = max(1000, baseScore + eloOffset)`，只用于实力与匹配。
- `baseScore = 60000 × ((wins + 25) / (games + 50))^1.8 × (0.3 + 0.7 × log(1 + games) / log(101))`。
- ELO 只读取双方赛前综合分与胜负：`expectedA = 1 / (1 + 10^((teamBScore - teamAScore) / 40000))`，`deltaA = 200 × (resultA - expectedA)`；场次不会改变 K 值或额外放大 ELO。
- `wallet.balance` 才是可消费“积分”：新用户初始 10000，用于商城、赛事报名和经典底分输赢，不参与综合分公式。

### `GET /api/v1/season/tasks`

返回当前赛季及任务进度。`daily` 任务使用东八区自然日计数和领奖周期；`season` 任务在当前赛季内累计。

### `POST /api/v1/season/tasks/:taskId/claim`

需要 `Idempotency-Key`。任务未完成时返回 `409 TASK_NOT_COMPLETE`；同一周期重复请求不会重复入账。

## 钱包与商城

### `GET /api/v1/wallet?limit=20`

```json
{
  "wallet": { "userId": "usr_...", "balance": 8800, "currency": "points", "updatedAt": 1785753600000 },
  "ledgerEntries": [
    {
      "id": "led_...",
      "amount": -1200,
      "balanceAfter": 8800,
      "type": "shop_redeem",
      "referenceId": "ord_...",
      "description": "兑换商品：植物香皂",
      "createdAt": 1785753600000
    }
  ]
}
```

流水只追加，不提供更新、覆盖或删除接口。钱包余额和综合分完全隔离：商城、报名或牌局底分流水不会改动 `eloOffset`，综合分变化也不会直接增减钱包。

### `GET /api/v1/products`

返回 `data.products`：

```json
{
  "id": "soap",
  "name": "植物香皂",
  "pointsPrice": 600,
  "description": "温和清洁香皂，示例规格100克。",
  "category": "个护",
  "stock": 150
}
```

### `POST /api/v1/orders/redeem`

头：`Idempotency-Key: <客户端每次操作生成的唯一值>`

```json
{ "productId": "soap", "quantity": 1, "expectedPointsPrice": 600 }
```

返回 `data.order`，状态当前为 `paid`。库存扣减、积分扣减、订单和流水在同一个存储事务中提交。`expectedPointsPrice` 与服务端现价不一致时返回 `409 PRODUCT_PRICE_CHANGED`，客户端必须刷新并让用户重新确认，不会按未展示的新价自动扣分。请求结果不确定时，重试必须复用原 `Idempotency-Key`。

### `GET /api/v1/tournaments`

可匿名访问；携带访问令牌时 `enrolled` 反映当前用户报名状态。返回 `data.tournaments`，字段包括：

```json
{
  "id": "weekend-cup",
  "name": "周末挑战赛",
  "description": "周六、周日开放 · 周榜奖励",
  "status": "open",
  "entryPoints": 200,
  "queueId": "weekend_cup",
  "enrolled": false
}
```

### `POST /api/v1/tournaments/:tournamentId/enroll`

需要访问令牌和 `Idempotency-Key`，正文传 `{ "expectedEntryPoints": 200 }`，返回 `data.enrollment`。收费赛事的报名、扣分和流水在同一事务完成；报名费已变更时返回 `409 TOURNAMENT_PRICE_CHANGED`，不会静默按新费用扣分。

### `POST /api/v1/tournaments/:tournamentId/check-in`

固定16人赛事专用，需要访问令牌且必须先报名。检录幂等；第16名玩家检录后立即锁定名单并生成3轮、每轮4桌的稳定 Latin 编排。锁定后不再接收第17名玩家，也不会因进程重启重新洗牌。

### `GET /api/v1/tournaments/:tournamentId/state`

固定16人赛事专用，需要访问令牌。返回 `phase`、检录人数、当前轮、已完成桌数、本人分桌 assignment 和本人排名。`phase` 为 `check-in | round-active | blocked | finished`；每轮前3桌完成时不会推进，第4桌完成后才统一激活下一轮。

### `GET /api/v1/tournaments/:tournamentId/standings`

返回赛事轮次、晋级名额和排名。排序依次使用赛事分、对手分、胜场、头游和稳定用户键；每个结算事件只能计分一次。响应明确包含 `provisional`、`cutoffRank`、每人的 `qualificationStatus` 以及携带登录令牌时的 `viewerStanding`。固定16人赛事在12桌全部完成前统一为 `pending`，完成后恰好按 `advanceCount` 标记晋级。

## 牌谱与延迟观战

### `GET /api/v1/replays` / `GET /api/v1/replays/:replayId`

列表和详情都需要登录，且只允许参与者读取。最终结算负责创建并绑定牌谱；事件时间线优先使用牌局服持续上报的公开观战流，兼容旧牌局服时才回退到签名结算正文中的 `publicTimeline`。两条来源都不保存或返回其他玩家未出手牌，也不暴露内部平台用户 ID。

### `GET /api/v1/spectate/:matchId?delaySeconds=30`

返回牌局服持续上报的公开事件流，服务端强制最少 15 秒延迟，最多 300 秒。事件包括开局、贡还阶段转换、出牌、不出、超时/托管自动动作、局结算和牌桌非正常终止；不会包含未出手牌、卡牌 ID、玩家姓名或平台用户 ID。公开 DTO 还会移除内部 `eventId`、`matchId` 和六位入桌 `roomId`。

正常结算状态为 `finished`。全桌安全退出并超过牌局服回收时间、投票解散或匹配入桌超时会通过双签名的 `room-closed` 事件进入明确的 `aborted` 状态；平台同时把四名参与者的旧匹配置为 `aborted`、停止下发旧票据并释放重新匹配资格，但不会生成赛事场次、积分或结算奖励。普通匹配中，如果合法的结算级签名结果与异常回收发生竞态，最终结算拥有更高权威，会把旧匹配和公开流纠正为 `completed / finished`，且不会清除玩家后来加入的新匹配。固定16人赛事更保守：异常桌会把整轮置为 `blocked`，本版本不自动补赛，也不接受异常后的迟到结算改写赛事积分，等待后续人工恢复流程。

### `POST /api/v1/game/spectator-events`（内部）

牌局服对每个匹配维护单调递增的 `sequence`，按 `matchId` 串行、异步上报。网络失败时，失败的队首事件持续指数退避且等待上限受配置约束，后续序号不能越过它；上报等待不阻塞牌局状态机。默认队列仍在内存中；设置 `GAME_SPECTATOR_OUTBOX_FILE` 后，事件会先写入本地 JSON outbox，再尝试 HTTP 上报，平台确认成功后才从 outbox 删除。进程重启会按 `matchId/sequence` 重新装载并继续发送；若远端已确认而本地尚未来得及删除，重发依靠平台事件 ID 与正文幂等收敛。`room-closed` 从 outbox 恢复时仍使用下述双签名，不会降级为普通观战事件。

本地 outbox 使用目标目录内的临时文件加重命名原子替换，正式文件权限为 `0600`；相对路径以牌局服启动工作目录为基准。文件损坏、schema 不支持、重复 `eventId` 或重复 `matchId/sequence` 会在启动时 fail-fast，避免静默跳号。它只适用于**单进程、单实例、同一文件系统**，不是多实例消费者队列、分布式锁或平台数据库事务；多个牌局服实例不能共享同一个文件。当前也没有死信队列、人工跳过或自动丢弃：无法被平台接受的队首会保持阻塞并有界退避，生产部署仍必须补容量监控、告警、人工修复流程，并在横向扩容前迁移到真正的消息系统。

普通公开事件使用独立请求头：

```text
X-Spectator-Event-Id: spectate:<matchId>:<sequence>
X-Spectator-Timestamp: <Unix 毫秒>
X-Spectator-Signature: hex(HMAC-SHA256(GAME_SPECTATOR_EVENT_SECRET, timestamp + "." + rawBody))
```

`room-closed` 会释放匹配资格，属于高权限生命周期动作，因此除上述观战签名外必须同时携带结算级签名；只泄露观战密钥不能终止真实匹配：

```text
X-Game-Event-Id: <与 X-Spectator-Event-Id 相同>
X-Game-Timestamp: <Unix 毫秒>
X-Game-Signature: hex(HMAC-SHA256(GAME_RESULT_SECRET, timestamp + "." + rawBody))
```

出牌示例（只允许公开牌面字段）：

```json
{
  "eventId": "spectate:mat_123:12",
  "matchId": "mat_123",
  "roomId": "271828",
  "sequence": 12,
  "at": 1785753600000,
  "type": "play",
  "roundSequence": 2,
  "playerId": "p3",
  "automatic": false,
  "playType": "Pair",
  "cards": [
    { "rank": 6, "suit": "heart" },
    { "rank": 7, "suit": "heart" }
  ]
}
```

平台验证五分钟签名窗口、事件发生时间、固定 `matchId/roomId`、类型白名单、逐类型字段白名单和连续序号。相同事件 ID 与相同正文幂等成功；相同 ID 对应不同正文或越序写入会拒绝。贡还事件只记录阶段/席位，不上报牌的 `id` 或具体牌面。

## 商户后台接口

- `POST /api/v1/merchants/apply`：幂等创建 `pending` 商户申请；不会自动变为可发分账户。
- `GET /api/v1/merchants/me`：返回商户、角色、门店、员工和最近发分记录。
- `POST /api/v1/merchants/stores`：负责人/管理员创建门店，必须使用 `Idempotency-Key`。
- `POST /api/v1/merchants/employees`：仅负责人可添加 `manager` 或 `cashier`。
- `POST /api/v1/merchants/points/grant`：向已存在用户发放 1–1000 积分，必须使用 `Idempotency-Key`；受商户日限额、门店归属和操作员角色检查保护。

只有外部审核系统将商户状态改为 `active` 后才能写入门店、员工和积分；商户不能向负责人或员工账户发分。商户写操作与用户钱包、只追加流水在同一存储事务内完成。这些接口是管理端基础，上线前仍需要审核 UI/服务、风控、操作审计和真实数据库权限。

## 匹配与入桌票据

### `POST /api/v1/match/join`

```json
{ "mode": "quick" }
```

支持普通快速匹配 `quick`、经典底分场 `classic_50` / `classic_300` / `classic_2000` / `classic_10000`，以及赛事队列 `rookie_cup` / `weekend_cup` / `master_cup` / `lingshui_16_cup`。等待中响应 `data.match`：

`quick` 和四个经典底分场可直接进入匹配，服务端按 `mode` 使用互相独立的等待池，不会跨底分场拼桌。同一等待池允许并行维护多张未满桌，优先选择综合分跨度最小的桌；初始允许跨度 5000 分，最老等待者每等待 15 秒放宽 5000 分。赛事队列必须先报名对应赛事；未报名返回 `403`，已完成全部轮次返回 `409 TOURNAMENT_ROUNDS_COMPLETE`。`lingshui_16_cup` 不能按普通队列随机凑桌，必须提交服务端当前状态返回的 `{ "mode": "lingshui_16_cup", "tournamentId": "lingshui-16-cup", "assignmentId": "tpa_..." }`；缺失 assignment 返回 `409 TOURNAMENT_ASSIGNMENT_REQUIRED`。

经典场底分分别为 50、300、2000、10000。入队后会为这场匹配预留一份底分；商城兑换和赛事报名只能使用“钱包余额 - 已预留底分”的可用积分，不能花掉正在匹配或已经匹配牌局的底分。余额不足时返回 `409 INSUFFICIENT_CLASSIC_STAKE`。结算为队伍间零和转账：每个败方席位必须向对应胜方席位完整转移一份底分，不允许按剩余余额折扣扣款。匹配取消、异常终止或牌局完成后释放预留资格；`quick` 和赛事沿用非底分奖励规则。

固定赛 assignment 一旦成桌就绑定同一 `matchId / roomId / seat`。如果玩家尚未入桌而 90 秒票据过期，再次提交同一 assignment 会只为本人续签新票，不会重新配桌、换座或重复推进轮次；牌局内掉线仍应优先使用牌局服 `resumeToken` 恢复。

```json
{
  "ticketId": "mat_...",
  "matchId": "mat_...",
  "queueId": "quick",
  "mode": "quick",
  "status": "matching",
  "joinedAt": 1785753600000
}
```

同模式四人到齐后，四人轮询会分别得到：

```json
{
  "ticketId": "mat_...",
  "matchId": "mat_...",
  "queueId": "quick",
  "mode": "quick",
  "status": "matched",
  "roomId": "271828",
  "seat": "p2",
  "gameEndpoint": "wss://game.example/weapp",
  "gameTicket": "signed.compact.token",
  "joinToken": "signed.compact.token",
  "expiresAt": 1785753690000
}
```

`joinToken` 是当前 Cocos 契约的兼容别名，值与 `gameTicket` 相同。

### `GET /api/v1/match/status?matchId=mat_...`

返回当前用户视角的 `data.match`。不能读取其他用户的匹配记录。

### `POST /api/v1/match/cancel`

```json
{ "matchId": "mat_..." }
```

等待状态可取消；已经分配牌桌返回 `409 MATCH_ALREADY_ASSIGNED`。

### WebSocket 入桌

匹配完成后连接 `gameEndpoint`，然后：

- `seat === "p1"`：发送 `createRoom`，payload 包含 `roomId`、`hostName`、`gameTicket`。
- 其他席位：发送 `joinRoom`，payload 包含 `roomId`、`gameTicket`。

服务端校验签名、过期时间、`roomId`、固定 `seat`、`matchId` 和一次性 `jti`。非 p1 先到时会由有效票据预建不公开的等待房间；p1 随后 `createRoom` 接管。票据房四席到齐后由服务端自动发牌并向四端广播 `gameState`，无需 p1 再发 `startGame`；普通好友房仍由房主手动开始。客户端正常收到入桌响应后，后续重连应使用服务器签发的 `resumeToken`。

为处理 `roomCreated` / `roomJoined` 成功响应在网络中丢失的情况，票据房会把原始 `jti` 固定绑定到对应席位：同一张尚未过期的票据，在该席位为空或仍是同一连接时可以幂等重发。服务端返回原 `resumeToken`、当前阶段以及该席位视角的脱敏牌局状态；若席位正被另一个活动连接占用则拒绝。不同 `jti`、错误 `matchId`、错误 `roomId` 或错误 `seat` 都不能走恢复分支。底层 `GameTicketVerifier.verifyAndConsume()` 对重复消费仍然报错，恢复只在房间确认原 `jti` 绑定后显式执行。

未启用 `GAME_TICKET_REQUIRED` 时，无票据的原本地房间流程仍兼容；只要客户端提交了票据，即使非强制模式也会严格验证。票据绑定房间不会允许无票据玩家混入。

`server/index.js` 是旧网页端的 Socket.IO 局域网兼容服务，不是生产 Cocos 牌局入口；在 `GAME_TICKET_REQUIRED=true` 时它会拒绝启动，避免意外暴露无票据旁路。

## 签名结算回传

最终过 A 后，牌局服向 `POST /api/v1/game/results` 发送原始 JSON，并带：

```text
X-Game-Event-Id: game:<matchId>:<roundSequence>
X-Game-Timestamp: <Unix 毫秒>
X-Game-Signature: hex(HMAC-SHA256(GAME_RESULT_SECRET, timestamp + "." + rawBody))
```

正文：

```json
{
  "eventId": "game:mat_123:8",
  "matchId": "mat_123",
  "roomId": "271828",
  "ranking": ["p1", "p3", "p2", "p4"],
  "userIdsBySeat": { "p1": "usr_1", "p2": "usr_2", "p3": "usr_3", "p4": "usr_4" },
  "winnerTeam": "teamA",
  "teamLevels": { "teamA": 14, "teamB": 10 },
  "finishedAt": 1785753600000
}
```

平台验证五分钟时间窗、签名、匹配房间、固定席位用户后，在同一事务中更新 rating、牌局统计、钱包流水和赛事数据。`eventId` 唯一：重复回调返回成功但 `duplicate: true`，不会重复更新综合分或钱包；同一 `matchId` 换用另一个事件ID重复结算也会被拒绝。

## 存储边界与上线前工作

当前提供三种 repository 形态：

- `MemoryPlatformStore`：默认测试/开发，进程退出即清空。
- `JsonFilePlatformStore`：原子 rename 的单实例演示持久化；打开旧快照时会补齐缺失集合和当前内置目录记录，为旧用户补发八位账号、重建唯一反向索引，并把旧场次/胜场迁移到独立 rating（`eloOffset` 从 0 开始，不继承旧 `stats.elo` 或钱包）后提升 schemaVersion。它不会覆盖已有运营记录，也没有跨进程锁或回滚脚本。
- `RedisPlatformStorePrototype`：定义 `get/set` 适配边界，只在单进程内串行；没有 WATCH/MULTI 或分布式锁。

因此这是一套可验证的服务端基础和联机安全契约，不代表生产基础设施已经完成。正式上线至少还需要：

1. 将用户、账本、订单和报名迁移到带唯一约束、事务和备份的数据库。
2. 将匹配队列、票据消费和房间归属迁移到 Redis 原子脚本或等价协调层。
3. 仅开放 WSS/HTTPS，限制 CORS、请求体、频率、来源网络和内部回调访问。
4. 使用密钥管理系统分别轮换访问、票据、结算、观战四类密钥，并增加审计日志和告警。
5. 做四端真实设备、断线重连、进程重启、多实例争抢、超时和故障注入测试。
