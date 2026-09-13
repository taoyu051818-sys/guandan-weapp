# 服务端复式双桌审计：server-duplicate-04

日期：2026-09-12。审阅者：audit_server_authority。仓库 `/Users/mac/Documents/Codex/2026-08-02/wo-yi`，HEAD `1d58999dc6e5455b049e1643660bbba3deee1406`。

重读审计 README 和 coverage 后，完整审阅本批 7 个 pending 文件，共 578 行；准确路径、SHA-256 和逐文件范围见同名 JSON。actions/projection 已在前批审阅，本次只作调用链辅助，不重复计覆盖。保留原有五处业务文件 dirty 状态，只新增本批报告，不更新清单、不改业务、不提交、不访问真实用户数据或备份。

结论：确认 3 个 P2 连接/房间生命周期问题。没有在本批证实新的另一桌手牌泄露；不重复计 CS-01-001、SA-01-001。CN-02-C01 仍是已有跨模块待验证项，本批未证明新的同连接乱序生产者。

## SD-04-001 / P2：断连提交失败保留幽灵在线身份，存储恢复后仍拒绝双桌恢复

触发条件：已通过签名入房的双桌成员断开连接，恰逢 `disconnected()` 的一次保存失败。无需篡改凭据。

证据链：

- `duplicate-room-runtime.js:119-125` 只在 draft 上清空 `connectionId`、设置 trustee；`:26-30` 在保存成功后才替换 live room。保存失败留存旧在线身份。
- 真实关闭入口 `weapp-ws.js:694-696` 在排定 `disconnected` 后立即从全局 `connections` 删除物理连接，异步失败只打印日志。
- `duplicate-room-admission.js:12`、`:30` 分别对 token 与签名票据恢复按非空 `m.connectionId` 拒绝，没有检查物理连接仍存活；runtime tick 没有重试/协调清掉该悬挂身份。
- 只影响这一次失败的房间也会继续在后续成功提交中保留幽灵身份。磁盘写入恢复不等于断连业务恢复。`:15` 的启动恢复清空全部 `connectionId`，是代码上可见的解除路径，不声称绝对不可恢复。

验证：真实 runtime、真实合成签名票据、无网络、`filePath: ''`。一次注入保存失败后恢复存储，另一个房间成功入场并执行 tick，正确的两类凭据仍被拒绝。未测试真实磁盘破坏，也没有推断越权或手牌泄露。

建议：独立记录不可回滚的物理断连事实，或保留房间/成员/连接代次保护的业务重试；身份互斥区分真正存活连接和悬挂 ID。测试应覆盖一次保存失败恢复后可重连，同时不错误清除后来的新连接。

复制以下完整命令，在上述仓库根目录运行：

```sh
node --input-type=module <<'NODE'
import assert from 'node:assert/strict'
import { DuplicateRoomRuntime } from './work/guandan-windows-source/server/duplicate-room-runtime.js'
import { GameTicketService, GameTicketVerifier } from './work/guandan-windows-source/server/platform/crypto.js'
import { normalizeFriendRoomSettings } from './work/guandan-windows-source/server/friend-room-settings.js'
const secret = 'audit-synthetic-secret-not-used-outside-this-probe'
const now = Date.now(), connections = new Map()
const tickets = new GameTicketService({ secret, gameEndpoint: 'ws://127.0.0.1:1/weapp' })
const settings = normalizeFriendRoomSettings({ format: 'duplicate' })
const runtime = new DuplicateRoomRuntime({ connections, filePath: '', now: () => now,
  send: (c, type, payload) => c.packets.push({ type, ...payload }), verifier: new GameTicketVerifier({ secret, required: true }),
  reporter: { configured: true, claimStart: async () => {}, enqueue: async () => {} } })
clearInterval(runtime.timer)
const connection = id => { const c = { id, packets: [] }; connections.set(id, c); return c }
let requestId = 0
const cmd = async (c, type, payload) => { const id = ++requestId; await runtime.handle(c, { type, requestId: id, payload }); return c.packets.findLast(p => p.requestId === id) }
const enter = async (c, roomId, userId, seat = 'p1') => { const ticket = tickets.issue({ userId, roomId, matchId: `audit_${roomId}`, seat, roomKind: 'friend', roomSettings: settings, roomExpiresAt: now + 600000, hostUserId: `host_${roomId}` }); const payload = { roomId, gameTicket: ticket.gameTicket, entryAttemptId: ticket.claims.entryAttemptId }; return { reply: await cmd(c, 'joinRoom', payload), payload } }
try {
  const old = connection('audit-old'), entry = await enter(old, '908041', 'host_908041')
  assert.equal(entry.reply.type, 'roomJoined')
  const token = entry.reply.resumeToken, save = runtime.store.save.bind(runtime.store)
  runtime.store.save = async () => { throw new Error('synthetic one-shot disk failure') }
  await assert.rejects(runtime.disconnected(old), /one-shot/)
  connections.delete(old.id) // weapp-ws close handler deletes the physical connection even when disconnected rejects
  runtime.store.save = save
  const other = await enter(connection('audit-other-room'), '908042', 'host_908042')
  assert.equal(other.reply.type, 'roomJoined') // a later real entry/commit succeeds after storage recovers
  await runtime.serial(() => runtime.tick())
  const fresh = connection('audit-new')
  const resumed = await cmd(fresh, 'rejoinRoom', { roomId: '908041', resumeToken: token })
  const reticketed = await cmd(fresh, 'joinRoom', entry.payload)
  assert.equal(resumed.type, 'error'); assert.match(resumed.message, /账号已在线/)
  assert.equal(reticketed.type, 'error'); assert.match(reticketed.message, /另一连接/)
  assert.equal(runtime.rooms.get('908041').members[0].connectionId, old.id)
  assert.equal(connections.has(old.id), false)
  console.log(JSON.stringify({ oldConnectionPhysicallyPresent: connections.has(old.id), retainedConnectionId: runtime.rooms.get('908041').members[0].connectionId,
    laterEntryAfterStorageRecovery: other.reply.type, tokenRejoin: resumed, signedTicketEntry: reticketed }, null, 2))
} finally { await runtime.dispose() }
NODE
```

实际输出关键值：`oldConnectionPhysicallyPresent=false`、`retainedConnectionId=audit-old`、`laterEntryAfterStorageRecovery=roomJoined`；token 返回“重连凭证无效或该账号已在线”，有效签名票据返回“该账号已在另一连接中”。退出码 0。

## SD-04-002 / P2：双桌大厅解散后未清其他成员连接归属，阻断同连接下一次入房

触发条件：双桌大厅房主安全退出，另一名已落座成员保持 WebSocket 连接；收到解散通知后尝试进入另一房间。

证据链：

- 辅助文件 `duplicate-room-actions.js:20-29` 把大厅房主退出变成 `closed`；`duplicate-room-runtime.js:78` 只清请求方的两项连接指针，`:94` 对其他成员仅发 `roomDissolved`。
- 下一房请求先在 runtime `:40` 因旧 `connection.roomId` 被拒绝。该 guest 对已关闭旧房补发 `safeExit` 又落入 actions `:26` 的“进行中不能释放”条件。
- runtime `owns():21` 按旧 `duplicateRoomId` 接管路由；真实 `weapp-ws.js:671` 因此连本该走四人房路径的新请求也会送到双桌处理器并被旧房约束拒绝。
- 客户端真实路径：`LobbyMessageRouter.ts:118-120` → `LobbyController.ts:414-420` 只本地清房、回大厅和刷新房间；`CocosSocketClient.ts:48` 在同 URL、OPEN 状态复用连接，因此不是仅手工协议构造的状态。
- 边界：`LobbyMatchedEntryCoordinator.ts:187-193` 的入场失败会清 transport 并请求恢复；探针也确认新建连接后同一下一房票据成功。影响为正常复用连接下首次新房入场失败和额外恢复，不能称为客户端永久卡死。

建议：closed 状态持久提交后，对仍属于同一房间的所有在线连接清理归属和视图缓存，再通知解散；不能误清已迁移到新房的连接。关闭房的安全退出应可幂等收敛。加入 host 大厅退出及到期解散后，guest 不重连即可进入双桌/四人新房的集成回归。

复制以下完整命令，在上述仓库根目录运行：

```sh
node --input-type=module <<'NODE'
import assert from 'node:assert/strict'
import { DuplicateRoomRuntime } from './work/guandan-windows-source/server/duplicate-room-runtime.js'
import { GameTicketService, GameTicketVerifier } from './work/guandan-windows-source/server/platform/crypto.js'
import { normalizeFriendRoomSettings } from './work/guandan-windows-source/server/friend-room-settings.js'
const secret = 'audit-synthetic-secret-not-used-outside-this-probe', now = Date.now(), connections = new Map()
const tickets = new GameTicketService({ secret, gameEndpoint: 'ws://127.0.0.1:1/weapp' })
const settings = normalizeFriendRoomSettings({ format: 'duplicate' })
const runtime = new DuplicateRoomRuntime({ connections, filePath: '', now: () => now,
  send: (c, type, payload) => c.packets.push({ type, ...payload }), verifier: new GameTicketVerifier({ secret, required: true }),
  reporter: { configured: true, claimStart: async () => {}, enqueue: async () => {} } })
clearInterval(runtime.timer)
const connection = id => { const c = { id, packets: [] }; connections.set(id, c); return c }
let requestId = 0
const cmd = async (c, type, payload) => { const id = ++requestId; await runtime.handle(c, { type, requestId: id, payload }); return c.packets.findLast(p => p.requestId === id) }
const issue = (roomId, userId, seat) => { const ticket = tickets.issue({ userId, roomId, matchId: `audit_${roomId}`, seat, roomKind: 'friend', roomSettings: settings, roomExpiresAt: now + 600000, hostUserId: `host_${roomId}` }); return { roomId, gameTicket: ticket.gameTicket, entryAttemptId: ticket.claims.entryAttemptId } }
try {
  const host = connection('audit-host'), guest = connection('audit-guest'), roomId = '908043'
  assert.equal((await cmd(host, 'createRoom', issue(roomId, `host_${roomId}`, 'p1'))).type, 'roomCreated')
  assert.equal((await cmd(guest, 'joinRoom', issue(roomId, 'audit_guest_user', 'p2'))).type, 'roomJoined')
  assert.equal((await cmd(host, 'safeExit', { roomId })).type, 'roomLeft')
  assert.ok(guest.packets.some(p => p.type === 'roomDissolved' && p.roomId === roomId))
  assert.equal(host.roomId, null); assert.equal(guest.roomId, roomId); assert.equal(guest.duplicateRoomId, roomId)
  const nextPayload = issue('908044', 'host_908044', 'p1')
  const nextRoom = await cmd(guest, 'createRoom', nextPayload)
  const leaveClosed = await cmd(guest, 'safeExit', { roomId })
  assert.equal(nextRoom.type, 'error'); assert.match(nextRoom.message, /先离开/)
  assert.equal(leaveClosed.type, 'error'); assert.match(leaveClosed.message, /复式进行中/)
  const normalRoomRequestStillRoutedDuplicate = runtime.owns(guest, { type: 'joinRoom', payload: { roomId: '999991', roomSettings: { format: 'independent' } } })
  assert.equal(normalRoomRequestStillRoutedDuplicate, true)
  await runtime.disconnected(guest); connections.delete(guest.id)
  const fresh = connection('audit-guest-fresh')
  const afterReconnect = await cmd(fresh, 'createRoom', nextPayload)
  assert.equal(afterReconnect.type, 'roomCreated')
  console.log(JSON.stringify({ notifiedClosed: true, hostPointer: host.roomId, guestPointer: guest.roomId, nextRoom, leaveClosed,
    normalRoomRequestStillRoutedDuplicate, afterTransportReconnect: afterReconnect.type }, null, 2))
} finally { await runtime.dispose() }
NODE
```

实际输出关键值：`notifiedClosed=true`、`hostPointer=null`、`guestPointer=908043`、`normalRoomRequestStillRoutedDuplicate=true`；下一房报“请先离开当前牌局”，旧房退出报“复式进行中请使用托管，不能释放参赛席位”；新 transport 入房结果 `roomCreated`。退出码 0。

## SD-04-003 / P2：已确认关闭的双桌墓碑持续占用开房容量，零活动房也拒绝新票据入场

触发条件：同一双桌实例在墓碑清理前累计产生达到 `maxRooms` 的 closed/ended 记录。真实入口 `weapp-ws.js:771-772` 将双桌上限固定为 `Math.min(MAX_ROOMS, 64)`；默认配置下最多 64 条这类记录即可阻止下一间新双桌房。此处确认的是代码可达影响，未查询或断言真实部署已有此故障。

这不是“存在容量限制”本身的问题：防重放保留关闭身份是合理的；问题在于已完成关闭的历史记录和活动房共享开房额度，使正常平台退出/重新建房流程在 **零活动房** 时也失败。`duplicate-room-runtime.js:45` 检查总 `rooms.size`，而 `:161-164` 到 `max(expiresAt, endedAt) + 24 小时` 之后、且事件确认完毕才删除墓碑。因此即使租约已经过期、关闭回调成功且没有待交付事件，也继续占用额度。提高 `WEAPP_MAX_ROOMS` 到 64 以上无法扩大这个双桌额度。

真实平台释放链：`spectator-event-service.js:300-310` 接受 room-closed 后将旧 match 置 aborted 并释放 `activeMatchByUser`；`friend-room-service.js:265-288` 随后允许同一用户创建另一房并签新票。探针完整运行这些真实服务和 runtime，关闭事件由真实 runtime 生成，未直接伪造结束状态。选择正常退出的 host（连接指针已清），排除 SD-04-002 的影响。

影响：单实例没有活动双桌房也拒绝所有尚不存在的双桌房入场，已存在房间不受这个新房容量门禁影响，四人房不由该独立 Map 计数。等待最早符合条件的墓碑过期可恢复；不建议删除墓碑绕过防重放，也不把重启当作可靠恢复方案（启用持久化时会加载这些记录）。

建议：将活动房容量和已关闭身份索引分开计数/存储，给墓碑独立的紧凑结构和安全上限；不能为了恢复容量提前允许旧票重建房间。回归应同时证明有效新房能入场、旧关闭房票据仍不能重建。

复制以下完整命令，在上述仓库根目录运行。`maxRooms: 1` 是同一条件的最小合成规模，时钟推进只影响探针实例；无网络、无磁盘快照：

```sh
node --input-type=module <<'NODE'
import assert from 'node:assert/strict'
import { DuplicateRoomRuntime } from './work/guandan-windows-source/server/duplicate-room-runtime.js'
import { GameTicketService, GameTicketVerifier } from './work/guandan-windows-source/server/platform/crypto.js'
import { FriendRoomService } from './work/guandan-windows-source/server/platform/friend-room-service.js'
import { SpectatorEventService } from './work/guandan-windows-source/server/platform/spectator-event-service.js'
import { MemoryPlatformStore, createEmptyPlatformState } from './work/guandan-windows-source/server/platform/storage.js'
const secret = 'audit-capacity-synthetic-secret-not-production'
let clock = Date.now(), sequence = 0, matchId = 0, roomId = 908050, invite = 0
const initial = createEmptyPlatformState(); initial.users.audit_host = { id: 'audit_host' }
const store = new MemoryPlatformStore(initial), connections = new Map()
const tickets = new GameTicketService({ secret, now: () => clock, gameEndpoint: 'ws://127.0.0.1:1/weapp' })
const service = new FriendRoomService({ store, gameTickets: tickets, now: () => clock, createId: () => `audit-capacity-${++matchId}`,
  createInviteCode: () => `audit-capacity-invite-${++invite}`, createRoomId: () => String(++roomId), friendRoomTtlMs: 600000 })
const events = new SpectatorEventService({ store, now: () => clock, markMatchPlaying: () => {},
  cancelExpiredFriendRoom: (...args) => service.cancelExpired(...args), cancelExpiredUnstartedMatch: () => false,
  activeFriendTickets: (...args) => service.activeTickets(...args) })
const runtime = new DuplicateRoomRuntime({ connections, filePath: '', maxRooms: 1, now: () => clock,
  send: (c, type, p) => c.packets.push({ type, ...p }), verifier: new GameTicketVerifier({ secret, required: true, now: () => clock }),
  reporter: { configured: true, claimStart: async e => events.accept(e.eventId, e), enqueue: async e => events.accept(e.eventId, e) } })
clearInterval(runtime.timer)
const host = { id: 'audit-host', packets: [] }; connections.set(host.id, host)
const cmd = async (type, payload) => { const requestId = ++sequence; await runtime.handle(host, { type, requestId, payload }); return host.packets.findLast(p => p.requestId === requestId) }
const create = attempt => service.create('audit_host', { entryAttemptId: `audit-capacity-attempt-${attempt}`, roomSettings: { format: 'duplicate' } })
const enter = e => cmd('createRoom', { roomId: e.roomId, gameTicket: e.gameTicket, entryAttemptId: e.entryAttemptId })
try {
  const first = await create('0001'); assert.equal((await enter(first)).type, 'roomCreated')
  assert.equal((await cmd('safeExit', { roomId: first.roomId })).type, 'roomLeft')
  for (let i = 0; i < 20 && runtime.delivering.size; i++) { await new Promise(setImmediate); await runtime.queue }
  assert.equal(runtime.delivering.size, 0); assert.equal(runtime.rooms.get(first.roomId).events.length, 0)
  assert.equal(await store.read(s => s.matches[first.matchId].status), 'aborted')
  assert.equal(await store.read(s => s.activeMatchByUser.audit_host), undefined)
  assert.equal(host.roomId, null)
  const closed = structuredClone(runtime.rooms.get(first.roomId))
  clock = closed.expiresAt + 1; await runtime.serial(() => runtime.tick())
  assert.equal(runtime.rooms.size, 1)
  const second = await create('0002')
  assert.equal(tickets.inspect(second.gameTicket).roomId, second.roomId)
  const refused = await enter(second)
  assert.equal(refused.type, 'error'); assert.match(refused.message, /房间已满/)
  const activeRuntimeRooms = [...runtime.rooms.values()].filter(r => !['closed', 'ended'].includes(r.phase)).length
  assert.equal(activeRuntimeRooms, 0)
  const heldAfterLease = runtime.rooms.size
  clock = Math.max(closed.expiresAt, closed.endedAt) + 86400001; await runtime.serial(() => runtime.tick())
  assert.equal(runtime.rooms.size, 0)
  const third = await create('0003'); const recovered = await enter(third)
  assert.equal(recovered.type, 'roomCreated')
  console.log(JSON.stringify({ platformOldMatch: 'aborted', closeEventAcknowledged: true, activeRuntimeRooms,
    roomCountAfterLeaseExpiry: heldAfterLease, nextValidPlatformTicket: true, nextCreate: refused,
    createAfterTombstoneTtl: recovered.type }, null, 2))
} finally { await runtime.dispose() }
NODE
```

实际输出：旧 match 为 `aborted`、关闭事件已确认，`activeRuntimeRooms=0`、`roomCountAfterLeaseExpiry=1`、平台新票有效；新房报“复式房间已满，请稍后重试”。推进到旧 lease + 24 小时之后，`createAfterTombstoneTtl=roomCreated`。退出码 0。

## 测试和覆盖边界

已完整阅读两份测试，检查 WS 固定端口 39139 未被占用后，以如下隔离环境运行（cwd 为 `work/guandan-windows-source`）：

```sh
env -i PATH=/usr/bin:/bin WEAPP_HOST=127.0.0.1 /opt/homebrew/bin/node --test server/duplicate-room-runtime.test.mjs server/duplicate-room-ws.test.mjs
```

结果：2 pass / 0 fail，约 5.4 秒。只有合成平台/签名票据、回环 HTTP/WS collector 和测试创建的临时目录；清理只由测试处理其自建目录和子进程。清空继承环境避免测试的 `...process.env` 注入真实回调或存储路径。

runtime 回归实际进行了两轮真实规则驱动的出牌，覆盖同牌/同级/同庄、两桌 barrier 和累计计分、中途重启、私有投影及机器人 pending 计划。其保存失败用例仅覆盖主动 `setTrustee`，退出用例是已 `ended` 的房主；不能覆盖本批发现的断连和大厅解散。WS 回归的最终结算事件是手工合成后直接注入内存平台，并不验证完整终局从游戏服务器到平台的链路。

辅助检查同连接发布：duplicate 自有 serial 包裹 handle/tick/disconnected；commit 成功后 publish 同步顺序发送；flush 的异步响应经 serial 删除事件而不发布旧视图。未获得独立乱序复现，CN-02-C01 不新增计数。外层调度 key 与执行时连接房间变化属于根线程已有诊断边界，尚无实际错乱结果。

结束复核：7 个源文件 SHA-256 均匹配 JSON；HEAD 未变；原五处业务 dirty 仍保留。未刷新 manifest/coverage。
