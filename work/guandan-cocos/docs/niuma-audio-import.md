# NiuMa 女声报牌、牌局流程与背景音乐接入

从 MIT 仓库 `niuma-wj/client-cocos` 的固定提交 `f9d037feaef5a80867fd97c8dd39b9a7486fbeca` 保留女声及流程音效 48 个 MP3 + 1 个 OGG，以及 1 条 MP3 背景音乐。2026-09-07 按用户要求取消男声：40 个 NiuMa 男声与 licensed/single_5_male.mp3 已移出 assets，导入脚本和切换控件删除。历史哈希清单保留并标记 runtimeAllowed=false。临时恢复副本在 /tmp/guandan-retired-male-dMUrhV（系统可能清理）。未清理历史构建快照，发布时必须重新构建。运行时继续使用语义键，不允许场景直接引用文件名。

## 已接入

- 单张：`2–10、J、Q、K、A、小王、大王` 全量女声。
- 对子：`2–10、J、Q、K、A` 全量女声；大小王对子统一使用女声通用“对子”。
- 声线：仅女声，旧缓存中的男声自动归一化为女声；旧授权包中未确认声线的人声不再作为回退播放。
- 钢板：新增独立合成女声 tts/steel_plate，详见 third_party/licenses/tts-steel-plate.json。只在 PlayType.Plate 播报，不用“飞机”代替；尚待真机听感验收。
- 牌型：三张、顺子、三带二、三连对、同花顺、炸弹、王炸。
- 流程：三种“不要”轮换、倒计时 `0–5` 精确选择、本局开始、胜利、失败。
- 快捷语：仅接入 Female 的上游 `phrase02`，按钮/服务端白名单为原声确切文案“你的牌打得太好啦”。
- 背景音乐：上游 `assets/GuanDan/Audio/bg.mp3` 独立导入为 `music/niuma/table_theme`；使用单独循环声道，遵循会话中的音乐开关/音量配置（玩家设置页已退役），不受音效开关干扰。
- 原有授权发牌声、爆破声和生成式兜底音效继续保留；新增人声作为独立报牌层播放。

快捷语的含义不是按文件编号猜测。固定提交中的 `GuanDanPlayer.ts` 与 `SeatPanel.ts` 都依次定义同一组显示文案，`AudioControl.playPhrase` 再把零基索引加一并根据声线加载 `Phrase/Female/phraseNN` 或 `Phrase/Male/phraseNN`。脚本会同时验证三处旧代码，任何文案或路由变化都会终止导入。

| 上游索引 | 上游原句 | 当前中性文案 | 资源键 | 决策 |
| --- | --- | --- | --- | --- |
| 1 | 快点儿吧，等到花儿都谢了 | 请尽快出牌 | — | 文本不一一对应且带催促反讽，排除运行映射 |
| 2 | 你的牌打得太好啦 | 你的牌打得太好啦 | `niuma/chat_nice_play` | 仅女声接入；男声退役 |

“请尽快出牌”“配合得好”“大家加油”“谢谢”“再来一局”在这 9 条上游语音中没有逐字一致的安全对应项，因此继续无声降级，不用相近编号或大致语义硬配。

## 明确排除

- `feiji.mp3`：旧工程用于钢板，但语音名称为“飞机”，禁止映射到钢板。
- `yapai.mp3`：旧工程随机播放，规则层没有无歧义的“压牌”事件。
- `dealcard.ogg`：与现有授权发牌 MP3 重复，且尚未完成微信目标格式回归。
- `Phrase/Female/phrase01`、`phrase03`—`phrase09`：逐条核对后排除。原因包括文案不精确/催促反讽、负面嘲讽、贬损、语境不明、训斥、时间场景固定、与“再来一局”相反，以及重复催牌但措辞偏冲。
- Male/Female 的 `feiji.mp3`、`yapai.mp3` 和不匹配快捷语均保持排除；整个男声包已退役，不再打包。

## 可重复导入与审计

```sh
NIUMA_CLIENT_COCOS_DIR=/path/to/client-cocos node scripts/import-niuma-audio.mjs
NIUMA_CLIENT_COCOS_DIR=/path/to/client-cocos node scripts/import-niuma-bgm.mjs
```

脚本先核对 Git 提交、MIT 全文和旧代码文案/路由，再导入资源；同名运行时文件哈希不一致时会停止，不覆盖本地改动。缺失的 Cocos `.meta` 使用确定性 UUID 创建。女声与男声分别记录在 `third_party/licenses/niuma-client-cocos-audio.json`、`third_party/licenses/niuma-client-cocos-male-audio.json`；背景音乐另记在 `third_party/licenses/niuma-client-cocos-bgm.json`，MIT 全文保存在 `third_party/licenses/NiuMa-client-cocos-MIT.txt`。

自动测试只能确认语义映射、资源存在、哈希和静音/降级路径。发布前仍需用手机扬声器与耳机逐项听测，重点检查这一条 OGG 快捷语在 Web、微信小游戏和真机上的解码、响度与完整句尾，并确认另外五个按钮不会误播；同时检查三种“不要”的节奏、倒计时顺序、炸弹事件音效与报型人声是否互相遮蔽。背景音乐还需听测首尾循环接缝、长时间响度、前后台切换以及是否压住报牌语音。
