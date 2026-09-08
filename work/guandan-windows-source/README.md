# 陵水掼蛋权威服务端

本目录名称为历史兼容路径；现在只维护服务端，不再包含 React、Electron 或原生微信客户端。历史工程已移出 Git 工作区，恢复方式见 [仓库隔离记录](../../docs/LEGACY_ISOLATION_20260908.md)。

这是 Cocos 客户端配套的权威牌局服与平台服务。客户端只提交动作意图，服务端负责规则校验、回合推进、贡还、结算、状态投影和平台结果回传；共享领域规则位于工作区的 `shared-core`。

## 项目亮点

- 服务端权威对局流程：发牌、出牌、过牌、接风、结算、升级、进贡/还贡。
- A关卡规则：支持打A过关、失败降级、三次不过回2等机制。
- 统一最高难度 AI：好友房机器人和服务端托管均固定为 `master`，不向玩家暴露低档难度。
- 按观察者身份投影牌局状态，隐藏其他座位手牌与未公开贡还选择。
- 平台能力：登录、积分账本、商城、匹配、赛事、签名结算和延迟观战。

## 游戏玩法说明

### 1. 基本目标

- 四人两队，队友相对而坐。
- 通过出牌竞争名次，按名次组合决定本局升级与下一局节奏。
- 经典匹配按随机级牌的独立单局结算；好友房可选择定局玩法或传统升级，升级目标服从房间设置。

### 2. 出牌与回合

- 支持常见掼蛋牌型（单张、对子、三张、顺子、连对、钢板、炸弹等）。
- 每轮按顺时针行动，需跟同类型且更大的牌；无法跟牌可选择 `Pass`。
- 当其他三家都 `Pass` 时，最后出牌者获得新一轮首发权（接风）。

### 3. 升级与A关卡

- 普通级别按当局名次组合升级。
- 到达 `A` 后进入冲关局，只有满足“头游+二游（双下）”或“头游+三游（单下）”才算过A并终局获胜。
- 若冲A失败，触发降级逻辑；支持连续失败递进降级与“三次不过回2”。

### 4. 进贡与还贡

- 根据上局名次触发进贡/还贡流程。
- 还贡后，首发权由规则决定（包含抗贡分支）。
- AI已接入该阶段上下文，在“还贡开局”与“抗贡开局”采用不同策略倾向。

## AI 策略设计

### 运行策略

- 产品机器人运行时只接受 `master`；好友房机器人和服务端托管使用同一策略，客户端已无本地人机或“更多”测试入口。
- 机器人依据权威座位队伍映射识别友方和敌方：`p1/p3` 同队、`p2/p4` 同队。队友控制牌权时会主动让牌，敌方控制牌权时会评估跟牌、拦截与炸弹收益。
- 服务端 `master-bot-policy.js` 会拒绝损坏的座位或队伍数据，避免机器人因脏状态误把敌方当队友。

### 当前核心策略点

- 记牌与概率估计：动态统计关键牌暴露信息，评估抢控与放权。
- 协同信号：队友领先时降侵略，队友临门时优先喂节奏。
- 尾盘封堵：敌方只剩 1—2 张时，先于随机让牌执行拦截；领出时避免刚好送出单张/对子形状，队友出完后切回敌方控场。
- 牌力保护：同样合法时优先不拆天然炸弹、三张和对子，不浪费逢人配；必须炸时只用最低充分炸弹。
- 控制链优先：首发优先可连续控权的复合牌型。
- 炸弹经济学：仅在“保队友、断对手、炸后可续控”三类高收益场景主动炸。
- 终局特化：小手牌阶段切换尾盘策略，减少死尾与失误。
- A关卡特化：将冲A成功率纳入策略目标，必要时接受短期让利换整体胜率。

## 技术栈

- 客户端：Cocos Creator，位于 `../guandan-cocos`。
- 领域内核：TypeScript，位于 `../../shared-core`。
- 牌局服务：Node.js 原生 WebSocket，客户端只发送命令意图。
- 平台服务：Node.js HTTP API，提供账户、匹配、赛事、结算与观战能力。

## 目录结构

```text
../../shared-core/     客户端与服务端共享的领域内核
../guandan-cocos/      正式 Cocos 客户端
server/weapp-ws.js     权威牌局 WebSocket 组合根
server/weapp-match-lifecycle.js  回合、总时长与轮次落盘生命周期
server/weapp-game-start-coordinator.js  开局认领、重连宽限与入场截止协调
server/weapp-runtime-recovery.js  持久化恢复与各生命周期重启编排
server/weapp-operation-scheduler.js  房间级串行与跨房间全局屏障
server/weapp-accepted-action-store.js  有界幂等接受记录与会话令牌轮换
server/platform/       平台领域与 HTTP 接口
server/platform-server.js
```

## 快速开始

### 1) 安装依赖

服务端本身没有外部 npm 运行依赖。使用 Node.js 22 或更新版本；先安装并构建共享核心：

```bash
pnpm --dir ../../shared-core install --frozen-lockfile
pnpm --dir ../../shared-core build
```

### 2) 启动平台与权威牌局服务

```bash
PLATFORM_ENABLE_DEV_LOGIN=true \
GAME_TICKET_SECRET=local-development-game-ticket-secret-2026 \
GAME_RESULT_SECRET=local-development-game-result-secret-2026 \
GAME_SPECTATOR_EVENT_SECRET=local-development-spectator-event-secret-2026 \
npm run server:platform

# 另开终端；密钥与平台服保持一致，结算与观战事件才能回传
GAME_TICKET_REQUIRED=true \
GAME_TICKET_SECRET=local-development-game-ticket-secret-2026 \
GAME_RESULT_SECRET=local-development-game-result-secret-2026 \
GAME_SPECTATOR_EVENT_SECRET=local-development-spectator-event-secret-2026 \
GAME_RESULT_ENDPOINT=http://127.0.0.1:3003/api/v1/game/results \
GAME_SPECTATOR_EVENT_ENDPOINT=http://127.0.0.1:3003/api/v1/game/spectator-events \
GAME_RESULT_OUTBOX_FILE=./var/result-outbox.json \
GAME_SPECTATOR_OUTBOX_FILE=./var/spectator-outbox.json \
WEAPP_ROOM_STATE_FILE=./var/weapp-rooms.json \
npm run server:weapp
```

- 原生 WebSocket 默认地址：`ws://127.0.0.1:3002/weapp`。
- 平台 API 默认地址：`http://127.0.0.1:3003/api/v1`。
- 登录、积分账本、商城兑换、赛事报名、四人匹配、一次性入桌票据、签名结算与延迟观战事件契约见 [平台服务说明](./server/platform/README.md)。
- 快速匹配和经典场若最早真人已等待 7 秒仍未满桌，下一次状态轮询会在同一平台事务中签名补齐机器人并自动开局；赛事队列不会补机器人。
- 默认内存和 Redis 原型只用于开发、测试与联调。平台 JSON 仅可通过 `PLATFORM_STORE_MODE=json-single-instance` 显式启用；它可用于明确接受单实例边界的部署，但不提供多实例协调、自动备份或数据库级恢复能力。

原生牌局服当前还负责以下权威状态，客户端只负责显示和发意图：

- 每回合下发绝对 `turnDeadlineAt`；超时自动不要或出最小合法牌，连续两次超时后按房间设置决定是否进入托管。
- 主动托管、超时托管和断线托管分别记录原因；恢复连接后可取消托管。
- 每局结算后四个席位分别准备/取消准备，四席齐才原子切换到下一局；结算阶段离线席自动准备，避免牌桌永久卡住。
- 联机安全退出保留托管席位；解散采用全员投票，一人拒绝即继续，离线重连后可恢复待投票状态。
- 快捷语只接受固定白名单，服务端按玩家执行 1.2 秒节流和同句 8 秒冷却。
- 全桌离线保留 60 秒重连宽限，宽限后回收房间、回合与投票定时器。

#### 好友房设置协议

无票据好友房可在 `createRoom.payload.roomSettings` 提交以下设置。设置在创建时由牌局服严格校验并冻结，随后随 `roomCreated`、`roomJoined`、`roomRejoined`、`roomMembers` 和牌局状态广播；房间快照恢复后仍使用同一份设置。

```json
{
  "mode": "classic",
  "rounds": 4,
  "scoring": "double-3",
  "scoreVisibility": "live",
  "turnSeconds": 40,
  "trusteeSeconds": 15,
  "totalTimeMinutes": 0,
  "spectator": "off",
  "autoSort": true,
  "disableInteraction": true,
  "sortOrder": "desc",
  "authoritativeValidation": true
}
```

`rounds` 允许 `4..32` 且必须为 4 的倍数；`scoring` 为 `double-3 | double-4`；`scoreVisibility` 为 `live | hidden`；`turnSeconds` 为 `20 | 40 | 60`；`trusteeSeconds` 为 `0 | 15 | 30 | 60`，其中 `0` 关闭好友房托管；`totalTimeMinutes` 为 `0 | 20 | 30 | 60`，其中 `0` 表示不限时；`spectator` 为 `off | live | delayed-round`；`sortOrder` 为 `desc | asc`。`authoritativeValidation` 只能为 `true`。

牌局服直接执行局数上限、双下计分、比分发布、回合/托管/总时长、禁互动和权威动作验证。`spectator` 会生成对应的授权/延迟策略；`autoSort` 与 `sortOrder` 是客户端手牌表现设置，牌局服负责校验、持久化和广播，但不会改写权威手牌顺序。

兼容旧客户端时仍接受 `roundCount/gameCount/customRoundCount`、`doubleDownScore/doubleDownPoints`、`scoreDisplay/scoreVisible`、`firstPlaySeconds`、`totalMinutes/totalDurationMinutes`、`oneClickSort` 和 `disableChat`，但响应与快照统一写成上面的正式字段，不会继续传播旧别名。`mode: "classic"` 暂时保留给现有 Cocos 客户端。

本地故障注入可调整：

| 环境变量 | 默认值 | 用途 |
|---|---:|---|
| `WEAPP_TURN_TIMEOUT_MS` | `20000` | 平台票据房回合期限，范围 `100..3600000` |
| `WEAPP_TRUSTEE_ACTION_DELAY_MS` | `500` | 托管自动动作延迟，范围 `10..60000` |
| `WEAPP_BOT_ACTION_DELAY_MS` | `500` | 好友房及普通匹配补位机器人的动作延迟，范围 `10..60000` |
| `WEAPP_FRIEND_SECOND_MS` | `1000` | 秒级测试时钟，范围 `1..60000`；生产必须为 `1000` |
| `WEAPP_TOTAL_MINUTE_MS` | `60000` | 分钟测试时钟，范围 `100..600000`；生产必须为 `60000` |
| `WEAPP_DISSOLVE_TIMEOUT_MS` | `30000` | 解散投票期限，范围 `1000..3600000` |
| `WEAPP_EMPTY_ROOM_TIMEOUT_MS` | `60000` | 全桌离线宽限，范围 `100..86400000` |
| `WEAPP_MAX_MESSAGE_BYTES` | `65535` | 入站消息上限，范围 `1024..65535`；超限帧直接断开 |
| `WEAPP_MAX_CONNECTIONS` | `1000` | 单实例连接上限，范围 `4..10000` |
| `WEAPP_MAX_ROOMS` | `500` | 单实例房间上限，范围 `1..5000` |
| `WEAPP_COMMAND_RATE_LIMIT` | `120` | 单连接窗口请求上限，范围 `10..10000`；连续超限会断开 |
| `WEAPP_COMMAND_RATE_WINDOW_MS` | `10000` | 单连接协议限流窗口，范围 `1000..600000` |
| `WEAPP_MAX_PENDING_COMMANDS` | `32` | 单连接等待执行的命令上限，范围 `1..1024` |
| `WEAPP_PERSIST_DEBOUNCE_MS` | `25` | 内部 dirty 快照合并窗口，范围 `5..5000` |
| `WEAPP_ALLOWED_ORIGINS` | 空（开发环境不校验） | 逗号分隔的浏览器 WebSocket Origin 白名单 |
| `WEAPP_ROOM_STATE_FILE` | 空（关闭） | 单实例牌局快照 JSON 文件；例如 `./var/weapp-rooms.json` |
| `WEAPP_HOST` | `127.0.0.1` | 牌局服监听地址；公网测试显式使用 `0.0.0.0` |
| `WEAPP_WS_PORT` | `3002` | 原生 WebSocket 端口，必须是 `1..65535` 的整数 |

牌局服与平台服还需共享 `GAME_TICKET_SECRET`、`GAME_RESULT_SECRET` 和 `GAME_SPECTATOR_EVENT_SECRET`。牌局服通过 `GAME_RESULT_ENDPOINT` 上报最终结算，通过独立的 `GAME_SPECTATOR_EVENT_ENDPOINT` 串行上报脱敏观战事件。`GAME_RESULT_OUTBOX_FILE` 与 `GAME_SPECTATOR_OUTBOX_FILE` 都采用“先持久化、远端幂等确认后删除”的投递方式，并会在重启后继续；它们不提供多实例协调或死信处理，详细边界见 [平台服务说明](./server/platform/README.md)。

`NODE_ENV=production` 会执行发布前 fail-fast：平台服要求显式设置 `PLATFORM_STORE_MODE=json-single-instance` 与 `PLATFORM_JSON_FILE`、`WX_APPID/WX_SECRET`、非通配 `PLATFORM_CORS_ORIGIN` 和 `wss://` 的 `GAME_ENDPOINT`，并禁止开发登录；牌局服要求强制入桌票据、HTTPS 结算/观战回调、两个独立 outbox、房间快照以及非通配 Origin 白名单。访问、票据、结算、观战密钥必须互不相同，端口、超时、容量和限流参数必须落在配置边界内。任一必需配置缺失时进程会拒绝启动。

#### 单实例牌局快照与恢复边界

设置 `WEAPP_ROOM_STATE_FILE` 后，原生牌局服会把房间、完整牌局状态、回合绝对期限、贡还/准备/托管/解散状态、服务端统计、重连凭证以及最近 512 条已接受动作写入一个 JSON 快照。相对路径以启动牌局服时的工作目录为基准；该文件包含手牌和重连凭证，应放在仅服务账号可读写的持久化目录中，不要提交到代码仓库。

状态变更先标记 dirty，内部计时器产生的连续变化会合并后异步写入；客户端动作则在返回 `actionAccepted` 前等待包含该动作的快照落盘。每次实际保存都以 `0700` 目录和 `0600` 文件写入临时文件，执行文件 `fsync`、原子重命名及父目录 `fsync`，因此单个 Node 进程读取到的是上一份或下一份完整快照，不会读取半份 JSON。这个边界只适用于**单进程、单实例、同一文件系统**：它不是数据库事务、分布式锁或多实例房间所有权方案，也没有自动备份，更没有把平台回调与本地快照组成同一个原子事务。多实例部署必须改用带租约、事务和唯一约束的 Redis/Postgres 等服务，不能让多个进程共写同一个 `WEAPP_ROOM_STATE_FILE`。

进程重启后，Socket 连接号不会恢复，所有已占用席位先转为离线并保留原重连凭证；进行中的玩家进入断线托管，待表决票转为离线票。客户端凭原 `resumeToken` 重连后会收到完整权威状态。匹配当前步骤的原 `turnDeadlineAt` 会继续使用，已经到期则立即进入服务端超时动作；最近的 `requestId` 接受记录也会恢复，以避免重连重试重复执行。全桌离线回收宽限会从服务恢复时重新计时。文件不存在按空状态启动；快照存在但 JSON 损坏或 schema 不支持时会拒绝启动，需由运维修复或移走文件后再启动。

### 3) 质量检查

```bash
npm run check
npm run lint
npm test
```

`check` 和 `lint` 会自动检查 `server` 下全部生产 JavaScript；`test` 运行平台与权威牌局服务测试。Cocos 客户端构建与测试命令见 [`../guandan-cocos/README.md`](../guandan-cocos/README.md)。

## 开源协议

本项目采用 [Apache-2.0](./LICENSE) 协议开源。

## 欢迎讨论与共建

如果你也是掼蛋爱好者，欢迎提出你最关心的问题或建议：

- 哪些规则细节还可以更贴近你本地牌桌习惯？
- 你希望AI在哪些场景更“像人”、更有压迫感？
- 是否需要加入更多赛事模式、数据复盘、对局回放功能？

欢迎提交 `Issue` / `PR`，也欢迎在讨论区分享你的实战牌例，一起把这个项目打磨成更强的掼蛋开源作品。
