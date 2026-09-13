# 客户端网络状态第二批审计

审计基线：`1d58999dc6e5455b049e1643660bbba3deee1406`，2026-09-12。已重读本审计目录 README，并保留既有五处工作树修改。

完整逐行审阅指定 5 个文件，共 465 行；逐文件 SHA-256 与说明见同名 JSON。新增确认发现 **0**，独立待验证边界 **1**。首批 `CS-01-001` 的复式换桌 authority 问题只交叉引用，不重复计数。

仅写本批 Markdown/JSON。没有修改业务代码、持久用户数据、测试断言，没有提交、部署或启动外部服务。辅助调用链文件不计入完整审查数量；库存/覆盖汇总由根线程统一刷新。

## 审查要点及结论

| 文件 | 完整行数 | 核验重点 |
| --- | ---: | --- |
| `LobbyMessageRouter.ts` | 207 | live消息当前房间、ready及清理状态门禁；metadata/状态版本顺序；贡还、结算和恢复事件分流 |
| `LobbySyncTracker.ts` | 100 | 两层版本去重、effect cursor、生命周期事件去重和reset |
| `FriendRoomViewReceiver.ts` | 28 | 角色/视角白名单、复式桌切换、等待结束恢复及metadata字段 |
| `LobbyResumeSession.ts` | 81 | 存储白名单、WS端点、身份字段、损坏/异常记录清理和冷恢复接线 |
| `LobbyResumeConnectionWatchdog.ts` | 49 | 30秒期限、6次失败、generation失效、成功/退出/销毁取消和一次通知 |

补充检查：

- `LobbyController.ts` 的成功入桌、清房、销毁均清理 watchdog；恢复凭证只在成功入桌后保存，销毁保留冷恢复身份，主动清房删除身份。
- 冷恢复保存的本地 seat 可能不同于后续好友房视角，初看会与请求预期座位冲突；但 `LobbyEntryRequest.ts:10` 对有 `roomRole` 的好友房响应明确允许合法座位/视角变化。该候选已排除，未报告为问题。
- `NetworkEndpoint` 拒绝带用户密码、空白或歧义端点；恢复存储只接受 `ws/wss`，不保留任意附加字段或一次性 gameTicket。未读取真实恢复凭证。
- `LobbySyncTracker.processedRoomEvents` 在房间生命周期内保留去重键，清房时 reset；没有证明正常房间生命周期导致实质内存问题，不将缺少固定容量本身列为漏洞。
- 跨复式桌的独立 revision/phase 不属于普通同authority过期包；只引用已确认的 `CS-01-001`，本批不再列同根因发现。

## 验证记录

已先核对以下测试只使用 fake socket、内存存储和本地编译器，然后并行运行；全部退出 0：

```sh
cd work/guandan-cocos
node tests/lobby-network-owners-regression.cjs
node tests/network-round-state-regression.cjs
node tests/lobby-entry-regression.cjs
node tests/friend-room-observer-regression.cjs
```

另执行无网络、无文件写入的进程内断言，导入真实 3 个被审模块：

- watchdog：闲置失败不计数；clear后的旧定时器无效；新周期不被上一周期定时器取消；前5次失败不耗尽，第6次恰好通知一次；之后旧timeout不重复通知；新周期30秒超时恰好通知一次。
- resume store：合法结构往返；version错误、非WS端点、端点含用户密码、非法房间号、非法本地seat、短token、空matchId共7种字段错误；损坏JSON、数组、null共3种形状；get/set/remove均抛错时不外抛且restore/save安全失败。仅使用人工 `synthetic-token`，无真实秘密。
- sync tracker：同类型同version去重、同version不同类型允许、旧metadata拒绝；重复及更旧gameVersion拒绝；新gameVersion允许；同房同version回合事件只处理一次；reset之后新房间低版本可重新建立基线。

这些断言及既有回归通过不构成真实设备休眠、移动网络乱序、存储系统崩溃或整个调用链无缺陷的证明。

## CN-02-C01 · 待验证，不计确认发现

位置：`LobbyMessageRouter.ts:136`，以及 `FriendRoomViewReceiver.ts:26`。

`roomView` 都被当作 `reconnect` 强制恢复。`applyEntryMetadata` 虽会拒绝旧metadata，但没有把失败返回给调用者，后续 `statePacket(..., recoveryReason)` 仍可输出旧状态；角色/视角在 133 行已先 patch。服务器提供的 `viewRevision` 未作为独立新鲜度门禁。

人工依次注入同房同视角的 v10、v9 时，上游发出的状态 `gameVersion` 为 `[10,9]`，metadata仍保留10。下面是可复制的纯内存边界实验：

```sh
node <<'NODE'
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const ts = require('./work/guandan-cocos/tests/support/typescript.cjs').loadTypeScript();
require.extensions['.ts'] = (m, p) => m._compile(ts.transpileModule(fs.readFileSync(p, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, p);
const root = path.resolve('work/guandan-cocos/assets/scripts/network');
const { LobbyMessageRouter } = require(path.join(root, 'LobbyMessageRouter.ts'));
const { createLobbySnapshot } = require(path.join(root, 'LobbyModels.ts'));
let snapshot = { ...createLobbySnapshot(), roomId: '123456', roomStatus: 'ready', roomRole: 'observer', myPlayerId: 'p1' };
const listeners = new Map(), states = [];
const router = new LobbyMessageRouter({
  snapshot: () => snapshot, patch: p => { snapshot = { ...snapshot, ...p }; },
  listen: (t, f) => listeners.set(t, f),
  emit: (t, p) => { if (t === 'guandan:network-state') states.push(p); },
  isRoomCleaning: () => false, handleRequestResult() {}, applyRoomEntry() {}, closeRoom() {}, reportError() {},
});
router.bind();
const packet = n => ({ roomId: '123456', myPlayerId: 'p1', roomRole: 'observer', entryKind: 'friend',
  phase: 'playing', version: n, gameVersion: n, viewRevision: n,
  state: { playArea: [], phase: 'playing', roundId: 1, revision: n } });
listeners.get('roomView')(packet(10));
listeners.get('roomView')(packet(9));
assert.deepEqual(states.map(p => p.gameVersion), [10, 9]);
assert.equal(snapshot.gameVersion, 10);
console.log({ artificialOnly: true, emittedGameVersions: states.map(p => p.gameVersion), metadataGameVersion: snapshot.gameVersion });
NODE
```

此实验**仅证明人工输入边界**。当前尚未找到有序 WebSocket 与服务端发布链实际产生同视角乱序旧 `roomView` 的触发条件，也没有证明用户可见回退；下游 canonical GameManagerProjection 还有 revision 门禁。因此不列为已确认产品缺陷。

后续在网络 transport 与服务器 observer 发布全量审查时核验跨连接generation及晚到同视角发布。如果出现真实路径，应以 authority + 独立 viewRevision 判断恢复包新鲜度；不能简单禁止所有低gameVersion恢复，否则会误伤合法跨桌和延迟观战。
