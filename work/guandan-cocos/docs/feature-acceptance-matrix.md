# 功能吸收与验收矩阵

> 源码复核：2026-08-05
>
> 范围：`guandan-cocos`、`shared-core`、`guandan-windows-source/server`
>
> 目的：区分“已有实现”“只有骨架”和“仍需真实测试”，避免把页面、接口或测试桩误写成产品完成。

## 判定口径

| 标记 | 含义 |
| --- | --- |
| ✅ 已实现 | 当前需求范围已有端到端代码路径和针对性自动化证据；仍不等于通过真机/生产验收 |
| 🟡 部分/骨架 | 有数据模型、接口或部分 UI，但关键阶段、真实数据链路或操作闭环不完整 |
| ⬜ 未实现 | 只有需求/入口提示，或没有可用执行路径 |

“自动证据”表示仓库中存在对应测试目标，不表示本文更新时的全部未提交改动已经由 CI 重新跑过。合入前仍应执行 Cocos `npm test`、服务端 `npm run test:server`、类型检查和 Web/小游戏构建验证。

## A. 牌桌与联机

| 能力 | 状态 | 当前边界与代码证据 | 自动证据 | 必须补的真实测试 |
| --- | --- | --- | --- | --- |
| 服务端回合 deadline | ✅ 已实现 | `weapp-ws.js` 以绝对时间和 `deadlinePlayerId / deadlineAction` 覆盖出牌、进贡、还贡、贡还完成/抗贡开始；客户端只据此显示，不在联机模式自行提交超时动作 | `server/weapp-round-state.smoke.mjs`、`tests/network-round-state-regression.cjs` | 四端时钟偏差、后台恢复、弱网重复包；逐阶段确认超时只执行一次 |
| 托管状态机 | ✅ 已实现（可选单实例重启恢复） | 主动、连续超时、断线三类托管共用权威步骤；跟牌不要、领出最小单牌、贡最高合法牌、还最低合法牌（[2025 竞赛规则](https://gawsf.b-cdn.net/files/%E4%B8%96%E7%95%8C%E6%8E%BC%E7%89%8C%EF%BC%88%E6%8E%BC%E8%9B%8B%EF%BC%89%E7%AB%9E%E8%B5%9B%E8%A7%84%E5%88%99%EF%BC%882025%EF%BC%89.pdf)规定整手均高于 10 时还全手最低牌）、贡还结束/抗贡自动开局，重连恢复当前步骤并可取消。双贡先 escrow 收齐，再按牌点动态分给上游/二游，同点稳定映射，实际贡给上游者领出。可选 `WEAPP_ROOM_STATE_FILE` 以原子 JSON 快照恢复单实例房间、绝对 deadline、托管/贡还/准备/投票和最近幂等接受记录；默认关闭，不提供多实例所有权或分布式事务 | 同上，加 `server/weapp-ws.smoke.mjs`、`server/room-state-store.test.mjs`、`server/weapp-persistence.smoke.mjs` | 两次连续超时、每种原因切换/取消；双贡大小/同点映射、无 10 及以下牌；四端在贡还/出牌中杀进程后重连，验证原 deadline 与动作只执行一次 |
| 四人局间准备/取消 | ✅ 已实现 | 四席独立 ready/cancel，`n/4` 展示，全员后只推进一次；结算时离线席自动准备 | `server/weapp-round-state.smoke.mjs`、`tests/network-round-state-regression.cjs` | 四人同时点击、准备后取消、掉线竞态、只创建一次下一局及贡还状态 |
| 好友房首局准备/房主管理 | ✅ 已实现（本批范围） | 非票据好友房四席分别准备，房主在全员准备后开始；开局前可移出在线且未准备的非房主席位，被移出方清除恢复凭证并退回大厅；与局间 ready 完全分离 | `server/weapp-ws.smoke.mjs`、`tests/lobby-entry-regression.cjs` | 四端同时准备/取消、移出与断线竞态、被移出令牌失效；换座留待下一批原子协议 |
| 比赛匹配等待页 | ✅ 已实现（展示范围） | 匹配票据轮询、取消/已分配竞态恢复、等待阶段和本地已等待时长已接；后端不返回人数/ETA 时不伪造 | `tests/match-waiting-regression.cjs`、`tests/platform-live-contract.cjs` | 真实平台长时间排队、取消恰逢成桌、前后台切换、弱网重复轮询和入桌过期 |
| 智能理牌 | ✅ 已实现 | 纯 cardId 展示层识别天王炸、炸弹、同花顺、钢板、三连对、三带二并选非重叠组合；每组占一个横向位置并从上向下错层，露出每张牌的点数/花色，最大纵向占用受控，不改规则手牌 | `tests/hand-grouping-regression.cjs` | 27 张牌、逢人配、多解冲突、低端机布局和叠牌露出区触控命中 |
| 手动分组 | ✅ 已实现 | 独立于出牌选择，可在非己方回合点选并成组；权威手牌变化会清理失效 cardId | `tests/hand-grouping-regression.cjs` | 他人出牌前后、自己出牌后、重连换快照后仍可选牌；不污染出牌集合 |
| 分组调整与历史 | ✅ 已实现 | 多步撤销/重做、牌组前后移动、拆组与恢复默认已接牌桌 UI；服务端换手牌后清空历史，不能复活已出牌；调整选择与出牌选择隔离 | `tests/hand-grouping-regression.cjs` | 连续成组/移动/拆分/撤销重做、撤销后出牌、换手牌后历史失效、横竖屏边界 |
| 解散投票 | ✅ 已实现 | 发起、同意、拒绝、30 秒到期、离线票状态、全员通过销房和客户端投票弹窗已接通 | `server/weapp-round-state.smoke.mjs`、`tests/network-round-state-regression.cjs` | 并发发起、拒绝与超时边界、投票中断线/重连、通过后四端统一退桌 |
| 联机安全退出 | ✅ 已实现（可选单实例重启恢复） | 客户端明确使用 `safeExit`；服务端保留席位并进入断线托管，出牌/贡还当前步骤可自动推进，未完成局不报正常结算。配置 `WEAPP_ROOM_STATE_FILE` 后，单实例重启会保留席位凭证与权威阶段；原本未托管的保留席位转为断线托管，已有托管原因继续保留。默认不落盘，且不支持多实例共写 | `server/weapp-round-state.smoke.mjs`、`server/weapp-persistence.smoke.mjs`、`tests/network-round-state-regression.cjs` | 分别在出牌/贡还/结算退出；全部玩家退出、空房回收、战绩不误记；真机杀进程后四席恢复及宽限期边界 |
| 固定可玩牌局 | ✅ 已实现 | DEV 下有固定开局、逢人配+炸弹、炸弹压制三套 108 张牌状态；可真实选牌/提示/出牌且隔离战绩 | `tests/effect-lab-quick-chat-regression.cjs` | Cocos 中逐套打牌；返回大厅、再次进入状态干净；发行包无入口 |
| 音效/动效实验室 | ✅ 已实现 | DEV 编译门禁；覆盖全部牌型、逢人配、语义音频、0–5 秒、贡还和结算 fixture。贡还预览目前以数据/提示为主 | `tests/effect-lab-quick-chat-regression.cjs`、`tests/audio-effects-regression.cjs` | 全 fixture 真机视听、特效档位、跳过动画、批量截图和正式包门禁 |
| 快捷语文本与服务端节流 | ✅ 已实现 | 六条白名单；客户端每人 1.2 秒/同句 8 秒，服务端再次校验并返回冷却 | `tests/effect-lab-quick-chat-regression.cjs`、`server/weapp-ws.smoke.mjs` | 四端交叉发送、恶意自定义文本、边界毫秒、断线重连后的策略 |
| 快捷语音 | 🟡 部分/骨架 | 仅“你的牌打得太好啦”接 MIT Female/Male `phrase02`，设置页显式选择声线且不会男女混播；revision、许可证、索引路由和哈希分别有清单；其余五句无安全对应并静音 | `tests/audio-effects-regression.cjs`、`tests/effect-lab-quick-chat-regression.cjs`、`server/weapp-ws.smoke.mjs` | Web/微信/真机分别听辨男女 OGG 的语义、句尾和响度；其余五句确认不误播 |
| 屏蔽与座位气泡 | ✅ 已实现 | 屏蔽按 viewer/sender 只影响本地查看者，同时隐藏气泡并停止被屏蔽者的接收语音；每座位只保留最后一条并在 2.5 秒过期，队友/左右座位有独立布局 | `tests/effect-lab-quick-chat-regression.cjs`、`tests/architecture-regression.cjs` | 四个座位、刘海/小屏、连续覆盖；真机验证屏蔽/恢复同时控制气泡和语音 |

## B. 平台与长期系统

| 能力 | 状态 | 当前边界与代码证据 | 自动证据 | 必须补的真实测试 |
| --- | --- | --- | --- | --- |
| 多轮赛事 | 🟡 固定赛制已闭环 | 新增固定16人、4桌、3轮 Latin 编排：显式检录、满员锁名单、三轮不重复同桌、服务端 assignment 入桌、每轮四桌屏障、异常桌阻塞和单玩家单轮唯一结算；Cocos 可显示检录/轮次/桌完成数/本人分桌。固定桌票据过期时只续签本人同桌同座新票；旧本地 JSON 会补入新赛事与新增集合且不覆盖已有运营记录。仍不是任意人数或通用赛事引擎 | `server/platform/tournament-pairing.test.mjs`、`server/platform/tournament-orchestrator.test.mjs`、`server/platform/tournament-live.test.mjs`、`server/platform/platform.test.mjs`、`tests/platform-live-contract.cjs` | 迟到、弃权、替补、争议恢复、异常补赛、轮空、跨实例数据库和晋级后新阶段 |
| 排名与晋级 | 🟡 固定赛制已闭环 | 三轮完成前统一返回 `pending`，全部12桌完成后用同一稳定排序器产生恰好 Top 8；响应包含晋级线、临时/最终状态和 `viewerStanding`，本人不在前六也单独显示。没有晋级后新阶段、奖励和争议处理 | `server/platform/tournament-live.test.mjs`、`server/platform/platform.test.mjs`、`tests/platform-api-regression.cjs`、`tests/architecture-regression.cjs` | 同分边界产品规则、赛事奖励幂等、申诉改判、反作弊和下一阶段编排 |
| 商户后台 | 🟡 迁移边界 | 服务端有 pending 申请、门店、owner/manager/cashier、日限额、积分发放幂等和自发分拦截；Cocos 页面与网关代码暂留用于迁移验证，但普通玩家入口已隐藏。仍缺审核/申诉、撤销、核销、对账、独立运营后台、完整审计和生产数据库 | `server/platform/platform.test.mjs`、`tests/platform-api-regression.cjs`、`tests/merchant-console-regression.cjs`、`tests/more-feature-retirement-regression.cjs` | 确定独立商户产品入口及鉴权边界后，再做四类角色越权、审核、幂等重试、日切、真机输入和生产事务验收 |
| 个人中心 | 🟡 部分/骨架 | 大厅头像/资料栏进入统一个人中心，展示八位账号、积分、`rating.comprehensiveScore`、总场和胜率，并承载赛季任务/我的牌谱入口与返回链路；缺完整资料编辑、隐私、段位、客服/协议 | `server/platform/platform.test.mjs`、`tests/platform-api-regression.cjs`、`tests/more-feature-retirement-regression.cjs` | 真实账号跨设备、实际结算后统计、钱包同步失败、隐私与未登录/令牌过期 |
| 牌谱 | 🟡 部分/骨架 | 有本人列表/详情、参与者访问控制和持续公开动作时间线；Cocos 已按 sequence 排序去重并复原四座位最后动作、桌面公开牌、贡还/出牌/结算阶段，支持播放、暂停、前后步进和 0/25/50/75/100% 跳转；模型显式不保存或推断隐藏手牌 | `server/platform/platform.test.mjs`、`server/weapp-ticket.smoke.mjs`、`tests/platform-api-regression.cjs`、`tests/replay-timeline-regression.cjs` | 完整一局事件数/顺序、权限、无隐藏手牌、长牌局跳转、前后台恢复和真机视觉回放 |
| 赛季任务 | ✅ 已实现（原型范围） | 日/赛季任务、Asia/Shanghai 日桶、真实结算进度、幂等领取和积分流水已接平台与 Cocos UI；开发网关只显示演示进度，不显示可领取按钮；运营配置/段位任务未做 | `server/platform/platform.test.mjs`、`tests/platform-api-regression.cjs`、`tests/more-feature-retirement-regression.cjs` | 23:59/00:00 日切、赛季起止、并发双领、失败重试、真实结算驱动 |
| 延迟观战数据链路 | ✅ 已实现（可选单实例 durable outbox） | 持续采集公开动作；独立 HMAC、幂等、严格 schema/sequence/match-room 校验和 15–300 秒延迟。失败队首持续有界退避且阻止后序越序；room-closed 额外要求结算生命周期签名，普通观战密钥不能终止匹配，正式结算可覆盖异常回收竞态。可选 `GAME_SPECTATOR_OUTBOX_FILE` 先原子落盘、成功后删除并在重启后按 match/sequence 续传；默认关闭，不是多实例队列，也没有死信 | `server/platform/spectator-outbox.test.mjs`、`server/platform/platform.test.mjs`、`server/weapp-ticket.smoke.mjs`、`tests/platform-api-regression.cjs` | 真实持续到达、严格延迟、长期故障/恢复、非正常关桌和正式结算竞态；确认无房间码/真实用户/隐藏牌；做磁盘满、损坏文件、积压容量和人工恢复演练 |
| 观战/回放体验 | 🟡 自动追帧已闭环 | 本人牌谱与延迟观战共用公开状态播放器：可显示四座位动作和已出牌，支持播放/暂停/步进/比例跳转。观战页每3秒拉取并按 sequence 增量合并；位于末尾时自动跟随，用户回看时不抢光标并提示新事件/回到最新；离页、销毁和进入后台会令旧轮询失效，终局延迟尾部公开完整后自动停止，临时失败保留画面并按3/6/12秒有界重试。尚无任意拖动条、音效/特效复演、导演视角或精彩切片 | `tests/replay-timeline-regression.cjs`、`tests/spectator-polling-regression.cjs`、`tests/architecture-regression.cjs`、`tests/platform-api-regression.cjs` | 不同网速、长牌局、前后台、低端机性能；逐事件与服务端日志核对尾随/回看位置，确认不推断手牌 |

## C. 放行规则

1. “✅ 已实现”只有在对应自动化、TypeScript、构建检查通过且“必须补的真实测试”留有记录后，才能改为版本验收通过。
2. 任一 🟡 项不得在产品文案中称为“完整”“正式可用”或“已上线”；可以标注“技术预览/开发中”。
3. 联机安全、隐藏手牌、平台用户 ID、房间凭证、积分账本和商户权限属于阻断项，不能以演示数据通过代替。
4. 每次服务端协议、规则牌型或资源包更新后，重新执行相关行的自动化与真实测试，不沿用旧结论。
