# 第十三批：运行赛制、机器人适配与出牌计时

基线 HEAD：`1d58999dc6e5455b049e1643660bbba3deee1406`。根线程完整读完 11 文件、1,302 行，逐文件 SHA-256 与审阅笔记见 [JSON](runtime-policy-13.json)。只写审计目录，不修改产品。

## 范围与结论

本批覆盖 game-session 及两份测试、master-bot-policy 及测试、bot-turn-pacing 及测试、match-format-policy、friend-room-settings 及测试、weapp-turn-clock。

现有五个测试入口均通过。补充检查确认公共单局/不洗牌/升级/赛事的初始化语义一致，计时计算不重复叠加耗时、恢复不重抽已保存决策，其他人手牌仍仅暴露数量。但是新增确认 1 个 P2，不能以现有测试全绿宣称转蛋自动出牌可用。

## RP-13-001 · P2：合法换队被机器人固定队伍校验判错

定位：`work/guandan-windows-source/server/master-bot-policy.js:23-26`；同文件 9 行固定映射、43 行调用、54 行传入队伍。

转蛋身份与物理席位是两件事。共享规则 `shared-core/src/lib/variantRules.ts:27-50` 保持 p1..p4 认证身份，只调整 turnOrder 和 players[id].team。但服务端适配器仍要求 p1/p3 永远属于 teamA，p2/p4 永远属于 teamB。

触发链：

1. `match-format-policy.js:18-33` 真实发牌、选择抽牌并调用 arrangeRotatingRound；或者首局结束后 `weapp-match-lifecycle.js:394-407` 真实准备下一局，执行顺时针轮换。
2. 合法状态的 turnOrder 与 team 已一致更新，例如随机开局 seed=1 是 [p1,p2,p4,p3]，p3 为 teamB、p4 为 teamA；顺时针第二局是 [p3,p2,p4,p1]。
3. `weapp-match-lifecycle.js:329` 的机器人和托管共同调用 prepareBotPlay → chooseCards，尚未进入策略 engine 就抛出“队伍数据无效”。
4. 同模块 371-375 行回滚并重试；默认最多三次（23 行）后调用 83-86 行 closeRoomWithoutAck，原因 automated-deadline-failed，外部语义为 roomDissolved/dissolved。改变 seed 或保存恢复不能修复固定校验。

实际影响：这类转蛋局轮到机器人或已托管玩家自动出牌时失败并进入关房分支。不是“机器人策略偶尔选择不佳”，也不是赛制数据真的损坏。真人继续手动出牌没有经过此适配器，不能一起判为失败；普通固定队伍、顺时针首局对照正常。

验证：运行 [隔离探针](../repro/runtime-policy-13.mjs)。52 个固定随机发牌 seed 中 22 桌改变队伍，逐桌四席共 88 次适配器调用均拒绝。这个计数仅是固定探针，不是线上发生率。随机换队/顺时针第二局 × 机器人/手动托管 × 原状态/JSON后canonical恢复共 8 案，均没有 revision 推进，连续记录三次错误并调用关房端口。4 个正常组对照使用真实决策与 transition 完成首手且无错误。

顺时针测试以人工合法结算 fixture 作为下一局输入，之后使用真实生命周期发牌与换队；不是完整打完前一副牌。计时、持久化、发布和关房端口为内存替身，捕获关房请求，不冒充微信端掉线截图或线上事故。

建议：统一由权威 turnOrder / 当前 players.team 推导和验证队伍，验证四人排列、一队两人及对家同队后，将当前玩家 team 传给 AI。保留不一致状态拒绝和身份绑定，不以直接删掉校验解决。补齐抽牌实际换队、顺时针第二/三局、机器人/托管及恢复后的自动出牌回归。

## 补充验证

命令：`node docs/audit/2026-09-12/repro/runtime-policy-13.mjs`，exit 0。

- 182 开局：13 级 × quick、12 个底分队列、16人赛，108 张唯一牌/每席27张、队伍与turnOrder一致、单局与过A/贡还/不洗牌/个人排名语义。
- 240 好友房组合：4赛制 × 2发牌方式 × 6局数 × 5出牌时限，严格规范化幂等和终局局数门禁。
- 48 时延组合：8计算耗时 × 2普通/稀有延长 × 3截止预算；同时推进计算与权威时钟，确认耗时只计一次、deadline截断和JSON计划不重抽；每个cost的100格random中10格延长。
- 48 clock组合：公共/好友 × 真人/机器人/托管 × 允许/禁止自动托管 × 4种出牌/贡还动作，公开时限保留、私有唤醒、恢复及结束清理。
- 12 小手牌（4席 × 1/5/10张）零隐藏牌访问、同seed同决策、真实首手transition合法和输入不变对照。不是27张全局胜率或手机性能测试。
- 上述转蛋 8 失败路径与 4 正常路径交叉对照。

既有测试入口均为 `node work/guandan-windows-source/server/<name>`：game-session.test.mjs、game-session-projection.test.mjs、master-bot-policy.test.mjs、bot-turn-pacing.test.mjs、friend-room-settings.test.mjs。源文件已读完且安全检查后执行；全部仅合成内存，不访问网络或真实用户。

## 测试与边界说明

master-bot-policy 既有“错误队伍”用例只修改一个 team 字段，正确验证损坏状态拒绝，但没有同步改变 turnOrder 来构造合法轮换。friend-room-settings 的转蛋用例只比格式，不调用机器人。两者都绿并不意味着跨模块契约一致。

legacy 恢复的格式/缺失currentTurn、clock 中 Number(null) 仅是损坏输入观察，未找到当前合法生产者，未另列问题。game-session-projection 正式源、variantRules、matchFormat、weapp-ws、生命周期及恢复模块为调用链辅助核对，不重复加覆盖。未重建Cocos、未改提示策略、未执行服务器入口。

