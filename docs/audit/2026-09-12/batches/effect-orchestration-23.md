# 第二十三批：出牌动画编排、取消与恢复

结论：14份文件完整审阅，共2,041行。本批未新增确认问题；这不是动效全部验收或既有问题已修复。静态全读EffectController，动态探针执行两协调器、真实PlayArea、CardFlight、registry/profile/policy；完整Controller与真实炸弹renderer留下一批。

## 覆盖与证据

- `work/guandan-cocos/assets/scripts/effects/EffectController.ts`（342行）：完整342行。核setup唯一registry、画质变更取消、action/queue委托、major优先级/busy所有权、shake和卡牌反应取消、只读asset缓存。活动调用为GameScene/TableMatchCoordinator；本批不运行完整Controller与真实renderer，资源加载迟到/actual renderer下一批复核，不以分层合理推定所有绘制无问题。
- `work/guandan-cocos/assets/scripts/effects/EffectPlaybackCoordinator.ts`（220行）：完整220行。核串行动作包含preload/flight/impact全寿命、代际重置不受旧promise堵塞、语音只在开始一次、取消和恢复语义不同、普通/六炸与普通炸分路、失败释放和barrier。28阶段×reason取消，40串行动作、7失败和4prepared场景通过；资源/flight端口合成，不是GPU。
- `work/guandan-cocos/assets/scripts/effects/EffectActionPresentationCoordinator.ts`（103行）：完整103行。核静默baseline/duplicate保留本地origin、只连续append播一次、gap取消并reset、ticket贯穿逐张reveal、提前reset稍后接presentation。11真实PlayArea配合成CardView案例通过；不得只按actionCount推定跨桌身份无风险，已知CS-01-001在上游仍未修复。
- `work/guandan-cocos/assets/scripts/effects/CardFlightController.ts`（114行）：完整114行。核独立ghost、world→local、统一扇形间距/0.8比例、贝塞尔与完成前缩放、逐张回收再reveal、异常callback不中断、预载/中途取消/池失败回收。10组60/120Hz+5故障/取消，以本机Tween算法和内存节点通过。未测真实分辨率变化中的飞行轨迹。
- `work/guandan-cocos/assets/scripts/effects/NetworkEffectSyncPolicy.ts`（70行）：完整70行。核room/version/actionCount门禁及forced recovery优先、跨room静默、round-reset和actiongap、不因metadata版本差当作新动作。1248人工观察/force组合与既有tracker回归通过；不重复计旧跨桌source身份缺陷。
- `work/guandan-cocos/assets/scripts/effects/EffectPolicy.ts`（23行）：完整23行。核immutable policy只0/1大特效、永不禁止输入、替换旗标规范化。5非法/合法max值对照；注释中的可替换不证明活动串行队列真的发生并发major。
- `work/guandan-cocos/assets/scripts/effects/ArchivedPlayVisuals.ts`（100行）：完整100行。核退役原因/旧renderer/key/type永久清单freeze、四个仅炸弹allowlist、flow通配拒绝。actual registry对所有拒绝key与3画质/两种注册表均零render；它是防回流清单，不是僵尸玩法入口。资源许可证与source来源仍为后续专项。
- `work/guandan-cocos/assets/scripts/effects/EffectRendererRegistry.ts`（126行）：完整126行。核先全量校验再register、normalize去重、按renderer身份unregister、fallback不得绕过禁入、prepare/render异常转换、active句柄清理、clear按唯一实例dispose。既有及64补充registry/prepared案例通过。动态替换旧renderer的dispose语义不用于当前只setup注册一次的活动流程，未误报泄漏。
- `work/guandan-cocos/assets/scripts/effects/EffectProfileResolver.ts`（34行）：完整34行。核仅Bomb含专属效果、六张单独key、非炸含同花顺/王炸只飞牌与语音、off保留语音/独立sound设置、reduced缩短且降画质。198类型/张数/画质映射通过；这是视觉策略不是同花顺5.5张大小比较实现。
- `work/guandan-cocos/assets/scripts/effects/EffectRecipes.ts`（79行）：完整79行。核immutable普通炸与六炸配方、full/reduced/off、禁止额外flow配方。既有配方单测通过；旧crack/flame计数字段不代表renderer绘制全部层，实际消费者后续核验，不直接宣称死代码可删。
- `work/guandan-cocos/assets/scripts/effects/EffectRenderer.ts`（11行）：完整11行。核纯type renderer契约supports/prepare/render/dispose及handle/服务边界；无运行时入口，不将类型文件误当失活业务。
- `work/guandan-cocos/tests/effect-controller-lifecycle-regression.cjs`（133行）：完整133行并执行通过。两纯协调器实际加载，第一快照/重复/origin/序列gap/recovery迟到/off/不可用覆盖。原依赖isBomb恒false且getFlight=null，故未覆盖真实炸弹/飞牌或完整EffectController；本批补足协调器分路但真实renderer另审。
- `work/guandan-cocos/tests/network-effects-regression.cjs`（100行）：完整100行并执行通过。实际纯policy+LobbySyncTracker验证gameVersion与roommetadata分离、force重复恢复；其余为source regex连接断言，不代表执行完整socket/scene。补充1248观察组合，无真实网络。
- `work/guandan-cocos/tests/effect-renderer-migration-regression.cjs`（586行）：完整586行并执行通过。执行handle/registry/recipes/catalog与manifest哈希守卫；renderer/Controller/PlayArea/Hand的大量校验为source正则，不是节点行为测试。只读已跟踪素材哈希，不下载、不写，不把declared许可或regex成功等同授权/GPU验收。

## 运行结果

三个既有回归全部通过，新增 `node docs/audit/2026-09-12/repro/effect-orchestration-23.cjs`：

- 28组排队/预载/飞行/冲击 × 7取消原因：跳过等非恢复取消只提交一次展示；恢复/销毁不补旧展示、旧预载迟到不发语音，新代际不再等旧任务。
- 40个full/reduced串行动作及7种失败：普通、不要、四炸、六炸、王炸顺序正确，7个资源/flight/impact/owner失败后下一动作继续。外围renderer/flight在这部分为可控端口。
- 11个真实PlayArea/action-coordinator组合：1–10张捕获origin、逐张显示、ticket作废、gap/早期reset正常；CardView为替身。
- 15个实际CardFlight案例：10组60/120Hz×1/2/5/8/10张及5个冷加载/飞行取消/加载失败/节点池失败。第一张在落桌前到0.8倍，终点等于当前静态牌面间距，每张释放后回调且只释放一次，callback抛错不挂起。
- 64个registry/prepared案例：所有退役key在两类registry/三个画质都不进入render，fallback不绕过，拒绝混合注册不污染原映射；prepared拒绝/取消释放。
- 1,248个网络观察含forced恢复，198个牌型/张数/画质投影，5个policy边界。

引擎算法来自本机已安装Cocos3.8.8，9个文件哈希见[机器报告](effect-orchestration-23.json)。这里只转译Tween/ActionManager算法，绘制/Node/音频/资源和时钟均为内存替身，不能据此声称微信真机/低端机帧率或全量GPU内存已验证。既有migration test大量renderer断言是正则匹配，本批明确标记而不将它算行为覆盖。

UI/UX技能经一次收窄检索匹配“Cancellable State Transitions”。用于检查取消后语义状态与反馈，不修改风格、不导入Web实现。

## 接续

继续完整阅读真实Bomb/SixBomb renderer、CardBlastReaction、EffectPrimitives、DesignSystem、AssetCatalog、坐标适配及未审效果测试；核对冷素材/跳过/销毁与旧素材可达性，补完Controller联合动态验证。原31项确认缺陷仍待单独授权整改。
