# 第十五批：音效生命周期与测试替身边界

范围：9 份第一方文件、1,232 行，详见 [逐文件哈希记录](audio-lifecycle-15.json)。基线 HEAD `1d58999dc6e5455b049e1643660bbba3deee1406`，保留五处原有修改。仅审计，不更改产品或引擎。

## 新增确认问题

### AUDIO-15-001 · P3：取消不到已提交引擎的短音效

位置：

- `work/guandan-cocos/assets/scripts/audio/CocosAudioController.ts:74-78`：取消代际并调用 `effectSource.stop()`。
- 同文件 `213-227`：可选资源加载后通过 `playOneShot` 发出语音/音效。
- `GameScene.ts:508-511`：隐藏牌桌调用取消；controller 的静音与销毁也使用同一路径。

本机实际 Cocos 3.8.8 的 `AudioSource.stop`（410行）只停止普通 `_player`。其 `playOneShot`（430行）另行异步创建短音效对象，完成后直接播放，不归属这个 `_player`，也不检查业务播放代际。

因此“可选资源加载 → 提交引擎 → 引擎完成加载 → 播放”的后半段没有取消保护。离桌、关闭音效或组件销毁发生在提交引擎之后时，已经播放的短音效不会被该 stop 中止；尚未完成引擎加载的短音效还可在取消之后才开始。

## 可重复验证

```sh
node docs/audit/2026-09-12/repro/audio-lifecycle-15.cjs
```

探针读取当前已安装引擎，AST 提取 **未经改写** 的 stop/playOneShot 两个方法，与真实 controller/cache 联动，仅把音频后端和声音管理器换成内存端口。引擎文件 SHA-256：

`dc903119f1eda1e3af897d8f79be136196f1b1ae960614a0e1cc414c2743e7ea`

结果：

- 3 种取消边界 × 引擎待完成/已播放 2 种阶段，共 6 例，均仍执行播放且没有停止短音效。
- 取消时还在应用可选资源阶段的 3 个对照均不提交引擎，说明既有 epoch 门禁本身有效。
- 普通 clip 的 stop 及正常短音效播放/自然结束 2 个对照正常。
- 10 个缓存案例验证同步/异步回调、20 个同资源订阅、重试上限、冷却精确边界及同步取消；均通过。
- 最新语音代际的 1800/1801ms 临界、9 个冻结事件配置及 11 个倒计时输入对照通过。

本次执行的是实际引擎方法与合成后端，不是微信真机听测，不推定故障发生频率；自然结束会释放跟踪，不是永久内存泄漏。

## 既有测试与缺口

以下三项均通过，未请求 build 检查：

```sh
node work/guandan-cocos/tests/audio-effects-regression.cjs
node work/guandan-cocos/tests/audio-lifecycle-regression.cjs
node work/guandan-cocos/tests/audio-recovery-regression.cjs
```

原 lifecycle 测试只断言 stop 调用了足够多次；harness 的 playOneShot 直接记录 clip，没有模拟第二层异步和独立音效对象。因此三项通过与此次缺陷并不矛盾。

本批同时核对女性语音过滤、级牌专属路由退役、红心配对子播报、BGM独立声道/模式切换、失败重试与销毁。未确认其他独立问题。资源 hash/存在性断言不等于来源授权、完整第三方审核或当前发布包新鲜度。

## 建议及后续验收

为需要取消的短音效建立可持有和停止的声道抽象，确保引擎加载完成前后使用同一代际；优先使用公共可控 AudioSource.clip/play 生命周期或具有明确取消契约的适配器，不以 stop 承诺取消 playOneShot。保持 BGM 独立。

| 真机步骤 | 期望 |
| --- | --- |
| 语音播放中返回大厅 | 牌桌语音停止，大厅 BGM 按设置播放 |
| 资源冷加载时触发报牌，立即离桌 | 返回大厅后不补播旧牌桌语音 |
| 报牌后立即关闭音效 | 已播/待播音效停止，BGM 不受音效开关误伤 |
| 连续进出牌桌或销毁/重建音频组件 | 不出现旧实例迟到声音，不影响新实例正常声音 |

以上是后续修复的验收流程，当前未实施修复或真机验收。辅助引擎方法、场景调用点和此前已审 helper 不重复计入新增覆盖。
