# 陵水掼蛋平台 API 与生产联机契约

本目录是独立实现的平台服务基础，不包含或复制其他未授权项目代码。它与牌局规则服务分工如下：

`PlatformService` 是 HTTP 层使用的兼容门面；账户、钱包商城、赛事、好友房、商户、匹配和结算分别由领域服务承接。匹配服务拥有普通/固定赛事的排队、分桌、票据与取消事务；结算服务在单个存储事务中完成事件幂等校验、钱包与统计入账、牌谱生成、匹配终态和赛事轮次推进。领域服务只依赖底层策略/存储模块，不反向依赖 `PlatformService`。

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
| `PLATFORM_STORE_MODE` | `memory` | `memory` 或 `json-single-instance`；生产必须显式选择后者 |
| `PLATFORM_JSON_FILE` | 空 | `json-single-instance` 的平台快照文件；不能被多实例共享 |
| `PLATFORM_ACCESS_SECRET` | 开发密钥 | 访问令牌 HMAC 密钥，生产必填且至少32字符 |
| `GAME_TICKET_SECRET` | 开发密钥 | 平台和牌局服共享的入桌票据密钥，生产必填 |
| `GAME_RESULT_SECRET` | 开发密钥 | 平台和牌局服共享的结算回调密钥，生产必填 |
| `GAME_SPECTATOR_EVENT_SECRET` | 开发密钥 | 仅用于公开观战事件写入；生产环境必须与结算密钥不同 |
| `GAME_ENDPOINT` | `ws://127.0.0.1:3002/weapp` | 匹配完成后返回给客户端的地址 |
| `PLATFORM_ACCESS_TOKEN_TTL_MS` | `86400000` | 访问令牌有效期，范围 `300000..2592000000` |
| `GAME_TICKET_TTL_MS` | `90000` | 入桌票据有效期，范围 `10000..600000` |
| `GAME_TICKET_REQUIRED` | `false` | 牌局服设为 `true` 后 create/join 强制票据 |
| `GAME_RESULT_ENDPOINT` | 空 | 牌局服结算回调地址，例如 `http://platform:3003/api/v1/game/results` |
| `GAME_SPECTATOR_EVENT_ENDPOINT` | 空 | 独立观战事件入口，例如 `http://platform:3003/api/v1/game/spectator-events` |
| `GAME_RESULT_OUTBOX_FILE` | 空（关闭） | 牌局服单实例结算 outbox，例如 `./var/result-outbox.json` |
| `GAME_SPECTATOR_OUTBOX_FILE` | 空（关闭） | 牌局服单实例观战事件 outbox，例如 `./var/spectator-outbox.json` |
| `WEAPP_ROOM_STATE_FILE` | 空（关闭） | 牌局服单实例房间快照，例如 `./var/weapp-rooms.json` |
| `WEAPP_HOST` | `127.0.0.1` | 牌局服监听地址；香港裸 IP 联调显式使用 `0.0.0.0` |
| `WEAPP_ALLOWED_ORIGINS` | 空（开发环境不校验） | 逗号分隔的 WebSocket Origin 白名单 |
| `WEAPP_MAX_PENDING_COMMANDS` | `32` | 单连接等待执行命令上限，范围 `1..1024` |
| `WX_APPID` / `WX_SECRET` | 空 | 微信小程序 `code2Session` 配置；生产环境两者必填 |
| `WX_LOGIN_TIMEOUT_MS` | `5000` | 微信登录上游超时，范围 `100..30000` |

当 `NODE_ENV=production` 时，服务会 fail-fast：四个 HMAC 密钥必须显式配置且互不相同；平台必须显式配置 `PLATFORM_STORE_MODE=json-single-instance`、`PLATFORM_JSON_FILE`、`WX_APPID/WX_SECRET`、非通配 CORS 和 `wss://` 牌局地址并禁用开发登录；牌局服必须强制票据、使用 HTTPS 回调、分别配置结算 outbox、观战 outbox、房间快照和非通配 Origin 白名单。`PLATFORM_JSON_FILE`、两个 outbox 和房间快照四个路径会先解析为绝对路径再统一去重，等价相对路径也不能指向同一文件。端口、超时、容量、消息大小和限流值会做整数上下界校验；用于测试加速的两个牌局时钟在生产环境必须保持真实倍率。`code`、`openid` 和 `session_key` 不写日志；当前服务也不保存或返回 `session_key`。

四个 JSON 文件都应放入各自专用、由服务账号拥有的持久化目录。写入器会把目标目录权限收紧为 `0700`，不要把仓库根目录、共享挂载根目录或其他服务共用目录直接设为这些文件的父目录。

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

昵称限制为 1—24 个 Unicode 码点，校验与保存口径一致，包含表情时不截断 UTF-16 代理对；登录时需要裁剪的昵称也按完整码点处理。账号 ID 和头像 URL 的长度规则不变。

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

商品必须是目录中自身持有、ID 一致的有效记录，不接受对象继承属性。价格、库存、余额和兑换总额必须为非负安全整数；异常时拒绝兑换，不扣款、不减库存、不新增订单或流水。异常商品配置、余额、总额分别返回 `409 INVALID_PRODUCT_STATE`、`INVALID_WALLET_STATE`、`INVALID_ORDER_TOTAL`，不会擅自修复历史余额。

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

正常结算状态为 `finished`。全桌安全退出并超过牌局服回收时间或投票解散会通过双签名的 `room-closed` 事件进入明确的 `aborted` 状态；普通匹配入桌超时也可由平台 TTL 清扫直接终态化为公开 `aborted`。平台会停止下发旧票据、清理四人的旧 activeMatch 并释放重新匹配资格，但不会生成赛事场次、积分或结算奖励。若平台 TTL 与牌局服的 `entry-timeout` 关闭回调竞态，先到的终态生效，迟到的同原因签名回调幂等确认且不追加伪事件。普通匹配中，如果合法的结算级签名结果与异常回收发生竞态，最终结算拥有更高权威，会把旧匹配和公开流纠正为 `completed / finished`，且不会清除玩家后来加入的新匹配。固定16人赛事更保守：异常桌会把整轮置为 `blocked`，本版本不自动补赛，也不接受异常后的迟到结算改写赛事积分，等待后续人工恢复流程。

### `POST /api/v1/game/spectator-events`（内部）

牌局服对每个匹配维护单调递增的 `sequence`，普通公开事件按 `matchId` 串行、异步上报。网络失败时，失败的队首事件持续指数退避且等待上限受配置约束，后续序号不能越过它；普通事件的上报等待不阻塞牌局状态机。默认队列仍在内存中；设置 `GAME_SPECTATOR_OUTBOX_FILE` 后，事件会先写入本地 JSON outbox，再尝试 HTTP 上报，平台确认成功后才从 outbox 删除。进程重启会按 `matchId/sequence` 重新装载并继续发送；若远端已确认而本地尚未来得及删除，重发依靠平台事件 ID 与正文幂等收敛。`game-start`、`match-ended`、`seat-left` 和 `room-closed` 从 outbox 恢复时仍使用下述双签名，不会降级为普通观战事件。

本地 outbox 在权限为 `0700` 的目标目录中写临时文件，执行文件 `fsync`、原子重命名和父目录 `fsync`，正式文件权限为 `0600`；相对路径以牌局服启动工作目录为基准。文件损坏、schema 不支持、重复 `eventId` 或重复 `matchId/sequence` 会在启动时 fail-fast，避免静默跳号。它只适用于**单进程、单实例、同一文件系统**，不是多实例消费者队列、分布式锁或平台数据库事务；多个牌局服实例不能共享同一个文件，也不自带备份。当前也没有死信队列、人工跳过或自动丢弃：无法被平台接受的队首会保持阻塞并有界退避，生产部署仍必须补容量监控、告警、人工修复流程，并在横向扩容前迁移到真正的消息系统。

普通公开事件使用独立请求头：

```text
X-Spectator-Event-Id: spectate:<matchId>:<sequence>
X-Spectator-Timestamp: <Unix 毫秒>
X-Spectator-Signature: hex(HMAC-SHA256(GAME_SPECTATOR_EVENT_SECRET, timestamp + "." + rawBody))
```

`game-start` 会把匹配推进为 `playing`，`match-ended` 会执行无积分的好友房配置终局，`seat-left` 会释放好友房访客席位，`room-closed` 会释放整桌匹配资格；四者都属于高权限生命周期动作，因此除上述观战签名外必须同时携带结算级签名。只泄露观战密钥不能开始牌局、结束好友房、撤销席位或终止真实匹配：

```text
X-Game-Event-Id: <与 X-Spectator-Event-Id 相同>
X-Game-Timestamp: <Unix 毫秒>
X-Game-Signature: hex(HMAC-SHA256(GAME_RESULT_SECRET, timestamp + "." + rawBody))
```

`game-start` 是开局 claim，不是普通的 fire-and-forget 事件。牌局服必须先持久化包含该事件的未开局房间，再调用 `SpectatorEventReporter.claimStart(event)`（或对本接口执行同等的有界同步请求），并只在响应 `data.event.lifecycleClaim.accepted === true` 后发牌。平台在同一存储事务中裁定 claim 与普通匹配入桌 TTL、好友房租约或 `seat-left`：claim 胜出后整桌为 `playing`，离席释放不再被接受；TTL/租约或离席先胜出则房间已终态或退回 `matching`，牌局服不得发牌。固定赛事 assignment 不使用票据 TTL 取消，过期后保持原 `matchId / roomId / seat` 并重签票据；牌局服清理未开局本地等待房间时发出的 `entry-timeout` 会被确认但不占用公开序号，重建同一房间后仍能从 sequence 1 claim，旧回调的迟到重试也不能覆盖已成功的新 claim。相同生命周期事件和正文重试会返回 `duplicate: true`；相同事件 ID 改写正文返回冲突。

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

平台始终验证请求头签名的五分钟新鲜度；durable outbox 每次重试必须用当前请求时间重新签名。正文中的业务 `at/endedAt` 不使用“距当前最多24小时”的限制，而是与持久 match 的 `createdAt/startedAt/friendRoomExpiresAt` 对照，因此网络或进程故障超过24小时后仍可补投真实历史事件；超过允许时钟偏差的未来时间仍会拒绝。平台同时验证固定 `matchId/roomId`、类型白名单、逐类型字段白名单和连续序号。相同事件 ID 与相同正文幂等成功；相同 ID 对应不同正文或越序写入会拒绝。贡还事件只记录阶段/席位，不上报牌的 `id` 或具体牌面。

## 商户后台接口

- `POST /api/v1/merchants/apply`：幂等创建 `pending` 商户申请；不会自动变为可发分账户。
- `GET /api/v1/merchants/me`：返回商户、角色、门店、员工和最近发分记录。
- `POST /api/v1/merchants/stores`：负责人/管理员创建门店，必须使用 `Idempotency-Key`；相同标识仅允许重放相同规范化名称和地址，内容不同返回 `409 IDEMPOTENCY_CONFLICT`。兼容原有字符串回执，不需要数据迁移。
- `POST /api/v1/merchants/employees`：仅负责人可添加 `manager` 或 `cashier`。
- `POST /api/v1/merchants/points/grant`：向已存在用户发放 1–1000 积分，必须使用 `Idempotency-Key`；受商户日限额、门店归属和操作员角色检查保护。

只有外部审核系统将商户状态改为 `active` 后才能写入门店、员工和积分；商户不能向负责人或员工账户发分。商户写操作与用户钱包、只追加流水在同一存储事务内完成。这些接口是管理端基础，上线前仍需要审核 UI/服务、风控、操作审计和真实数据库权限。

## 匹配与入桌票据

### 认证好友房票据

平台好友房不是仅凭六位房间号即可加入的本地房间。创建和加入都需要登录，并使用用户级 `entryAttemptId` 做幂等。该值必须是至少 128-bit 随机性、22–128 位的 base64url 字符串，只允许 `[A-Za-z0-9_-]`；推荐直接使用 `crypto.getRandomValues(new Uint8Array(16))` 的无填充 base64url 编码。同一用户以同一 `entryAttemptId` 重试相同正文会返回原席位，改用不同正文则返回 `409 IDEMPOTENCY_CONFLICT`。

房主创建：

```http
POST /api/v1/friend-rooms/create
Authorization: Bearer <accessToken>
Content-Type: application/json
```

```json
{
  "entryAttemptId": "EjRWeJCrze8SNFZ4kKvN7w",
  "roomSettings": {
    "mode": "classic",
    "rounds": 8,
    "scoring": "double-4",
    "scoreVisibility": "hidden",
    "turnSeconds": 60,
    "trusteeSeconds": 30,
    "totalTimeMinutes": 20,
    "spectator": "off",
    "autoSort": false,
    "disableInteraction": false,
    "sortOrder": "asc",
    "authoritativeValidation": true
  }
}
```

`roomSettings` 会先规范化，再同时写入幂等指纹、房间不可变状态和四席签名票据。相同 `entryAttemptId` 不能换设置。响应的 `data.entry`：

```json
{
  "entryAttemptId": "EjRWeJCrze8SNFZ4kKvN7w",
  "matchId": "mat_friend_...",
  "roomId": "271828",
  "seat": "p1",
  "roomKind": "friend",
  "ticketPurpose": "entry",
  "gameEndpoint": "wss://game.example/weapp",
  "gameTicket": "signed.compact.token",
  "joinToken": "signed.compact.token",
  "expiresAt": 1785753690000,
  "roomExpiresAt": 1785755400000,
  "roomSettings": { "mode": "classic", "rounds": 8, "scoring": "double-4", "scoreVisibility": "hidden", "turnSeconds": 60, "trusteeSeconds": 30, "totalTimeMinutes": 20, "spectator": "off", "autoSort": false, "disableInteraction": false, "sortOrder": "asc", "authoritativeValidation": true },
  "inviteCode": "32-byte-base64url-secret",
  "invitePayload": { "version": 1, "roomId": "271828", "inviteCode": "32-byte-base64url-secret" },
  "inviteText": "271828.32-byte-base64url-secret"
}
```

客户端分享/复制时必须传递完整 `invitePayload` 或 `inviteText`。`inviteText` 以第一个 `.` 分隔六位展示号和 base64url 邀请密钥；六位 `roomId` 只用于定位，绝不是认证凭证。`inviteCode`、`invitePayload` 和 `inviteText` 都应按短期秘密处理，不能写入分析日志、公开观战 DTO 或错误消息。

访客加入时从分享内容解析两个字段并同时提交：

```http
POST /api/v1/friend-rooms/join
Authorization: Bearer <accessToken>
Content-Type: application/json
```

```json
{
  "entryAttemptId": "obLD1J0KL0_PCF5g4N2ZJQ",
  "roomId": "271828",
  "inviteCode": "32-byte-base64url-secret"
}
```

加入成功仍返回 `data.entry`，包含 `entryAttemptId / matchId / roomId / seat / roomKind / ticketPurpose / gameEndpoint / gameTicket / joinToken / expiresAt / roomExpiresAt / roomSettings`，但不再次返回邀请密钥。p2–p4 的预留在平台存储事务内完成；并发加入不能获得重复席位。错误邀请码、格式错误的凭据和未知房间统一返回 `404 FRIEND_ROOM_UNAVAILABLE`，避免用六位号枚举房间；持有正确邀请但房间已满返回 `409 FRIEND_ROOM_FULL`。用户已有其他 `matching / matched / playing` 匹配时返回 `409 ALREADY_MATCHING`。

好友房 match 在不足四席时保持 `matching`，四席到齐后才原子变为 `matched`；牌局服还必须取得双签名 `game-start` claim 才能发牌。短期 `gameTicket` 默认 90 秒，用于限制凭证泄露窗口，不是好友房整桌期限。好友房租约默认 30 分钟并固定在 `roomExpiresAt`；同一 entry 请求在短票过期后会保持原 `matchId / roomId / seat / roomSettings / roomExpiresAt`，只换签新的 `jti / exp`。租约过期或房主 `room-closed` 会终态化房间并释放全部 `activeMatch`。

每张票据都显式签入 `roomKind`、`purpose` 和本次入桌使用的 `entryAttemptId`。初次入桌为 `purpose: "entry"`，冷启动重连为 `purpose: "rejoin"`。普通匹配为 `roomKind: "match"` 且不能携带好友房专属字段；好友房为 `roomKind: "friend"`，同时签入毫秒时间戳 `roomExpiresAt` 和完整规范化 `roomSettings`。验证器要求 friend entry 的租约不早于短票 `exp`；friend rejoin 保留原始、甚至已经过去的 lobby lease，同时使用独立的新短票 `exp`。验证器把 `roomKind / purpose / entryAttemptId / roomExpiresAt / roomSettings` 纳入一次性 `jti` 的消费绑定。牌局服必须严格比较 WS payload 的 `entryAttemptId === ticketClaims.entryAttemptId`；只使用 p1 entry 票初始化不可变房间设置，p2–p4 必须逐字段一致才能进入。

访客在开局前主动离开或被房主踢出后，牌局服在本地最终状态和撤销名单持久化成功后，上报双签名事件：

```json
{
  "eventId": "spectate:mat_friend_123:7",
  "matchId": "mat_friend_123",
  "roomId": "271828",
  "sequence": 7,
  "at": 1785753600000,
  "type": "seat-left",
  "roundSequence": 1,
  "playerId": "p2",
  "reason": "left",
  "userId": "usr_..."
}
```

`playerId` 只允许 p2–p4，`reason` 只允许 `left | kicked`；p1 退出必须使用 `room-closed`。平台原子核对 friend room、席位和用户，释放参与者与 `activeMatch`，把已满房间退回 `matching` 并允许新用户补原席。响应 `data.event.seatRelease.revokedTickets` 会列出该席位当前世代全部未过期的 `{jti, exp}`；牌局服必须先把整组写入房间快照，再清除待发送事件。平台最多允许同席同时存在 256 张有效票，达到上限后返回 `409 FRIEND_TICKET_LIMIT_REACHED`，绝不会为了签新票而遗忘仍有效的旧 JTI。`kicked` 还会把用户加入该房间 ban，同一或新的 `entryAttemptId` 都返回 `403 FRIEND_ROOM_BANNED`。公开观战投影会删除内部 `userId`。旧自包含票无法由平台远程撤销，因此牌局服必须持久保存被撤销的旧 `jti`/用户黑名单，在验票后、落座前拒绝旧票；平台不会再次返回被撤销票，也不会给被踢用户重签。

通用 `POST /api/v1/match/cancel` 也接受尚未满员好友房的 `matching | matched` 参与者：房主取消整房，访客只取消本人。它和牌局服回调允许任意到达顺序。访客 cancel 先到时释放 `activeMatch`，但席位进入等待确认状态；双签名 `seat-left` 到达前，join 和 recover 都返回 `409 FRIEND_SEAT_RELEASE_PENDING`，不能复活旧票。确认后原 `entryAttemptId` 返回 `409 FRIEND_ENTRY_ATTEMPT_REVOKED`，用户必须生成新 attempt 才能重新加入，其他用户也可补位。事件先到时后续 cancel 幂等返回。房主 cancel 先到后，任何对应同房间终态的合法 `room-closed` 都会被确认但不重复追加公开事件；反向顺序同样幂等。该收敛规则保证持久 outbox 不会因平台已经进入相同终态而永久重试。

好友房因配置终止时不伪造四人排名，也不发送 `GAME_RESULT`。牌局服持久化最终状态后发送双签名 `match-ended`：

```json
{
  "eventId": "spectate:mat_friend_123:87",
  "matchId": "mat_friend_123",
  "roomId": "271828",
  "sequence": 87,
  "at": 1785753600000,
  "type": "match-ended",
  "roundSequence": 8,
  "reason": "round-limit",
  "scores": { "teamA": 12, "teamB": 8 },
  "roundsPlayed": 8,
  "endedAt": 1785753600000,
  "winnerTeam": "teamA"
}
```

`round-limit` 要求 `roundsPlayed` 等于签名设置的局数，`winnerTeam` 由比分严格推导，平分为 `null`；平台把 match 和当前四席置为 `completed`。由于当前事件没有可验证的“恰好在局间”字段，`time-limit` 一律采用中局安全策略：要求 `winnerTeam: null`、`endedAt >= platformStartedAt + signedRoomSettings.totalTimeMinutes * 60_000`，状态为 `aborted / draw`；提前 1ms 也会返回 `409 FRIEND_TIME_LIMIT_EARLY`。两种策略都会释放四人的 `activeMatch`，但不会更新钱包、rating、赛季、赛事、牌局统计或排名。`match-ended` 是观战流最终序号；比分和终局状态只有在该事件经过配置延迟后才公开并将 `timelineComplete` 置为 true。

### `POST /api/v1/matches/recover`

需要登录，请求正文为：

```json
{ "recoveryAttemptId": "jQsydXfS3k-cw3H7gQdYJw" }
```

`recoveryAttemptId` 使用与 `entryAttemptId` 相同的 22–128 位 base64url 约束，并且每次需要一张可消费的新票时都必须生成新值。平台只按 `activeMatchByUser` 返回当前用户自己的原 `matchId / roomId / seat / sub`，没有可恢复匹配时返回 `200` 和 `{ "entry": null }`。playing 的好友房、quick 和固定赛事都会返回短期 `purpose: "rejoin"` 一次性票；普通匹配响应：

```json
{
  "entry": {
    "entryAttemptId": "jQsydXfS3k-cw3H7gQdYJw",
    "recoveryAttemptId": "jQsydXfS3k-cw3H7gQdYJw",
    "matchId": "mat_...",
    "roomId": "271828",
    "seat": "p2",
    "roomKind": "match",
    "ticketPurpose": "rejoin",
    "gameEndpoint": "wss://game.example/weapp",
    "gameTicket": "signed.compact.token",
    "joinToken": "signed.compact.token",
    "expiresAt": 1785753690000
  }
}
```

平台在 participant 内持久保存恢复 receipt。相同用户以同一 `recoveryAttemptId` 重试同一牌局绑定会返回完全相同的票和 JTI；换一个 attempt 会强制签发新 JTI，旧 attempt 不能跨 match/room/seat/purpose 复用，否则返回 `409 RECOVERY_ATTEMPT_CONFLICT`。这允许客户端在 HTTP 响应丢失时安全重放，也要求一张票被 WS 消费后用新 attempt 恢复，不能反复索取同一已消费 JTI。

好友房响应还包含冻结的 `roomExpiresAt / roomSettings`，且 `entryAttemptId === recoveryAttemptId === ticketClaims.entryAttemptId`。matching/matched 阶段返回 `purpose: "entry"`，房主可恢复邀请载荷，访客不能；playing 阶段所有人只返回 `purpose: "rejoin"`，不再返回邀请字段。playing rejoin 绝不延长 `roomExpiresAt`，即使该 lobby lease 已经过期，rejoin 短票的 `exp` 仍按当前时间独立计算。兼容别名 `POST /api/v1/friend-rooms/active` 使用同一正文且只恢复好友房。客户端冷启动或 WebSocket 建连延迟超过短票 TTL 时应调用恢复接口，不能以新 create/join 请求绕过当前 active match；牌局服验明 rejoin 票后旋转该席位的 `resumeToken`。

### `POST /api/v1/match/join`

```json
{ "mode": "quick" }
```

支持普通快速匹配 `quick`、经典底分场 `classic_50` / `classic_300` / `classic_2000` / `classic_10000`，以及赛事队列 `rookie_cup` / `weekend_cup` / `master_cup` / `lingshui_16_cup`。等待中响应 `data.match`：

`quick` 和四个经典底分场可直接进入匹配，服务端按 `mode` 使用互相独立的等待池，不会跨底分场拼桌。同一等待池允许并行维护多张未满桌，优先选择综合分跨度最小的桌。最早真人等待达到 7000ms 后，下一次 `join / status / cancel` 会在同一个平台事务中先为缺少的 p2—p4 席位生成系统机器人并原子成桌；客户端每秒轮询，因此正常在线等待会自动补位。超过期限后才到达的真人进入另一张桌，不能挤占已签名席位；期限前取消则不会补位。所有赛事队列都禁止机器人补位：未报名返回 `403`，已完成全部轮次返回 `409 TOURNAMENT_ROUNDS_COMPLETE`。`lingshui_16_cup` 不能按普通队列随机凑桌，必须提交服务端当前状态返回的 `{ "mode": "lingshui_16_cup", "tournamentId": "lingshui-16-cup", "assignmentId": "tpa_..." }`；缺失 assignment 返回 `409 TOURNAMENT_ASSIGNMENT_REQUIRED`。

经典场底分分别为 50、300、2000、10000。入队后会为这场匹配预留一份底分；商城兑换和赛事报名只能使用“钱包余额 - 已预留底分”的可用积分，不能花掉正在匹配或已经匹配牌局的底分。余额不足时返回 `409 INSUFFICIENT_CLASSIC_STAKE`。结算为队伍间零和转账：每个败方席位必须向对应胜方席位完整转移一份底分，不允许按剩余余额折扣扣款。匹配取消、异常终止或牌局完成后释放预留资格；`quick` 和赛事沿用非底分奖励规则。

固定赛 assignment 一旦成桌就绑定同一 `matchId / roomId / seat`。如果玩家尚未入桌而 90 秒票据过期，再次提交同一 assignment 会只为本人续签新票，不会重新配桌、换座或重复推进轮次；牌局内掉线仍应优先使用牌局服 `resumeToken` 恢复。牌局服确认开局后，平台把匹配和四名参与者原子推进为 `playing`：入桌票据的 TTL 不再终止已开始牌局，也不会释放玩家去创建重叠匹配。

```json
{
  "ticketId": "mat_...",
  "matchId": "mat_...",
  "queueId": "quick",
  "mode": "quick",
  "status": "matching",
  "joinedAt": 1785753600000,
  "entryAttemptId": "6nLw3vYms-kH8iWQ2zMt1A",
  "humanPlayerCount": 1,
  "botCount": 0,
  "botFillAt": 1785753607000
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
  "entryAttemptId": "6nLw3vYms-kH8iWQ2zMt1A",
  "roomId": "271828",
  "seat": "p2",
  "gameEndpoint": "wss://game.example/weapp",
  "gameTicket": "signed.compact.token",
  "joinToken": "signed.compact.token",
  "expiresAt": 1785753690000,
  "humanPlayerCount": 1,
  "botCount": 3
}
```

普通与固定赛事匹配的 `entryAttemptId` 由平台生成并持久绑定 participant，重试和固定 assignment 换签都保持不变；签名票据必须携带相同值。机器人补位桌会把完整 `botUserIdsBySeat` 写入每张真人 HMAC 票据，牌局服要求同房票据绑定完全一致；机器人没有 Socket、入桌票或恢复令牌，客户端也不能把普通空席伪造成机器人。普通匹配恢复票据会保留同一组绑定。`joinToken` 是当前 Cocos 契约的兼容别名，值与 `gameTicket` 相同。

### `GET /api/v1/match/status?matchId=mat_...`

返回当前用户视角的 `data.match`。不能读取其他用户的匹配记录。

### `POST /api/v1/match/cancel`

```json
{ "matchId": "mat_..." }
```

等待状态可取消；已经分配牌桌返回 `409 MATCH_ALREADY_ASSIGNED`。

### WebSocket 入桌

匹配完成后连接 `gameEndpoint`，然后：

- `seat === "p1"`：发送 `createRoom`，payload 包含 `roomId`、`hostName`、`gameTicket`、`entryAttemptId`。
- 其他席位：发送 `joinRoom`，payload 包含 `roomId`、`gameTicket`、`entryAttemptId`。

服务端校验签名、过期时间、`roomId`、固定 `seat`、`matchId`、机器人席位绑定和一次性 `jti`。非 p1 真人先到时会由有效票据预建不公开的等待房间；p1 随后 `createRoom` 接管。真人连接与签名机器人合计占满四席后，服务端自动发牌并向所有真人端广播 `gameState`，无需 p1 再发 `startGame`；普通好友房仍由房主手动开始。客户端正常收到入桌响应后，后续重连应使用服务器签发的 `resumeToken`。

为处理 `roomCreated` / `roomJoined` 成功响应在网络中丢失的情况，票据房会把原始 `jti` 固定绑定到对应席位：同一张尚未过期的票据，在该席位为空或仍是同一连接时可以幂等重发。服务端返回原 `resumeToken`、当前阶段以及该席位视角的脱敏牌局状态；若席位正被另一个活动连接占用则拒绝。不同 `jti`、错误 `matchId`、错误 `roomId` 或错误 `seat` 都不能走恢复分支。底层 `GameTicketVerifier.verifyAndConsume()` 对重复消费仍然报错，恢复只在房间确认原 `jti` 绑定后显式执行。

未启用 `GAME_TICKET_REQUIRED` 时，无票据的原本地房间流程仍兼容；只要客户端提交了票据，即使非强制模式也会严格验证。票据绑定房间不会允许无票据玩家混入。

`server/index.js` 已正式退役，直接执行会以非零状态退出；它不再提供 Socket.IO 整状态写入旁路。唯一受支持的牌局入口是 `npm run server:weapp`。

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
  "finalSpectatorSequence": 87,
  "finishedAt": 1785753600000
}
```

牌局服先把结算正文按 `eventId` 持久化到 `GAME_RESULT_OUTBOX_FILE`，再执行有超时的 HTTP 投递；进程重启后会自动补发，平台确认幂等成功后才删除。同一 `eventId` 配不同正文会在本地或平台端拒绝。该 outbox 与观战 outbox 一样只支持单进程、单实例、同一文件系统，不替代分布式消息系统。

平台验证五分钟时间窗、签名、匹配房间、固定席位用户和 `finalSpectatorSequence` 后，在同一事务中更新 rating、牌局统计、钱包流水和赛事数据。`eventId` 唯一：重复回调返回成功但 `duplicate: true`，不会重复更新综合分或钱包；同一 `matchId` 换用另一个事件ID重复结算也会被拒绝。结算与观战流是独立 outbox，结果可能先到；公开 DTO 在最终序号对应的 `round-end(isGameWon=true)` 收齐并经过观战延迟前仍保持 `running`、隐藏 `finishedAt`，且 `totalEventCount` 不得提前泄露尚不可见事件。两项条件都满足后才返回 `finished` 和 `timelineComplete: true`。

## 存储边界与上线前工作

当前提供三种 repository 形态：

- `MemoryPlatformStore`：默认测试/开发，进程退出即清空。
- `JsonFilePlatformStore`：仅由 `PLATFORM_STORE_MODE=json-single-instance` 显式启用；以 `0600` 文件、`0700` 目录、文件 `fsync`、原子 rename 和父目录 `fsync` 提供单实例快照持久化。打开旧快照时会补齐缺失集合和当前内置目录记录，为旧用户补发八位账号、重建包含 `matching/matched/playing` 的唯一活跃匹配索引，并把旧场次/胜场迁移到独立 rating（`eloOffset` 从 0 开始，不继承旧 `stats.elo` 或钱包）后提升 schemaVersion。它不会覆盖已有运营记录，也没有跨进程锁、自动备份或回滚脚本。
- `RedisPlatformStorePrototype`：定义 `get/set` 适配边界，只在单进程内串行；没有 WATCH/MULTI 或分布式锁。

因此这是一套可验证的服务端基础和联机安全契约，不代表生产基础设施已经完成。正式上线至少还需要：

1. 将用户、账本、订单和报名迁移到带唯一约束、事务和备份的数据库。
2. 将匹配队列、票据消费和房间归属迁移到 Redis 原子脚本或等价协调层。
3. 仅开放 WSS/HTTPS，限制 CORS、请求体、频率、来源网络和内部回调访问。
4. 使用密钥管理系统分别轮换访问、票据、结算、观战四类密钥，并增加审计日志和告警。
5. 做四端真实设备、断线重连、进程重启、多实例争抢、超时和故障注入测试。
