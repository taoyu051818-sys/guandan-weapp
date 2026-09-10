# 发布候选版交付与运行边界

## 当前交付策略

源码提交到独立候选分支，GitHub CI 通过后供审阅；不自动合并主分支、不自动上传小程序，也不重启正式服。
真实手机体验用 [真机验收流程表](RELEASE_ACCEPTANCE_20260910.md) 签收。当前所有人工项目均待测。

## 可重复验证

在仓库根依次执行。客户端和服务端检查都会重建 `shared-core/dist`，同一工作区不要并行执行；CI 使用各自独立的 checkout，不共享构建目录。

```sh
pnpm --dir shared-core build
pnpm --dir work/guandan-cocos test:ci
pnpm --dir work/guandan-cocos typecheck:runtime
pnpm --dir work/guandan-windows-source check:server
pnpm --dir work/guandan-windows-source test:server
node scripts/release-manifest.test.mjs
node scripts/restore-drill.mjs
node scripts/local-room-load.mjs 4 16
# 加大本地样本；上限 16 房，每房最多 64 次动作，禁止接受远程目标
node scripts/local-room-load.mjs 16 32
```

CI 客户端与服务端统一使用 Node 22；CI 增加限时与手动触发入口，根目录脚本和归档资源变更也触发检查。
服务端 CI 加入哈希清单测试、合成数据恢复演练与 4 房间并发检查。它不是正式服压测。

## 发布清单

从已提交的干净工作区构建 shared-core、Web 与微信包，完成正式配置核验后执行：

```sh
# Creator 构建完成后，Web 正式包须显式提供既有公开业务端点。
GUANDAN_PLATFORM_ENDPOINT=https://api.yutechhn.cn/guandan \
GUANDAN_LOBBY_ENDPOINT=wss://api.yutechhn.cn/guandan/weapp \
pnpm --dir work/guandan-cocos finalize:web-build
GUANDAN_PLATFORM_ENDPOINT=https://api.yutechhn.cn/guandan \
GUANDAN_LOBBY_ENDPOINT=wss://api.yutechhn.cn/guandan/weapp \
pnpm --dir work/guandan-cocos verify:web-build
pnpm --dir work/guandan-cocos finalize:wechat-build
pnpm --dir work/guandan-cocos verify:wechat-build
node scripts/release-manifest.mjs create 20260910-rc1
node scripts/release-manifest.mjs verify release-artifacts/20260910-rc1/manifest.json
```

清单记录源码 commit/tree、三个产物目录内每个文件的大小和 SHA-256。任何源码未提交、包文件变化、空产物或符号链接均不能通过核验。
清单与构建日志保存在包外 `release-artifacts`，不提交生成包或机器日志。哈希清单不能证明可复现构建，也不能替代构建日志、CI 与人工签收。

首轮 GitHub 检查发现转蛋 smoke 的服务启动失败；旧脚本丢弃子进程日志，不能准确回溯底层启动原因。本轮将带副作用的三个模式测试改为顺序加载，转蛋使用临时端口、隔离环境，并保留有界启动日志和失败清理；规则断言不减少。不要用“本地通过”掩盖远程失败，应以候选提交重新运行的 CI 为准。

## 本地演练边界

2026-09-10 本机 Apple M1 / macOS / Node v26.7.0 的一次实测：16 房、64 个 WebSocket 连接、512 次出牌/不要、共 656 条有 ACK 的命令；耗时 9.15 秒，ACK P50 208.73 ms、P95 230.59 ms、P99 278.99 ms、最大 287.38 ms，持久快照 458,754 字节。它是短时有界并发检查，不是长时间稳定性或生产容量证明。

四类合成存储的恢复演练通过，耗时约 51 ms；该耗时不能当成生产恢复时间目标。现网只读健康/鉴权检查也通过（health 200、未登录 profile 401、开发登录 403、WSS 升级正常、不可信 Origin 403），不表示候选版本已部署。

- 并发脚本启动自己的 loopback 服务，不继承生产 GAME_* 地址/密钥/数据路径；各房创建、入席、准备、开局、轮流单牌/不要，核对版本收敛与隐藏手牌。
- ACK 延迟是本机 Node/文件系统/环回网络测量，不包含广域网、TLS、微信端、平台上报或真实 AI 算力。没有据此承诺线上人数上限。
- 恢复脚本只操作 mkdtemp 合成数据，验证平台、普通房、结算/观战 outbox 的复制、校验和、重新打开、回执幂等及损坏拒绝；演练结束清除自己的临时数据。
- 八人双桌恢复与 16 人完整赛事继续由服务端集成回归覆盖，不将四人负载结果等同于这两种模式的容量证明。

## 正式服发布 / 回退流程（本轮不执行）

1. 记录当前和候选源码版本、服务端归档哈希、微信包版本与 CI 链接；确认真机表已签收。
2. 检查连接、活动牌局、待上报队列和备份空间。默认不打断玩家；确需维护窗口应另行确认。
3. 停止两项服务或取得一致的静止快照，再备份完整 shared/data：平台 JSON、普通房与 `.duplicate`、结算/观战 outbox、回执/墓碑，以及目录中其他持久文件。不能只备份积分文件。
4. 备份置于权限受限、不可覆盖的新目录，记录 SHA-256；异机保留加密副本。不要把生产备份、用户头像/昵称数据或密钥提交 GitHub。
5. 使用已有 activate-server-variants.sh 的归档校验、分阶段启动与健康检查；不修改生产凭证。
6. 失败先停服隔离，检查数据 schema 是否兼容旧代码。既有脚本仅回退代码并保留现场，不能把它称为数据恢复。数据不兼容时，从完整备份恢复到新目录，校验后再切换；不能在服务写入期间覆盖文件。
7. 核对积分/名次/房间阶段、待上报事件及重试幂等，确认后恢复流量。记录实际丢失窗口和恢复耗时。

## 持续运行检查建议（未安装定时监控）

| 检查 | 初始告警建议 | 响应 |
| --- | --- | --- |
| 平台 health / 游戏端口 / systemd | 不可用或进程反复退出 | 保留日志、阻止扩大发布，不盲目反复重启 |
| 磁盘 / inode | 使用率超过 80%，或余量不足容纳一次全量备份 | 扩容或按保留策略清理已验证旧备份，不删除当前数据 |
| 备份新鲜度 / 异机副本 | 超过约定周期未完成；初始建议每天 | 检查备份任务并做恢复验证 |
| TLS 证书 | 剩余少于 14 天 | 核查续期任务与实际对外证书 |
| outbox | 持续积压、最旧事件持续老化 | 检查平台连通性与回执，禁止直接删除事件 |
| ACK 延迟 / 失败率 / 内存 | 以正式环境基线确定阈值 | 限流、分析磁盘/事件循环/AI，扩容前处理存储架构 |

实际线上容量、真实生产备份恢复、告警通知渠道及定时运行仍需在运维环境另行验收。JSON 单实例存储未变更，禁止多个服务实例并发写同一数据文件。
