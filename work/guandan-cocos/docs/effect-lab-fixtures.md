# 开发效果实验室与快捷聊天策略

## 开发门禁

`assets/scripts/development/EffectLab.ts` 只通过 Cocos `cc/env` 的编译期 `DEV || DEBUG` 标志创建实例：编辑器预览与显式调试构建可用，非调试发行构建中 `createEffectLab()` 恒定返回 `null`。模块不读取 URL、查询参数、LocalStorage 或 SessionStorage，因此不能用 `?effectLab=1` 一类入口绕过。

调试构建还会安装只读/预览用途的 `globalThis.__guandanEffectLab` 桥，供批量截图和视觉回归使用；离开场景时自动删除，发行构建不会安装。常用入口：

```js
__guandanEffectLab.open()
__guandanEffectLab.list()
__guandanEffectLab.trigger('play-bomb-small', 'full')
__guandanEffectLab.trigger('sequence-quality-matrix', 'full')
__guandanEffectLab.trigger('sequence-style-matrix', 'full')
__guandanEffectLab.trigger('sequence-seat-matrix', 'full')
__guandanEffectLab.skip()
__guandanEffectLab.diagnostics()
await __guandanEffectLab.audit()
```

Web 调试包右下角还有一组可换行的调试按钮：`LAB / 牌 / 炸 / 精 / 关 / 连 / 色 / 座 / 资 / 清`。`色` 会依次巡检六个语义色族，`座` 会从下、右、上、左四个座位投掷炸弹；其余按钮用于固定测试牌局、三档质量、快速连续触发、资源审计和跳过清理。除打开按钮外，执行结果都会写回对应按钮的 `data-result`，便于自动化断言；这个 DOM 入口同样只在实验室可用时创建。

场景可在开发代码中注入驱动器：

```ts
const lab = createEffectLab({
  playAction: preview => {
    // preview.action 与 preview.effectProfile 可接 EffectController 调试适配器
  },
  playAudio: event => audio.playEvent(event),
  playCountdown: remaining => audio.playCountdown(remaining),
  playSettlement: result => effects.playSettlement(result.won, result.levelUp),
  startFixedMatch: (state, fixture) => manager.applyDevelopmentFixtureState(state, fixture.label),
  playQuickChat: phrase => audio.playVoice(phrase.voice),
  playTribute: fixture => {
    // 只渲染贡还演示，不写入真实 GameSession
  },
  playFlow: fixture => effects.previewFlow(fixture.kind, fixture.text),
  playSequence: fixture => {
    // 按 step.delayMs 触发，可对单步指定 full/reduced/off
  },
  runDiagnostic: () => effects.auditRuntimeAssets(),
})
```

`list(kind?)` 列出固定项目，`inspect(id, quality?)` 返回语义和解析后的 profile，`trigger(id, quality?)` 调用驱动器。实验室不直接持有 `GameScene`、`LobbyController`、规则引擎或网络连接。

## 固定 fixture

| 分类 | fixture |
| --- | --- |
| 固定可玩牌局 | 固定开局、逢人配与炸弹手牌、炸弹压制场景 |
| 所有牌型 | 单张、对子、三张、顺子、三带二、三连对、钢板、同花顺、四/六/八张炸弹、天王炸、不要 |
| 掼蛋语义 | 逢人配实际替代，包含 `wildcardUsages` |
| 语义音频 | `game-start`、`deal`、`play`、`pass`、`countdown`、`bomb`、`straight-flush`、`king-bomb`、`wildcard`、`victory`、`defeat` |
| 快捷语 | 六个审核后按钮逐项预览；一条播放已核对女声，五条验证静音降级 |
| 倒计时 | 0、1、2、3、4、5 秒分别触发 |
| 贡还 | 进贡、还贡、抗贡 |
| 结算 | 胜利升 1 级、胜利升 3 级、失败 |
| 独立流程 | 发牌、级牌、托管、左右聊天、玩家出完、匹配成功 |
| 压力序列 | 快速连续出牌、L3 替换 L2、完整/精简/关闭三档矩阵、六语义色族、四座位炸弹投掷 |
| 资源诊断 | 运行时纹理加载、迁移候选隔离、拒绝素材及代码绘制降级 |

所有动作和固定牌局每次检查都会重新生成，实验室内的点击或调试修改不会污染下一次 fixture。固定牌局允许真实选牌、提示和出牌，但 `GameManager` 会隔离其结算，不写入本地战绩、等级或联机房间版本。

## 快捷聊天策略

`QuickChatPolicy` 是展示层纯状态模块：

- 只接受六条中性、可审核白名单短语，任意网络文本不会成为气泡；
- 每位玩家独立 1.2 秒节流，同一短语默认 8 秒冷却；
- 每个座位仅保留最后一条气泡，默认 2.5 秒过期；
- `block(viewerId, senderId)` 和 `unblock(...)` 只控制目标查看者的本地可见性；
- 被屏蔽消息仍可正常经过网络、回合和规则状态，其他查看者不受影响；
- `ChatController.setViewer()`、`block()`、`unblock()` 为现有场景提供接入 API。

运行回归：

```sh
node tests/effect-lab-quick-chat-regression.cjs
```
