# 旧动效迁移与资源合规基线

这份文档约束从旧 Cocos 工程吸收动效时可以使用什么、必须重做什么，以及资源进入运行时前必须通过的检查。当前原则是“迁移动效语义和时间曲线，不恢复旧房间架构，也不默认继承旧画面”。

## 固定来源

- 上游仓库：`https://github.com/niuma-wj/client-cocos.git`
- 固定提交：`f9d037feaef5a80867fd97c8dd39b9a7486fbeca`
- 审查时本地目录：`/Users/mac/Downloads/掼蛋/client-cocos`
- 许可证：MIT，Copyright (c) 2025 NiuMa
- 完整清单：`third_party/legacy-effects/manifest.json`
- 随项目保留的许可证：`third_party/legacy-effects/LICENSE`

清单为每个候选文件记录源路径、计划目标路径、许可证、SHA-256、字节数、允许或拒绝结论以及原因。上游许可证使用 CRLF，项目副本规范化为 LF，因此两份许可证分别记录哈希；许可证正文未删减。

## 当前评审结论

“允许”表示允许作为适配输入，不表示可以原样进入运行时。当前五项均为 `runtimeIncluded: false`，只有完成节点重绑定、清理接入和再次评审后，才能记录目标文件哈希并改为运行时已包含。

| 结论 | 数量 | 内容 | 使用边界 |
| --- | ---: | --- | --- |
| 允许适配 | 2 | `deal_card.anim`、`deal_card.animgraph` | 保留发牌节奏和轨迹，重新绑定当前牌背节点，不携带旧房间状态机 |
| 允许提取时间 | 2 | `TalkLeft.anim`、`TalkRight.anim` | 只提取左右气泡一秒循环节奏，重新绘制气泡和指示器 |
| 允许提取时间 | 1 | `Game/TuoGuan/ani.anim` | 只提取托管提示运动曲线，使用当前 UI 重做画面 |
| 拒绝 | 15 | `Effect/Blast`、`Effect/Flush`、`Effect/Plane` 全部 PNG | 视觉质量未通过；固定提交中的 `Room.prefab` 也未实际引用这些图片 |
| 拒绝 | 24 | 旧聊天帧、托管条幅、级分组件和胜负面板 | 与当前“陵水掼蛋”视觉系统不一致，使用代码动画、通用粒子或新素材重做 |

特别禁止将 `Blast`、`Flush`、`Plane` 图片换名后复制到 `assets/`。校验器按内容哈希扫描运行时 PNG，因此改名不能绕过拒绝名单。

## 运行时准入规则

1. 未列入清单的旧动效资源默认拒绝。
2. 只有 `status: allowed` 的条目可以进入适配流程。
3. 上游 `.meta` 一律不复制，由当前 Cocos Creator 生成本项目元数据。
4. `runtimeIncluded: false` 时，计划目标路径必须不存在。
5. 目标文件落地后，必须记录适配后文件的 `targetSha256`，再将 `runtimeIncluded` 改为 `true`。
6. 被拒绝文件必须保持 `targetPath: null`、`targetSha256: null` 和 `migrationMode: do-not-import`。
7. 所有旧资源动画必须接入统一跳过、换局、重连和销毁流程；资源存在不代表可以绕开 `EffectController`。

## 与长期迁移任务的对应关系

- 基础适配层：本清单、MIT 副本、哈希校验和拒绝资源扫描已经建立。
- 单效果试迁：普通炸弹应继续使用当前通用环、火星和桌面根节点震动；旧 Blast 图片不得作为捷径。
- 独立动画：发牌剪辑可适配；级分、托管和聊天只吸收时间曲线，画面重做。
- 核心牌型：小/中/大炸弹、同花顺、天王炸和逢人配使用当前通用粒子或新审美素材。
- 流程动效：贡牌/还贡、出完提示、升级、胜负和匹配成功均作为新表现实现；旧 Result 图片保持拒绝。
- EffectLab：每项效果除三档质量和连续触发外，还应验证可跳过、资源加载失败回退、换局清理及重连不补播。

## 2026-08-05 运行时迁移结果

旧文件仍保持 `runtimeIncluded: false`：本轮迁移的是经审计的时间曲线和交互意图，运行时画面由当前海蓝金色 UI、通用 CC0 纹理与代码绘制重新实现。因此不会把旧 `.anim`、旧 `.meta` 或旧图片打进包。

- `EffectRendererRegistry` 按语义 key 调度普通炸弹、同花顺、天王炸、逢人配与流程动效。
- `EffectHandle` 统一完成、跳过、替换、重连、换局和销毁清理；飞牌也已纳入可取消句柄。
- 小/中/大炸弹分别配置冲击环、火星、火焰、烟雾和闪光预算；精简模式去除烟雾、火焰、暗场和震屏。
- 发牌沿用旧剪辑约 2.074 秒、27 个节拍；级牌提示沿用 `0.2s backOut → 2.5s → 0.2s backIn`。
- 托管沿用 1 秒明暗呼吸；左右聊天沿用三段波纹节拍，但旧蓝绿色语音指示图片被拒绝。
- 贡牌、还贡、抗贡、玩家出完、升级、胜负和匹配成功均接入统一流程 Renderer。
- 初次快照、重连、版本缺口和跨局恢复只显示最终状态，不补播历史动效。

## 校验命令

不依赖旧仓库的日常检查：

```bash
node scripts/verify-legacy-effect-assets.mjs
node tests/legacy-effect-assets-regression.cjs
```

迁移审计或更新清单时，同时校验固定上游检出、文件尺寸和全部 SHA-256：

```bash
LEGACY_EFFECT_SOURCE_ROOT=/path/to/client-cocos \
  node scripts/verify-legacy-effect-assets.mjs --strict-source
```

也可以显式传入 `--source-root /path/to/client-cocos`。严格检查还会确认 Git HEAD 与固定提交一致，并确认三个完全拒绝目录中没有遗漏的 PNG。

## 新增候选资源的步骤

1. 先在固定提交上确认实际引用关系，避免迁移从未运行过的遗留素材。
2. 单独进行视觉评审，记录“允许”或“拒绝”的具体原因。
3. 计算源文件 SHA-256 和字节数，添加唯一清单条目。
4. 允许项先保持 `runtimeIncluded: false`；完成适配和人工验收后再登记目标哈希。
5. 运行默认校验、严格源校验和 EffectLab 场景检查。
6. 若调整拒绝结论，必须视为新的视觉评审，不得仅因开发方便修改状态。
