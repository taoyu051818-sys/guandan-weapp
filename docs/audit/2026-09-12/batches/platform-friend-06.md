# 平台好友房审计：platform-friend-06

基线 HEAD：`1d58999dc6e5455b049e1643660bbba3deee1406`。审阅者：`/root/audit_core_rules`。2026-09-12。

本批完整读审 **6 文件 / 1,914 行**；确认 **1 项 P2**，不是已审 SL/SP/SD/SE 的同根因重复。当前读取的总覆盖仍为 156/629，本批不更新总清单。根线程通知长期目标已暂停后，停止补充验证，仅收尾已开展工作。

## 范围与安全

先读当前 README、STATUS 和 coverage；六文件均为 pending。保留原五处未提交修改。长测试分 1–330、331–660、661–990、991–1290 读至 EOF；辅助查阅/测试执行经过的文件不计完整覆盖。未读取生产 env、真实账户、秘密或线上数据，未运行服务器主入口、构建、生成、提交或部署。

执行前核对 MemoryPlatformStore 仅克隆/内存事务，平台 runtime 导入不自动监听；指定 HTTP 测试使用显式 test 配置、内存种子、合成身份和密钥、127.0.0.1 随机端口，finally 关闭。Reporter 未配置 outboxFilePath，唯一目标为该回环测试服务。探针无文件/网络写入；运行时 interval 在 finally dispose。产品依赖读取现有 shared-core/dist，不重建，不据此宣称构建新鲜。

## 逐文件审阅

| 文件（server/platform/） | 行数 | SHA-256 |
| --- | ---: | --- |
| friend-room-number-limiter.js | 20 | `849425e3ab8cb534fa3cd958cfd24d6f6a893084fb975c33dec4cecf3e6441de` |
| friend-room-personal-scores.js | 16 | `6f27cb0cc8806c17af45ee082574caa555656e9fa11562468904db609bbbc734` |
| friend-room-roster.js | 32 | `1f010c45199574dd8626e94c9873e2e66b7b9f8edbbf42de3ed94c98175028cc` |
| friend-room-service.js | 453 | `5df01561f4b7e0219a1e81ddb83728b7b2653bcec0126e468132d7929d676f18` |
| friend-room-service.test.mjs | 103 | `40b7ea6e4f254fe99c757722b512f2b8a4755864a6b8ee72310bb05c02a44fe0` |
| friend-room.test.mjs | 1290 | `ead60b1b6aeea80bc5ea662bd4891871969cee43e72844c73725d2fc545ad184` |

- `work/guandan-windows-source/server/platform/friend-room-number-limiter.js`：完整读审。核按用户60秒窗口、6次上限、到期回收及10000键内存边界；现有纯内存回归覆盖这些边界。未确认新增问题。
- `work/guandan-windows-source/server/platform/friend-room-personal-scores.js`：完整读审。核转蛋个人分/队伍分互斥、3/6计分的单人范围和总和；真实 SpectatorEventService 调用前经 normalizeSpectatorEvent 验证四席完整整数，未将绕过上游的孤立API误用列为问题。未新增计分探针。
- `work/guandan-windows-source/server/platform/friend-room-roster.js`：完整读审。核真实开局提交的四人唯一性、活动授权成员/签名机器人白名单、spectator off限制、人席调整/观战身份、开局锁定/终态拒绝；复式路由仅辅助追踪。未确认独立新增问题。
- `work/guandan-windows-source/server/platform/friend-room-service.js`：完整读审。核配置规范化、邀请码/房号、创建和恢复幂等、票据256容量、房主信息、租约、活动比赛归属、取消/踢出/离席确认、4/8座与观战。确认 PF-06-001：复活已有 cancelled participant 缺12人上限校验，平台13人但牌桌运行时拒绝第13票。
- `work/guandan-windows-source/server/platform/friend-room-service.test.mjs`：完整读审并执行通过。纯内存服务/假票据：创建加入恢复、观战12人、新用户超限、房号鉴权与限流、幂等、封禁、开局/关闭/过期。容量断言只有首次新成员加入，没有满员后合法离席旧成员重新加入。
- `work/guandan-windows-source/server/platform/friend-room.test.mjs`：完整分四段读至EOF并执行通过。仅显式test环境/MemoryStore、回环HTTP和合成身份/密钥；覆盖HTTP认证、规范签名票据、生命周期双签名/重放/归属、取消离席闭环、恢复/过期、终局计分/延迟公开、256票据边界。生命周期和终局多为手工合成，不等于全WS牌局/全终场验证；未覆盖PF-06-001。

## PF-06-001 / P2：旧成员复活绕过平台 12 人检查

位置：`work/guandan-windows-source/server/platform/friend-room-service.js:329`，相关复活分支 333–358 行、票据与活动归属写入 359–361 行。

触发条件：

1. 启用观战的同一好友房，用户此前成功加入；离席由牌局服的 `seat-left(reason=left)` 确认，平台保留该用户的 cancelled participant。
2. 其他用户入房后达到 12 名活动成员，原座已被占用。
3. 离席用户用新的合法 entryAttemptId 再次加入相同房间。

`admit` 的 >=12 检查仅处于 `!participant` 新建分支。旧成员走 cancelled 复活分支，转为 observer、签新票、写 activeMatchByUser，平台活动成员增到 13。同一满员状态下首次加入的新用户正确收到 FRIEND_ROOM_FULL，因此不是配置允许 13 人。重用旧 entryAttemptId 也正确拒绝；触发必须使用新的合法尝试编号。

实际影响限定为：**平台成功响应并多发一张牌桌无法接受的观战票，恢复该用户的活动比赛归属，随后入桌失败。** 不是实际 13 人观战，也没有越权出牌、隐藏牌泄漏或积分改变证据。该活动归属可由正常取消/生命周期操作清理，未证明永久卡死。

当前真实路径证据：

- HTTP `platform/http.js:204–212` 认证后调用 PlatformService 的邀请/房号加入方法；`platform/service.js:204–212` 都进入同一 FriendRoomService。
- `platform/spectator-event-service.js:277–295` 将已确认离席成员置 cancelled、清理票据/activeMatchByUser、保留 seatLifecycleConfirmedAt；kicked 另写封禁表。HTTP 生命周期入口要求双签名，本探针不伪造用户可发的生命周期权限。
- 普通好友房生产入口 `weapp-ws.js:631–633` 优先调用 observerRuntime.enter；其 `friend-room-observer-runtime.js:102` 对不存在的成员再次按 12 人检查。实际 `weapp-room-exit.js:58` 在未开局离席时移除成员记录，所以再次加入并非现有在线成员幂等重连。
- 复式 `duplicate-room-admission.js:26–34` 仅找到未 left 的同用户，新增活跃真人也检查 12 人。其运行时限制是总活跃非机器人 12 人，不是额外 12 位观战。
- 本探针全真人满座：普通为 4 玩家 + 8 观战，复式为 8 玩家 + 4 观战；两种模式均拒绝第 13 人，维持运行时 12 人。机器人参与时的配额差异不在本复现结论内。

建议：对“非活动 → 活动”的新建/复活共用容量检查，而不是取消运行时防线；已活动成员幂等重试或恢复不应被误拒。补回归应验证平台拒绝且没有新票/activeMatchByUser 变更。

## 已执行验证与未验证边界

- `node work/guandan-windows-source/server/platform/friend-room-service.test.mjs`：通过。
- `node work/guandan-windows-source/server/platform/friend-room.test.mjs`：通过。含合成回环 HTTP，未建立该票据 gameEndpoint 的 WebSocket。
- 下列完整探针：4 场景（普通/复式 × 邀请/房号），全部得到 platformActive=13、runtimeActive=12、runtimeAdmitsThirteenth=false；新用户超限与旧 entryAttemptId 拒绝对照均通过。
- 普通场景真实调用平台服务、票据验签、观战入场模块和退出模块；复式真实入场模块，但先前离席用合法 left 墓碑 + 对应平台事件模拟，不声称执行复式退出协调器。
- 持久化、广播、连接/已接受动作等外围端口为内存适配；不等于真 WS/生产持久化/真机测试。容量探针直接调用同一 PlatformService；签名/HTTP真实路径由源码与上述既有测试核对。
- 通知暂停时，额外 ban/off/pending 与开局后旧成员复活的容量组合对照尚未运行，现已停止；本批不把它们写成新增验证通过。既有两测试已含封禁、未允许观战、待离席确认等门禁的部分独立断言。
- 个人计分检查有上游四席完整安全整数验证，未把孤立API缺少上游验证当业务缺陷；本批没有新增计分最优/可达总分专项证明。
- 未确认其他独立问题；“无新增”不代表全部平台服务、跨服务一致性或剩余文件已安全。

## 可复制探针

在仓库根目录执行以下唯一代码块。全部用户/密钥/状态为合成；不会读生产 env、监听端口或连接 gameEndpoint。通过时打印 4 行场景对象，关键结果均为平台 13、牌桌 12、拒绝第 13 票。

```bash
node --input-type=module <<'NODE'
import assert from 'node:assert/strict'
import { PlatformService } from './work/guandan-windows-source/server/platform/service.js'
import { MemoryPlatformStore, createEmptyPlatformState } from './work/guandan-windows-source/server/platform/storage.js'
import { AccessTokenService, GameTicketService, GameTicketVerifier } from './work/guandan-windows-source/server/platform/crypto.js'
import { createFriendRoomObserverRuntime } from './work/guandan-windows-source/server/friend-room-observer-runtime.js'
import { createRoomExit } from './work/guandan-windows-source/server/weapp-room-exit.js'
import { duplicateEntry } from './work/guandan-windows-source/server/duplicate-room-admission.js'
const now = 1800000000000
const secret = 'PF-06-synthetic-test-secret-no-production-use'
const active = p => ['matching', 'matched', 'playing'].includes(p.status)
const rows = []
for (const format of ['classic', 'duplicate']) {
  for (const byNumber of [false, true]) {
    const state = createEmptyPlatformState()
    for (let i = 0; i < 14; i++) state.users['u' + i] = { id: 'u' + i }
    const store = new MemoryPlatformStore(state)
    const tickets = new GameTicketService({ secret, now: () => now, gameEndpoint: 'ws://127.0.0.1:1/unused' })
    const verifier = new GameTicketVerifier({ secret, required: true, now: () => now })
    let nextId = 0
    const service = new PlatformService({
      store, gameTickets: tickets, accessTokens: new AccessTokenService({ secret, now: () => now }),
      now: () => now, createId: () => 'pf-' + (++nextId), createRoomId: () => '456789',
      createInviteCode: () => 'P'.repeat(24),
    })
    const roomSettings = format === 'duplicate' ? { format, rounds: 2, spectator: 'live' } : { spectator: 'live' }
    const host = await service.createFriendRoom('u0', { entryAttemptId: 'pf-host-entry-attempt-0001', roomSettings })
    const join = (i, suffix = 'first') => service[byNumber ? 'joinFriendRoomByNumber' : 'joinFriendRoom']('u' + i, {
      roomId: host.roomId, inviteCode: host.inviteCode, entryAttemptId: 'pf-guest-entry-attempt-' + i + '-' + suffix,
    })
    const first = await join(1)
    const claims = tickets.inspect(host.gameTicket)
    const nullSeats = () => Object.fromEntries(['p1','p2','p3','p4'].map(s => [s, null]))
    const gameRoom = { roomId: host.roomId, matchId: host.matchId, entryKind: 'friend', ticketBound: true,
      roomSettings: claims.roomSettings, friendHostUserId: 'u0', botSeed: 'pf-seed', version: 0,
      seats: nullSeats(), resumeTokens: nullSeats(), userIdsBySeat: nullSeats(),
      ticketJtisBySeat: nullSeats(), ticketExpiresAtBySeat: nullSeats(), lobbyReady: nullSeats(),
      revokedTicketJtis: [], friendMembers: [], pendingSpectatorEvents: [] }
    const rooms = new Map([[host.roomId, gameRoom]])
    const connections = new Map(), acceptedActions = new Map(), pending = []
    let nextToken = 0, requestId = 0, sequence = 0, duplicateRoom
    const d = {
      rooms, connections, acceptedActions,
      entryPayloadFor: () => ({ state: null, phase: 'lobby', version: 0 }),
      inspectEntryTicket: (p, expected) => verifier.inspectWithConsumptionStatus(p.gameTicket, expected),
      // These binding-only ports use the exact match/room/settings returned by the real platform.
      ticketBlockedByClosedRoom: () => false,
      ticketMatchesRoom: (r, c) => r.matchId === c.matchId && r.roomId === c.roomId && JSON.stringify(r.roomSettings) === JSON.stringify(c.roomSettings),
      entryConflictFor: () => false, actionFingerprint: (type, p) => JSON.stringify([type, p]),
      reserveAccepted: () => true, releaseAccepted() {}, gameTicketVerifier: verifier,
      createResumeToken: () => 'pf-token-' + (++nextToken), rotateAcceptedActionIdentity() {},
      clearEmptyRoomExpiry() {}, clearHostExpiry() {}, publishRoomMembers() {},
      rememberAccepted(key, fingerprint, response, responseType, completion) { acceptedActions.set(key, { fingerprint, response, responseType, completion }) },
      async commitRuntimeState() {}, send(c, type, payload) { if (type !== 'roomView') c.last = { type, payload } },
    }
    const observer = createFriendRoomObserverRuntime(d)
    const enter = async (i, entry) => {
      const connection = { id: 'c' + i, acceptedCacheKeys: new Map() }
      connections.set(connection.id, connection)
      const payload = { roomId: entry.roomId, gameTicket: entry.gameTicket, entryAttemptId: entry.entryAttemptId }
      if (format === 'duplicate') {
        const result = duplicateEntry(duplicateRoom, connection, { type: 'joinRoom', requestId: ++requestId, payload }, verifier, now)
        duplicateRoom = result.room
      } else {
        await observer.enter({ type: 'joinRoom', requestId: ++requestId, payload, connection, reply: (type, p) => { connection.last = { type, payload: p } } })
        if (connection.last?.type === 'error') throw new Error(connection.last.payload.message)
        assert.equal(connection.last?.type, 'roomJoined')
      }
      return connection
    }
    const exit = createRoomExit({
      ...d, playerIn: (r, id) => Object.keys(r.seats).find(s => r.seats[s] === id),
      ensureLobbyMetadata() {}, deleteAcceptedActionIdentity() {}, persistRuntimeState() {},
      reportSpectatorEvent(r, event) { pending.push(event) }, stagePendingSideEffects() {},
      syncConnectionRoomId(c) { c.roomId = null }, publishCurrentRoom() {}, broadcastRooms() {},
      enqueueServerOperation: (_key, op) => op(),
    })
    try {
      await enter(0, host)
      const returningConnection = await enter(1, first)
      if (format === 'classic') {
        await exit.handle({ payload: { roomId: host.roomId }, connection: returningConnection,
          requestId: ++requestId, cacheKey: 'pf-leave', requestFingerprint: 'pf-leave', reply() { assert.fail('unexpected leave error') } })
        assert.equal(gameRoom.friendMembers.some(m => m.userId === 'u1'), false)
        assert.equal(pending.length, 1)
      } else {
        // Duplicate departure is represented as the existing runtime's left tombstone.
        // Its separate exit coordinator is not exercised by this probe.
        const departed = duplicateRoom.members.find(m => m.userId === 'u1')
        departed.left = true; departed.connectionId = null
        pending.push({ type: 'seat-left', playerId: 'p2', userId: 'u1', reason: 'left', roundSequence: 1 })
      }
      for (const event of pending) {
        const eventId = 'spectate:' + host.matchId + ':' + (++sequence)
        await service.acceptSpectatorEvent(eventId, { ...event, eventId, matchId: host.matchId, roomId: host.roomId, sequence, at: now })
      }
      assert.equal(await store.read(s => s.matches[host.matchId].participants.find(p => p.userId === 'u1').status), 'cancelled')
      await assert.rejects(join(1), e => e.code === 'FRIEND_ENTRY_ATTEMPT_REVOKED')
      for (let i = 2; i <= 12; i++) await enter(i, await join(i))
      const count = () => store.read(s => s.matches[host.matchId].participants.filter(active).length)
      assert.equal(await count(), 12)
      await assert.rejects(join(13), e => e.code === 'FRIEND_ROOM_FULL')
      const revived = await join(1, 'second')
      assert.equal(revived.seat, 'observer')
      assert.equal(verifier.inspect(revived.gameTicket).sub, 'u1')
      assert.equal(await count(), 13)
      assert.equal(await store.read(s => s.activeMatchByUser.u1), host.matchId)
      await assert.rejects(enter(1, revived), /已满/)
      const runtimeCount = format === 'classic' ? gameRoom.friendMembers.length : duplicateRoom.members.filter(m => !m.left && !m.bot).length
      assert.equal(runtimeCount, 12)
      rows.push({ format, method: byNumber ? 'number' : 'invite', platformActive: 13, runtimeActive: runtimeCount, runtimeAdmitsThirteenth: false })
    } finally { exit.dispose(); observer.dispose() }
  }
}
console.log(JSON.stringify({ finding: 'PF-06-001', scenarios: rows }, null, 2))
NODE
```

## 辅助阅读，不计覆盖

为核安全和调用契约辅助阅读了 `platform-server.js`、`platform/{storage,config,seeds,service,crypto,http,spectator-event-service,spectator-domain,spectator-event-reporter,matchmaking-service,duplicate-room-roster}.js` 的相关内容，以及 `friend-room-settings.js`、`friend-room-members.js`、`friend-room-observer-runtime.js`、`friend-room-observer-buffer.js`、`duplicate-room-admission.js`、`weapp-room-exit.js` 和 `weapp-ws.js` 对应入口/退出/绑定段。仅将本批明确完整逐项读审的六文件入 reviewed，未按依赖导入或检索命中扩展计数。

## 结束核验

结束时再次核对六文件 SHA-256，与开始记录一致；HEAD 未变。五处原 dirty 文件 SHA-256 与原基线均相同，git status 仍仅原五处修改和 docs/audit/。只使用 apply_patch 新增本批 MD/JSON，没有改产品、原测试、总清单或 STATUS。

