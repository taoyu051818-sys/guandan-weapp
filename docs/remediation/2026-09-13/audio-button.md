# 音效取消与按钮按压整改（2026-09-13）

本轮修复 AUDIO-15-001、UI-22-001，仅修改与本地测试；没有提交、部署、变更视觉风格或动原有5处dirty文件。审计目录保持immutable。

## AUDIO-15-001

- `assets/scripts/audio/TransientAudioChannels.ts`（及meta）独立持有短音效声道。每条cue使用公共 `AudioSource.clip/play`，不再使用独立、不可追回的 `playOneShot`。取消时先stop并清空clip，使引擎异步加载失效，再销毁对应节点；不复用取消后的同clip source，避免旧加载附着新声道。正常ENDED自动释放，最大存活声道不超过引擎声道数。
- `CocosAudioController.ts` 将播放、离桌、静音和销毁统一接到声道所有者；原资源加载代际继续生效。BGM仍用原独立声道，多条短音效可以正常叠层，没有合并成互相截断的单source。
- 更新旧audio lifecycle和测试harness的播放端口，新增 `tests/audio-engine-cancellation-regression.cjs`。直接转译本机Cocos3.8.8完整AudioSource原源码，替换PAL音频/Node等端口，不复制供应商源码、不真实发声。
- 9组（应用资源待加载/引擎待加载/已播放 × 离桌/静音/销毁）通过；另验证叠层、自然结束清理、同clip旧加载不能附着新cue。BGM在离桌/只关闭音效时继续，销毁时停止。

## UI-22-001

- `assets/scripts/ui/RuntimeUiFactory.ts` 使用WeakMap持有本工厂为每个节点创建的scale Tween实例。入场/按压/释放都替换并停止前一实例，避免 `tween(node).stop()` 创建新空Tween却停不到旧动画。
- 仅取消该工厂的scale动画，不全停节点上的位置等其他所有者动画。保留原.96按压比例、.06/.08反馈时间、入场曲线、颜色与命中区域。延迟onSelect额外核当前节点有效且在活动层级中。
- 新增 `tests/runtime-button-motion-regression.cjs`，直接执行安装的真实Tween/ActionManager算法：button/imageCard × 60/120Hz × 4按下时点共16组长按均保持.96；另4组快速重按、取消、旧回调取消、其他位置动画不受影响和隐藏页面无迟到选择通过。

## 验证

以下入口在仓库根、干净环境 `env -i PATH=/opt/homebrew/bin:/usr/bin:/bin /opt/homebrew/bin/node` 下全部exit0：

```text
work/guandan-cocos/tests/audio-effects-regression.cjs
work/guandan-cocos/tests/audio-lifecycle-regression.cjs
work/guandan-cocos/tests/audio-recovery-regression.cjs
work/guandan-cocos/tests/ui-frame-style-regression.cjs
work/guandan-cocos/tests/audio-engine-cancellation-regression.cjs --require-engine
work/guandan-cocos/tests/runtime-button-motion-regression.cjs --require-engine
work/guandan-cocos/tests/cocos-iterable-spread-regression.cjs
```

在 `work/guandan-cocos` 执行 `npm run typecheck:runtime`，两份tsconfig的 `--noEmit` 检查通过。`git diff --check`通过。架构检查当时仅报3个代理新增测试尚未注册default test命令（本任务2个及其他任务hand-gesture）；主代理统一注册，未自行覆盖package.json。

引擎测试可用 `COCOS_ENGINE_ROOT` 指定已安装Cocos源码的 `cocos` 根目录。普通CI无Creator时明确打印 **SKIP / 未验证真实引擎行为** 并exit0；`--require-engine` 或 `REQUIRE_COCOS_ENGINE=1` 要求引擎存在，否则失败。本机以强制模式实际通过；另以不存在路径验证普通skip分支（两项exit0且明确NOT verified）与强制分支（两项预期exit1）。没有静默把未执行引擎检查当作通过。

UI/UX技能未搜到专门匹配条目，采用其内置“动画可中断、按压状态稳定”的规则，影响是将缩放动画归于单一所有者，没有进行视觉改版。未做微信真机听测、GPU输入绘制验收或交付包重建；这些仍是主任务统一验收边界，不能用本机合成端口结果冒充真机听感。
