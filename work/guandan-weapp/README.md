# 掼蛋大师 · 微信小程序

这是从 `guandan-windows-source` 迁出的原生微信小程序。牌型、AI、结算、进贡和跨局逻辑全部来自工作区根目录的 `shared-core`，网页端、小程序端和服务端共用同一份实现。

## 导入微信开发者工具

在微信开发者工具中导入本目录：

`/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-weapp`

项目配置的 `miniprogramRoot` 是 `dist/`。修改代码后，在本目录执行：

```sh
PATH="/Users/mac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" node scripts/build-native-weapp.mjs
```

然后在开发者工具点击“编译”。对局页为横屏。

## 单机内容

- 四档 AI：简单、中等、困难、大师；困难/大师可使用小程序 Worker。
- 摸牌定庄、标准/双明牌/闯关模式。
- 合法出牌、接风、双下、升级、A 关、进贡/还贡、抗贡、结算和下一局。
- 设置、战绩、教程、快捷聊天、音效和背景音乐。

## 音频 CDN

为了满足微信 2MB 主包限制，BGM 和语音不进入小程序安装包。上线前将原仓库的 `public/bgm.mp3` 和 `public/voices/` 转码为 MP3 后上传 HTTPS CDN，并在 [audio-config.js](/Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-weapp/native/lib/audio-config.js) 填入根地址；同时在微信后台把该 HTTPS 域名添加为下载文件合法域名。未配置时游戏正常运行，只是不播放音频。

## 好友房服务

网页端仍使用 Socket.IO（端口 3001）。小程序使用原生 WebSocket 服务：

```sh
cd /Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-windows-source
PATH="/Users/mac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" node server/weapp-ws.js
```

开发时可在好友房页面填写 `ws://局域网IP:3002/weapp`。发布到微信前，必须部署为 HTTPS/WSS，并在小程序后台配置已备案的合法 Socket 通信域名；不要将本地 `ws://` 地址用于生产。

## 验证

```sh
cd /Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-weapp
PATH="/Users/mac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" node ../../shared-core/tests/round-smoke.cjs

cd /Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-windows-source
PATH="/Users/mac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" node server/weapp-ws.smoke.mjs
```
