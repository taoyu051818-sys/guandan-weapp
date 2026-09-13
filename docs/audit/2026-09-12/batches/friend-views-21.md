# 好友房设置、等待页与复式桌面审计（第二十一批）

基线：`1d58999dc6e5455b049e1643660bbba3deee1406`。仅审计；15文件完整审阅，共1969行。逐文件哈希/边界见 [JSON](friend-views-21.json)。

## 确认问题

### FR-21-001 · P3 · 复式进行中比分忽略“结算显示”设置

位置：`work/guandan-cocos/assets/scripts/scenes/DuplicateTablePresentation.ts:3`。

FriendRoomSettingsPolicy给复式提供score-visibility并生成hidden。TableHudPresenter.ts:147直接优先duplicateTableLabel(d)，仅备用projectTableModeLabel收到hidden；此函数无条件输出红蓝累计分。server duplicateSnapshot保留roomSettings及累计scores，正常轮间得分不会清空。

复现：node docs/audit/2026-09-12/repro/friend-views-21.cjs：实际policy→实际TableHudPresenter→实际DuplicateTablePresentation，playing第二局比分3:1，hidden/live均输出‘复式 A桌 · 红 3 : 蓝 1’；实际转蛋投影hidden/live两对照分别隐藏/显示个人分。

建议：把比分可见性作为共享HUD投影输入，复式/转蛋按同一策略在进行中隐藏；结算保留真实比分。补上两种模式、两个设置、playing/settlement的行为测试。

边界：仅显示契约缺陷，累计计分/服务端权限未因此改变；分数不是隐藏手牌。内存HUD绘制端口，不是真机截图。

### FR-21-002 · P3 · 复式跨桌观战按钮在窗口变窄后仍留在旧位置

位置：`work/guandan-cocos/assets/scripts/scenes/DuplicateTableStatusView.ts:10`。

signatures仅JSON.stringify(d)，没有viewport/insets。GameScene.applyResponsiveLayout:554–561更新普通HUD和tableMatch.refresh，不重新布局此独立root；后来同d元数据重绘亦提前return。TableGameHud只重布局它自有节点，不移动这个附加root。

复现：实际renderDuplicateTableStatus配内存Node/UI：p1/p3本桌已结束及未入席观战3例，1565×720→960×720后按钮x仍642.5，宽204左缘540.5超出新右界480；即使再传同内容d也无更新。改变ready触发重建后x340正确。

建议：分离内容更新与layout，尺寸事件必调用布局；或签名纳入viewport/insets并补resize调用。测试同数据不同尺寸、同数据节点已销毁、换桌和普通playing不显示。

边界：依赖窗口/安全区变化，不是固定尺寸首次加载必现；已确认设计坐标越界与可达调用链，未做真实浏览器GPU/折叠屏/手机旋转测试。不能与CS-01-001跨桌版本门禁合并为同一根因。

## 验证与边界

3既有入口通过；496选项有效性/往返、32草稿重绘/代际、11房号、16规则topic/尺寸、18摘要规范化，以及3尺寸缺陷复现和4比分显隐案例通过。

复现入口：[friend-views-21.cjs](../repro/friend-views-21.cjs)。运行已有3个回归入口均通过；runtime-settings回归是静态接线检查，不代表配置端到端生效。八席/四席机器人权限既有矩阵通过，普通输入去重/取消和失败返回流程通过。

15文件共1969行完整阅读。既有已审Policy/Domain/GameScene/HUD/服务器projection/actions仅辅助链路复核，不重复计数。

复现重用已读既有测试的纯class/compiler前缀，改的是测试fixture默认值20秒和Mock补充方法，不改产品模块；生成variant文件只作已审共享源的对应模块加载。

所有新增测试节点/绘制/屏幕/网络为内存替身，无创建真实房间、发送邀请、微信权限、真机输入/裁切、Cocos构建、资料上传、Git或部署写入。初次探针缺matchFormat依赖失败，补全harness依赖后完整运行通过，未计为产品问题。

UI/UX技能用于检查显式标签、反馈、模态关闭和布局刷新。两项均P3，未确认新增权限/结算/手牌泄漏问题；不是全库健康结论，业务修复待授权。

