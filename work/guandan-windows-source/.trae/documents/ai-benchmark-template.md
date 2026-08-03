# AI 30局自动对战统计模板

## 目标
- 比较 `easy / medium / hard` 三档 AI 的稳定性与强度分层。
- 观察每手决策指标，确认“更强 AI 不明显卡顿”。

## 对战矩阵
- `hard + hard` 对 `medium + medium`：10 局
- `hard + hard` 对 `easy + easy`：10 局
- `medium + medium` 对 `easy + easy`：10 局

## 记录口径
- 每局记录：
  - 胜方（`teamA/teamB`）
  - 局耗时（秒）
  - 关键阶段平均 `elapsedMs`
  - `generatedPlays / validPlays / prunedPlays`
  - `endgameDepth / endgameNodes`
  - 缓存命中率（`playInfo / canPlay / allPlays`）

## 单局记录模板
| 局次 | 对战组合 | 胜方 | 局耗时(s) | 平均elapsedMs | 平均generated | 平均valid | 平均pruned | 平均endgameDepth | 平均endgameNodes | playInfo命中率 | canPlay命中率 | allPlays命中率 |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | hard+hard vs medium+medium | teamA |  |  |  |  |  |  |  |  |  |  |

## 30局汇总模板
| 对战组合 | 局数 | A方胜率 | 平均局耗时(s) | 平均elapsedMs | 平均endgameDepth | 平均endgameNodes | 备注 |
|---|---:|---:|---:|---:|---:|---:|---|
| hard+hard vs medium+medium | 10 |  |  |  |  |  |  |
| hard+hard vs easy+easy | 10 |  |  |  |  |  |  |
| medium+medium vs easy+easy | 10 |  |  |  |  |  |  |

## 建议验收阈值
- 强度分层：
  - `hard` 对 `medium` 胜率 >= 58%
  - `medium` 对 `easy` 胜率 >= 62%
- 性能：
  - `hard` 平均 `elapsedMs` <= 20ms
  - `medium` 平均 `elapsedMs` <= 14ms
  - `easy` 平均 `elapsedMs` <= 8ms
- 稳定性：
  - 无明显“超时空回合”或连续异常 Pass

## 操作建议
- 开启开发环境，在浏览器控制台读取 `console.debug('[AI metrics]', ...)`。
- 每个对战组合连续打满 10 局，不中断以避免样本偏差。
- 若 `endgameNodes` 异常偏高，优先下调对应难度的 beam 与 budget。
