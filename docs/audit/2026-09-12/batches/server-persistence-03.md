# 服务端退出、恢复与持久化审计（第三批）

- 日期：2026-09-12；仓库：`/Users/mac/Documents/Codex/2026-08-02/wo-yi`。
- 基线 HEAD：`1d58999dc6e5455b049e1643660bbba3deee1406`。开始前重读审计 README；保留原有五处工作树修改。
- 完整审阅指定 5 文件，共 358 行；交付前重新核验同名 JSON 中全部 SHA-256。辅助阅读不计入本批完整覆盖。
- 新确认 2 项 P2。仅写本批报告，未刷新清单、修改业务代码、部署、操作真实备份/服务器或提交 Git。
- 去重：退出调用 `markOfflineReady` 的终场/待收尾问题引用 `SL-02-001`，不重复计；既有 SA/SL 其他根因亦不重复计。

## 完整阅读范围

| 文件（相对 `work/guandan-windows-source/server/`） | 行数 | 审查内容 |
| --- | ---: | --- |
| `weapp-room-exit.js` | 98 | 成员授权、退出接受记录、房间身份核验、双提交关闭、自动重试、席位释放/保留 |
| `weapp-runtime-recovery.js` | 115 | 接受记录/关闭索引恢复、房间校验、迁移、离线化、副作用与生命周期恢复顺序 |
| `weapp-room-expiry.js` | 49 | 房主/空房存活复核、解散到期、取消/替换、提交失败回滚 |
| `weapp-command-publication.js` | 17 | 重放后发布当前状态及贡还/结算/投票的顺序 |
| `room-state-store.js` | 79 | 原子存储接线、schema/损坏失败关闭、队列错误、复制/席位去连接化、接受记录精确确认 |

辅助追查：`weapp-room-expiry-jobs.js`、`weapp-match-lifecycle.js`、`weapp-game-command-handler.js`、`weapp-runtime-persistence.js`、`weapp-ws.js`、`durable-file.js` 及相关测试，不计为本批新增完整审阅文件。

## SP-03-001 / P2：自动动作回滚替换投票对象，导致已排定的投票超时失效

**位置：** `work/guandan-windows-source/server/weapp-room-expiry.js:32`。

**触发条件：** 房间已有未结束解散投票；在该投票到期前，自动出牌/托管动作遇到规则执行异常或非终局持久失败，走整房间快照回滚；原解散超时任务随后正常触发。

**证据：**

- `weapp-room-expiry.js:28-32` 捕获 `vote` 对象，并以 `room.dissolveVote !== vote` 判定旧任务，不仅检查业务标识/期限。
- `weapp-match-lifecycle.js:316` 创建 `structuredClone(room)`，`371-375` 或 `378-382` 遇到异常后调用 `restoreRoom`；该函数 `76-78` 将嵌套字段替换为快照对象。恢复的投票内容/期限完全相同，但引用不同，且不重设解散定时器。
- 原到期任务因此在 `weapp-room-expiry.js:32` 静默退出；`weapp-room-expiry-jobs.js:19-21` 在 finally 删除这个任务，不会自动重新排定。
- `weapp-game-command-handler.js:113` 在投票对象仍存在时拒绝新的解散申请。

**已确认影响：** 该投票失去自动超时清理，超过期限仍留在房间，后续解散申请被“已有解散投票进行中”拒绝。玩家主动拒绝旧投票或重启重建计时器等其他路径可能解除它，因此不声称完全不可恢复。

**验证：** 真实 `createWeAppMatchLifecycle` 和 `createRoomExpiry`，合成房间、可控计时器，向自动动作 dispatch 注入一次异常。回滚后 `sameVoteReference=false`、`equalVoteContent=true`；触发原到期回调后 `voteStillPresent=true`、`remainingExpiryTimers=0`，没有提交或 `expired` 发布。随后调用真实 game handler 的 `proposeDissolve`，得到已有投票错误。未运行真实时钟等待或网络服务。

**建议：** 为投票使用稳定 ID/代次，不能把内存引用作为跨回滚身份；或在整体快照回滚后重建对应投票到期任务。保留真正新投票不能被旧任务清除的保证，增加“投票中自动动作失败→回滚→原期限到达”的跨模块回归。

## SP-03-002 / P2：空房/房主过期关闭提交失败后只重试存储，不重试完成关闭

**位置：** `work/guandan-windows-source/server/weapp-room-expiry.js:12`，同文件 `20-23` 的房主过期路径同类。

**触发条件：** 未开局房间的房主过期任务，或已结算且未启用总时长限制房间的空房过期任务执行关闭；关闭的第一次或第二次运行态持久提交失败。随后存储恢复正常。选取这些状态排除正常出牌/总时长计时器偶然触发其他关闭路径，不以进行中牌局推断永远不会再收到业务回调。

**证据：**

- `weapp-room-expiry.js:12-14,20-24` 直接调用 `closeRoomWithoutAck`，失败后没有再次安排关闭工作。
- `weapp-room-expiry-jobs.js:19-21` 即使操作拒绝也在 finally 删除对应定时任务。
- 实际 `weapp-ws.js:456-475` 的关闭函数先设置 `closingReason` 再提交（460–464）；第一次失败时标记留在内存。第二次失败时将已删除房间放回 Map 并调用 `persistRuntimeState`（467–473）。这两个提交错误分支均不重新安排完整关闭。
- `weapp-runtime-persistence.js:25-29` 只重新安排保存；保存恢复后只确认快照（23–24），不会重做 `stage → delete → commit → finalize`。
- 真实入口没有通用 `closingReason` 周期扫描。`weapp-ws.js:355-369` 确有可重新关闭的副作用重试，但只在 `stagePendingSideEffects` 自身抛错时（411–413）安排；本复现的 stage 成功/未被调用，单独的 commit 错误不会进入它。`friend-room-observer-runtime.js:49-55` 的周期任务仅发布观察快照，不清理关闭房间。
- `weapp-command-gateway.js:64` 对仍有 `closingReason` 的房间返回 `ROOM_CLOSING`。`weapp-runtime-recovery.js:94-98` 能在后续重启时移除关闭中的房间，但这不是当前进程内的自动恢复。

**已确认影响：** 存储恢复后房间仍保留且已被标为关闭，关闭/持久重试任务均已耗尽，正常请求被关闭门禁阻止，房间记录占用容量，直到重启或其他关闭路径介入。没有声称某个生产房间已经丢失数据，也没有将正常持久失败本身作为漏洞。

**验证：** 使用真实 expiry 与 runtime persistence；只从 `weapp-ws.js` 读取并原样提取 `closeRoomWithoutAck` 函数体，在合成依赖中运行，**没有 import 或执行服务器入口**。内存 `save` 分别只在第 1、第 2 次提交抛错；随后显式执行后台保存重试。两种情形均得到：

```text
第1次失败：提交次数2，roomRetained=true，closingReason=empty-timeout，
            closeTimers=0，persistTimers=0，最后快照仍含1个房间，无finalize。
第2次失败：提交次数3，其余结果相同。
```

可复制脚本也遍历房主过期分支；回归在合成数据上覆盖两种关闭原因和两个失败位置。不进行真实磁盘故障或服务器操作。

**建议：** 关闭工作本身保留可重试租约/完成标记；无论第几次持久提交失败，在房间仍是同一实例且未完成关闭时重试完整关闭流程。不能仅依赖底层保存重试。复用明确的房间身份/代次保护，避免旧关闭任务作用于同号新房间。

## 可复制无网络复现

在仓库根目录分别用 `node --input-type=module` 执行下面两个 JavaScript 块。计时器为可控队列，触发回调模拟相应期限到达；只使用内存合成房间/存储。

```js
// SP-03-001
import assert from 'node:assert/strict'
import { createRoomExpiry } from './work/guandan-windows-source/server/weapp-room-expiry.js'
import { createWeAppMatchLifecycle } from './work/guandan-windows-source/server/weapp-match-lifecycle.js'
import { createGameCommandHandler } from './work/guandan-windows-source/server/weapp-game-command-handler.js'
const ids = ['p1', 'p2', 'p3', 'p4'], noop = () => {}
const flags = v => Object.fromEntries(ids.map(id => [id, v]))
const room = { roomId: '321654', version: 1, gameVersion: 1,
  roomSettings: { format: 'rounds', rounds: 4, turnSeconds: 20, trusteeSeconds: 15, totalTimeMinutes: 0 },
  state: { phase: 'playing', currentTurn: 'p1', lastValidPlay: { type: 'Single' },
    players: Object.fromEntries(ids.map(id => [id, { hand: [{ id: `card-${id}` }] }])) },
  seats: Object.fromEntries(ids.map(id => [id, `connection-${id}`])),
  trustees: flags(null), consecutiveTimeouts: flags(0),
  dissolveVote: { initiator: 'p2', votes: { p1: 'pending', p2: 'agree', p3: 'pending', p4: 'pending' },
    expiresAt: Date.now() + 60000 } }
const rooms = new Map([[room.roomId, room]])
const turnTimers = new Map(), expiryTimers = new Map(), jobs = [], events = []
const enqueue = fn => { const p = Promise.resolve().then(fn); jobs.push(p); return p }
const timerInto = timers => (fn, delay) => {
  const id = { unref: noop }; timers.set(id, { fn, delay }); return id
}
const expiry = createRoomExpiry({ rooms, seatHasLiveConnection: () => true,
  hasConnectedHuman: () => true, enqueueServerOperation: enqueue, closeRoomWithoutAck: noop,
  commitRuntimeState: async () => events.push('committed'), publishDissolveVote: () => events.push('expired'),
  emptyRoomTimeoutMs: 1000, setTimeout: timerInto(expiryTimers), clearTimeout: id => expiryTimers.delete(id) })
const lifecycle = createWeAppMatchLifecycle({ playerIds: ids, rooms, connections: new Map(),
  turnTimeoutMs: 20000, friendSecondMs: 1000, totalMinuteMs: 60000,
  isShuttingDown: () => false, enqueueServerOperation: enqueue, ensureLiveMetadata: noop,
  isFriendRoom: () => true, isMatchRoom: () => false, isBotPlayer: () => false,
  botPolicyForRoom: noop, existingBotPolicyForRoom: () => null,
  dispatchMatchIntentImpl: () => { throw Error('injected action failure') }, shuffleRandom: () => 0.5,
  persistRuntimeState: noop, commitRuntimeState: async () => {}, stagePendingSideEffects: noop,
  broadcast: noop, send: noop, phaseFor: () => '', liveMetadataFor: () => ({}),
  publishTurnStatus: noop, publishState: noop, publishTribute: noop, publishRoundEnded: noop,
  recordRoomAction: noop, reportSpectatorEvent: noop, reportSpectatorAction: noop,
  reportSpectatorRoundEnd: noop, reportCompletedGame: noop, closeRoomWithoutAck: noop,
  log: { error: noop }, scheduleTimeout: timerInto(turnTimers), cancelTimeout: id => turnTimers.delete(id) })
try {
  const oldVote = room.dissolveVote
  expiry.scheduleDissolveExpiry(room)
  lifecycle.armTurnDeadline(room)
  const firstTurn = turnTimers.entries().next().value
  turnTimers.delete(firstTurn[0]); firstTurn[1].fn(); await jobs.shift()
  assert.notEqual(room.dissolveVote, oldVote)
  assert.deepEqual(room.dissolveVote, oldVote)
  const scheduled = expiryTimers.entries().next().value
  expiryTimers.delete(scheduled[0]); scheduled[1].fn(); await jobs.shift()
  assert.ok(room.dissolveVote)
  assert.equal(expiryTimers.size, 0)
  assert.deepEqual(events, [])
  const replies = []
  const handler = createGameCommandHandler({ rooms, ensureLiveMetadata: noop,
    playerIn: (r, connectionId) => ids.find(id => r.seats[id] === connectionId) })
  await handler({ type: 'proposeDissolve', payload: { roomId: room.roomId },
    connection: { id: 'connection-p1' }, reply: (type, body) => replies.push({ type, ...body }) })
  assert.equal(replies[0].message, '已有解散投票进行中')
  console.log({ sameVoteReference: room.dissolveVote === oldVote,
    equalVoteContent: JSON.stringify(room.dissolveVote) === JSON.stringify(oldVote),
    voteStillPresent: !!room.dissolveVote, remainingExpiryTimers: expiryTimers.size, events, replies })
} finally { lifecycle.dispose(); expiry.dispose() }
```

```js
// SP-03-002：提取单个原样函数，不执行weapp-ws入口。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRoomExpiry } from './work/guandan-windows-source/server/weapp-room-expiry.js'
import { createRuntimePersistence } from './work/guandan-windows-source/server/weapp-runtime-persistence.js'
const source = readFileSync('./work/guandan-windows-source/server/weapp-ws.js', 'utf8')
const closeBody = source.split('const closeRoomWithoutAck = ')[1]
  .split('\nconst initializeRoomMatch = ')[0].trim()
assert.ok(closeBody.startsWith('async (room, reason,'))
assert.ok(closeBody.endsWith('}'))
const makeClose = new Function('d', `const { rooms, hasConnectedHuman,
  rememberClosedRoomTombstone, reportSpectatorClosed, commitRuntimeState,
  stagePendingSideEffects, persistRuntimeState, finalizeRemovedRoom } = d;
  return (${closeBody});`)
const noop = () => {}
for (const kind of ['empty', 'host']) for (const failedCommit of [1, 2]) {
  const room = { roomId: '123456', version: 1,
    state: kind === 'empty' ? { phase: 'settled' } : null,
    roomSettings: { totalTimeMinutes: 0 }, closingReason: null }
  const rooms = new Map([[room.roomId, room]])
  const expiryTimers = new Map(), persistTimers = new Map(), queue = [], saved = [], events = []
  let commits = 0
  const timerInto = timers => (fn, delay) => {
    const id = { unref: noop }; timers.set(id, { fn, delay }); return id
  }
  const persistence = createRuntimePersistence({
    roomStateStore: { configured: true, save: async snapshot => {
      commits++
      if (commits === failedCommit) throw Error('injected persistence failure')
      saved.push(structuredClone(snapshot))
    } }, acceptedActions: new Map(),
    persistedRuntimeSnapshot: () => ({ rooms: [...rooms.values()], acceptedActions: [] }),
    debounceMs: 10, isShuttingDown: () => false,
    setTimeout: timerInto(persistTimers), clearTimeout: id => persistTimers.delete(id),
  })
  const close = makeClose({ rooms, hasConnectedHuman: () => false,
    rememberClosedRoomTombstone: noop, reportSpectatorClosed: () => events.push('reported'),
    commitRuntimeState: async () => {
      persistence.persistRuntimeState()
      await persistence.flushRuntimeState({ throwOnError: true })
    }, stagePendingSideEffects: () => events.push('staged'),
    persistRuntimeState: persistence.persistRuntimeState, finalizeRemovedRoom: () => events.push('removed') })
  const expiry = createRoomExpiry({ rooms, seatHasLiveConnection: () => false,
    hasConnectedHuman: () => false,
    enqueueServerOperation: fn => { const p = Promise.resolve().then(fn); queue.push(p); return p },
    closeRoomWithoutAck: close, commitRuntimeState: async () => {}, publishDissolveVote: noop,
    emptyRoomTimeoutMs: 1000, setTimeout: timerInto(expiryTimers), clearTimeout: id => expiryTimers.delete(id) })
  try {
    if (kind === 'empty') expiry.scheduleEmptyRoomExpiry(room)
    else expiry.scheduleHostExpiry(room.roomId)
    const [id, timer] = expiryTimers.entries().next().value
    expiryTimers.delete(id); timer.fn()
    await assert.rejects(queue.shift(), /injected persistence failure/)
    const reason = kind === 'empty' ? 'empty-timeout' : 'host-left'
    assert.equal(expiryTimers.size, 0)
    assert.equal(room.closingReason, reason)
    assert.equal(rooms.size, 1)
    await persistence.flushRuntimeState({ throwOnError: true })
    assert.equal(saved.at(-1).rooms[0].closingReason, reason)
    assert.equal(rooms.size, 1)
    assert.equal(expiryTimers.size, 0)
    assert.equal(persistTimers.size, 0)
    assert.ok(!events.includes('removed'))
    console.log({ kind, failedCommit, commits, roomRetained: rooms.size === 1,
      closingReason: room.closingReason, closeTimers: expiryTimers.size,
      persistTimers: persistTimers.size, lastSavedRooms: saved.at(-1).rooms.length, events })
  } finally { expiry.dispose(); persistence.cancelPendingTimer() }
}
```

## 验证与边界

Node `v26.7.0`。已核对后运行以下 4 个现有本地测试，全部通过（4 pass / 0 fail）：

```text
node --test work/guandan-windows-source/server/weapp-runtime-recovery.test.mjs work/guandan-windows-source/server/room-state-store.test.mjs work/guandan-windows-source/server/weapp-room-expiry.test.mjs work/guandan-windows-source/server/weapp-command-recovery.test.mjs
```

存储测试只操作自身 `mkdtempSync` 创建的合成目录，finally 清理该目录；未读取任何真实运行快照。现有测试覆盖保存权限/原子替换失败、schema 拒绝、准确接受记录确认、退出两阶段提交、租约取消/替代/同号新房间、解散到期自身失败重试；不覆盖这两项跨模块缺口。

本批确认存储对无法解析 JSON/不支持 schema 不静默重置，序列写入失败向 save 调用方抛出，并保护进程内连接 ID 不跨重启恢复。没有以测试通过声称持久化链路整体无缺陷。未做真实文件损坏、机器断电、平台副作用或网络故障测试；未把深层快照格式缺乏全面 schema 验证推测为远程越权。报告中的复现已从 Markdown 提取再次执行，源码哈希随后复核。
