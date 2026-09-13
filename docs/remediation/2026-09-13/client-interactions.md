# 客户端交互与布局整改

范围：CI-05-001、FR-21-001、FR-21-002、UI-25-001、UI-25-002、UI-27-001、UI-27-002，共7项P3。仅修改和测试，不提交、不部署，不修改审计历史。未编辑原有dirty的GameScene、TablePhasePresenter及其原回归。

使用`ui-ux-pro-max`技能检查触摸取消、提交失败反馈和响应式边界；保持既有颜色、按钮尺寸、字体、面板风格和交互入口，不增加视觉重设计。技能的失败反馈/重试原则具体落实为投票发送失败保留弹窗并显示中文重试提示。

## 实施与原生回归

| ID | 修复 | 验证 |
| --- | --- | --- |
| CI-05-001 | 新独立`game/HandGestureEpoch.ts`按权威手牌、本人回合结束、阶段/轮次/视角作用域推进输入代际，协调器显式传给HandController。代际失效取消拖选及长按；长按闭包身份隔离，迟到旧计时器不能激活新触点。普通刷新/他人动作不无条件取消合法预选。 | `hand-gesture-lifecycle-regression.cjs`复用实际CardView触摸坐标支架，经实际TableMatchCoordinator→GameManager→HandController和规则引擎PLAY/PASS验证：增量/恢复×touchend/长按4组合、本人PASS2组合、迟到timer与新触点、他人动作/重复刷新预选正常。既有坐标、取消、HUD排除/叠牌对照仍通过。 |
| FR-21-001 | TableHudPresenter统一计算仅playing阶段的隐藏比分策略，显式传给复式标签与转蛋标签；结算展示真实比分，原始计分数据不变。 | `table-interaction-state-regression.cjs`实际HUD投影：复式/转蛋×hidden/live×playing/settlement共8组合；保留桌别/模式标签和真实终场分，检查源快照未变。既有运行时设置断言更新为共享策略契约，不删行为覆盖。 |
| FR-21-002 | 复式状态缓存纳入viewport；所需节点被销毁时重建。TableMatchCoordinator.refresh调用现有duplicate状态渲染端口，接通GameScene已有resize→refresh路径，不再等待房间摘要变化。 | 同摘要、3身份（A桌/B桌/旁观）×4组宽高/安全区，按钮始终按最新安全边定位，重复刷新复用、销毁重建、每次点击只发1个watchTable意图，返回本桌及非playing隐藏。另有协调器refresh动态接线/销毁对照。 |
| UI-25-001 | PlayAreaController在humanId变化时立即重排已缓存动作；中断旧位置tween并落到新视角坐标，Pass根节点scale收尾为1，保留opacity到期回调和既有呈现票据。 | `play-area-presentation-regression.cjs`四席12种换视角，原牌/Pass节点不替换，不重放同动作；Pass旧位置tween移除、到期仍销毁且不复活，旧揭牌票据无效。既有真实飞牌控制器收缩/落桌回归通过。 |
| UI-25-002 | TableToolbarLayout接受显式active状态查询；TableGameHud两处布局调用均传入锁牌/恢复可用状态。文字宽度重绘不再覆盖语义高亮。 | 实际TableGameHud→TableToolbarLayout→绘制基础模块的render/update/layout/扩展尺寸链，lock/unlock/unavailable×两种理牌文字6组合，检查最终Graphics填色参数、统一按钮尺寸、取消托管长文字宽度、按压/取消恢复与单次点击。 |
| UI-27-001 | TableOverlayController记录每个遮罩/面板的绘制参数；resize原位更新全屏UITransform及Graphics，不替换弹窗节点、按钮和投票状态。 | `table-overlay-controller-regression.cjs`退出/提示/解散3种×4组宽高（1565×720、960×540、1792×828、1280×720）及四边安全区，遮罩与输入拦截尺寸一致、面板保留、原按钮能关闭/表决；销毁后回调无效。 |
| UI-27-002 | 表决返回null时保留待投票弹窗并提示网络重试；成功才关闭。弹窗已清理时忽略排队的重复点击。 | 实际LobbyCommandSender的发送异常/rejoining×同意/拒绝4组合；失败0发送且票仍pending，原按钮恢复后成功1发送，重复已排队点击不再发送。保留原投票过期与销毁对照。 |

所有样本使用合成牌局/房间/投票。Cocos节点、Graphics、调度及素材端口为明确内存支架，相关协调器、管理器、规则引擎、发送器和布局/绘制模块为实际源码。没有读取平台state、真实用户资料、账号凭据或外部服务，也没有启动生产入口。

## 验证记录

新增两项原生回归：`tests/hand-gesture-lifecycle-regression.cjs`、`tests/table-interaction-state-regression.cjs`，由主流程纳入默认测试链。扩展5项旧回归：`table-match-coordinator`、`selection`、`play-area-presentation`、`table-overlay-controller`、`friend-room-runtime-settings`。

在仅测试进程的`fs.readFileSync`替换层中，对应模块读入`git show HEAD:...`旧源码，7项缺陷及FR-21-002刷新接线共8个回退检查均预期失败：旧触点重新选中a；隐藏比分仍含37；按钮/出牌坐标保留旧值；刷新未调用状态视图；锁牌色被覆盖；遮罩仍为1280宽；失败表决弹窗已销毁。UI-27-002仅回退发送失败分支，以避免先被遮罩断言截停。未覆盖/回退任何工作区文件。现实现全部通过。

在`work/guandan-cocos`执行并通过以下18项：

```sh
node tests/hand-gesture-lifecycle-regression.cjs
node tests/table-interaction-state-regression.cjs
node tests/table-overlay-controller-regression.cjs
node tests/play-area-presentation-regression.cjs
node tests/selection-regression.cjs
node tests/table-match-coordinator-regression.cjs
node tests/hand-touch-coordinates-regression.cjs
node tests/table-hand-interaction-controller-regression.cjs
node tests/table-game-hud-regression.cjs
node tests/table-snapshot-presenter-regression.cjs
node tests/table-network-event-bridge-regression.cjs
node tests/table-scene-assembly-regression.cjs
node tests/friend-room-observer-regression.cjs
node tests/front-page-reflow-regression.cjs
node tests/table-layout-overlap-audit-regression.cjs
node tests/table-hud-seat-view-group-regression.cjs
node tests/table-hud-turn-timer-view-regression.cjs
node tests/friend-room-runtime-settings-regression.cjs
pnpm typecheck:runtime
git diff --check
```

`typecheck:runtime`的运行时代码和refactor测试两套tsconfig均通过。本范围无未完成代码项；完整仓库回归由主流程汇总。未声称Cocos GPU实际绘制、微信真机触摸/旋转/网络或交付包验收完成。字号/配色检查是源代码和绘制调用参数级验证，不能替代真机视觉验收；现有布局交叠告警不因本次缺陷修复被改成无告警结论。
