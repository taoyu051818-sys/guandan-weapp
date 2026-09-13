# 去重整改清单

基线：`1d58999dc6e5455b049e1643660bbba3deee1406`及原有5处未提交修改，2026-09-13。**41项确认问题均未修复：17项P2、24项P3。** 下列是建议实施顺序，不是修复已获授权；每项的源码、详细复现与修复建议均可追溯。P2/P3是缺陷严重性，阶段是工程依赖顺序，不能混为一谈。

先给需要文件/服务的测试建立独立环境，再修正确性；同一所有者的状态/事务集中修，不为了设计模式再包多层。每批做小提交和对照回归，但本次审计不执行提交。

## 单独的依赖维护事项

DEPENDENCY-40-C01：`vitest` / `@vitest/mocker` 4.1.10命中上游文件读取公告，修复线4.1.11；建议授权维护时先升级到经验证的修复版本并回归。当前未发现所需暴露的mock开发入口，因此不混入41项产品缺陷，也不是“依赖安全通过”。完整69项在线公告/registry真实性、23项非本机包许可仍未完成。证据见[依赖报告](batches/dependency-boundaries-40.md)与[维护者公告](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9)。禁止以放宽文件/域名校验来绕过问题。

## 0. 先建立安全、可信的修复回归环境（3项P3）

| 编号 / 定位与证据 | 已确认问题及边界 | 修复验收要点 |
| --- | --- | --- |
| TEST-32-001 · P3<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-windows-source/server/weapp-security.smoke.mjs:11) / [复现](batches/server-test-quality-32.md) | 旧安全冒烟继承调用者状态路径，测试通过也会改写该文件。两次隔离临时文件复现；只确认继承文件读写，不声称真实房间已丢失或线上数据泄露。 | 给测试注入自有临时状态路径，启动前后核调用者哨兵文件哈希不变；所有子进程和临时目录均由夹具回收。 |
| BUILD-03-001 · P3<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-cocos/scripts/runtime-client-config.mjs:73) / [复现](batches/build-release-03.md) | 构建接受运行时拒绝的编码/点路径，交付冒烟未使用实际嵌入配置。仅误配这类地址时配置门禁漏检；当前默认地址正常，运行时仍拒绝，不是域名限制绕过。 | 合法默认地址接受；编码/点路径在构建与运行时一致拒绝；冒烟读取实际包中嵌入的配置。 |
| CORE-CONTRACT-06-001 · P3<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/shared-core/tests/match-format.test.ts:102) / [复现](batches/core-contract-06.md) | 独立局免抗贡测试使用不存在的事件名。在内存加入真实 ANTI_TRIBUTE_DECLARED 事件后，原测试仍全部通过；是测试漏检，不是当前独立局真的错误抗贡。 | 独立局注入真实 ANTI_TRIBUTE_DECLARED 事件必须使原测试失败；正常独立局通过。 |

## 1. 优先修复终场、持久化与成员生命周期（12项P2）

| 编号 / 定位与证据 | 已确认问题及边界 | 修复验收要点 |
| --- | --- | --- |
| RP-13-001 · P2<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-windows-source/server/master-bot-policy.js:23) / [复现](batches/runtime-policy-13.md) | 转蛋合法轮换后，机器人/托管仍按固定玩家ID校验队伍。实际抽牌换队或顺时针第二局触发队伍错误；默认重试3次调用异常关房。8个角色/轮换/恢复组合复现，4个正常组对照通过；非真实微信断线实测。 | 两种转蛋轮换连续三局，机器人与真人托管均合法行动；恢复后保持动态队伍，坏队伍仍拒绝。 |
| SL-02-001 · P2<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-windows-source/server/weapp-match-lifecycle.js:419) / [复现](batches/server-lifecycle-02.md) | 离线自动准备未阻止终场或待持久收尾状态，提前重新发牌。四真人终场退出后出现新副牌；待收尾时原结算 state 被覆盖。没有证明已上报积分改变或真人收到混搭消息。 | 终场四人离线不再发牌；结算持久失败期间离线不覆盖原结算，恢复后至多推进一次。 |
| PR-08-001 · P2<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-windows-source/server/platform/game-result-service.js:78) / [复现](batches/platform-ingestion-08.md) | 换座留下的已离席历史成员覆盖当前席位，正确结果被拒绝。已确认升级好友房：正常离席、替补再离席、旧成员重入后，实际开局 roster 正确但结算映射错误；重试仍失败，无部分入账。未将定局/转蛋/复式专用结算一并判为受影响。 | 旧成员离席、替补再离席、旧成员重入后提交真实升级终场；仅当前四人各入账一次。 |
| TO-11-001 · P2<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-windows-source/server/platform/spectator-event-service.js:315) / [复现](batches/tournament-progression-11.md) | 首桌异常令赛事暂停后，其他桌关闭回调被拒绝，成员占用释放回滚。四桌均开始后依次异常关闭，后三桌12人仍占活动匹配，转入quick/取消旧匹配失败；重试和内存冷恢复仍失败。不是暂停赛程策略本身错误，未做16WS断连计时实测。 | 四桌依次/交错异常结束：保留赛事暂停，但四桌成员都能释放；重复回调与冷恢复不改分。 |
| SE-05-001 · P2<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-windows-source/server/weapp-game-start-coordinator.js:185) / [复现](batches/server-entry-05.md) | 一房开局保存失败的全局回执回滚，清掉另一房已成功操作的记录。另一房准备已保存并收到确认，取消后重发原请求 ID 仍再次准备；只证明合法准备重复执行，未证明重复结算/积分或越权。 | A房开局保存失败并发B房准备成功；B取消后重发原准备ID不得再次执行。 |
| SP-03-001 · P2<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-windows-source/server/weapp-room-expiry.js:32) / [复现](batches/server-persistence-03.md) | 自动动作失败整体回滚替换投票对象，旧到期任务按引用判断后失效。投票逾期仍保留并阻止新申请；主动拒绝或重启等其他路径可能恢复。 | 投票中自动动作失败回滚后，原投票仍按时过期；新投票不被旧计时器清除。 |
| SP-03-002 · P2<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-windows-source/server/weapp-room-expiry.js:12) / [复现](batches/server-persistence-03.md) | 过期/全员同意关房的持久提交失败后，只恢复保存，不继续关闭事务。已有过期关房触发外，第十四批新增验证四真人最后同意或一真人三机器人直接同意，两个保存点失败均可卡 ROOM_CLOSING；保存恢复/原请求重试/原投票到期仍不完成关闭。 | 过期或全票关房的两个保存点各失败一次，恢复后自动完成关闭与释放，无须重启。 |
| SD-04-001 · P2<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-windows-source/server/duplicate-room-runtime.js:125) / [复现](batches/server-duplicate-04.md) | 复式断连保存失败后保留悬挂在线身份。存储恢复后正确 token 和签名票据仍被拒绝重连；进程恢复清理身份等路径可解除，不是永久不可恢复。 | 复式离线保存失败后用有效token/签名票重连，恢复身份一致且不得出现双在线。 |
| SD-04-002 · P2<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-windows-source/server/duplicate-room-runtime.js:94) / [复现](batches/server-duplicate-04.md) | 复式房主在大厅解散后，其他成员连接仍归属旧房。正常复用连接首次进入新房失败；客户端失败恢复或新 transport 可恢复，不是永久卡死。 | 房主解散复式后，其余成员复用同一连接首次进入新房成功；旧房不能再收动作。 |
| SD-04-003 · P2<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-windows-source/server/duplicate-room-runtime.js:45) / [复现](batches/server-duplicate-04.md) | 复式已关闭记录仍占活动开房额度。平台已确认关闭并签发新票、活动房为零，仍可因墓碑计数被拒绝；真实入口上限 64，墓碑至租约/结束时间较晚者再加 24 小时后才清理。 | 关闭记录保留审计历史但不占活动额度；真正达到64个活动房仍限制。 |
| PS-08-001 · P2<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-windows-source/server/platform/spectator-domain.js:210) / [复现](batches/platform-ingestion-08.md) | 进行中观战者离开误用开房租约，堵塞同场公开事件。原租约+5分钟后实际游戏侧已移除 observer，平台拒绝释放并保留成员；真实 reporter 的后续 play 堵在 seat-left 后。不是出牌停止，也未证明独立结果上报通道停止。 | 超过开房租约的进行中观战者退出成功；后续公开事件继续，重复退出幂等、坐席违规离开仍拒绝。 |
| PF-06-001 · P2<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-windows-source/server/platform/friend-room-service.js:329) / [复现](batches/platform-friend-06.md) | 已离席旧成员再次加入绕过平台 12 人上限。普通/复式、邀请/房号均可出现平台 13 人并签发第 13 票，牌桌实际仍为 12 人且拒绝此票，导致平台成功而入桌失败；不是实际超额观战或隐私泄漏。 | 已离席成员在12人满房时通过邀请/房号重入都拒绝，不能先签票后被游戏端拒绝。 |

## 2. 恢复视角、规则与页面状态的一致性（5项P2）

| 编号 / 定位与证据 | 已确认问题及边界 | 修复验收要点 |
| --- | --- | --- |
| CS-01-001 · P2<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-cocos/assets/scripts/game/GameManagerProjection.ts:125) / [复现](batches/client-state-01.md) | 复式从已结束的 A 桌切到进行中的 B 桌，被旧投影的版本/阶段门禁拒绝。合法换桌观战仍停在原桌结算；须区分房间/对局/桌的状态来源身份。 | A桌结算后观看B桌，B版本小于/大于A都正常；同一桌的旧包仍拒绝，不重播已出牌。 |
| SA-01-001 · P2<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-windows-source/server/friend-room-observer-buffer.js:18) / [复现](batches/server-authority-01.md) | 延迟一局观战将已完成局数当成当前局号。第二局仍无法观看首局；第二局结算才首次获得第二局进行中快照。 | 延迟一局：首局无画面、第二局可看完整首局；绝不出现当前局牌面。 |
| SL-02-002 · P2<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-windows-source/server/friend-room-observer-runtime.js:133) / [复现](batches/server-lifecycle-02.md) | 启用观战的好友房重连遗漏离线投票状态恢复。已坐回牌桌的玩家票态仍 offline，客户端不再显示这次解散投票框。 | 解散投票期间掉线并重入，offline票态恢复pending，投票框可再次操作。 |
| PG-17-001 · P2<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-cocos/assets/scripts/services/platform/friendRoomGateway.ts:32) / [复现](batches/platform-gateways-17.md) | 好友房关闭记牌器的配置在客户端双向归一化中被丢弃。定局/升级/转蛋/复式4种玩法均复现关闭后仍显示；服务端支持该字段，缺陷在客户端DTO白名单；无真机绘制验证。 | 定局/升级/转蛋/复式的记牌器false经表单、请求、存储、恢复、HUD完整往返。 |
| LP-19-001 · P2<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-cocos/assets/scripts/scenes/front-pages/LobbyPageDomain.ts:415) / [复现](batches/page-lifecycle-19.md) | 同步资料期间往返子页面，大厅数据已更新但当前菜单不重绘。两路由×两响应顺序均停在账号同步中/--，显式重排恢复；非授权失败、数据丢失或不能打牌。 | 资料请求期间离厅再返厅，成功/失败两种响应都更新当前菜单，不抢回其他页面。 |

## 3. 修复可见交互、排布与资源恢复（17项P3）

| 编号 / 定位与证据 | 已确认问题及边界 | 修复验收要点 |
| --- | --- | --- |
| CI-05-001 · P3<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-cocos/assets/scripts/ui/HandController.ts:120) / [复现](batches/client-input-05.md) | 本人权威动作清理选择后，旧触摸收尾重新选中存活牌。首次超时尚未托管且允许预选时，旧 touchend 在新手牌状态恢复本应清空的选择；无网络提交、非法出牌或锁组拆开证据；由 CH-04-C01 升级，不重复计数。 | 触摸未结束时收到本人权威动作，旧touchend/长按不能重新选牌；他人动作仍保留正常预选。 |
| CTL-06-001 · P3<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-cocos/assets/scripts/scenes/TableTurnClockController.ts:85) / [复现](batches/client-table-lifecycle-06.md) | 选牌刷新先于同秒 tick 可吞掉倒计时提示音。真实输入链可漏播最后五秒音效，文字/HUD 秒数、服务器 deadline 和自动出牌不受影响；未做真机听测。 | 最后5秒内连续选牌/元数据刷新，倒计时音效每秒至多一次且不漏；切阶段不串音。 |
| AUDIO-15-001 · P3<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-cocos/assets/scripts/audio/CocosAudioController.ts:74) / [复现](batches/audio-lifecycle-15.md) | 离桌/静音/销毁取消不到已提交引擎的短音效。Cocos3.8.8真实stop只停止普通player，playOneShot独立加载/播放；6个取消/阶段组合复现迟到或继续播放，应用资源阶段3个取消对照正常。未真机听测，自然结束可释放。 | 音频加载前、引擎加载中、已播放时退出/静音/销毁均能取消；BGM声道独立。 |
| RESOURCE-06-001 · P3<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-cocos/assets/scripts/services/DefaultProfileFrames.ts:14) / [复现](batches/resource-frames-06.md) | 机器人默认头像首次失败后 pending 不释放。底层加载已恢复，后续仍不重试，只显示兜底头像；不影响发牌或进入牌局。 | 头像加载首次失败后资源恢复，后续正常请求可加载；并发只发一次，成功命中缓存。 |
| PG-17-002 · P3<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-cocos/assets/scripts/services/platform/friendRoomGateway.ts:126) / [复现](batches/platform-gateways-17.md) | 修改新规则仍复用旧创建幂等ID。首次创建响应丢失、旧房租约过期后，改变发牌/升级目标/转蛋轮换/计分会多报一次409；再点一次可恢复，相同设置重试正常。 | 首次创建已落盘但响应丢失：同配置重试同ID；租约结束后改任一规则用新意图ID。 |
| RP-19-001 · P3<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-cocos/assets/scripts/scenes/front-pages/ReplayPageDomain.ts:46) / [复现](batches/page-lifecycle-19.md) | 回放后台暂停但按钮仍写暂停，点击反而播放。实际模型已停，旧timer被取消；没有额外reflow时按钮旧，正常暂停对照正确；不影响真实对局/积分。 | 回放中切后台再回来显示播放，点击才播放；过期timer不推进，不自动抢回页面。 |
| FR-21-001 · P3<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-cocos/assets/scripts/scenes/DuplicateTablePresentation.ts:3) / [复现](batches/friend-views-21.md) | 复式进行中比分忽略“结算显示”设置。进行中复式HUD仍输出红蓝累计分；转蛋同设置对照正确。仅展示策略，未改计分。 | 复式/转蛋在playing隐藏比分，settlement显示真实结果；计分本身不变。 |
| FR-21-002 · P3<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-cocos/assets/scripts/scenes/DuplicateTableStatusView.ts:10) / [复现](batches/friend-views-21.md) | 复式跨桌观战按钮在窗口变窄后仍留在旧位置。本桌结束后1565→960设计宽度，按钮全宽移出新右界；相同摘要不恢复，摘要改变重绘恢复。 | 复式同数据下宽→窄→宽，跨桌按钮保持安全区内、可点，不能依赖比分更新来重排。 |
| UI-22-001 · P3<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-cocos/assets/scripts/ui/RuntimeUiFactory.ts:213) / [复现](batches/animation-lifetime-22.md) | 旧入场Tween覆盖按钮长按缩放反馈。12个入场内长按时序回到scale=1，4个入场后长按保持.96；取消/离页防线有效，无重复业务动作结论。 | 按钮入场过程中长按仍保持按下态，取消/离页恢复；无重复开房或迟到点击。 |
| UI-25-001 · P3<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-cocos/assets/scripts/ui/PlayAreaController.ts:191) / [复现](batches/table-presentation-25.md) | 观战切换玩家后旧出牌仍使用原视角坐标。真实消息路由→恢复→协调器→出牌区12种切换均复现；相同快照refresh不恢复，显式layout可恢复。不是服务端牌权/隐藏手牌泄漏。 | 四席12种观战视角切换，既有出牌立即按新视角重排，同动作不重播动画。 |
| UI-25-002 · P3<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-cocos/assets/scripts/ui/TableToolbarLayout.ts:16) / [复现](batches/table-presentation-25.md) | 工具条布局覆盖锁牌按钮的可用高亮。lock/unlock最终均被绘成普通色；恢复/锁牌文字正确，未证明锁牌功能失效。 | 锁牌/恢复可用高亮在最终toolbar layout后仍正确；不可用色与触控行为一致。 |
| HAND-26-001 · P3<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-cocos/assets/scripts/game/HandDisplayOrdering.ts:171) / [复现](batches/hand-projection-26.md) | A2345同花顺叠放把A放到末尾。5505炸弹强度被当序列点数，4花色×自然/红心配×auto/lock共16组；16分类对照正确，规则出牌仍合法。 | 4花色自然/配牌A2345同花顺，auto/lock叠放顺序正确；10JQKA与5.5炸弹比较不回归。 |
| HAND-26-002 · P3<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-cocos/assets/scripts/game/PublicStraightFlushPossibility.ts:34) / [复现](batches/hand-projection-26.md) | 记牌器把不能参与顺子的普通级牌计入可能性。520精确剩余五牌场景中150误亮；370合法和150红心配对照正确，不读取暗牌、不改变判牌。 | 全部级数/花色/连续段：普通级牌不填顺子槽，红心配一次只补一个；无可能时四花色全灰。 |
| UI-27-001 · P3<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-cocos/assets/scripts/scenes/TableOverlayController.ts:54) / [复现](batches/scene-lifecycle-27.md) | 已打开弹窗的遮罩/拦截节点不随窗口变宽更新。3种弹窗×2宽度共6例缺285/512宽度；重开恢复，独立手牌阻塞仍有效；未实测底层按钮误触。 | 保持弹窗打开调整横屏宽度/安全区，背景遮罩与输入拦截全覆盖；不阻断合法弹窗操作。 |
| UI-27-002 · P3<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-cocos/assets/scripts/scenes/TableOverlayController.ts:242) / [复现](batches/scene-lifecycle-27.md) | 解散表决发送失败仍收起投票框。发送异常/重连×同意/拒绝4例无发送且票pending，无直接重试入口；新投票消息可重开，不是计票错误。 | 同意/拒绝发送失败保留可理解的待提交/重试状态；重发不重复计票。 |
| RESOURCE-27-001 · P3<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-cocos/assets/scripts/scenes/SceneBackdropController.ts:82) / [复现](batches/scene-lifecycle-27.md) | 牌桌背景首次失败后再次入桌不重试。callback错误/15秒超时两例，5次入桌仍显示大厅背景；显式preload可恢复，不阻断对局。 | 牌桌背景错误/超时后重新入桌可重试，迟到旧请求不能覆盖新场景。 |
| LP-28-001 · P3<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-cocos/assets/scripts/ui/LobbyMenuView.ts:73) / [复现](batches/ui-surfaces-28.md) | 已开放赛事的大厅卡片仍硬编码筹备中。合法open响应下实际入口可免费报名并确认检录，但卡片仍暗示未开放；不阻断报名，不代表线上此刻有开放赛事。 | 赛事入口和详情对open/closed/失败状态不互相矛盾，正常报名检录可达。 |

## 4. 收束兼容接口与文档债务（4项P3）

| 编号 / 定位与证据 | 已确认问题及边界 | 修复验收要点 |
| --- | --- | --- |
| CS-01-002 · P3<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-cocos/assets/scripts/game/NetworkMatchSnapshotController.ts:88) / [复现](batches/client-state-01.md) | 应用恢复同一结算时重复累加本地会话统计。未发现当前业务 UI 消费者；不是服务端积分或平台排行榜重复结算。 | 重启或复原同一结算不重复本地统计；新对局正常计数，平台分数不受本地回放影响。 |
| CORE-RULES-01-001 · P3<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/shared-core/src/lib/engine.ts:247) / [复现](batches/core-rules-01.md) | 旧兼容 `dealNextRound` 丢失赛制字段。兼容 API 的个人排名局可提前结束；当前主流程未发现调用。 | 若保留兼容入口，个人排名赛制字段跨局不丢；若退役，调用点与导出同步限制。 |
| CORE-RULES-01-002 · P3<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/shared-core/src/lib/engine.ts:276) / [复现](batches/core-rules-01.md) | 旧兼容过牌用对象引用定位末次出牌。JSON 恢复后可提前清轮；当前 `transition` 主流程不使用此逻辑。 | 兼容状态JSON恢复前后过牌归属一致；活动transition行为不受改动影响。 |
| DOC-39-001 · P3<br>[源码](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-cocos/THIRD_PARTY.md:45) / [复现](batches/resource-boundaries-39.md) | 第三方说明仍描述退役男声、快捷语及级牌音效。文案25运行/2归档与实际4/22不符，男声脚本已不存在；40个男声hash与快捷语/级牌专属音效均不在当前资源或现有包内，不是功能回流。 | 更新当前能力/入口/文件清单/节奏/资源说明，历史记录标日期与退役；不恢复旧功能。 |

补充扩展证据：SP-03-002的投票关房场景见[第14批](batches/room-commands-14.md)；DOC-39-001的活动说明、路径清单与历史边界见[根文档报告](batches/document-baselines-40.md)、[其余文档报告](batches/document-history-40.md)。

## 实施约束

- 先将已有最小复现转成修复前失败、修复后通过的跨模块回归，保留正常路径、幂等、旧消息拒绝和隐藏手牌边界的对照。
- 不把关闭开关、取消版本门禁、清历史记录或删功能当作正确修复；优先修状态身份、房间事务边界、配置codec、布局失效与资源所有权。
- 不复活实验室、快捷语、男声、级牌专属音效、复制完整口令页面和复杂自动顺子理牌；旧名回归可能是退役守卫，不应按名字删除。
- 兼容/迁移能力先核活动调用与外部契约再决定保留或退役；目前未发现UI消费的本地统计不应被说成线上积分重复。
- 修复完成后按[人工验收表](MANUAL_ACCEPTANCE.md)验收，并重新构建核验实际交付包；此次审计不签发上线结论。
