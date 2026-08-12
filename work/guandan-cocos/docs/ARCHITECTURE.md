# 客户端架构基线

本文描述 `work/guandan-cocos` 当前可持续演进的架构基线。它用于约束新代码的归属、状态所有权、依赖方向和生命周期，不代表所有历史大类都已经拆分完成。

## 目标与边界

当前重构遵循以下原则：

- 每份业务状态只有一个明确的写入方，UI 只投影状态并转发意图。
- Cocos 场景负责组装，规则、同步策略、布局策略和网关契约尽量保持可独立测试。
- 联机牌局以服务端为权威；客户端不能从 UI 或本地缓存推断隐藏状态。
- 生产适配器与开发模拟数据隔离，传输实现可以替换。
- 所有监听、定时器、轮询、异步加载和临时节点都有对应的销毁路径。
- 重构必须保持功能一致，由聚焦回归、类型检查和目标平台构建共同验证。

本基线已经完成 Cocos 发布路径的 P0-P5 边界收口，并完成 P6 的座位视角、控制器拆分和生命周期治理。`GameScene` 已进一步把联机状态协调和快照到桌面视图的投影交给 `TableMatchCoordinator`；`TableGameHud` 和部分页面域仍是后续拆分热点。

## P0-P6 交付状态

| 阶段 | 当前发布路径 | 验收依据 |
| --- | --- | --- |
| P0 | 共享核心具备锁定的 TypeScript/Vitest 构建链；Cocos 有 core-sync、架构、纯模块、迁移源码和 Creator 类型门禁 | `pnpm test:ci`、Creator 3.8.8 双端构建 |
| P1 | `RuleProfile` 深冻结并显式注入；规则、合法动作和服务端使用同一 shared-core；旧 `server/rules.js` 已删除 | shared rules/legalMoves 测试与 `verify:core-sync` |
| P2 | 本地 Cocos 与服务端生产对局均以 `MatchState + GameCommand + transition` 原子推进回合、接风、排名、结算、下一局及贡还 | engine/tribute/settlement Vitest 与权威联机 smoke |
| P3 | `LocalMatchController` 是本地 `MatchState` 唯一写入方；AI、事件、副作用、选牌、计时和网络待确认动作均有独立控制器 | local-match、audio lifecycle、network effect 回归 |
| P4 | 客户端只发意图；服务端校验 requestId/expectedVersion、执行 transition，并按观看席位投影手牌和贡还选择 | weapp server 全套协议、四席隐私、重连与持久化测试 |
| P5 | AI 缓存、记牌、指标、调参和 RNG 均属于 `createAIEngine` 实例；`decisionRunner` 独占单局决策门禁顺序，`policyOverrides` 独占难度策略适配，`fallbackDecision` 独占常规跟牌、领牌与人性化兜底，`runtimeIntel`、`checkpoint`、`decisionSupport` 分别拥有记牌、恢复校验和辅助选牌；Cocos 每局、服务端每房隔离，Worker runtime 与主线程 checkpoint 连续一致 | AI engine/runtime-intel/random/worker parity 与 room bot 测试 |
| P6 | `myPlayerId` 驱动四席旋转；快照 presenter、手牌交互、弹层、回合钟、AI 回合和音频生命周期已从组合根拆出 | p1-p4 viewer、controller dispose、runtime reachability 测试 |

根目录另有原生微信客户端 `work/guandan-weapp`，仍携带一份旧 `EngineState` 兼容核心。shared-core 只为非贡还旧调用方保留 `playCards`、`passTurn` 和 `dealNextRound` facade；`createTribute`、`giveTribute`、`returnTribute`、`tributeLeader` 已从公共导出退役。Cocos 与权威服务端的新代码只能提交 `GameCommand`。旧客户端的迁移/退休不属于本次 Cocos 发布范围。

权威微信服务端位于 `work/guandan-windows-source/server`。该父目录还包含一个不属于本次发布的旧 React 客户端，因此父包的通用 `npm run check` 不能作为 Cocos 门禁；服务端使用 `npm run check:weapp-server`、`npm run test:weapp-server` 和 server lint 验收。不得为消除旧 React 类型错误而恢复共享核心的模块级规则或 AI 状态。

服务端组合根也遵循职责抽取：`weapp-websocket-transport` 独占 HTTP Upgrade、帧编解码和连接传输生命周期，`weapp-room-publisher` 独占权威房间状态到 viewer-safe 协议消息的投影与广播，`weapp-command-gateway` 统一处理验证、版本、幂等与持久化接纳，再由 entry/lobby/game handler 分域执行协议命令；平台侧 account/commerce/tournament/friend-room/merchant service 分别拥有账号、积分交易、赛事、好友房和商户事务，`spectator-domain` 独占观战事件规范、脱敏、延迟与终态投影。`check-server.mjs` 对这些模块及两个组合根实施只降不升的行数预算。

Cocos 当前使用 `SynchronousLocalAIEngine` 在主线程内执行 shared Worker protocol/runtime；它不是伪装成 Web Worker 的后台线程。这样可以在 Creator Web 与微信小游戏上保持同一 checkpoint、规则、seed 和调参契约，并为以后替换为真实 Worker 保留稳定协议，但本轮不宣称已经获得离主线程搜索的性能收益。

## 当前分层

| 目录 | 当前职责 | 约束 |
| --- | --- | --- |
| `assets/scripts/core/generated` | 从根目录 `shared-core/src` 同步的规则、AI、结算和牌型实现 | 生成目录只读；不得手工修改 |
| `assets/scripts/game` | 牌局应用状态、玩家意图、手牌工作区及可独立测试的交互策略 | 不创建页面；规则判断调用共享核心 |
| `assets/scripts/session` | 页面/牌局模式、设置、本地战绩及持久化会话投影 | 不持有服务端房间快照 |
| `assets/scripts/network` | 好友房和比赛入桌协议、断线恢复、版本同步及 WebSocket 边界 | 服务端状态只通过快照和事件进入应用 |
| `assets/scripts/services` | 资源加载、前台网关契约、开发适配器和平台服务门面 | 稳定契约不依赖 Cocos 或开发样例 |
| `assets/scripts/services/platform` | 生产 HTTP 客户端、校验/解码和各领域网关 | 禁止 runtime import `DevelopmentApis` |
| `assets/scripts/replay` | 公开事件时间线与观战轮询策略 | 不推断私有手牌 |
| `assets/scripts/ui` | Cocos 视图控制器、节点工厂，以及表格/提示等展示策略 | 不反向依赖 `scenes` |
| `assets/scripts/effects`、`audio` | 动效与音频语义、资源和播放控制 | 由上层传入牌局语义，不拥有牌局规则状态 |
| `assets/scripts/scenes/front-pages` | 大厅、匹配、比赛、商城、个人中心等页面域 | 各页面拥有自己的请求令牌和短期页面状态 |
| `assets/scripts/scenes` | Cocos 生命周期和组合根；连接页面、牌桌、服务与适配器 | 允许依赖下层，不能成为下层工具的依赖 |
| `assets/scripts/development` | 固定牌局和特效实验室 | 不得被生产平台适配器依赖 |
| `migration` | 已退出 Cocos 资源图、但仍需保留和独立类型检查的迁移源码 | 不带 `.meta`，不得被 `assets` 运行时 import |
| `art-source`、`third_party` | 原始素材、包外归档、许可和可复现导入证据 | 不属于 Cocos bundle，不得用作运行时资源路径 |

几个已经形成的边界：

- `GameScene` 是运行时组合根，保留 Inspector 属性、节点兜底构造和响应式布局；牌局快照、联机状态与牌桌视图协调由 `TableMatchCoordinator` 统一承接。
- `TableMatchCoordinator` 独占 `GameManager` 快照监听、牌桌网络桥、recovery baseline、下一局/托管意图和短期牌桌展示状态；业务真相仍分别属于 `GameManager`、`LobbyController` 与 `GameSession`。
- `TableNetworkEventBridge` 独占牌桌所需的 Lobby 事件注册、转发和成对解绑；它不缓存快照，也不改变 `LobbyController` 的服务端权威状态。
- `StartupCoordinator` 独占资源启动状态机，`SceneBackdropController` 独占背景加载、切换和销毁。
- `TableOverlayController` 独占结束提示、离桌确认、系统通知、解散投票倒计时和快捷语节点及其监听生命周期。
- `TableTurnClockController` 独占本地 20 秒计时、联机 deadline 投影、最后 5 秒音效、操作区位置和 HUD 计时状态。
- `TableHudSeatViewGroup` 独占四个座位节点、默认头像注入、座位快照投影、布局和销毁；它不判定座次、回合或牌数。
- `TableHudTurnTimerView` 独占回合计时节点、圆环/秒数绘制、鸡图资源替换和销毁；倒计时权威数据仍由 `TableTurnClockController` 投影。
- `EffectController` 只组合 Cocos 渲染器、资源、节点池和总清理；`EffectActionPresentationCoordinator` 独占联机 action-count 去重、展示票据与本地飞牌起点，`EffectPlaybackCoordinator` 独占可见动效队列、异步准备代际和播放 handle 生命周期。
- `FrontPageController` 组装 `PageRouter` 和各页面域；商城、比赛、匹配、好友房、个人中心、回放观战等实现不再回流到 `GameScene`。`MatchmakingPageDomain` 以有界集合保留取消/查询均失败的 uncertain ticket，新入队前必须先对账，未确认时不得再创建队列票据。
- `FriendRoomSettingsPresenter` 独占好友房设置草稿、标签页、运行时节点和交互生命周期；`FriendRoomSettingsPolicy` 只提供纯 schema、投影和归一化。生产平台好友房由 `FriendRoomPlatformFlow` 保证 HTTP 预留、WebSocket 入席和退出补偿，`FriendRoomPlatformPresenter` 只展示完整邀请口令；`FriendRoomWaitingPresenter` 按服务端 capabilities 渲染席位、准备与 bot 入口，开发直连仍保留六位房间号入口。
- `PlatformApi.ts` 是稳定生产平台门面，具体客户端、解码和网关位于 `services/platform`。
- `LobbyController` 保留 Cocos 生命周期、房间身份和公开命令门面；resume 凭证写入失败必须投影为可观察错误，但不能阻止当前牌局。`LobbyCommandSender` 独占命令版本注入与发送失败归一化，`LobbyConnectionEventCoordinator` 固定连接、断线、匹配入桌与本地恢复的调用顺序，`LobbyMessageRouter` 独占服务端消息过滤、快照投影和领域事件转发：直播房间消息必须携带当前六位 roomId，metadata 必须携带非负安全整数 version，state/round 还必须携带 gameVersion；仅入桌 adapter 可兼容缺失版本的旧快照。`LobbyModels` 提供模型工厂，`LobbySyncTracker` 独占版本与特效游标，`LobbyEntryAttemptTracker` 独占 128-bit 入桌幂等键，`LobbyMatchedEntryCoordinator` 管理平台票据的跨连接重试、超时和恢复轮换，`LobbyResumeConnectionWatchdog` 限制本地 resume token 的连接恢复时长与总失败次数。
- `LocalMatchController` 是本地 `MatchState` 唯一写入方；`GameManager` 是 Cocos 组件适配器，转发 UI/网络意图并投影控制器结果，不直接调用领域 `transition`。
- `GameManager` 的 phase、等级、积分、排名、贡还和结算只保存在一个 canonical projection 中；兼容旧 Scene API 的 getter 只能读取该投影，不能重新成为可写状态。
- `LocalAITurnController`、`LocalMatchEventController`、`LocalHandSelectionController` 和 `NetworkActionController` 分别拥有 AI 调度、事件副作用、选牌和网络待确认生命周期；`NetworkMatchSnapshotController` 单点消费联机快照，负责 canonical phase/贡还/结算投影、`roundId + revision` 门禁和每局统计去重，旧 result-only 包通过服务端 room/version/gameVersion 事件身份去重。`HandGrouping` 只编排分组命令、事务历史和 revision，状态克隆、等价比较、权威快照归一化与显示排序集中在 `HandGroupingState`。
- `HandArrangement.ts` 只保留稳定导出门面；`HandArrangementModel` 独占基础牌序、配置和公共类型，`HandDisplayOrdering` 独占展示列与组内牌序，`HandGroupSuggestions` 独占百搭分配、牌型候选发现和冲突选择。三者均为无 `cc` 的纯模块，候选发现不得反向读取展示状态。
- shared-core 用一次 `resolvePlayForContext` 同时完成多解百搭的合法性判断与落账；提示、诊断、状态机和 AI 共享这份解释。`MatchState.roundMeta` 保存贡还/抗贡来源并显式注入 AI，结算 state、operation 和 event payload 之间不共享可变引用。`ai/engine.ts` 只持有实例状态和装配依赖，`ai/decisionRunner.ts` 独占单局门禁顺序，`ai/policyOverrides.ts` 适配 hard/medium/master 策略，`ai/fallbackDecision.ts` 处理常规跟牌、领牌与随机人性化；记牌、checkpoint 校验、规则查询 LRU 和辅助决策分别集中在 `runtimeIntel.ts`、`checkpoint.ts`、`ruleMemo.ts`、`decisionSupport.ts`。
- `TableHudLayoutPolicy`、`FriendRoomSettingsPolicy`、`NetworkEffectSyncPolicy`、手牌策略等模块保持无 `cc` 运行时依赖，便于纯测试。

## 依赖方向

硬性方向是：场景层可以组装下层，下层不能 runtime import 场景层；共享核心和稳定契约不能依赖表现层。

```text
scenes（组合与页面域）
  -> ui / effects / audio
  -> game / session / network / replay
  -> services contracts + injected gateways
  -> core/generated

services/platform
  -> platform client/contracts/decoders
  -> FrontPageGatewayContracts
  -X-> DevelopmentApis

core/generated
  -X-> Cocos scene/UI/service implementation
```

目前下层模块之间仍允许有明确用途的横向依赖，例如 `network` 更新 `GameSession`、`game` 调用音频或房间意图。新增横向依赖前必须确认不会产生第二份状态或 runtime cycle。`scripts/check-architecture.mjs` 统计静态与动态运行时 import/export；`import type` 不会被误判为运行时耦合。

任何新 `.ts` 文件都必须带同路径 `.meta`。架构检查器还会检查本地运行时依赖环和大类行数预算。预算只能在职责抽取后下调，不能为了容纳新功能上调。

## 状态所有权

| 状态 | 写入方 | 其他层如何使用 |
| --- | --- | --- |
| 掼蛋规则、合法牌型、AI 和结算规则 | 根目录 `shared-core/src`；Cocos 使用同步后的 `core/generated` | 应用控制器调用，不在 UI 复制规则 |
| 本地牌局 `MatchState` | `LocalMatchController`，只通过原子 `transition` 写入 | `GameManager` 投影为 `GameSnapshot`，UI 只读 |
| 本地 AI、事件副作用、规则选牌和待确认网络动作 | 对应 `LocalAI*` / `LocalMatchEventController` / `LocalHandSelectionController` / `NetworkActionController` | AI 上下文直接读取 canonical `roundMeta`；`GameManager` 只组合、转发和发布结果 |
| 联机真实牌局 | 服务端 `game-session` 持有 canonical `MatchState` | `LobbyController` 接收按席位脱敏的 `ViewerMatchState`，`GameManager` 不在本地推进联机规则 |
| 联机牌局客户端投影和结算统计去重 | `NetworkMatchSnapshotController` | canonical `MatchState.phase/tribute/settlement` 优先于旧拆包字段；相同 room/round 或旧包的相同服务端事件身份只记录一次当前座位战绩 |
| 房间身份、成员、准备、托管、倒计时元数据 | `LobbyController.snapshot`，数据源为服务端 | 页面和牌桌只读投影并发送意图 |
| 服务端版本去重、房间事件去重、特效同步游标 | `LobbySyncTracker` | `LobbyController` 仅委托并发布数据包 |
| 游戏模式、设置、本地战绩、当前本地身份 | `GameSession`；持久化数据先经 `GameSessionModel.restoreSessionSnapshot` 按 schema 迁移和校验 | 页面、音频和牌桌订阅会话事件；炸弹数只统计当前座位的公开出牌历史，`StraightFlush` 是否计入由当前 `RuleProfile` 决定 |
| 规则出牌/贡牌选择 | `LocalHandSelectionController`，通过 `GameManager` 暴露意图 | 按当前 `MatchState + RuleProfile` 诊断，不保存展示分组 |
| 锁牌草稿与理牌复原事务 | `HandWorkspace`；锁牌使用 `idle/create/unlock`，理牌使用 `point-stacked/smart-arranged`，二者都是独立判别状态并受 `roundId` 代际保护 | `TableHandInteractionController` 互斥投影规则选择与锁牌草稿；锁变化只失效旧布局基线，不回滚当前锁；新轮次/离桌完整重置 |
| 玩家提示候选与游标 | shared-core `hints/handHintPolicy` 纯排序合法动作；Cocos `HandHintProtectionProjector` 将当前不重叠显示组投影成通用 cardId 保护组；`LocalHandSelectionController` 独占签名和游标 | UI/理牌状态不进入规则内核；锁组有完整替代时禁止部分拆分；提示不发送网络命令，正式出牌仍经权威 transition |
| 手牌展示牌列、组合来源与锁定归属 | `HandGrouping`；`HandGroupingHistory` 独占有界 undo/redo；每个组显式保存 `origin: rank/auto/manual`、`locked` 和全局 `layoutMode` | 普通模式只按实体点数归列和有效点数排序，智能模式才自动提升大牌型；显式锁组无论当前布局模式都作为完整 `DisplayUnit` 进入左侧锁定区，区内以当前 `RuleProfile` 的共享规则强度稳定排序，解锁后重新进入当前布局规则。列内固定 40px 步长，普通牌与大小王一致且不压缩；操作区保持上层固定位置，不修改规则手牌。锁牌成员只能通过 `createLockedGroup`、解锁或整组移动改变，禁止重新引入可绕过合法性检查的通用 `createGroup` / `moveCard` API |
| 堆叠布局、选中与锁定视觉 | `HandController` / `CardView`，只消费 `displayCardIds + selectedCardIds + lockedCardIds` | 命中区高度与牌面几何分离；选中/锁定不改 scale 或 sibling order |
| 玩家资料与钱包页面投影 | `FrontPagePlayerState`、`FrontPageWalletState`；线上数据源为平台服务 | 各页面域共享同一投影，不各自缓存一份余额 |
| 页面路由和当前模态层 | `PageRouter` / `FrontPageController` | 页面域请求打开/关闭，不自行保留旧页面节点 |
| 好友房设置草稿与设置页标签 | `FriendRoomSettingsPresenter`；规则映射由 `FriendRoomSettingsPolicy` 提供 | `LobbyPageDomain` 只接收创建时的完整设置并编排连接 |
| 启动下载、预加载、初始化和 ready 门闩 | `StartupCoordinator` | `GameScene` 注入初始化和响应式布局回调 |
| 背景纹理缓存和切换 revision | `SceneBackdropController` | 页面/牌桌只选择 `lobby` 或 `table` 模式 |
| 结束提示、离桌/通知弹窗、解散投票倒计时和快捷语 | `TableOverlayController` | `GameScene` 只注入牌桌动作并调用公开交互入口 |
| 牌桌回合剩余时间、计时文案和 HUD 座位投影 | `TableTurnClockController`；联机 deadline 数据源仍是 `LobbyController.snapshot` | `GameScene` 只提交当前快照和布局上下文；本地超时回调到 `GameManager` |
| 最新牌局快照、阶段/手数/贡还去重标记和 recovery 视觉基线 | `TableMatchCoordinator`（仅短期展示状态） | 监听 `GameManager` 与 `TableNetworkEventBridge`，投影到手牌、出牌区、座位、HUD、弹层、音效和动效；不推进规则 |
| 动效 action-count 游标、展示票据、可见队列和异步准备代际 | `EffectActionPresentationCoordinator` / `EffectPlaybackCoordinator` | `EffectController` 只提供渲染、音频、震动和资源依赖；recovery/destroy 统一取消旧代际，迟到准备不得恢复展示或发声 |
| 节点位置、按钮可见性和短时提示 | 对应 UI 控制器或页面域 | 只能是上述业务状态的展示，不成为业务真相 |

`TableMatchCoordinator.snapshot` 和动效去重标记属于短期展示状态；牌桌弹窗、快捷语和解散倒计时的短期状态由 `TableOverlayController` 持有，回合计时的短期状态由 `TableTurnClockController` 持有。它们都不应被其他模块读取为规则或联网权威状态。

## 可替换边界

### 房间传输

`LobbyController` 默认创建 `CocosSocketClient`，生产行为不变。测试或其他运行环境可在 Cocos 调用 `onLoad` 前执行：

```ts
lobbyController.setSocketClient(testSocket)
```

注入对象只需实现 `LobbySocketClient` 的 `connect`、`on`、`send` 和 `close`。事件绑定后禁止替换传输，避免旧监听器继续写入状态。

服务端为每个席位签发 256-bit 恢复令牌，并在每次成功 `rejoinRoom` 后立即轮换；客户端只有在 room、seat、requestId 和 entry generation 全部匹配的成功响应中才替换内存令牌。匹配票据在 90 秒有效期内同时承担“入桌响应丢失”的幂等恢复凭证，因此同票据恢复返回原席位凭证；它不是长期会话入口。当前令牌不写入 Cocos 本地持久化，因此只承诺同一应用进程内的断线恢复；服务端进程重启可以恢复房间和成员凭证，但客户端应用被系统彻底结束后的冷启动恢复尚未提供 UX，不得宣称为已支持能力。

### 平台网关

页面依赖 `FrontPageGateways`，不直接依赖 XHR：

- 无平台地址时，组合根使用 `createDevelopmentGateways()`。
- 配置平台地址时，组合根使用 `createHttpGateways(config, transport)`。
- `createHttpGateways` 默认注入 `XhrTransport`，测试可传入 `HttpTransport` 假实现。
- `PlatformApi.ts` 保持稳定导出，应用代码不应跨过门面依赖内部文件，除非正在实现平台模块本身。

当前少数页面域仍直接读取 `DevelopmentApis` 中的样例目录或观战模拟器，这是已知迁移点。硬性边界先保证 `services/platform` 永远不依赖开发适配器，下一阶段再把样例目录也改为组合根注入。

### 启动流程

`StartupCoordinator` 通过构造参数接收场景根、加载背景、初始化应用、响应式布局和 ready 回调。测试不需要启动完整 Cocos 场景即可覆盖成功、失败重试、销毁后异步返回和初始化失败重启。

## 生命周期与销毁

新代码必须满足以下约束：

1. Cocos 组件在 `onLoad` / `onEnable` 注册的监听，必须在 `onDestroy` / `onDisable` 使用相同函数和 target 注销。
2. `schedule`、轮询、长按和延迟 AI 等任务必须在离页、退桌或销毁时取消；不能只隐藏节点。
3. 非组件拥有资源或节点时提供幂等的 `dispose()` / `destroy()`，父级只销毁自己明确拥有的对象。
4. 异步加载和请求使用 `disposed`、attempt、generation、revision 或 request token；回调提交前同时检查 token 和目标节点/路由仍有效。
5. 页面切换先停止输入和轮询，再销毁旧页面根。后台/前台事件也必须由页面壳统一解绑。
6. Socket 所有者在销毁时调用 `close()`；已绑定的 transport 不允许中途替换。
7. Tween、临时 SpriteFrame、对象池对象和动态节点必须有回收路径。销毁后到达的 Promise 不得重新挂载节点。

当前可参考的完整实现包括 `StartupCoordinator.dispose()`、`SceneBackdropController.dispose()`、`TableOverlayController.dispose()`、`TableTurnClockController.dispose()`、`TableHudSeatViewGroup.dispose()`、`FriendRoomSettingsPresenter.dispose()`、`LobbyPageDomain.destroy()`、`FrontPageController.destroy()`、`TableGameHud.dispose()` 和 `LobbyController.onDestroy()`。

## 测试与构建门禁

### 提交前默认门禁

```sh
pnpm test:ci
```

该命令按顺序执行：

1. `verify:core-sync`：确认 `shared-core/src` 与 `core/generated` 完全同步。
2. `verify:architecture`：检查 `.meta`、依赖方向、runtime cycle、生产/开发适配器隔离和大类预算。
3. `typecheck:ci-core`：严格检查不依赖 Cocos 的规则、手牌、网络协议/同步、平台网关、回放和纯 UI policy；架构检查会阻止纯模块漏出该清单。
4. `test:core`：从干净构建产出运行 shared-core 的类型、领域和 AI 测试。
5. `test`：执行全部聚焦回归和平台契约测试。

默认测试链包含启动协调器、背景控制器、好友房设置策略、设置页 presenter 生命周期与运行时、网络同步、牌桌布局/提示、手牌交互、音效动效、页面域、平台网关、回放观战等测试。新增 `tests/*-regression.cjs` 时必须同时加入 `package.json` 的默认 `test`，不能只增加一个无人调用的单独 script。

GitHub Actions 在 Linux 上运行 `pnpm test:ci`，使用项目锁定的 TypeScript 4.9.5。`typecheck:ci-core` 只覆盖不依赖 `cc` / `cc/env` 的代码：Cocos 官方可独立安装的类型目前没有与项目 3.8.8 完全一致的版本，CI 不使用近似版本冒充全量检查。它不能替代本机 Creator 3.8.8 类型检查和目标平台构建。

### 类型检查

```sh
# 可在任意已安装依赖的环境执行，仅检查 Cocos-independent core
pnpm typecheck:ci-core

# 必须在打开过项目并生成 temp 声明的 Cocos Creator 3.8.8 环境执行
pnpm exec tsc --noEmit --pretty false

# 同样依赖 Creator temp 声明，独立检查移出 bundle 的休眠迁移源码
pnpm typecheck:migration
```

纯测试中的 `transpileModule` 只能验证语法和局部行为，不能替代语义检查。`typecheck:ci-core` 也不能覆盖场景、组件、包外迁移源码或其他 `cc` 依赖；提交前仍需运行上面的两个本机 Creator 声明类型检查。

### Web 与微信小游戏

```sh
# Web Desktop
/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator \
  --project "$PWD" \
  --build "platform=web-desktop;debug=false;useSplashScreen=false"
pnpm finalize:web-build
pnpm verify:web-build

# 微信小游戏
/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator \
  --project "$PWD" \
  --build "platform=wechatgame;debug=false;sourceMaps=false;useSplashScreen=false"
pnpm verify:wechat-build
```

构建验收还需要在真实横屏尺寸和微信安全区检查背景 cover、手牌触控、按钮遮挡、加载重试、音频解锁和分包下载。源码正则与纯策略测试不能证明视觉效果正确。

## 新代码落位检查

新增功能前依次判断：

1. 这是规则还是牌型判断：进入 `shared-core`，同步后由客户端调用。
2. 这是牌局/会话/房间/钱包中的哪一种状态：写入对应唯一 owner，不在页面复制。
3. 这是可纯化的布局、选择、同步或校验策略：放入无 `cc` 的 policy/model 模块并先写运行测试。
4. 这是平台或网络 I/O：先扩展 contract，再实现 adapter，通过组合根注入。
5. 这是节点和动效：放入 UI/effects 控制器，明确销毁路径。
6. 这是页面流程：进入对应 page domain；跨页面共享状态进入明确的共享 projection。
7. 最后才在 `GameScene` 或 `FrontPageController` 增加组装代码。

完成后补 `.meta`、默认测试入口和必要的架构规则，并运行本节门禁。

## 下一阶段热点

按优先级继续收束：

1. `GameScene`：网络状态协调、recovery baseline 和快照到桌面视图的映射已迁入 `TableMatchCoordinator`；后续只可继续抽取节点兜底构造或响应式布局，不得把牌局协调回流到组合根。
2. `TableGameHud`：布局策略、座位视图组和计时视图已抽出，门面仍集中操作栏和同花顺控件，应继续按组件生命周期拆分。
3. `LobbyPageDomain`：好友房设置页已经迁入可销毁 presenter；好友房等候牌桌、四档场次和大厅身份展示仍集中，应继续按独立区域拆分。
4. `ReplaySpectatorPageDomain`、`CompetitionPageDomain`：继续分离数据协调与代码生成视图。
5. `GameManager`：联机快照与结算统计已迁入 `NetworkMatchSnapshotController`；下一步只继续拆快照发布/会话端口装配。本地规则状态必须继续由 `LocalMatchController` 单独写入，不能回流。
6. 开发样例注入：移除页面域对 `DevelopmentApis` 样例常量的直接 import，由组合根提供开发 catalog/gateway。
7. 编辑器可预览性：逐步把稳定页面和 HUD 从大量运行时代码生成迁移为 prefab/可序列化组件，同时保留纯布局测试。

这些热点必须逐页、逐责任拆分，并用现有聚焦回归保持行为一致；禁止一次性改写整个牌桌或同时迁移规则、状态和视觉。
