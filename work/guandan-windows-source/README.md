# 掼蛋大师 (Guandan Master)

**Language / 语言**

- 简体中文（当前）：`README.md`
- English: [README.en.md](./README.en.md)
- Русский: [README.ru.md](./README.ru.md)
- 日本語: [README.ja.md](./README.ja.md)
- 한국어: [README.ko.md](./README.ko.md)

一个以本地对战为核心、支持局域网联机的掼蛋项目。  
目标是把“规则正确、节奏顺畅、AI可对抗、可持续演进”这四件事同时做好。

## 项目亮点

- 完整对局流程：发牌、出牌、过牌、接风、结算、升级、进贡/还贡。
- A关卡规则：支持打A过关、失败降级、三次不过回2等机制。
- 统一最高难度 AI：客户端、好友房机器人和服务端托管测试入口均固定为 `master`，不向玩家暴露低档难度。
- 终局体验：胜利结算页、动画表现、关键结果文案强化。
- 桌面发布能力：支持 Electron 打包为 Windows 可执行版本。

## 游戏玩法说明

### 1. 基本目标

- 四人两队，队友相对而坐。
- 通过出牌竞争名次，按名次组合决定本局升级与下一局节奏。
- 以“先过关到A并完成A关卡”作为核心胜负目标。

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

- 产品运行时只接受 `master`；旧存档或外部注入的低档值会被覆盖，好友房机器人与“更多”中的快速人机测试也走同一策略。
- 机器人依据权威座位队伍映射识别友方和敌方：`p1/p3` 同队、`p2/p4` 同队。队友控制牌权时会主动让牌，敌方控制牌权时会评估跟牌、拦截与炸弹收益。
- 服务端 `master-bot-policy.js` 会拒绝损坏的座位或队伍数据，避免机器人因脏状态误把敌方当队友。

### 当前核心策略点

- 记牌与概率估计：动态统计关键牌暴露信息，评估抢控与放权。
- 协同信号：队友领先时降侵略，队友临门时优先喂节奏。
- 控制链优先：首发优先可连续控权的复合牌型。
- 炸弹经济学：仅在“保队友、断对手、炸后可续控”三类高收益场景主动炸。
- 终局特化：小手牌阶段切换尾盘策略，减少死尾与失误。
- A关卡特化：将冲A成功率纳入策略目标，必要时接受短期让利换整体胜率。

## 技术栈

- 前端：React 18 + TypeScript + Vite
- 状态管理：Zustand
- 动画与UI：Framer Motion + Tailwind CSS
- 联机通信：Socket.IO（客户端 + Node服务端）
- 桌面打包：Electron + electron-builder

## 目录结构

```text
src/
  components/   对局与通用组件
  pages/        场景页面（主菜单、对局、结算、联机等）
  store/        全局状态与游戏流程
  lib/          规则引擎、AI分层策略、音频与工具
  workers/      AI Worker 计算线程
  types/        领域模型类型定义
server/         联机服务端
main.js         Electron 主进程入口
```

## 快速开始

### 1) 安装依赖

```bash
npm install
```

### 2) 启动前端开发环境

```bash
npm run dev
```

- 默认访问地址通常为 `http://localhost:5173/`。

### 3) 启动联机服务（可选）

```bash
node server/index.js
```

- 默认端口 `3001`。

微信小游戏原生 WebSocket 与平台 API：

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
npm run server:weapp
```

- 原生 WebSocket 默认地址：`ws://127.0.0.1:3002/weapp`。
- 平台 API 默认地址：`http://127.0.0.1:3003/api/v1`。
- 登录、积分账本、商城兑换、赛事报名、四人匹配、一次性入桌票据、签名结算与延迟观战事件契约见 [平台服务说明](./server/platform/README.md)。
- 默认内存/可选 JSON/Redis 原型都只用于开发和联调；正式上线前必须替换为具备事务、唯一约束和多实例协调能力的基础设施。

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
| `WEAPP_TURN_TIMEOUT_MS` | `20000` | 平台票据房的服务端回合期限 |
| `WEAPP_TRUSTEE_ACTION_DELAY_MS` | `500` | 平台票据房托管自动动作的最短表现延迟 |
| `WEAPP_BOT_ACTION_DELAY_MS` | `500` | 好友房最高档机器人自动动作的最短表现延迟 |
| `WEAPP_FRIEND_SECOND_MS` | `1000` | 好友房秒级设置的测试时钟；生产环境保持默认值 |
| `WEAPP_TOTAL_MINUTE_MS` | `60000` | 总时长配置中“一分钟”的毫秒数；仅用于故障注入测试 |
| `WEAPP_DISSOLVE_TIMEOUT_MS` | `30000` | 解散投票期限 |
| `WEAPP_EMPTY_ROOM_TIMEOUT_MS` | `60000` | 全桌离线重连宽限 |
| `WEAPP_MAX_MESSAGE_BYTES` | `65535` | 单个小程序 WebSocket 入站消息上限；畸形或超限帧直接断开 |
| `WEAPP_ROOM_STATE_FILE` | 空（关闭） | 单实例牌局快照 JSON 文件；例如 `./var/weapp-rooms.json` |
| `WEAPP_WS_PORT` | `3002` | 原生 WebSocket 端口 |

牌局服与平台服还需共享 `GAME_TICKET_SECRET`、`GAME_RESULT_SECRET` 和 `GAME_SPECTATOR_EVENT_SECRET`。生产环境中观战事件密钥必须与结算密钥不同；牌局服通过 `GAME_RESULT_ENDPOINT` 上报最终结算，通过独立的 `GAME_SPECTATOR_EVENT_ENDPOINT` 串行上报脱敏观战事件。可选的 `GAME_SPECTATOR_OUTBOX_FILE=./var/spectator-outbox.json` 会在单实例中先原子持久化观战事件、远端确认后删除，并在重启后按匹配与序号继续；它不提供多实例协调或死信处理，详细边界见 [平台服务说明](./server/platform/README.md)。

#### 单实例牌局快照与恢复边界

设置 `WEAPP_ROOM_STATE_FILE` 后，原生牌局服会把房间、完整牌局状态、回合绝对期限、贡还/准备/托管/解散状态、服务端统计、重连凭证以及最近 512 条已接受动作写入一个 JSON 快照。相对路径以启动牌局服时的工作目录为基准；该文件包含手牌和重连凭证，应放在仅服务账号可读写的持久化目录中，不要提交到代码仓库。

每次保存都先在目标目录写临时文件，再用重命名替换正式文件，因此单个 Node 进程读取到的是上一份或下一份完整快照，不会读取半份 JSON。这个边界只适用于**单进程、单实例、同一文件系统**：它不是数据库事务、分布式锁或多实例房间所有权方案，也没有把平台回调与本地快照组成同一个原子事务。多实例部署必须改用带租约、事务和唯一约束的 Redis/Postgres 等服务，不能让多个进程共写同一个 `WEAPP_ROOM_STATE_FILE`。

进程重启后，Socket 连接号不会恢复，所有已占用席位先转为离线并保留原重连凭证；进行中的玩家进入断线托管，待表决票转为离线票。客户端凭原 `resumeToken` 重连后会收到完整权威状态。匹配当前步骤的原 `turnDeadlineAt` 会继续使用，已经到期则立即进入服务端超时动作；最近的 `requestId` 接受记录也会恢复，以避免重连重试重复执行。全桌离线回收宽限会从服务恢复时重新计时。文件不存在按空状态启动；快照存在但 JSON 损坏或 schema 不支持时会拒绝启动，需由运维修复或移走文件后再启动。

### 4) 质量检查

```bash
npm run check
npm run lint
npm run test:server
```

### 5) 构建与打包

```bash
npm run build
npm run electron:build:win
```

## 开源协议

本项目采用 [Apache-2.0](./LICENSE) 协议开源。

## 欢迎讨论与共建

如果你也是掼蛋爱好者，欢迎提出你最关心的问题或建议：

- 哪些规则细节还可以更贴近你本地牌桌习惯？
- 你希望AI在哪些场景更“像人”、更有压迫感？
- 是否需要加入更多赛事模式、数据复盘、对局回放功能？

欢迎提交 `Issue` / `PR`，也欢迎在讨论区分享你的实战牌例，一起把这个项目打磨成更强的掼蛋开源作品。
