# 客户端内部状态首批审计

基线：`1d58999dc6e5455b049e1643660bbba3deee1406`，审计日期 2026-09-12。完整逐行审阅指定 8 文件、909 行，逐文件 SHA-256 与结论见同名 JSON。调用链中额外读取的网络、会话、复式服务端和测试文件仅用于核验，不计入本批完整审查数量。

确认 2 项：P2 1 项、P3 1 项。仅写本报告和 JSON；保留用户已有修改，未改业务代码、提交或部署。范围为客户端状态逻辑，不包含 UI 设计、真实设备渲染或线上压力验证。

## CS-01-001 · P2 · 复式换桌观战被原桌生命周期门禁拒绝

定位：`work/guandan-cocos/assets/scripts/game/GameManagerProjection.ts:125`（125–127 行，另见 122–124 行 revision 门禁）。

触发：A 桌已经结束，参赛者通过合法 `watchTable(B)` 观看仍在进行的 B 桌。两桌属于同一房间，同一 `roundId`，但有各自的版本和状态。

服务端 `duplicate-room-actions.js:61–64` 允许且专门限定这一操作；`duplicate-room-model.js:28–30` 创建两个独立状态。`FriendRoomViewReceiver.ts:23–26` 在桌/视角切换时只重置上游 `LobbySyncTracker`（接线在 `LobbyMessageRouter.ts:37–40`），没有重建 `GameManagerProjection`。`TableMatchCoordinator.ts:159–169` 将恢复包传给旧投影。

投影比较只看 `roundId/revision/phase`，看不到桌的身份，于是把 B 桌的 `playing` 误当作 A 桌 `settlement` 的倒退。外层网络 metadata 已变成 `observer / watching=B`，内层仍是 A 桌结算。即使 B 的版本超过 A，生命周期门禁仍拒绝它，本局无法恢复正常观战。观察者在独立桌之间切换到较低 revision 也会被同一缺少 authority 身份的问题影响。

建议：引入稳定的房间/对局/桌 authority 标识，仅在鉴权通过的桌/视角切换时重建投影基线并清理选择；同一 authority 的普通过期包继续拒绝。不要直接删除生命周期保护。补齐真实 router → manager 的跨桌测试。

## CS-01-002 · P3 · 跨恢复生命周期重复记录同一结算

定位：`work/guandan-cocos/assets/scripts/game/NetworkMatchSnapshotController.ts:88`（88–95 行；Set 在 21 行初始化、25–26 行清空）。

触发：已经记录一局结算后重启应用，再恢复仍停留在这一结算的房间；或异常恢复清理调用 `GameManager.abortRound()` 后重新恢复该房间。

控制器的已记录回合集合没有持久化，但 `GameSession.ts:65–76,79–90` 的本地统计会持久化。恢复结算时 `LobbyMessageRouter.ts:143–145` 重新发出 `round-ended`，新控制器认为该回合尚未记录，`GameManager.ts:55–61` 再次累加。普通同实例重复包去重测试不能覆盖这一断点。

影响已限定为本地持久化 `gamesPlayed / wins / bombsPlayed / firstPlaceFinishes / elo` 和 `recentMatch.finishedAt`。根线程全仓引用复核没有找到当前业务 UI 读取本地统计的入口；个人资料实际使用 `profileGateways` 后台数据。因此列为 P3 本地数据一致性问题，不声称用户可见账号计数、服务端计分、平台个人中心或排行榜受影响。

建议：将稳定对局/桌/回合身份与统计一起持久化入账，或使用服务端统计；恢复只展示既有结算，不重复入账。将展示状态的 reset 与统计去重账本分离。不要只使用可能复用的房间号作为永久身份。

## 已执行验证

以下 6 个既有测试文件均退出 0：

- `tests/local-match-controller-regression.cjs`
- `tests/round-view-boundary-regression.cjs`
- `tests/selection-regression.cjs`（未请求 web build）
- `tests/network-round-state-regression.cjs`
- `tests/table-hand-interaction-controller-regression.cjs`
- `tests/friend-room-observer-regression.cjs`

测试通过不否定上述问题：现有 observer 回归只验证 router 层发出恢复包，没有继续让 GameManagerProjection 消费；现有结算重复测试只验证同控制器生命周期。

### CS-01-001 与 reset 重复记录的无网络复现

在仓库根目录执行以下 Node stdin 脚本。仅导入真实业务模块并在进程内组装端口，不创建文件、不启动服务、不访问外部账户。服务端 `duplicateAction/duplicateSnapshot` 和客户端 router/projection/controller 均为真实实现；`core.transition` 生成合法结算结果。

```sh
node <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('./work/guandan-cocos/tests/support/typescript.cjs').loadTypeScript();
require.extensions['.ts'] = (module, file) => module._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, file);
const base = path.resolve('work/guandan-cocos/assets/scripts');
const core = require(path.join(base, 'core/generated/index.ts'));
const { NetworkMatchSnapshotController } = require(path.join(base, 'game/NetworkMatchSnapshotController.ts'));
const { createGameManagerProjection, projectAuthoritativeState } = require(path.join(base, 'game/GameManagerProjection.ts'));
const { LobbyMessageRouter } = require(path.join(base, 'network/LobbyMessageRouter.ts'));
const { createLobbySnapshot } = require(path.join(base, 'network/LobbyModels.ts'));
(async () => {
  const { duplicateSnapshot } = await import('./work/guandan-windows-source/server/duplicate-room-projection.js');
  const { duplicateAction } = await import('./work/guandan-windows-source/server/duplicate-room-actions.js');
  const card = (id, value) => ({ id, rank: value, value, suit: 'spade', isLevelCard: false, isRedJoker: false });
  const hands = { p1: [], p2: [card('p2', 8)], p3: [card('p3', 9)], p4: [card('p4', 10)] };
  const players = Object.fromEntries(Object.entries(hands).map(([id, hand]) => [id, {
    id, name: id, isAI: false, team: ['p1', 'p3'].includes(id) ? 'teamA' : 'teamB', role: 'normal', hand,
  }]));
  const playing = { ...core.createMatchState({ players, ruleProfile: core.getRuleProfile('classic'),
    currentLevel: 2, levelTeam: 'teamA', teamLevels: { teamA: 2, teamB: 2 },
    dealerId: 'p3', currentTurn: 'p3', roundId: 1, revision: 10 }), finishedPlayers: ['p1'] };
  const outcome = core.transition(playing, {
    type: 'PLAY_CARDS', playerId: 'p3', cardIds: ['p3'], expectedRevision: 10, roundId: 1,
  });
  assert.equal(outcome.ok, true);
  const settled = outcome.state;
  assert.equal(settled.phase, 'settled');
  const room = {
    roomId: '123456', hostUserId: 'u1', phase: 'playing', version: 30, completedRounds: 0,
    roundTallied: false, history: [], scores: { red: 0, blue: 0 },
    settings: { rounds: 8, turnSeconds: 60, spectator: 'live' },
    members: Array.from({ length: 8 }, (_, i) => ({ userId: 'u' + (i + 1), name: 'player' + (i + 1),
      seat: 'p' + (i + 1), connectionId: 'c' + (i + 1), ready: false })),
    tables: { A: { state: settled, deadlineAt: null }, B: { state: playing, deadlineAt: 1000 } },
  };
  const host = room.members[0];
  let snapshot = { ...createLobbySnapshot(), roomId: room.roomId, roomStatus: 'ready', myPlayerId: 'p1', roomRole: 'player' };
  let state = playing, projection = createGameManagerProjection(), human = 'p1';
  const records = [], attempts = [];
  const controller = new NetworkMatchSnapshotController({
    getState: () => state, getProjection: () => projection, getRoomId: () => room.roomId, getHumanId: () => human,
    commit: (s, p) => { state = s; projection = p; }, clearSelection() {}, cancelPendingAction() {},
    setSessionPhase() {}, recordRound: r => records.push(r), publishHint() {},
  });
  const listeners = new Map();
  const router = new LobbyMessageRouter({
    snapshot: () => snapshot,
    patch: p => { snapshot = { ...snapshot, ...p }; human = snapshot.myPlayerId; },
    listen: (t, f) => listeners.set(t, f),
    emit: (t, p) => {
      if (t === 'guandan:network-state') attempts.push({ accepted: controller.applyServerState(p.state), incomingPhase: p.state.phase });
      if (t === 'guandan:round-ended') controller.applyRoundEnded(p.result, p.state, p.viewerRoundStats,
        { roomId: p.roomId, version: p.version, gameVersion: p.gameVersion });
    },
    isRoomCleaning: () => false, handleRequestResult() {}, applyRoomEntry() {}, closeRoom() {}, reportError() {},
  });
  router.bind();
  listeners.get('roomView')(duplicateSnapshot(room, host, 0));
  assert.equal(projection.phase, 'settlement');
  duplicateAction(room, host, 'watchTable', { table: 'B' }, { now: 1, random: () => 0.5 });
  room.version++;
  const watched = duplicateSnapshot(room, host, 1);
  assert.equal(watched.roomRole, 'observer');
  assert.equal(watched.state.phase, 'playing');
  listeners.get('roomView')(watched);
  assert.equal(snapshot.duplicate.watching, 'B');
  assert.equal(projection.phase, 'settlement');
  assert.equal(attempts.at(-1).accepted, false);
  assert.equal(projectAuthoritativeState(projection, { ...playing, revision: settled.revision + 10 }, { phase: 'playing' }).accepted, false);
  console.log({ watching: snapshot.duplicate.watching, incomingPhase: watched.state.phase, displayPhase: projection.phase, attempts });
  const before = records.length;
  controller.reset(); projection = createGameManagerProjection();
  controller.applyServerState(settled);
  const identity = { roomId: room.roomId, version: 30, gameVersion: settled.revision };
  controller.applyRoundEnded(settled.settlement, settled, { bombsPlayed: 7 }, identity);
  assert.equal(records.length, before + 1);
  controller.applyRoundEnded(settled.settlement, settled, { bombsPlayed: 7 }, identity);
  assert.equal(records.length, before + 1);
  console.log({ recordsBeforeReset: before, recordsAfterRecovery: records.length });
})().catch(error => { console.error(error); process.exitCode = 1; });
NODE
```

实际输出：`watching=B, incomingPhase=playing, displayPhase=settlement`；入包接受序列为 `[true, false]`，更高 B revision 也被拒绝；`recordsBeforeReset=1, recordsAfterRecovery=2`。

### CS-01-002 的持久化边界补验

另使用真实 `GameSession` 和 `NetworkMatchSnapshotController` 执行两次应用生命周期。仅将 `cc.Component / EventTarget / sys.localStorage` 换成内存桩；两个生命周期共享同一个 storage Map，其余 restore/commit/recordRound 逻辑均为真实代码。每次执行 `onLoad → joinRoom(123456,p1) → applyServerState(settled) → applyRoundEnded(同一roundId=1)`。

实际断言结果：

```json
{
  "first": { "gamesPlayed": 1, "wins": 1, "bombsPlayed": 7, "firstPlaceFinishes": 1, "elo": 1016 },
  "second": { "gamesPlayed": 2, "wins": 2, "bombsPlayed": 14, "firstPlaceFinishes": 2, "elo": 1032 }
}
```

完整可独立执行脚本（仓库根目录）：

```sh
node <<'NODE'
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const ts = require('./work/guandan-cocos/tests/support/typescript.cjs').loadTypeScript();
require.extensions['.ts'] = (m, p) => m._compile(ts.transpileModule(fs.readFileSync(p, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
}).outputText, p);
const storage = new Map(), originalLoad = Module._load;
Module._load = function (name, parent, isMain) {
  if (name === 'cc') return {
    _decorator: { ccclass: () => Type => Type }, Component: class {}, EventTarget: class { emit() {} },
    sys: { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } },
  };
  return originalLoad.call(this, name, parent, isMain);
};
const base = path.resolve('work/guandan-cocos/assets/scripts');
const { GameSession } = require(path.join(base, 'session/GameSession.ts'));
const { NetworkMatchSnapshotController } = require(path.join(base, 'game/NetworkMatchSnapshotController.ts'));
const { createGameManagerProjection } = require(path.join(base, 'game/GameManagerProjection.ts'));
const core = require(path.join(base, 'core/generated/index.ts'));
const card = (id, value) => ({ id, rank: value, value, suit: 'spade', isLevelCard: false, isRedJoker: false });
const hands = { p1: [], p2: [card('p2', 8)], p3: [card('p3', 9)], p4: [card('p4', 10)] };
const players = Object.fromEntries(Object.entries(hands).map(([id, hand]) => [id, {
  id, name: id, isAI: false, team: ['p1', 'p3'].includes(id) ? 'teamA' : 'teamB', role: 'normal', hand,
}]));
const playing = { ...core.createMatchState({ players, ruleProfile: core.getRuleProfile('classic'),
  currentLevel: 2, levelTeam: 'teamA', teamLevels: { teamA: 2, teamB: 2 },
  dealerId: 'p3', currentTurn: 'p3', roundId: 1, revision: 10 }), finishedPlayers: ['p1'] };
const outcome = core.transition(playing, {
  type: 'PLAY_CARDS', playerId: 'p3', cardIds: ['p3'], expectedRevision: 10, roundId: 1,
});
assert.equal(outcome.ok, true);
const settled = outcome.state;
function appLifetime() {
  const session = new GameSession();
  session.onLoad(); session.joinRoom('123456', 'p1');
  let state = playing, projection = createGameManagerProjection();
  const ctrl = new NetworkMatchSnapshotController({
    getState: () => state, getProjection: () => projection,
    getRoomId: () => session.snapshot.roomId, getHumanId: () => session.snapshot.myPlayerId,
    commit: (s, p) => { state = s; projection = p; }, clearSelection() {}, cancelPendingAction() {},
    setSessionPhase: () => session.beginSettlement(), publishHint() {},
    recordRound: ({ settlement: s, wasFirst, bombCount, scores }) => session.recordRound(s.winnerTeam, wasFirst, bombCount, {
      levelUp: s.levelUp, currentLevel: s.currentLevel, teamLevels: s.teamLevels, scores,
    }, 'teamA'),
  });
  ctrl.applyServerState(settled);
  ctrl.applyRoundEnded(settled.settlement, settled, { bombsPlayed: 7 }, { roomId: '123456', version: 30, gameVersion: 11 });
  return session.snapshot.playerStats;
}
const first = appLifetime(), second = appLifetime();
assert.equal(first.gamesPlayed, 1);
assert.equal(second.gamesPlayed, 2);
assert.equal(second.bombsPlayed, 14);
assert.equal(second.elo, 1032);
console.log({ first, second, sameRoom: '123456', sameRound: 1 });
NODE
```

## 排除项与验证边界

- 请求拒绝的 ID 门禁、同步发送失败的具体提示保留、取消后的超时 generation 守卫，现有回归通过；未将缺少额外理论防御当成已确认漏洞。
- `commitProjection` 无条件取消 pending 初看可疑；结合上游 gameVersion 去重、metadata/state 分流及断线错误清理，没有证明独立正常流程会错误解锁新的在途操作，不列为发现。
- 隐藏手牌中的贡还牌 ID 转换结合服务端 `tributeForViewer` fallback 核验，未确认私密牌泄露或贡还行动人丢失。
- 选择保留仅跨同一 playing round、本人手牌集合不变且未完成/未交出回合；贡还/结算/换局会清理。相关回归通过。
- 本批没有另外将未证实候选列为问题。此结论不代表上述 8 文件或跨模块调用链不存在其他缺陷，也不替代真机和真实重连场景验收。
