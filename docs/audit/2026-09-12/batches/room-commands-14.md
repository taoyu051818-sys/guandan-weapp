# 第十四批：成员、机器人入席与牌局指令

基线 HEAD `1d58999dc6e5455b049e1643660bbba3deee1406`。完整阅读 13 文件 / 1,241 行；SHA与逐文件结论见 [JSON](room-commands-14.json)。仅审计，不修改产品。

## 审阅范围

friend-room-bots、friend-room-members、weapp-game-command-handler 三个生产模块，以及 observer、gateway、router、command-recovery、entry-handler、accepted-store、action-executor、publisher、runtime-recovery、match-lifecycle 十个测试文件。九个测试入口执行通过（gateway 导入 command-recovery，lifecycle 另导入上一批已审 pacing）。

成员按 userId 保持身份，不随p1位置转移房主。120个模式/换座排列验证令牌和玩家绑定随成员移动；1800个被占位/无效位/开局后拒绝不改变房间。100轮通过真实lobby handler站起房主增删机器人，身份唯一、不增加resumeToken，非房主操作和坐进机器人位置被拒绝。64个已有closing/pendingFinalization/pendingStart/matchEnded × 16游戏命令门禁组合均在分发前停止。

## 已有 SP-03-002 的影响扩展：全员同意解散也可卡在关闭中

不新建或重复计算问题。此前确认的是“空房/房主过期关房，两阶段保存失败只恢复存储，不恢复关闭业务”。本批发现另一份关闭实现也有相同遗漏：

- `weapp-game-command-handler.js:27-39` 的 closeApprovedVote 先写 closingReason 和事件并提交，删除 Map 中房间后再提交。
- 第一提交失败时没有创建 accepted receipt、completion 或完整关闭重试。
- 第二提交失败时恢复房间、主动删除刚建回执及connection alias，只调用 persistRuntimeState。
- `weapp-command-gateway.js:64` 让同requestId重试和新动作均返回 ROOM_CLOSING。底层 persistence 恢复保存不会补发成功、删除房间或finalize。
- 四真人旧投票到期时，真实expiry只清掉vote，closingReason仍在；一真人+三机器人一致同意路径则根本不安排投票到期。

[隔离探针](../repro/room-commands-14.mjs) 运行真实 handler、gateway、router、runtime persistence 与 expiry：

| 全员同意来源 | 故障点 | 恢复后的结果 |
| --- | --- | --- |
| 一真人＋三机器人发起 | 第一次保存 | 保存恢复后仍留房，3次原请求均 ROOM_CLOSING |
| 一真人＋三机器人发起 | 第二次保存 | 回滚room但删回执，之后同上 |
| 四真人最后一票 | 第一次保存 | 同上，原投票expiry清vote后也不能完成关闭 |
| 四真人最后一票 | 第二次保存 | 同上，无finalize/无剩余保存或投票任务 |

两种无故障对照正常接受并finalize。合成房间为已结算且无总时限，排除后续出牌/总时长任务意外触发关闭；真实在线服务、磁盘故障和外部副作用均未运行。仍可能由重启或其他关闭路径恢复，不称永久不可恢复。

整改应将投票关闭和超时关闭纳入同一有完成状态的可重试事务，使用明确房间身份/代次；两个持久阶段任一步失败都续接业务完成，不能只修一个函数或仅重试保存。退出接口已有专用completion，但不能据其回归通过推定投票解散也具备它。

## 验证证据

- `node docs/audit/2026-09-12/repro/room-commands-14.mjs`：exit 0，120排列、1800拒绝对照、100机器人周期、64指令门禁、4故障关闭与2正常关闭。
- 九个现有测试入口 exit 0，完整命令见JSON。没有真实服务或外部网络；readFileSync读取weapp-ws源码的断言不执行服务器入口。
- 原 friend-room-observer.test 的 delayed-round fixture使用“当前局号”而实际生产字段是“已完成局数”；这正是先前SA-01-001未被既有测试捕获的边界，因此本批绿灯不撤销原问题。
- action-executor/lifecycle 的部分dispatch和结算是存根，仅验证协调/顺序；只有明确调用真实core的下一局和其他批次规则探针可支持对应规则结论。

本批没有新的独立问题编号，累计仍23项。辅助阅读的publisher、gateway、runtime/expiry、lobby handler此前已审，不重复加覆盖。本轮未修改测试断言、未修复业务、未构建或部署。

