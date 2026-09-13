# 结算与观战事件可靠交付审计 · report-delivery-07

2026-09-12，root；HEAD `1d58999dc6e5455b049e1643660bbba3deee1406`。本批完整审阅 **10 文件 / 1,110 行**，新增确认问题 0、concerns 0。不是整个上报/平台接收链路的健康证明。

用户在目标暂停后明确“继续”，本轮据此继续人工审计。子任务用量限制发生后未重试启动其他代理或使用重置额度；本组由根线程独立完成。只增加本批报告和隔离探针，不改产品或线上。

## 完整审阅范围

### result-reporter.js

- 文件：`work/guandan-windows-source/server/platform/result-reporter.js`
- SHA-256：`b56fe89904020317ae1cccccf30b969fe07e4ff23998ba6f8bd128c2c0dfec47`
- 完整185行。核持久stage先add再交付、同event去重、restore按finishedAt/ID启动但结果并行、精确DTO签名/回执、bounded与durable两层重试、超时和stop收尾。实际模块故障探针验证add失败不建operation、同事件复用Promise、ack后remove失败精确重试和清理。停机后stage保留durable事件再拒绝，不视为丢事件；没有把结果并行称为同场多次结算允许。

### spectator-event-reporter.js

- 文件：`work/guandan-windows-source/server/platform/spectator-event-reporter.js`
- SHA-256：`6bc8b97d3adb51fc33a8093d6c47121365739d469a98fdc1e8bff76158cccb90`
- 完整165行。核每match队列和不吞head拒绝、outbox写失败不污染队列、两层重试、恢复按match/sequence排序、精确ack、lifecycle双签名及独立claimStart契约。真实模块验证同场有序、跨场不阻塞、重启恢复、取消不删除未确认工作。同步game-start特殊路径的业务事务已在第五批审查；不重复归因SE-05-001。

### game-result-outbox-store.js

- 文件：`work/guandan-windows-source/server/platform/game-result-outbox-store.js`
- SHA-256：`7d006c26f5b9e41e2367780fe53f641059e36d765612dfa66969c595eaceb0c2`
- 完整98行。核schema/eventId/重复身份校验、JSON克隆、canonical冲突、save成功后才换内存、600/700权限和原子替换接口、ENOENT空/其他坏文件fail-fast。既有真实临时文件重启/rename失败测试通过，新增内存save故障验证add/remove和pending克隆；非多实例队列，不代表断电/共享盘实测。

### spectator-outbox-store.js

- 文件：`work/guandan-windows-source/server/platform/spectator-outbox-store.js`
- SHA-256：`ac34ba9f6594d883b1bd33d36ebb2597fb19a65415a64690f980d13ae71bac65`
- 完整95行。核safe sequence、eventId与match/sequence双唯一、逐条snapshot校验、JSON克隆、语义身份、save前后提交界限。真实临时文件回归及内存双唯一/删除失败对照通过。仅校验持久信封，业务事件完整性由上游/平台检查，不能把不验全部业务字段孤立误报。

### game-result-outbox.test.mjs

- 文件：`work/guandan-windows-source/server/platform/game-result-outbox.test.mjs`
- SHA-256：`e2708d79619031262204d584955f079939a3c261b54e0289ff06790111dbac85`
- 完整162行并运行通过。核先持久后请求、stop留存/新实例补发、重复ack删记录、abort signal/签名、canonical冲突、权限/rename失败/临时文件清理、timeout恢复、非协作fetch超时、无durable拒绝与坏JSON/version。mkdtemp新建合成目录finally清理，fetch全部替换；不验证生产回调或断电。

### spectator-outbox.test.mjs

- 文件：`work/guandan-windows-source/server/platform/spectator-outbox.test.mjs`
- SHA-256：`4b19780e8a424470dfb36e485b27c82c568b1d960d6e715471203c9fa00577e1`
- 完整129行并运行通过。核两事件队列停机保留/新实例顺序恢复、公开和生命周期签名、权限/正文幂等、rename失败及坏文件。显式config入参、fetch替换，无生产env或外部连接。只有两事件/一match既有覆盖，本批另补多match乱序恢复/阻塞隔离。

### reporter-delivery.test.mjs

- 文件：`work/guandan-windows-source/server/platform/reporter-delivery.test.mjs`
- SHA-256：`5e69205d6a80b24b929341f72734437fefdca16d50b34f2f90add3e73bf71b84`
- 完整171行并运行通过。核两reporter坏ack不删除、stage/direct跨重试DTO所有权、fetch与body中stop及迟到成功、跨场stop、inner/outer退避取消、不协作fetch超时。memoryOutbox只Map覆盖不具备生产冲突规则，因此补充探针用实际JsonStore.add/remove；未把该简化存根当生产持久一致性证明。

### report-delivery-lifetime.js

- 文件：`work/guandan-windows-source/server/platform/report-delivery-lifetime.js`
- SHA-256：`83169329e878608b72e2dcf33d65067b7f13ca0e6b5524ed38148c75b22c0d2a`
- 完整71行。核每match stopped/controller/waiter所有权、同步和异步assertActive、AbortController超时race、body等task迟到隔离、finally清timer/listener/controller、wait unref及单键stop幂等。既有中止回归和新增两键wait对照通过。没有reset已停match API属于单生命周期契约；生产stop于显式关闭，不将Map残留单独认定线上泄漏。

### report-event-contract.js

- 文件：`work/guandan-windows-source/server/platform/report-event-contract.js`
- SHA-256：`d3a42663e87d3dba37485306ffb9d6f461ab1f3a708a04afd05b323d3a81ff71`
- 完整17行。核标准JSON快照、result要求accepted===true和eventId相等、spectator另核match和sequence精确相等；多组既有坏ack与调用方变异测试通过。这是受信report DTO契约，非不可信外部输入全schema验证。

### canonical-json.js

- 文件：`work/guandan-windows-source/server/platform/canonical-json.js`
- SHA-256：`714637e30b339a5ff00f3fe0f3be31f64cd732760e61bab785ed3360197d768d`
- 完整17行。核对象递归排序、数组顺序保留、Object.fromEntries、fingerprint及旧插入序存储兼容与坏JSON返回false。真实嵌套重排/数组差异/旧fingerprint/自有__proto__对照通过。仅在JSON域讨论等价，不推断任意JS循环对象可序列化。

## 真实契约与调用链

`weapp-ws.js:189–211` 将结算和公开事件保留在房间待上报状态，340–418 行的 `stagePendingSideEffects` 对每条事件同步 stage；首次 durable 写失败会由外层安排 stage 重试。reporter 远端确认后才移除 outbox；房间快照中的待上报记录另由按房排队的 completion 清除。两层记录不是同一次文件事务，不能用单个 outbox 通过来证明全部跨服务一致性。

观战 reporter 对同一 match 串行，失败头部原地重试；不同 match 可推进。恢复会按 match/sequence 重建顺序；运行中输入按调用顺序排队，不能理解为任意乱序入参都自动重排。当前房间 producer 按 sequence 构造并依次 stage。

结算 reporter 以 eventId 去重，不是全局单队列；恢复排序决定启动顺序，不保证不同比赛结果按时间串行确认。本探针用三个独立比赛检验该并发语义，不主张允许同场任意多次结算。

`weapp-game-start-coordinator.js:211–242` 的开局 claim 是特殊有界确认：先保存 intent，再 await `claimStart`，随后才按房提交开局。它与普通 timeline 的 fire-and-forget 路径不同，不能只看 reporter 的队列注释断言 claim 的业务状态已完成。第五批 SE-05-001 的开局回滚问题不重复计为本批缺陷。

## 已实际执行的验证

以下脚本全文先核对安全边界再执行，全部 exit 0：

```sh
node work/guandan-windows-source/server/platform/game-result-outbox.test.mjs
node work/guandan-windows-source/server/platform/spectator-outbox.test.mjs
node work/guandan-windows-source/server/platform/reporter-delivery.test.mjs
node docs/audit/2026-09-12/repro/report-delivery-07.mjs
```

前两个既有测试只在 `mkdtemp` 创建的合成目录写文件，并在 finally 移除该目录；fetch 全部替换，URL 不被连接。验证新实例补发、先持久后请求、权限 0600/0700、rename 失败保留旧记录、原子临时文件清理、坏 JSON/不兼容版本拒绝。不是实际进程崩溃、断电、共享文件系统、多实例写入或生产数据恢复演练。

第三个测试验证精确回执、不合法/错身份确认不删 durable 事件、stage/direct 的 DTO 所有权、fetch/body 阶段取消与迟到成功、跨场隔离、两层退避取消和不配合 abort 的超时。其 memoryOutbox 不实现完整生产冲突校验，本批补充探针因此直接使用实际两个 JsonOutboxStore 的 add/remove，而不是把该存根当生产实现。

[补充探针](../repro/report-delivery-07.mjs) 使用真实 reporter/store/identity/lifetime 模块；**store.save 是显式内存故障端口，网络回执也为合成**：

- 两种 store：调用方与 pending 返回值均不能修改内部记录；嵌套字段重排仍幂等、正文变化拒绝；spectator 的同 match/sequence 不同 ID 拒绝。
- 两种 reporter：首次 stage 保存失败未创建 operation，恢复后可再次 stage；相同事件共享一个 Promise；冲突正文在发包前拒绝。
- 合成远端已确认但本地 remove 保存失败：事件保留，下一次发送 DTO 完全一致，匹配的重复确认后删除成功；不证明真实平台已完成两次幂等响应，只证明 reporter 的交付行为。
- 观战恢复输入故意乱序，A:1 阻塞时 B:1/B:2 完成；释放后 A:2/A:3 顺序完成，未确认 A 记录在中途全部保留。
- 三个独立比赛结算恢复按时间开始，三个 request 可并发，最终记录清空。
- 单键停止幂等且另一键的 wait 能完成；controller/waiter 归属由既有中止回归补充。
- 嵌套 canonical/旧插入顺序 fingerprint 接受，数组顺序保留，坏 JSON 返回 false；自有 `__proto__` JSON 键不改变 Object.prototype。

## 边界与后续

- 本批没有发现新增独立问题，不强行为问题数量设目标。已知 SE/SP/SD 等上层事务缺陷未因这组通过而消失。
- JsonOutboxStore 明确单进程；完整业务 schema、跨服务 eventId/sequence 语义与结算幂等仍需审阅平台接收服务/domain/HTTP。不将信封验证缺少全部业务字段孤立误报。
- 正常无限 durable 重试没有 dead-letter 或多实例队列承诺；本批没有容量/磁盘压力或持续永久拒绝的业务可达性证据，未升级为确认缺陷。
- GameResultReporter 与 SpectatorEventReporter 的取消封装有代码重复，但各自契约不同；未仅因没有共同父类而建议强制抽象。
- 辅助阅读的入口、开局协调器及 durable-file 已在旧批覆盖，不重复计数；config/crypto 只查导入和入参边界，未计完整覆盖，也未读取生产配置。
- 十文件读取后 SHA-256 与第六批 manifest 基线逐一比对一致；最终总库存、五处 dirty 保全由根线程统一再验。本报告不替代发布构建或微信真机验收。
