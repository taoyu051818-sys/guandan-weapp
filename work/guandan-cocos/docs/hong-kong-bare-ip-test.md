# 香港裸 IP 联调与桌面移动端模拟验收

## 使用边界

本方案只用于开发和验收，不是生产发布方案。测试网页必须通过 HTTP 打开，客户端连接香港服务器的 `http://IPv4:3003` 与 `ws://IPv4:3002/weapp`。如果网页本身通过 HTTPS 打开，浏览器会把裸 IP HTTP/WS 判定为混合内容并阻止连接。

裸 IP 联调会明文传输开发账号令牌和牌局消息，因此只允许测试账号与测试数据。云安全组应把 `3002/tcp`、`3003/tcp` 限制到验收人员公网出口 IP；测试结束后关闭端口。正式发布仍必须切换备案域名、HTTPS/WSS、微信登录和生产密钥。

## 桌面网页口径

- Cocos 内部设计分辨率保持 `1280×720`，不改牌桌坐标体系。
- Web Desktop 外壳固定显示为 `960×540` 横屏移动端画布，并居中放入桌面设备框。
- 不使用媒体查询，不根据桌面窗口宽高重排页面；窗口不足时允许裁切，不切换另一套布局。
- 微信小游戏构建不使用这个桌面设备框。

## 香港测试服环境

以下值中的 IP、Origin、路径与四组密钥都要替换；四组密钥至少 32 字符且互不相同。

```sh
export NODE_ENV=development
export GUANDAN_TEST_SERVER_IP=<香港服务器公网IPv4>
export GUANDAN_TEST_PLATFORM_PORT=3003
export GUANDAN_TEST_GAME_PORT=3002

export PLATFORM_HOST=0.0.0.0
export PLATFORM_PORT=3003
export PLATFORM_ENABLE_DEV_LOGIN=true
export PLATFORM_CORS_ORIGIN=http://127.0.0.1:4178
export PLATFORM_STORE_MODE=json-single-instance
export PLATFORM_JSON_FILE=/srv/guandan-test/data/platform.json
export PLATFORM_ACCESS_SECRET=<独立测试密钥1>

export GAME_ENDPOINT=ws://<香港服务器公网IPv4>:3002/weapp
export GAME_TICKET_REQUIRED=true
export GAME_TICKET_SECRET=<独立测试密钥2>
export GAME_RESULT_SECRET=<独立测试密钥3>
export GAME_SPECTATOR_EVENT_SECRET=<独立测试密钥4>
export GAME_RESULT_ENDPOINT=http://127.0.0.1:3003/api/v1/game/results
export GAME_SPECTATOR_EVENT_ENDPOINT=http://127.0.0.1:3003/api/v1/game/spectator-events
export GAME_RESULT_OUTBOX_FILE=/srv/guandan-test/data/result-outbox.json
export GAME_SPECTATOR_OUTBOX_FILE=/srv/guandan-test/data/spectator-outbox.json
export WEAPP_ROOM_STATE_FILE=/srv/guandan-test/data/rooms.json
export WEAPP_HOST=0.0.0.0
export WEAPP_ALLOWED_ORIGINS=http://127.0.0.1:4178
export WEAPP_WS_PORT=3002
```

先在服务端仓库验证测试档，再分别启动平台服和牌局服：

```sh
npm run check:hk-ip-test
npm run server:platform
npm run server:weapp
```

`PLATFORM_CORS_ORIGIN` 和 `WEAPP_ALLOWED_ORIGINS` 必须等于真实测试网页 Origin。若网页不是 `http://127.0.0.1:4178`，两处一起替换。

## 构建测试网页

Cocos Web Desktop 构建完成后，用同一个裸 IPv4 注入测试地址：

```sh
GUANDAN_TEST_SERVER_IP=<香港服务器公网IPv4> pnpm finalize:web-hk-test
GUANDAN_TEST_SERVER_IP=<香港服务器公网IPv4> pnpm verify:web-hk-test
```

该命令只接受裸 IPv4，自动注入 HTTP/WS 地址并打开三个隔离的开发开关。`--bare-ip-test` 与 `--release` 互斥，防止测试配置进入正式包。

## 验收清单

1. 在两个不同尺寸的桌面窗口中，设备框与游戏内容都保持 `960×540`，无响应式重排。
2. 浏览器加载页进入大厅；控制台没有启动错误。
3. 开发登录成功，个人资料与钱包来自香港平台服而不是演示数据。
4. 点击快速开始，匹配等待约 7 秒后补齐机器人并进入四人桌。
5. 完成选牌、出牌、机器人连续回合、安全退出和重新进入。
6. 平台服重启后账号/钱包保留；牌局服重启后可用原恢复凭证续桌。
7. 服务端拒绝错误 Origin、伪造票据、过期票据和错误席位。
8. 测试结束后关闭公网 `3002/3003`，不得把裸 IP 包用于微信正式发布。
