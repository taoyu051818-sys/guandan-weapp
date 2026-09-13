# 第十九批：大厅刷新、赛事页面与回放生命周期

基线 HEAD：`1d58999dc6e5455b049e1643660bbba3deee1406`。根线程完整审阅22个新文件，共2,545行，逐文件结论/哈希见 [JSON](page-lifecycle-19.json)。本批新增2项确认问题（P2/P3各1项），未修改产品代码。

## P2 · LP-19-001：返厅后资料已返回，画面仍在同步

位置：`work/guandan-cocos/assets/scripts/scenes/front-pages/LobbyPageDomain.ts:415–426`，关联 `showMenu:138–153`、`FrontPagePlayerState.invalidate` 和 `LobbyPlayerProfilePresenter`。

触发过程：

1. 首次进入大厅，请求资料和钱包尚未返回，显示“账号同步中”和“--”。
2. 进入经典玩法选择或好友房设置，再返回大厅。
3. 新菜单令牌已改变、资料已清空；但旧请求的loading仍为true，禁止新菜单刷新请求。
4. 旧请求写入正确资料/钱包后，因令牌不符不重绘当前菜单。
5. 当前页面没有自动资料重绘定时器，已安排的邀请激活也不改变显示。显式重排、有效重入等可恢复。

[复现脚本](../repro/lobby-refresh-19.cjs) 使用实际Domain、资料/钱包状态和资料Presenter；网络响应、UI节点/绘制、设置Presenter、邀请及原生端口为合成。两个子路由×两种响应顺序，共4例全部复现；数据fresh与显示旧文案同时成立。正常停留菜单、请求完成时仍留子页面两个对照通过。

影响限于错误的同步状态和资料显示，不是微信授权失败、钱包丢失或无法打牌。原生自动资料同步对已经generated/saved的用户不会带来额外保存重绘，因此不能依赖它兜底。

建议：给在途资料请求一个独立于页面令牌的所有者，返厅可订阅其完成结果，再通知当前菜单重绘。保留用户身份/销毁/离页隔离；不能简单取消所有令牌校验，也不应每次重排都重发HTTP。

## P3 · RP-19-001：后台暂停后的按钮语义相反

位置：`work/guandan-cocos/assets/scripts/scenes/front-pages/ReplayPageDomain.ts:46`；关联播放控制约148–174行及 `FrontPageController.ts:230–234`。

回放播放时切后台，实际模型被暂停、旧定时器也正确失效，但UI没有重绘。前台回调只恢复赛事。在没有额外resize/reflow的情况下，按钮仍显示“暂停”；按它读取到isPlaying=false，结果重新开始播放。

[复现脚本](../repro/page-lifecycle-19.cjs) 调实际ReplayPageDomain/Timeline确认这一行为，同时确认普通暂停正确变为“播放”、手动寻址使旧timer失效、迟到详情不能夺回已返回的列表。没有实际设备前后台/GPU测试；若设备额外触发resize可能掩盖此问题。

建议后台暂停时同步视图，或前台恢复时只重绘当前回放页的暂停状态，不自动开始播放、不重新打开用户已离开的页。该问题不影响真实对局、积分和隐藏牌。

## 本批其他结论

- 赛事控制器有独立代际、单飞和操作忙状态。旧页面列表请求成功/失败都不能覆盖新页面；排队取消等待轮询的新结果，名单锁定后不会发出取消。30次数据不变轮询不重建按钮。轮询间隔为请求完成后1秒，慢网时不是每秒并发启动新请求。
- 模型明确区分报名、检录、进入分桌、暂停及最终排名；赛事页面依赖服务端结果，不自动填造比赛成绩。页面视图按统一安全区缩放，仍待GPU和真机验收。
- ReplayTimeline只归约公开事件，保留序列身份/冻结快照，支持末尾追加和乱序补齐。80组乱序/重复事件，每组66个光标状态，共5,280次，与完整构造及函数归约对照一致；输入未被原地排序，修改输入卡片不污染已发布状态。
- 固定队伍的replayWinnerLabel不能独自证明转蛋回放错标。现有平台finalizeMatch/getReplay不返回viewerSeat，实际走中立视角；转蛋专用match-ended不生成这套普通replay。未人为补入活动接口不存在的字段来报告线上事故。
- 商城仍为明确只读预览，没有购物/扣款gateway。Shop.reflow间接调用showPreview会增加页面令牌；现有正则测试只检查reflow直接文本，无法证明间接无副作用。当前没有实际HTTP/写入后果，记录测试边界而非新增缺陷。
- 开发预览数据与每会话Store独立复制冻结，生产配置下不使用样例用户/赛事；没有把开发数据当成真实线上内容。

## 验证

以下5个既有入口均全文审阅后本地运行通过：

```sh
node work/guandan-cocos/tests/tournament-center-regression.cjs
node work/guandan-cocos/tests/front-page-reflow-regression.cjs
node work/guandan-cocos/tests/preview-state-isolation-regression.cjs
node work/guandan-cocos/tests/replay-viewpoint-regression.cjs
node work/guandan-cocos/tests/replay-timeline-regression.cjs
node docs/audit/2026-09-12/repro/lobby-refresh-19.cjs
node docs/audit/2026-09-12/repro/page-lifecycle-19.cjs
```

既有测试全部通过仍未覆盖上述两个页面反馈时序。补充赛事5个时序含30次不变轮询，不代表整个16人赛事再次全程联机。

UI/UX技能用于检查异步反馈与真实状态一致；采用已核对的Loading Indicators/Loading States建议，不把Web ARIA/CSS范例直接套到Cocos，不调整原视觉风格。

只写审计目录；没有构建/发布、真实网络、账户/好友数据访问、生产重启或业务修复。其余文件、资源/第三方/发布边界与最终跨模块验收仍待继续。

