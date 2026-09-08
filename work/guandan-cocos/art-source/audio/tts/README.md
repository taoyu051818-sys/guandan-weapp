# 钢板女声（AI 合成）

2026-09-07，用户授权自行选择 TTS 项目/服务。通过 edge-tts 7.2.8 调用普通话女声 zh-CN-XiaoxiaoNeural，文本“钢板！”，语速 +8%。未使用声音克隆。

原始输出保留为 steel-plate-edge-raw.mp3；最终本地 WAV 位于 assets/game-assets/audio/voices/tts/steel_plate.wav。模型和 Python 依赖均未加入游戏。

复现：

```sh
edge-tts --voice zh-CN-XiaoxiaoNeural --text '钢板！' --rate=+8% --write-media /tmp/steel-plate-raw.mp3
afconvert /tmp/steel-plate-raw.mp3 /tmp/steel-plate-raw.wav -f WAVE -d LEI16@24000 -c 1
python3 scripts/prepare-steel-plate-voice.py /tmp/steel-plate-raw.wav /tmp/steel-plate-prepared.wav
```

在线服务未来输出可能变化，因此保留本次文件和 SHA-256。服务输出的权利不等同于 edge-tts 工具开源许可证；商业发布前应核对服务条款。项目来源：https://github.com/rany2/edge-tts 。

此前考察的 Piper huayan 声音因其模型卡标注训练数据许可证 Unknown，未下载声音模型、未用于成品。
