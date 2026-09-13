# 动画时钟、生命周期与节点池审计（第二十二批）

基线：`1d58999dc6e5455b049e1643660bbba3deee1406`。新增9文件完整审阅，共779行；哈希和逐文件说明见 [JSON](animation-lifetime-22.json)。

## UI-22-001 · P3 · 入场动画覆盖按压缩放

位置：`work/guandan-cocos/assets/scripts/ui/RuntimeUiFactory.ts:213`及同文件button按压处理。

imageCard先启动0.22秒入场node tween，button另在277–280启动0.2秒入场tween。makeInteractive:213–222与button:283–286的按压使用tween(node).stop()，新Tween的_finalAction为null，并未停入场。按压0.06秒结束后旧入场继续把scale写回1，手指尚未松开。此前UI-20-C01机制疑点在此获得实际调度证据。

node docs/audit/2026-09-12/repro/animation-lifetime-22.cjs：直接转译未经改写的本机Cocos3.8.8 Tween/ActionManager/interval/instant/TweenAction/easing等9文件；只替换引擎Node/渲染端口。2类控件×2刷新率×3入场内按住时点共12例，持续按住0.4秒scale=1；入场后0.3秒按下4个对照scale=.96。显式停原实例对照scale=.96，所有cancel后回1，离页停止后迟到onSelect为0。

建议：让控件持有自己的入场/按压Tween实例并协调取消，按住期间维持pressed状态；不要全局停止节点上其他业务所有者动画。增加真实计时的入场→按下→取消和快速再次按压回归，替代即时赋值Tween存根。

边界：只确认入场期间长按的缩放视觉反馈被覆盖，button底色仍有按态；未确认错误出牌/重复开房/僵尸路由。Node/绘制/生命周期和60/120Hz调度为内存测试，不是Cocos/GPU/微信真机听看验收。

UI-20-C01历史机制疑点至此升级，不重复计数；没有僵尸导航结论。

## 验证与后续

既有回归通过；16按压时间组合含12复现4正常、原Tween停止对照/离页取消对照、11EffectHandle、200节点池循环、6卡牌ghost异步复用、13500时钟步与异常dt通过。

[复现入口](../repro/animation-lifetime-22.cjs)直接读取本机Cocos3.8.8算法，版本哈希记录在JSON。13500步分别为15/30/60/120Hz各60秒合成时钟，不代表实际运行耗时或真实设备性能。

9文件完整阅读，共779行；RuntimeUiFactory和卡面resolver/frame cache/geometry此前已审，本批只复核不重复计数。其他EffectController/PlaybackCoordinator/renderer/策略/legacy边界尚未审完。

本机引擎9文件只作为版本锁定的只读算法依赖，记录哈希，不计本仓库第一方覆盖或第三方全量源码审计完成；运行时禁止未列出的外部依赖，无network/fs写入端口。

NodePool/节点/组件/资源结果为内存替身；未真实分配GPU纹理、运行主引擎tick、Cocos构建、移动设备帧率/触控/动态偏好测试。

未执行未完整阅读的effect-renderer-migration等测试。仅因为它们加载这些模块不能计审或宣称全套动效已验收。

仅审计和隔离材料，原有产品修改保留。UI/UX技能用于交互反馈和取消语义检查，未恢复骨骼/退休特效。
