# 服务端身份、幂等与观战边界审计（首批）

- 审计日期：2026-09-12。
- 仓库：`/Users/mac/Documents/Codex/2026-08-02/wo-yi`；基线 HEAD：`1d58999dc6e5455b049e1643660bbba3deee1406`。
- 完整审阅：指定的 8 个文件，共 836 行；路径全部存在，无替代文件。逐文件 SHA-256 见同名 JSON。
- 只读审计及本地进程内验证；未部署、未访问真实服务、未修改生产代码、未提交 Git。开始时已有的用户未提交修改保持原样。
- 结论：1 项已确认 P2 功能缺陷；本批未确认身份越权、未授权重放或其他玩家手牌泄露。此结论只覆盖上述文件及所追查调用链，不代表全仓安全保证。

## 完整阅读范围

| 文件（相对仓库） | 行数 | 审查要点 |
| --- | ---: | --- |
| `work/guandan-windows-source/server/weapp-command-gateway.js` | 123 | 请求 ID、连接别名缓存、指纹冲突、版本检查、落盘屏障、入桌/终局重试 |
| `work/guandan-windows-source/server/weapp-command-router.js` | 20 | 命令唯一归属与异步 dispatch |
| `work/guandan-windows-source/server/weapp-entry-command-handler.js` | 306 | 票据/重连凭证、席位绑定、活动连接排他、令牌轮换、撤销与幂等入桌 |
| `work/guandan-windows-source/server/weapp-websocket-transport.js` | 140 | Upgrade 来源/容量、掩码/长度检查、帧解析与连接生命周期 |
| `work/guandan-windows-source/server/weapp-accepted-action-store.js` | 43 | 容量预约、持久/未持久记录淘汰、身份轮换与删除 |
| `work/guandan-windows-source/server/weapp-room-action-executor.js` | 77 | 权威状态执行、落盘前后发布、终局接受记录 |
| `work/guandan-windows-source/server/game-session-projection.js` | 79 | 对手手牌遮蔽、完赛队友可见条件、贡还隐藏与复制隔离 |
| `work/guandan-windows-source/server/friend-room-observer-buffer.js` | 48 | 延迟采样、单席手牌、贡还清理、重启/历史耗尽失败关闭 |

额外调用链资料只用于确认，不计入本批完整审阅数量：`weapp-ws.js`、`weapp-match-lifecycle.js`、`weapp-room-metadata.js`、`weapp-room-publisher.js`、`friend-room-observer-runtime.js`、`friend-room-members.js`、`weapp-game-command-handler.js`、`friend-room-settings.js`、`shared-core/src/lib/engine.ts` 及相关测试。

## 已确认发现

### SA-01-001 / P2：按局延迟错误使用已完成局数，导致首局无法在第二局观看

**位置：** `work/guandan-windows-source/server/friend-room-observer-buffer.js:18`，同文件第 34–36 行。

**触发条件：** 好友房使用 `spectator: 'delayed-round'`，首局完成后继续第二局，且整场尚未结束。无须恶意权限或异常输入，正常多局流程即可触发。

**证据链：**

1. `weapp-room-metadata.js:44` 将 `room.roundSequence` 初始化为 `0`。
2. `weapp-match-lifecycle.js:217-224` 只在结算时递增它；`391-410` 开下一局不递增，并以 `roundSequence + 1` 报告正在开始的局号。该字段代表已完成局数，不是当前局号。
3. `friend-room-observer-buffer.js:18` 却将 `room.roundSequence || 1` 保存为采样局号，因此首局进行中、首局结算、第二局进行中的样本都标为 `1`。
4. 同文件第 34–36 行只接受 `item.round < (room.roundSequence || 1)`。第二局正在进行时右侧仍为 `1`，首局历史也不满足条件，投影始终为 `null`。
5. 第二局结算后计数成为 `2`，首次放行的最新样本反而是标为 `1` 的“第二局进行中”样本，首局被跳过。
6. `friend-room-settings.js:240` 定义该模式 `delayRounds: 1`；`friend-room-observer-runtime.js:27` 将无样本映射为 `observerWaiting`，因此不是只影响内部编号，而是导致观战客户端第二局全程等待。

**影响：** “延迟一局”观战在首局后不能正常开始，第一局的观看内容丢失，结算节点与快照局号也不一致。当前复现属于错误延后/内容跳过，未证明提前泄露未完成局手牌，不按隐私泄露上报。

**验证：** Node `v26.7.0`，直接导入生产 `FriendRoomObserverBuffer`，用真实生命周期计数语义进行无网络、无文件写入的进程内复现。下列代码在仓库根目录经 `node --input-type=module` 执行，所有断言通过：

```js
import assert from 'node:assert/strict'
import { FriendRoomObserverBuffer } from './work/guandan-windows-source/server/friend-room-observer-buffer.js'
const ids = ['p1', 'p2', 'p3', 'p4']
let now = 1000
const room = {
  version: 1, roundSequence: 0, matchEnded: null,
  roomSettings: { spectator: 'delayed-round' },
  state: { roundId: 1, phase: 'playing', players: Object.fromEntries(
    ids.map(id => [id, { hand: [{ id: `round-1-${id}` }] }])) },
}
const buffer = new FriendRoomObserverBuffer({ now: () => now++ })
const capture = () => buffer.capture(room, { version: room.version, state: room.state })
capture()
room.roundSequence = 1 // 首局结算；生产代码在结算时递增
room.version++
room.state.phase = 'settled'
capture()
room.version++
room.state = { roundId: 2, phase: 'playing', players: Object.fromEntries(
  ids.map(id => [id, { hand: [{ id: `round-2-${id}` }] }])) }
capture()
assert.equal(room.roundSequence, 1)
assert.equal(buffer.project(room, 'p1'), null) // 第二局仍无法观看首局
console.log({ stage: 'round-2-playing', projected: buffer.project(room, 'p1') })
room.roundSequence = 2
room.version++
room.state.phase = 'settled'
capture()
assert.equal(buffer.project(room, 'p1').state.roundId, 2)
console.log({ stage: 'round-2-settled',
  projectedRound: buffer.project(room, 'p1').state.roundId,
  projectedPhase: buffer.project(room, 'p1').state.phase })
```

观察结果：第二局进行中 `projected: null`；第二局结算时首次投影为 `projectedRound: 2, projectedPhase: 'playing'`。

**建议：** 使用权威 `state.roundId` 标记快照，并独立依据已完成局数决定哪些局可发布；明确 settled 阶段与下一局开始的边界。补充从 `roundSequence: 0` 开始、首局结算、第二局开始、第二局结算、整场结束的跨层回归，不要只用手动设置 `roundSequence: 1 → 2` 的缓冲区测试替代真实生命周期。

## 已执行验证与边界

执行下列 8 个现有测试文件全部通过（8 pass / 0 fail）；gateway 测试还导入了 command-recovery 测试：

```text
node --test work/guandan-windows-source/server/weapp-command-gateway.test.mjs work/guandan-windows-source/server/weapp-command-router.test.mjs work/guandan-windows-source/server/weapp-entry-command-handler.test.mjs work/guandan-windows-source/server/weapp-websocket-transport.test.mjs work/guandan-windows-source/server/weapp-accepted-action-store.test.mjs work/guandan-windows-source/server/weapp-room-action-executor.test.mjs work/guandan-windows-source/server/game-session-projection.test.mjs work/guandan-windows-source/server/friend-room-observer.test.mjs
```

现有 `friend-room-observer.test.mjs:6,55-60` 从 `roundSequence: 1` 开始，只人工推进到 `2`，没有覆盖生产初值为 `0` 的首两局场景。其他测试通过只能说明覆盖到的断言通过，不能排除未覆盖路径。

未验证项（不列为 findings）：未做真实 WebSocket 部署联调、端到端签名票据环境或生产持久层故障注入；未把来源缺失、手动换观战视角、缓存淘汰等设计选择推测成漏洞。SHA-256 使用 Node 内置 crypto 计算；系统 `shasum` 因本机 Perl locale 错误退出，未影响审阅或哈希结果。
