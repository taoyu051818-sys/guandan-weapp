# 服务端调度、原子存储与测试审计：第四批

基线 HEAD：`1d58999dc6e5455b049e1643660bbba3deee1406`；完整审阅8文件、720行，文件SHA与逐项结论见[JSON](server-scheduler-04.json)。没有改产品、测试断言、已有工作树修改或线上。

## 结论

本批没有新增确认问题。已知SP-03-001/002在调度/存储的职责边界得到进一步核实，不重复计数：期限job负责取消与代次，失败后会释放job；runtime persistence只承诺重试快照保存，不能替代业务关房或投票期限重新调度。

## 完整范围

- `weapp-operation-scheduler.js`及其测试：异房并行、同key FIFO、全局屏障、错误与drain。
- `weapp-runtime-persistence.js`和`weapp-runtime-owners.test.mjs`：脏位/去抖/错误重试、准确确认接受记录、停机边界及metadata测试。
- `weapp-room-expiry-jobs.js`和`weapp-room-expiry.test.mjs`：已排队任务仍可取消、实例/代次、投票自身失败重试。
- `durable-file.js`和`room-state-store.test.mjs`：同步/异步写入协议、权限、替换/fsync/清理、坏schema与合成重开。

以上均位于`work/guandan-windows-source/server/`。已审过的room-state-store.js、entry/gateway、weapp-ws入口片段及调用检索不重新计覆盖。

## 安全验证

```sh
node --test work/guandan-windows-source/server/weapp-operation-scheduler.test.mjs work/guandan-windows-source/server/weapp-runtime-owners.test.mjs work/guandan-windows-source/server/weapp-room-expiry.test.mjs work/guandan-windows-source/server/room-state-store.test.mjs
node docs/audit/2026-09-12/repro/scheduler-persistence-04.mjs
```

- 4个测试文件全部通过；runtime-owners内部还import expiry测试，因此不把重复执行统计为新增独立覆盖。
- 确定seed的120项任务含7次预期异常，验证异key并行不违反同key FIFO/全局排他；失败不阻断后续任务，drain后pending=0。
- 10组同步/异步操作顺序测试覆盖正常与ensure/write/rename/directory-sync失败；确认清理仅针对生成临时路径，不误删目标。所有文件API都注入内存fixture，`/synthetic-audit-only/`从未被创建/访问。
- 准确接受记录探针在首写未完成时替换同key对象、加入新token别名；旧快照不确认新对象或别名，后续完整快照再确认，存储timer清零。
- 既有真实文件测试预先审查仅在mkdtemp目录写合成快照；未读取真实备份或凭证，未启动服务器。

这些验证不承诺机器断电语义、跨进程锁或全部业务事务一致性。当前存储明确是单进程原子快照，不应视为水平扩容的共享锁。

## Q-04-C01：保留的入队身份边界（非确认问题）

`weapp-operation-scheduler.js:6`按入队时的connection.roomId选key；`weapp-ws.js:673`在排队前调用，但task执行时才读取当前连接归属。

设同一连接仍在A时，快速排入leave A、join B（global）、B的后续命令；后者可能捕获旧A队列。global屏障保证它等join完成，却不自动把队列键改为B。届时另一个B连接的key是B，理论上跨key可同时等待。

本批探针**只验证key捕获前后不同及稳定key调度契约**；没有证明真实游戏handler错乱。真实入口还有成员授权、票据、防冲突、期望版本、pending持久化/开局等防线，正常客户端也可能不会发送该时序。为避免虚报，不列P2/P3或称漏洞。后续完整入口/connection代次审计需要决定：该时序能否进入，以及是否产生实际状态/发布影响。

## 测试缺口而非新缺陷

已有投票超时测试刻意保存同一个vote引用，覆盖的是超时操作自身回滚，不能代替整房间structuredClone回滚；既有关房测试将close函数存根成事件记录，不能验证两阶段关闭完成。相关影响已经在第三批用真实业务模块复现并编号，不因本批再次审到测试缺口增加缺陷数。
