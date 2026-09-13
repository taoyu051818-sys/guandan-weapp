# 客户端连接与请求代际第三批审计

基线：`1d58999dc6e5455b049e1643660bbba3deee1406`，2026-09-12。已重读审计 README，保留启动时五处工作树修改。完整逐行审阅指定 **5 文件、847 行**，新增确认发现 **0**，新增 concern **0**。逐文件 SHA-256 与结论见同名 JSON。

只写本批两个报告，不改业务代码或测试断言，不提交、部署，不更新全库清单。辅助读取的匹配协调器、微信网络策略、平台票据投影和测试文件仅用于交叉核验，不计入本批完整覆盖。

## 覆盖及结果

| 文件 | 行数 | 核验重点 |
| --- | ---: | --- |
| `LobbyController.ts` | 494 | 组件生命周期、手工/平台入桌、请求代际、迟到成功清理、冷热恢复、退出/销毁 |
| `LobbySocketClient.ts` | 18 | transport消费者契约与结果结构 |
| `CocosSocketClient.ts` | 194 | 连接替换、Promise复用、旧回调失效、消息派发、请求ID、退避取消 |
| `LobbyEntryRequest.ts` | 30 | 完整预期请求匹配、合法好友房视角重排、固定重试wire身份 |
| `LobbyEntryAttempt.ts` | 111 | 128位随机ID、微信回调超时/迟到、matched重试与manual新身份 |

主要核验结论：

- 成功入桌需匹配请求generation、requestId、response type、roomId和当前status；合法好友房座位重排由明确的friend/roomRole分支适配。重复已接受同room/seat/token成功不会触发误离桌清理。
- `LobbyEntryRequest` 固定重试的JSON body和wire requestId，`LobbyEntryAttemptTracker` 固定matched逻辑身份；重试不能偷偷换内容，成功/放弃时清除旧身份。现有回归还串联真实服务器票据处理器验证丢失成功回复后仅消费一次票据。
- 微信native安全随机数使用16字节、合法ArrayBuffer和5秒超时；完成guard让失败、成功、超时只结算一次，迟到回调不恢复已超时请求。未发现退回Math.random生成安全凭证的分支。
- `LobbyController.onDestroy` 先解绑socket监听器，再清匹配/恢复调度代际和请求状态、关闭连接；成功入桌和清房会清恢复watchdog；销毁保留持久恢复身份，主动清房删除身份。
- 复式平台的p5-p8入口不是直接传入此处p1-p4校验：`server/platform/friend-room-service.js:224` 已将响应seat映射为本地p1-p4，签名票据仍持有真实全局seat。因此没有把这个适配后路径报告为拒绝八人入桌缺陷。
- 首批CS-01-001及CS-01-002只保留原报告，不重复计数。

## 既有 CN-02-C01 的复核结果

第二批人工把同视角 `roomView(v10)` 后接 `roomView(v9)` 送到router，证明强制恢复分支可以输出较旧包；当时未证明真实触发条件。

本批从真实transport核验了可能的跨连接迟到解释：`CocosSocketClient.ts:76` 的message回调同时比较socket对象和connectionGeneration；替换/关闭连接在177–186行使两者失效。open/error/close同样有对应门禁。139–165行解析及派发是同步的，不引入异步队列来交换当前连接的消息顺序。

使用真实CocosSocketClient和可控内存WebSocket的实验确认：旧连接message/open/close/error均无副作用，当前连接v10→v11按原顺序派发。因此**客户端旧连接回调解释已被排除，CN-02-C01仍未升级为产品缺陷**。服务端若在同一连接上主动晚发旧视角快照，仍需该发布链进一步核验；不把此次局部排除当成已完成服务器链路审计，不新增重复concern。

### 可复制的隔离 transport 实验

在仓库根目录执行，无网络连接、无磁盘写入。假socket仅代替浏览器WebSocket和timer；所有connectionGeneration、Promise、receive/send及重连逻辑都是被审真实代码。

```sh
node <<'NODE'
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const ts = require('./work/guandan-cocos/tests/support/typescript.cjs').loadTypeScript();
require.extensions['.ts'] = (m, p) => m._compile(ts.transpileModule(fs.readFileSync(p, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, p);
const base = path.resolve('work/guandan-cocos/assets/scripts/network');
const { CocosSocketClient } = require(path.join(base, 'CocosSocketClient.ts'));
const original = { WebSocket: globalThis.WebSocket, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
const sockets = [], timers = new Map();
let timerId = 0;
class FakeSocket {
  static OPEN = 1;
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
  send(raw) { this.sent.push(raw); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  message(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
}
globalThis.WebSocket = FakeSocket;
globalThis.setTimeout = (f, d) => { const id = ++timerId; timers.set(id, { f, d }); return id; };
globalThis.clearTimeout = id => timers.delete(id);
(async () => {
  try {
    const c = new CocosSocketClient(), received = [], connections = [];
    c.on('roomView', x => received.push(x.version));
    c.on('connected', () => connections.push('open'));
    c.on('disconnected', () => connections.push('close'));
    const a = c.connect('wss://a.example/weapp');
    const rejectedA = a.catch(e => e.message);
    assert.equal(c.connect('wss://a.example/weapp'), a);
    const old = sockets[0];
    const b = c.connect('wss://b.example/weapp');
    assert.equal(await rejectedA, '连接地址已切换');
    const current = sockets[1]; current.open(); await b;
    old.message({ type: 'roomView', version: 9 });
    old.onclose(); old.onerror(); old.onopen();
    assert.deepEqual(received, []);
    assert.deepEqual(connections, ['open']);
    assert.equal(timers.size, 0);
    current.message({ type: 'roomView', version: 10 });
    current.message({ type: 'roomView', version: 11 });
    assert.deepEqual(received, [10, 11]);
    const id = c.send('play', { cardIds: ['synthetic'] });
    assert.equal(c.send('play', { cardIds: ['synthetic'] }, id), id);
    assert.equal(c.send('pass'), id + 1);
    assert.throws(() => c.send('pass', {}, id + 100), /重试请求编号/);
    current.onclose();
    assert.deepEqual(connections, ['open', 'close']);
    assert.equal([...timers.values()][0].d, 500);
    c.close(); assert.equal(timers.size, 0);
    current.message({ type: 'roomView', version: 12 });
    assert.deepEqual(received, [10, 11]);
    console.log({ oldConnectionRoomViewDropped: true, oldOpenCloseErrorInert: true,
      currentConnectionOrder: received, closeCancelsReconnect: true, requestRetryIdentity: true });
  } finally { Object.assign(globalThis, original); }
})().catch(error => { console.error(error); process.exitCode = 1; });
NODE
```

实际结果：全部断言通过，旧roomView被丢弃，当前顺序为 `[10,11]`，关闭后的重连timer为0。

## 其他已执行验证

以下4个本地回归均退出0；预先核对fake socket、内存存储和stub transport边界，未访问真实服务：

```sh
cd work/guandan-cocos
node tests/lobby-entry-regression.cjs
node tests/lobby-network-owners-regression.cjs
node tests/wechat-runtime-compatibility-regression.cjs
node tests/friend-room-platform-flow-regression.cjs
```

额外无网络进程内断言：固定16字节编码得到 `AAECAwQFBgcICQoLDA0ODw`；matched attempt重试ID不变，变更ID/请求body被拒，clear后允许新身份；native回调的成功、失败、15字节错误、5秒超时、超时后迟到成功均只结算一次且清timer。所有断言通过。

未声称这些结果证明真机WebSocket适配、休眠唤醒、实际服务端发布顺序或异常存储环境全部安全；没有为了数量将仅可人工构造而未找到真实路径的情况列为新增确认发现。
