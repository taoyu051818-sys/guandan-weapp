# 第二十四批：炸弹渲染、素材与取消收尾

完整审阅9份文件，共1,887行；没有新增确认缺陷。补上上一批未执行的真实EffectController与两种renderer联合验证。原31项问题仍未修复，不代表全库健康。

## 文件结论

- `work/guandan-cocos/assets/scripts/effects/EffectDesignSystem.ts`（261行）：完整261行。核冻结调色/层级/字号/时间线/画质预算、新Color不共享、level归一化与风格映射。既有design回归通过，真实renderer的18组合活动节点峰值≤声明上限；globalNodeLimit是数据预算而非全局硬限，未推断任意并发都被此数字限制。
- `work/guandan-cocos/assets/scripts/effects/CardBlastReaction.ts`（124行）：完整124行。核专属反应wrapper不改layout、target按Node去重/过滤隐藏失效、固定key变化/距离方向、replacement先归一、cleanup一处、强度差别。6直接反应测试和Controller完整取消/40复用通过；在renderer父handle结束时收尾，不把个别节点提前destroy导致自身handle待父取消误报永久泄漏。
- `work/guandan-cocos/assets/scripts/effects/EffectPrimitives.ts`（111行）：完整111行。核响应式root初始化、WeakMap层级排序、递归stopTree覆盖components、固定字样/outline helper及空dimmer。实际renderer调用root/layer/stopTree并验证清理；旧label/dimmer无活动引用，列退役候选不删除。
- `work/guandan-cocos/assets/scripts/effects/BombEffectRenderer.ts`（526行）：完整526行。核Sprite-only素材预载、缺body仍按时提交冲击语义、贝塞尔/拖尾与node池、frame先绑定再active、粒子/烟/碎片分配预算、sound/impact/震动异常边界、所有子句柄取消和root销毁。18画质/张数、36取消、14失败综合矩阵覆盖此类与六炸，40复用无活动节点残留；画像美术质量未验收。
- `work/guandan-cocos/assets/scripts/effects/SixBombRenderer.ts`（293行）：完整293行。核恰6张门禁、full需6素材/reduced需3、真实卡牌飞行后冲击、不重复画六牌、dim/core/ring/粒子分层、时长上限和shake/reactioncleanup。Controller真实联合测试通过，missing必需层安全退化。六炸使用居中画面冲击层，不能仅因未按target局部定位断言位置bug；待视觉状态验收。
- `work/guandan-cocos/assets/scripts/effects/EffectAssetCatalog.ts`（226行）：完整226行。核9当前素材+5只候选+39拒绝记录、许可/来源字段边界、构造register前全量校验无半写、resolve与可加载resourcePath区分/质量门禁。9真实PNG文件哈希/325564字节一致，候选/拒绝无runtimePath；不能由声明的CC0/MIT字符串替代上游授权或导入来源验证。
- `work/guandan-cocos/assets/scripts/effects/LegacyCoordinateAdapter.ts`（93行）：完整93行。核contain/cover/stretch、center/top-left反变换、大小/长度/worldlocal与目标sizefallback、正数检查。600有限值往返通过；当前只有Controller构造后放context，实际Bomb/Six未用映射方法，作为无活动消费者适配器候选，非当前出牌定位故障。
- `work/guandan-cocos/tests/effect-design-system-regression.cjs`（169行）：完整169行并执行通过。真实design+primitives配MockCC，调色freeze、画质/层级/字体、root尺寸、stopTree都核；仍专门保留旧文字/dimmer helper测试，测试经过不等于存在产品入口。actual renderer行为由独立审计probe提供。
- `work/guandan-cocos/tests/legacy-effect-assets-regression.cjs`（84行）：完整84行并执行通过（明确source not available）。本地default verifier只读目录扫描/许可copy哈希，测试可选硬编码外部旧checkout不存在因而未做strict-source。运行前完整复读既有verify脚本266行、不重复计审；移除LEGACY_EFFECT_SOURCE_ROOT继承避免误读外部配置，未外网访问。

## 可重复验证

运行 `node docs/audit/2026-09-12/repro/effect-renderers-24.cjs`。加载当前Controller、Bomb/SixBomb renderer、CardFlight、CardBlastReaction、TransientEffectNodePool及本机Cocos3.8.8 Tween算法，Node/组件、卡牌图像池、音频/震动和纹理加载为合成端口，无网络或真实GPU。

- 18组full/reduced/off × 4/5/6/7/8/10张：声音与动作语音一次、落牌一次、六炸正常逐张6张，full冲击0.308秒（六炸0.433），reduced0.250秒（六炸0.375），off无视觉分配。时间是120Hz合成时钟，不是真机延迟。
- 36组4/6/8张 × 冷素材/飞行/冲击 × 跳过/恢复/销毁/画质关闭：晚回调不重新出声/显示，root/活动池清空，摇动与卡牌wrapper归一，非销毁后的下一过牌可继续。
- 14缺素材案例：普通炸无body/全部失败；六炸每个必需/可选素材分别缺失。不会激活未绑定帧的可见Sprite，始终能结束队列，语义展示和语音完成。
- 2加载所有权案例：同ID在途合并，成功缓存复用；失败释放pending可以再次请求。
- 连续40次真实控制器炸弹序列：每次语音/声音各一次、结束活动节点0，缓存池稳定73节点；top/flight抽样活动节点峰值47，不包含整个牌桌，也不等于GPU内存或任意长时间无泄漏。
- 6种卡牌反应强度/取消，600旧坐标映射往返；不变更layout父节点。
- 53目录记录：9运行PNG哈希一致、5迁移候选和39拒绝条目均无可加载runtimePath。strict上游源码不存在而跳过，许可来源专项尚未完成。

既有design与legacy-assets两个回归通过，后者结果明确为source not available。只有仓库内已跟踪资源只读扫描/哈希；没有外网下载、改素材、构建或发布。

## 退役候选（不是新增运行缺陷）

- `createOutlinedEffectLabel`（`work/guandan-cocos/assets/scripts/effects/EffectPrimitives.ts:81`）：assets源码/引用检索仅定义；完整活动Bomb/Six renderer不导入，design回归仍调用。相关字号token也由此旧接口消费。 单独整改时删除闲置helper与专属测试，先审其它typeScale引用再删token，不连带移除root/layer/stopTree。
- `createEffectDimmer`（`work/guandan-cocos/assets/scripts/effects/EffectPrimitives.ts:104`）：固定返回null；运行时无调用，只有design回归验证null。真实六炸使用自己的位图dimmer，不依赖此函数。 可在退役整改移除空接口和断言，保留六炸的真实位图层。
- `LegacyCoordinateAdapter`（`work/guandan-cocos/assets/scripts/effects/LegacyCoordinateAdapter.ts:18`）：Controller创建实例后放到EffectRenderContext；完整两活动renderer无legacyCoordinates映射调用，无其他assets使用。 后续可移除未消费的context能力与实例，并决定将通用转换留测试工具或删除；不要把活动普通飞牌world/local转换一起删掉。

保留的39个拒绝素材哈希和ArchivedPlayVisuals禁入表仍被运行时/验证器消费，不能因为名字含legacy/archived就删掉。三个候选须在单独授权整改时处理，本批不删除。

## 边界

UI/UX技能仅用于取消后反馈一致性，不调整美术。帧资源为合成对象，未做画面像素、闪光观看、手机触摸/缩放、图像许可或现有发布包新鲜度验证。详见[机器报告](effect-renderers-24.json)。
