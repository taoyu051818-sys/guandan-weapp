# 开发效果实验室与快捷聊天策略

> 2026-09-08：实验室已按用户要求完整退役。本文以下内容仅为历史记录，所述 UI、`__guandanEffectLab` 控制台接口及固定牌局注入已不可用。固定手牌数据现位于 `tests/fixtures`，只供自动测试。参见 [退役报告](RETIREMENT_PACKAGE_AUDIT_20260908.md)。


## 开发门禁

`assets/scripts/development/EffectLab.ts` 只通过 Cocos `cc/env` 的编译期 `DEV || DEBUG` 标志创建实例：编辑器预览与显式调试构建可用，非调试发行构建中 `createEffectLab()` 恒定返回 `null`。模块不读取 URL、查询参数、LocalStorage 或 SessionStorage，因此不能用 `?effectLab=1` 一类入口绕过。

调试构建还会安装只读/预览用途的 `globalThis.__guandanEffectLab` 桥，供批量截图和视觉回归使用；离开场景时自动删除，发行构建不会安装。常用入口：

```js
__guandanEffectLab.open()
__guandanEffectLab.list()
__guandanEffectLab.trigger('play-bomb-small', 'full')
__guandanEffectLab.trigger('sequence-quality-matrix', 'full')
__guandanEffectLab.trigger('sequence-seat-matrix', 'full')
__guandanEffectLab.trigger('match-layout-split')
__guandanEffectLab.skip()
__guandanEffectLab.diagnostics()
await __guandanEffectLab.audit()
```

当前入口为大厅“更多 → 牌桌特效测试”，进入固定牌桌后显示可翻页的实验室抽屉。旧版右下角 `LAB / 牌 / 炸 / 精 / 关 / 连 / 色 / 座 / 资 / 清` DOM 工具条已移除；不要按旧说明重新接回。开发桥保留给调试验收，发行构建不可用。

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
| 牌桌布局 | `match-layout-all-bombs`（27 张全炸弹）、`match-layout-split`（25 张手牌跟上家的对子）、`match-layout-combinations`（12 张两副钢板）、`match-layout-one-card`（只剩 A，压不过对子）、`match-layout-own-landed`（我方对子已落桌的定格） |
| 保留商业牌型效果 | 四张、六张、七张、八张炸弹 |
| 压力序列 | 炸弹完整/精简/关闭三档矩阵、四座位炸弹投掷 |
| 资源诊断 | 运行时纹理加载、迁移候选隔离、拒绝素材及代码绘制降级 |

其余单项牌型、流光、电子出牌音、流程效果预览及六色巡检均已从运行时清单卸载。代码中的可选驱动接口不代表存在已开放的素材或 fixture；上述表格以实际注册项为准。

布局场景先保持普通叠牌模式，点击实际“一键理牌”按钮检查三区落位，随后选择、取消、提示和恢复。每次切换会重置手牌分组／撤销工作区、20 秒计时和旧桌牌表现，取消旧的短音频，不能继承前一个 fixture 的“已理牌”状态。仍附着联机房间时拒绝启动固定场景，先显示安全退出提示，不覆盖真实牌局。

`split`、`combinations`、`one-card` 是中盘快照，已清空的历史墩不在 `EngineState` 中；因此当前手牌加桌牌可能少于 108 张，但不会复制实体牌或把历史弃牌塞进其他玩家手中。不能把这些场景当成完整牌谱回放。`own-landed` 停在下家操作前：固定适配器不主动调度 AI，适合静态重叠测量，不用它证明 AI 自动推进已经验证。其他场景保留真实 20 秒超时行为，截图必须核对当时手牌数量，不能把超时出牌后的 26 张标成 27 张。

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
