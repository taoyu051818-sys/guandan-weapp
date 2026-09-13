# 服务端生命周期与投影审计（第二批）

- 日期：2026-09-12；仓库：`/Users/mac/Documents/Codex/2026-08-02/wo-yi`。
- HEAD：`1d58999dc6e5455b049e1643660bbba3deee1406`。已先重读本审计目录 README，保留原有五处工作树修改。
- 完整阅读本批指定 6 文件，共 1096 行；哈希见同名 JSON，交付前再次核验。额外调用链/测试阅读不计覆盖。
- 新确认：2 项 P2。未修改业务代码、测试断言、生产状态或提交 Git。
- 已知问题去重：`SA-01-001` 的按局延迟计数错位以及 `CS-01-001` 的客户端复式换桌生命周期门禁仅引用，不重复计入。

## 完整阅读范围

| 文件（均在 `work/guandan-windows-source/server/`） | 行数 | 审查范围 |
| --- | ---: | --- |
| `weapp-room-metadata.js` | 130 | 房间初始值、票据绑定、机器人/在线元数据、迁移归一化 |
| `weapp-match-lifecycle.js` | 457 | 结算、终场、自动动作、重试/回滚、下一局、离线准备、定时器释放 |
| `weapp-room-publisher.js` | 190 | 席位投影、重连/贡还/终局消息、观察者捕获、敏感字段复制 |
| `friend-room-observer-runtime.js` | 157 | 成员/观战授权、延迟快照、票据和本地凭证恢复、幂等缓存 |
| `duplicate-room-actions.js` | 90 | 房主权限、八席准备、两桌屏障、换桌观战、退出及终局事件 |
| `duplicate-room-projection.js` | 72 | 本桌/跨桌可见性、延迟历史、结算及终场公共数据 |

辅助阅读：`weapp-ws.js`、`weapp-room-exit.js`、`weapp-turn-clock.js`、`weapp-room-expiry.js`、`weapp-runtime-recovery.js`、`duplicate-room-model.js`、`duplicate-room-runtime.js`、`duplicate-room-admission.js`、`TableOverlayController.ts` 及相关测试。它们不作为本批新增完整审阅文件。

## SL-02-001 / P2：离线准备绕过终场与结算收尾屏障，覆盖应保留的结算状态

**位置：** `work/guandan-windows-source/server/weapp-match-lifecycle.js:419`，同函数 418–424 行。

**触发条件与结果：**

1. 四真人固定局数房间已按局数结束，`matchEnded.reason === 'round-limit'`，但该副 `roundResult.isGameWon === false`。四席随后退出或断连；最后一席触发自动准备，服务器发出第 N+1 副牌，`state.phase` 变为 `playing`、`roundResult` 清空，而 `matchEnded` 仍表示第 N 副已经终场。
2. 非终场的结算正持有 `pendingRoundFinalization`（例如持久提交/发布失败后等待重试），所有尚未准备的在线真人断连。离线清理绕过命令网关的 pending 屏障，提前发下一副。之后 `finalizePendingRound` 提交的是新一局状态与上一局待收尾标记，上一局完整结算 `state` 已被覆盖。

**证据链：**

- `weapp-match-lifecycle.js:217-231` 在结算后设置 `matchEnded` 和 `roundReady`；`418-424` 的离线准备只检查 `roundResult` 和 `isGameWon`，未检查 `matchEnded` 或 `pendingRoundFinalization`。
- 同文件 `391-415` 的 `prepareNextRound` 真正重新发牌，替换 `room.state`，调用 `syncRoomFromMatchState`（96–102）将 `roundResult` 清空；没有终场/收尾保护。
- 真实断连接线 `weapp-ws.js:710-723` 清座后直接调用 `markOfflineReady`，随后提交整个运行态；`731` 可发布 `roundPrepared`。此路径不经过命令网关。
- 已终场的显式退出也可经 `weapp-room-exit.js:60-66` 进入该函数；未完成持久收尾时显式退出会被网关阻止，因此第二种复现使用断连，不依赖绕过已有命令检查。
- 非终场时 `consumeRoundSettlement`（229–231）自动把没有连接的席位标为已准备，因此有机器人的房间只需剩余未准备真人离线即可满足全准备；终场则统一清空四席准备，本复现严格使用四真人，未假设机器人也会断连。
- `weapp-match-lifecycle.js:254-267` 的收尾按当前 `room.state` 发布 `gameState`，同时使用之前保留的 `pending.result` 发布 `roundEnded`，并不验证两者所属局仍相同。

**验证：已确认。** 使用真实 `createRoomOpeningState`、shared-core `settleMatchState`、生产 `markOfflineReady`、`prepareNextRound`、`finalizePendingRound`，仅持久写入/计时/消息输出替换为内存捕获。结果：

```text
终场：settledRound=2 → stateRound=3, statePhase=playing,
      roundResult=null, matchEnded={reason:round-limit, roundsPlayed:2}
待收尾：settledRound=1 → stateRound=2, statePhase=playing, roundResult=null
收尾提交：round=2, phase=playing, pending=true
发布回调入参（内存捕获，并非真实玩家收包）：
          publishState(round=2, phase=playing)
          publishRoundEnded(stateRound=2, statePhase=playing, resultRank=首局排名)
```

**影响：** 破坏终场状态冻结和跨持久收尾的一致性；重连可读到“本场已结束但又持有新一副牌”的快照，待收尾时原结算状态被提前覆盖。没有声称修改了已上报积分或证明了生产数据损坏。特别说明：该四席断连复现中所有 `seats` 已清空，真实 `publishRoundEnded` 的 `forEachViewer` 无玩家接收者；下面的内存发布回调只证明内部参数错位，不声称真人已收到混搭消息。没有人为插入可绕过 pending 门禁的重连，也未将仍在线观察者的影响计为已验证结论。

**建议：** 离线准备与显式下一局命令共用资格检查：终场不可准备；待终局持久收尾完成前只登记离线状态，不重新发牌。收尾完成后再统一检查下一局资格，并在底层发牌入口再次防御终场/未完成收尾。增加四真人终场退出及持久收尾期间断连的跨层回归。

## SL-02-002 / P2：启用观战的好友房重连没有恢复离线票态，客户端无法继续投票

**位置：** `work/guandan-windows-source/server/friend-room-observer-runtime.js:133`，成功绑定席位至返回响应的 133–152 行。

**触发条件：** 普通四人好友房开启任一支持的观战模式；玩家在解散投票尚未投票时断连，票态被置为 `offline`，在投票超时前用本地重连凭证或恢复票据重新入桌。

**证据链：**

- `weapp-ws.js:631-633` 先交给 `friendObservers.enter`，处理成功则不再调用原入桌处理器。`friend-room-observer-runtime.js:78` 在启用观战的房间命中该分支，包含坐着的玩家，而不仅是观察者。
- `weapp-ws.js:716` 将断线的未投票玩家票态改为 `offline`。同文件 `260-263` 提供 `restoreOfflineDissolveVote`，且 `599` 明确注入依赖。
- `friend-room-observer-runtime.js:133-150` 恢复席位、轮换令牌、持久化并返回投影，但没有调用上述恢复函数，也不发布恢复后的解散投票消息。
- 对照原 `weapp-entry-command-handler.js:190-194` 与 `249-254`，普通本地重连和票据恢复都调用恢复函数并在有变化时发布票态；本批分支遗漏这一职责。
- `work/guandan-cocos/assets/scripts/scenes/TableOverlayController.ts:201-207` 只有当前玩家票态为 `pending` 才显示解散投票框；`offline` 会关闭对话框。因此服务器虽接受了重连，玩家界面不能继续这次投票。

**验证：已确认。** 导入真实 `createRoomMetadata`、`createRoomPublisher`、`createFriendRoomObserverRuntime`，构造 `spectator: 'live'`、p2 已离线且票态为 `offline` 的房间，使用有效的内存测试令牌重连。结果：

```json
{"rejoined":"new-p2","rotatedToken":"new-token","returnedVote":"offline","restoreCalls":0}
```

真实 `roomRejoined` 响应包含 `dissolveVote.votes.p2 === 'offline'`；注入的恢复函数一次也未调用。手动发送原始 `dissolveVote` 命令仍可能投票，因此本项不是服务端撤销投票权限，而是已确认的恢复状态/客户端交互缺陷。

**建议：** 已恢复坐席的好友成员复用原入桌流程的投票恢复步骤，在落盘之前将 `offline` 恢复为 `pending`，成功落盘后向相关席位发布更新；覆盖本地 token、平台恢复票据、重放及 `spectator: off/live/delay-*` 分支。

## 可复制的隔离复现

在仓库根目录使用 Node `v26.7.0` 执行下列 JavaScript（`node --input-type=module`）。两段分别验证上述两项；不启动服务器、访问网络或写真实持久层。

```js
// SL-02-001
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createWeAppMatchLifecycle } from './work/guandan-windows-source/server/weapp-match-lifecycle.js'
import { createRoomOpeningState } from './work/guandan-windows-source/server/match-format-policy.js'
const { getRuleProfile, settleMatchState } = createRequire(import.meta.url)('./shared-core/dist')
const ids = ['p1', 'p2', 'p3', 'p4'], noop = () => {}
const flags = value => Object.fromEntries(ids.map(id => [id, value]))
const rooms = new Map(), published = [], saved = []
const lifecycle = createWeAppMatchLifecycle({
  playerIds: ids, rooms, connections: new Map(), turnTimeoutMs: 20000,
  friendSecondMs: 1000, totalMinuteMs: 60000,
  isShuttingDown: () => false, enqueueServerOperation: async f => f(),
  ensureLiveMetadata: noop, isFriendRoom: () => true, isMatchRoom: () => false,
  isBotPlayer: () => false, botPolicyForRoom: noop, existingBotPolicyForRoom: () => null,
  shuffleRandom: () => 0.5, persistRuntimeState: noop,
  commitRuntimeState: async () => saved.push([...rooms.values()].map(r => ({
    round: r.state.roundId, phase: r.state.phase, pending: Boolean(r.pendingRoundFinalization),
  }))),
  stagePendingSideEffects: noop, broadcast: noop, send: noop,
  phaseFor: () => '', liveMetadataFor: () => ({}), publishTurnStatus: noop,
  publishState: r => published.push({ type: 'state', round: r.state.roundId, phase: r.state.phase }),
  publishTribute: noop,
  publishRoundEnded: (r, result) => published.push({ type: 'roundEnded',
    stateRound: r.state.roundId, statePhase: r.state.phase, resultRank: result.fullRank }),
  recordRoomAction: noop, reportSpectatorEvent: noop, reportSpectatorAction: noop,
  reportSpectatorRoundEnd: noop, reportCompletedGame: noop,
  scheduleTimeout: () => ({ unref: noop }), cancelTimeout: noop,
})
for (const terminal of [true, false]) {
  const r = { roomId: terminal ? '100001' : '100002', entryKind: 'friend',
    version: 1, gameVersion: 1, roundSequence: terminal ? 1 : 0,
    roomSettings: { format: 'rounds', rounds: 2, levelMode: 'fixed', levelRank: 2, trusteeSeconds: 0 },
    seats: Object.fromEntries(ids.map(id => [id, `c-${id}`])),
    roundReady: flags(false), trustees: flags(null) }
  const opening = createRoomOpeningState(r, getRuleProfile('classic'), () => 0.5, () => false)
  opening.finishedPlayers = ['p1', 'p3']
  r.state = settleMatchState(opening).state
  r.roundResult = r.state.settlement
  r.roundSequence++
  const settledRound = r.state.roundId
  if (terminal) r.matchEnded = { reason: 'round-limit', roundsPlayed: 2 }
  else r.pendingRoundFinalization = { result: structuredClone(r.roundResult), accepted: null }
  rooms.set(r.roomId, r)
  for (const id of ids) { r.seats[id] = null; lifecycle.markOfflineReady(r, id) }
  assert.equal(r.state.roundId, settledRound + 1)
  assert.equal(r.state.phase, 'playing')
  assert.equal(r.roundResult, null)
  if (terminal) assert.equal(r.matchEnded.reason, 'round-limit')
  else {
    assert.ok(r.pendingRoundFinalization)
    await lifecycle.finalizePendingRound(r)
    assert.equal(r.pendingRoundFinalization, null)
  }
  console.log({ terminal, settledRound, stateRound: r.state.roundId,
    statePhase: r.state.phase, roundResult: r.roundResult, matchEnded: r.matchEnded || null })
}
console.log({ saved, published })
lifecycle.dispose()
```

```js
// SL-02-002（独立 Node 进程）
import assert from 'node:assert/strict'
import { createRoomMetadata } from './work/guandan-windows-source/server/weapp-room-metadata.js'
import { createRoomPublisher } from './work/guandan-windows-source/server/weapp-room-publisher.js'
import { createFriendRoomObserverRuntime } from './work/guandan-windows-source/server/friend-room-observer-runtime.js'
const ids = ['p1', 'p2', 'p3', 'p4'], noop = () => {}, messages = []
const connection = { id: 'new-p2', acceptedCacheKeys: new Map() }
const connections = new Map([[connection.id, connection]])
const metadata = createRoomMetadata({ playerIds: ids, createResumeToken: () => 'new-token',
  createBotSeed: () => 'fixture-seed', entryKindForClaims: () => 'friend', entryDeadlineForClaims: () => null })
const room = metadata.createRoomRecord({ roomId: '100003', roomSettings: { spectator: 'live' } })
room.state = { phase: 'playing', players: Object.fromEntries(ids.map(id => [id, {
  id, team: ['p1', 'p3'].includes(id) ? 'teamA' : 'teamB', hand: [{ id: `card-${id}` }],
}])) }
room.resumeTokens.p2 = 'old-token'
room.userIdsBySeat.p2 = 'user-p2'
room.friendMembers = [{ userId: 'user-p2', seat: 'p2', viewPlayerId: 'p2',
  resumeToken: 'old-token', connectionId: null }]
room.dissolveVote = { initiator: 'p1', votes: { p1: 'agree', p2: 'offline', p3: 'pending', p4: 'pending' },
  expiresAt: Date.now() + 60000 }
const rooms = new Map([[room.roomId, room]])
const send = (c, type, payload) => messages.push({ type, ...structuredClone(payload) })
const publisher = createRoomPublisher({ playerIds: ids, connections, send, broadcast: noop,
  ensureLobbyMetadata: metadata.ensureLobbyMetadata, ensureLiveMetadata: metadata.ensureLiveMetadata,
  isFriendRoom: () => true, seatIsOccupied: (r, id) => Boolean(r.seats[id]) })
let restores = 0
const runtime = createFriendRoomObserverRuntime({ rooms, connections, acceptedActions: new Map(),
  sameToken: (a, b) => typeof a === 'string' && a === b, entryConflictFor: () => null,
  reserveAccepted: () => true, releaseAccepted: noop, createResumeToken: () => 'new-token',
  rotateAcceptedActionIdentity: noop, clearEmptyRoomExpiry: noop, clearHostExpiry: noop,
  actionFingerprint: () => 'fingerprint', rememberAccepted: noop, commitRuntimeState: async () => {},
  send, ...publisher, restoreOfflineDissolveVote: (r, id) => {
    restores++; r.dissolveVote.votes[id] = 'pending'; return true
  } })
try {
  const handled = await runtime.enter({ type: 'rejoinRoom', requestId: 1,
    payload: { roomId: room.roomId, myPlayerId: 'p2', resumeToken: 'old-token' },
    connection, reply: (type, payload) => messages.push({ type, ...payload }) })
  assert.equal(handled, true)
  assert.equal(room.seats.p2, connection.id)
  assert.equal(room.resumeTokens.p2, 'new-token')
  const reply = messages.find(m => m.type === 'roomRejoined')
  assert.ok(reply)
  assert.equal(reply.dissolveVote.votes.p2, 'offline')
  assert.equal(restores, 0)
  console.log({ rejoined: room.seats.p2, rotatedToken: room.resumeTokens.p2,
    returnedVote: reply.dissolveVote.votes.p2, restoreCalls: restores })
} finally { runtime.dispose() }
```

## 回归与未验证边界

已核对脚本后执行 4 个本地测试文件，全部通过（4 pass / 0 fail，约 5.8 秒）：

```text
node --test work/guandan-windows-source/server/weapp-match-lifecycle.test.mjs work/guandan-windows-source/server/weapp-room-publisher.test.mjs work/guandan-windows-source/server/friend-room-observer.test.mjs work/guandan-windows-source/server/duplicate-room-runtime.test.mjs
```

复式测试使用自身创建的临时目录及内存 reporter/verifier，退出时仅清理该临时目录；没有真实平台调用。对应测试覆盖正常准备/两桌屏障、双桌牌组一致性、跨桌投影、幂等重放和重启；不覆盖此次两项复现。

本批未确认新的跨桌手牌泄露或未授权成员动作；未做生产持久层故障注入、真实 WebSocket/平台端到端联调或真机 Cocos 操作。两项 findings 的服务端结果已进程内复现，客户端投票框影响依据明确条件分支确认。未确认的可能性不列 findings。
