# 第二十五批：牌桌呈现、布局与交互边界

本批完整审阅22个第一方文件，共3294行，新增2个P3。全库进度454/629（72.18%）；累计33项确认问题（17P2、16P3），不是全库健康证明。

## 确认问题

### UI-25-001（P3）：观战切换后出牌还留在原位

位置：`work/guandan-cocos/assets/scripts/ui/PlayAreaController.ts:191`。

好友房头像点击→watchPlayer→服务端roomView.myPlayerId改变；FriendRoomViewReceiver仅reset网络sync并发recovery。PlayArea.render更新authoritativeHumanId，但同actionKey直接return，未重排节点；resetPresentation只清ticket/显牌，不更新坐标。GameScene.setTableVisible(true)不layout，layoutSeats只布局头像，均不能补救。

隔离真实LobbyMessageRouter/FriendRoomViewReceiver/LobbySyncTracker/EffectActionPresentationCoordinator/TableMatchCoordinator/PlayArea链：同一123456房、gameVersion=5、权威playArea未变，12种旧→新视角均保留旧p3出牌坐标。p1→p3时actual(0,165)，expected(0,86)；正常refresh不修复，显式layout恢复。384种初始座位/观众/出牌者对照正确；未连接真实WS/微信。

建议：将viewer身份纳入布局失效条件：render更新humanId后若变化，重排现有节点或重建投影；保持相同动作不重播动画。为roomView视角切换增加真实PlayArea联合回归，包括有Pass/进行中动画和不改变playArea长度。

### UI-25-002（P3）：布局把锁牌高亮覆盖掉

位置：`work/guandan-cocos/assets/scripts/ui/TableToolbarLayout.ts:16`，调用链见`TableGameHud.ts:542`。

TableGameHud.renderViews:537-539按lockDecision绘制活动色；同函数542随即layoutTableToolbar，后者对每个按钮固定drawTableHudButton(view,false,false)，把活动色覆盖。导致lock/unlock渲染最终与unavailable同色；布局承担了重复视觉状态职责。

实际TableGameHud/所有拥有视图/真实Foundation/Toolbar，三决策渲染均为RGBA(17,57,69,240)；直接同Foundation语义绘制lock/unlock应为(159,112,25,246)，unavailable控制一致。恢复/锁牌文字保持正确，未发现因此无法锁定/恢复；Graphics为颜色记录替身，非真机截图。

建议：让toolbar仅布局或显式接受每个button的active/pressed状态；由唯一渲染入口在布局之后应用语义状态。加完整render/update后的最终颜色断言，不仅检索drawToolButton调用存在。

## 动态核验

- 6个既有回归入口均通过；其动态/静态覆盖区别逐文件写在JSON。
- 104组不同级牌/规则/8张以内手牌，与26,008个子集穷举对照：可出牌按钮决策一致，相同语义JSON重绘不重复枚举。不是满手最坏性能测试。
- 384个初始座位排列/观众/出牌者组合定位正确；12种动态观战切换却复现旧坐标问题。
- 16组真实Tween“不要”寿命/恢复/销毁时序：到期不复活，清局后正常重新出现。
- 真实HUD及全部拥有视图经过80次状态轮转，40次相同状态重复保持95节点；3组尺寸的点击空隙、隐藏拒绝命中、记牌器拖动/折叠顶边不跳通过。
- 36尺寸/安全边几何、6种张数侧扇锚点、按钮设计单位间隙10均符合本次断言；250组双轮廓/重复/裁剪矩形交叠与独立像素格网oracle一致。
- 最终锁牌颜色3种决策对照证明语义高亮被布局覆盖，文字与功能不据此判错。

复现：`node docs/audit/2026-09-12/repro/table-presentation-25.cjs`。

## 审计边界与避免误报

- 只写docs/audit/2026-09-12，无产品/测试断言修改、Cocos构建、网络/上线/数据访问。
- 16源文件+6测试完整审阅22文件3294行；既有辅助核心/网络/协调器/屏幕与布局模块不重复计数，GameScene和ui-recovery-regression仍未完整审阅。
- 模拟节点、UITransform命中和Graphics非真实UI渲染/触控；只复用本机Cocos3.8.8九份Tween算法，不代表全引擎或第三方专项通过。
- Touch Target Size/Touch Spacing技能检索匹配移动端；这里只核统一设计单位与间隔/遮挡逻辑，不将44pt/48dp直接当设计单位判定；未改变视觉方向。
- 静态结构测试通过不等于真实联机/真机验收，两项新增均有独立动态复现；剩余第一方和资源/产物/跨模块专项仍继续。

原有HUD回归部分仍使用旧42高度；当前实际折叠高度为69.6，新增probe读取Foundation常数。禁用记牌器时隐藏节点保留旧几何是有意短路，不据此报可见布局问题。座位组dispose后旧avatar hit引用的同实例重用未找到活动调用：当前presenter会新建HUD，因此不升级成实际头像故障。

逐文件路径、SHA-256、审阅说明和探针输出见[同名JSON](table-presentation-25.json)。

