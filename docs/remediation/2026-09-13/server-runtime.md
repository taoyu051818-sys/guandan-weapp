# 服务端运行时整改（2026-09-13）

范围：11项已确认问题；本轮仅修改与本地测试，无提交、部署、线上服务访问。审计原件及原有5处dirty文件未改动。以下文件均位于 `work/guandan-windows-source/server/`，除非另有说明。

| ID | 业务改动 | 原生回归 |
| --- | --- | --- |
| RP-13-001 | `master-bot-policy.js` 依据当前turnOrder验证四人排列、对家同队和两队各两人，传入当前真实team；仍拒绝损坏映射 | `rotating-automatic-rounds.test.mjs`：draw/clockwise × bot/真人托管，每组真实完整3局，中途JSON及AI checkpoint恢复，共1020次合法动作；原master策略隐私和坏队伍测试保持通过 |
| SL-02-001 | `weapp-match-lifecycle.js` 在离线准备与底层发牌共同阻止终场/未收尾状态；离线仅记准备，收尾完成后统一推进；推进保存失败恢复结算并独立重试 | `weapp-offline-round-finalization.test.mjs`：四真人终场不发牌、收尾一次失败保留结算、恢复后只推进一次；完整转蛋自动局覆盖连续收尾 |
| SL-02-002 | `friend-room-observer-runtime.js` 恢复坐席时先恢复offline投票，保存成功后发布 | `friend-room-observer-rejoin.test.mjs`：5种开放观战模式 × token/恢复票据共10组 |
| SP-03-001 | `weapp-room-expiry.js` 为投票赋稳定UUID，跨回滚按ID/期限识别，关闭中的房间不再清票 | `weapp-dissolve-rollback.test.mjs`：真实自动动作异常导致整房clone回滚后原计时器仍清票；原expiry测试继续覆盖替换/取消/同房号新对象 |
| SP-03-002 | 新 `weapp-room-close-coordinator.js` 独立拥有两阶段关闭事务和有房间实例校验的重试；`weapp-ws.js`/game handler共用它，两个保存点失败均续接业务；最终投票回执保留，关闭尚未完成时gateway不提前重放成功 | `weapp-room-close-coordinator.test.mjs`：host/empty/四真人最后一票/一人三bot × 正常/第一保存失败/第二保存失败共12组，另有同房号替换保护；真实bot WS smoke覆盖接线及关闭重放 |
| SE-05-001 | `weapp-game-start-coordinator.js` 只回滚本次持有且仍相同的接受记录，不替换全局Map | `weapp-game-start-concurrency.test.mjs`：真实scheduler/gateway/router/persistence跨房并发，A第3次保存失败后B回执仍存在，B取消准备后同ID不会再次准备 |
| SD-04-001 | `duplicate-room-runtime.js` 将物理断连事实先反映到当前成员（不可随保存失败回滚），以旧connection ID匹配保护后续新连接 | `duplicate-disconnect-recovery.test.mjs`：保存恢复后token/签名票可重入，真正双在线拒绝，迟到旧断连不清新连接 |
| SD-04-002 | 复式closed提交后只清理仍属于该房的在线连接归属与view缓存再通知 | `duplicate-close-connections.test.mjs`：guest同一连接首次新建房成功，旧房动作拒绝，普通房路由不再被旧归属劫持 |
| SD-04-003 | 复式活动额度仅计非closed/ended房，保留关闭墓碑 | `duplicate-room-capacity.test.mjs`：1条真实关闭墓碑+64活动房允许，第65活动房拒绝，旧票仍不能重建 |
| SA-01-001 | `friend-room-observer-buffer.js` 按state.roundId采样及资格判断，当前局结算与开始下一局区分 | 更新 `friend-room-observer.test.mjs` 从生产roundSequence=0开始：首局无画面，首局结算仍不放行，第二局拿首局完整结算快照；其他手牌/贡还/延时投影对照保持 |
| TEST-32-001 | `weapp-security.smoke.mjs` 不继承调用者环境，自建临时state/outbox、随机回环端口，等待子进程退出后清理 | `weapp-security-isolation.test.mjs` 向调用者state/outbox及callback字段注入合成哨兵；安全smoke全通过且文件SHA-256不变 |

## 测试结果

仓库根执行，统一以 `env -i PATH=/opt/homebrew/bin:/usr/bin:/bin /opt/homebrew/bin/node --test` 启动下列18入口：18 pass / 0 fail，约7.3秒。

```text
work/guandan-windows-source/server/master-bot-policy.test.mjs
work/guandan-windows-source/server/weapp-match-lifecycle.test.mjs
work/guandan-windows-source/server/weapp-room-expiry.test.mjs
work/guandan-windows-source/server/weapp-game-start-coordinator.test.mjs
work/guandan-windows-source/server/friend-room-observer.test.mjs
work/guandan-windows-source/server/duplicate-room-runtime.test.mjs
work/guandan-windows-source/server/weapp-command-gateway.test.mjs
work/guandan-windows-source/server/weapp-runtime-owners.test.mjs
work/guandan-windows-source/server/weapp-room-close-coordinator.test.mjs
work/guandan-windows-source/server/weapp-game-start-concurrency.test.mjs
work/guandan-windows-source/server/duplicate-disconnect-recovery.test.mjs
work/guandan-windows-source/server/duplicate-close-connections.test.mjs
work/guandan-windows-source/server/duplicate-room-capacity.test.mjs
work/guandan-windows-source/server/weapp-offline-round-finalization.test.mjs
work/guandan-windows-source/server/friend-room-observer-rejoin.test.mjs
work/guandan-windows-source/server/weapp-dissolve-rollback.test.mjs
work/guandan-windows-source/server/rotating-automatic-rounds.test.mjs
work/guandan-windows-source/server/weapp-security-isolation.test.mjs
```

在 `work/guandan-windows-source` 内另执行以下真实回环WS冒烟，均exit 0：

```sh
env -i PATH=/opt/homebrew/bin:/usr/bin:/bin WEAPP_HOST=127.0.0.1 /opt/homebrew/bin/node server/weapp-bots.smoke.mjs
env -i PATH=/opt/homebrew/bin:/usr/bin:/bin WEAPP_HOST=127.0.0.1 /opt/homebrew/bin/node server/weapp-friend-observer.smoke.mjs
```

bot smoke固定端口39107启动前确认未被占用，自建临时state；观战smoke使用随机端口及自建回环collector/临时state/outbox。关闭成功后同ID重放改为回放持久接受记录，而不是原来的清记录后报不存在，因此同步更新了bot smoke这一断言。未运行可选浏览器分支。

`git diff --check` 通过。新增推进逻辑收紧后，`weapp-match-lifecycle.js` 保持原480行预算内；干净环境 `npm run check:server` exit0（87个生产文件、37条大小预算）。未重建shared-core，测试使用服务端已有dist；主任务其他改动的源码/交付构建验证另记。故障均为本地合成单次保存失败，不声称进行了真实磁盘破坏或生产故障演练。上述11项无未完成的代码项；真机断连/人工验收和最终交付构建仍由主任务统一收束。
