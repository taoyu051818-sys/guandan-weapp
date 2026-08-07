# 陵水掼蛋 · Cocos Creator 客户端

这是微信小游戏主客户端。它不复用 React / Electron UI；只复用根目录 `shared-core` 的规则、结算、进贡和 AI。

## 打开方式

1. 使用 Cocos Creator 3.8.8 导入本目录。
2. 运行 `node scripts/sync-core.mjs`，将共享核心同步到 `assets/scripts/core/generated`。
3. 打开现有的 `assets/scenes/Game.scene`。场景已包含横屏 `1280×720` 设计分辨率和 `GameScene`；首次运行会自动装配 `GameSession`、牌局、座位、出牌区、菜单、大厅和音频控制器，方便在没有正式 prefab 前直接预览完整流程。
4. 构建目标选择「微信小游戏」。横屏设计分辨率已经提交到 `settings/v2/packages/project.json`。

## 微信资源分包与加载页

微信首包只保留启动所需代码和压缩后的加载图。当前加载图是 `assets/startup/resource-loading-lingshui-v1.jpg`，原始无损图保存在 `art-source/backgrounds/resource-loading-lingshui-v1-source.png`；`build-templates/wechatgame/background.jpg` 让微信原生首屏在 Cocos 场景启动前也显示同一画面。两个加载层都采用等比 `cover`，会按机型铺满并裁切边缘，不会拉伸人物。

大厅背景、牌面、音乐、语音和特效素材统一放在 `assets/game-assets` Asset Bundle。微信构建把它输出为 `subpackages/game-assets`，启动后由 `GameAssetLoader` 先调用 `wx.loadSubpackage`，加载页显示真实下载字节和进度；下载失败会保留加载页并允许重试。不要把大资源重新放回 `assets/resources`，也不要让首场景直接引用 `game-assets` 内的素材，否则会失去清晰的首包边界。

Bundle 配置保存在 `settings/v2/packages/builder.json`。微信目标必须保持 `miniGame.configMode = overwrite` 且 `overwriteSettings.wechatgame.compressionType = subpackage`。`settings/v2/packages/engine.json` 同时裁掉了本项目未使用的 3D、物理、Spine、DragonBones 和粒子模块，避免这些引擎文件占用首包。

每次微信发布构建后运行：

```sh
node scripts/verify-wechat-build.mjs
# 或
npm run verify:wechat-build
```

脚本会检查子包声明与输出路径、加载图主包依赖、原生首屏接管顺序、未使用引擎产物和包体限制。最近一次 Creator 3.8.8 发行构建的首包为 `2.69 MiB`，`game-assets` 子包为 `3.48 MiB`，总计 `6.17 MiB`。

运行时采用分层职责：`FrontPageController + PageRouter` 管理大厅、比赛、商城、商户技术预览、规则弹窗、设置与多人房间页面，`RuntimeUiFactory` 统一代码生成 UI；`GameScene` 只负责装配、牌桌 HUD、交互倒计时和网络状态桥接。`GameManager`、`HandController`、`PlayerSeatController`、`PlayAreaController` 与 `LobbyController` 提供牌局能力：

- 两副牌完整开局、AI 回合和合法出牌；
- 选牌上移、手牌响应式排布；
- `ScreenAdapter` 监听 `canvas-resize`，用真实可视尺寸和安全区重新布局牌桌、手牌、座位、操作区和快捷语，并重绘背景；
- `assets/game-assets/backgrounds/lobby-lingshui-coast-v1.jpg` 是菜单和大厅的海滨背景，`assets/game-assets/backgrounds/table-perspective-blue-v2.jpg` 是对局牌桌背景；两者会按页面状态淡入切换，并由 `ScreenAdapter` 以等比 cover 方式适配横屏尺寸和安全区；
- `CardSkinResolver` 甡49张 MIT 组件图组合54种单副牌面；手牌、桌面牌和飞牌特效只使用这一条经典 PNG 渲染链路，共用同一帧缓存。全部牌面在大厅初始化前预加载，缺图时停留在资源重试页，不再切换为文字牌面；
- 统一 `EffectController`：规则语义解析、L0-L3 强度、四方飞牌、对象池、牌型标签、逢人配、炸弹/同花顺/天王炸、胜负升级和跳过动画；
- `AudioProfiles` 统一局开始、发牌、出牌、三种不要、0–5 倒计时、关键牌型与胜负的语义音频映射；完整女声与可选男声报牌包互不混播，资源缺失会安全回退或静默；
- 手牌已加入错峰发牌、选中上浮、按压缩放和重排过渡；正式桌面牌先显示，装饰特效不阻塞输入、AI 或网络消息；震屏仅作用于 `GameTableShakeRoot`，HUD 和返回按钮保持稳定；
- 设置页提供「完整 / 精简 / 关闭」特效质量与震动开关；断线重连和跨局恢复只显示最终状态，不重放历史大特效；联机倒计时严格读取服务端 `turnDeadlineAt`，连续超时、主动托管和断线托管都由服务端权威驱动；
- 局间由四个座位分别准备/取消准备；返回入口区分安全退出和全员解散投票，投票拒绝、超时与断线恢复都有明确状态；
- 智能理牌、手动成组、牌组前后移动、拆组、撤销/重做和恢复默认只调整展示 cardId 顺序，不修改规则手牌；整理后的每组牌占一个横向位置并从上向下错层，只露出每张牌顶部的点数/花色和最后一张完整牌面，叠牌触控只响应实际露出的区域，其他玩家回合仍可继续理牌；
- 开发构建的「固定牌局 · 音效/动效实验室」提供固定开局、逢人配/炸弹手牌、炸弹压制，以及所有牌型、贡还、结算和倒计时 fixture；固定牌局结算不会写入战绩；
- 大厅头像/资料栏进入个人中心，统一展示八位账号、积分和服务端综合分；赛季任务与我的牌谱从个人中心进入并返回。未配置平台时，牌谱和任务明确标为开发模拟/演示，且不会展示可领取的假按钮；
- 「我的牌谱」和「延迟观战（实验）」使用同一套公开状态播放器：按服务端 sequence 排序去重，复原四座位最后动作、桌面已出牌与公开阶段，支持播放/暂停、前后步进和比例跳转；“更多”内可一键进入固定 30 秒公开事件示例，真实观战页每 3 秒增量追帧，处于末尾时自动跟随，回看历史时保留光标并提示“回到最新”，前后台/离页会停止无效轮询；客户端不会保存或推断隐藏手牌；
- 商户客户端页面和接口暂留为迁移边界，但普通玩家入口已隐藏；服务端商户数据与能力不在本次收束范围内；
- 匹配页使用轻量三牌洗牌循环，明确显示“请求服务/已进入队列”、本地可核对的等待时长和取消入口；服务端未提供排队人数或 ETA 时不伪造这些数据；Web Desktop 自定义模板使用全视口，`1280×720` 不再裁掉手牌和操作区；
- 「更多」保留游戏设置、延迟观战示例和“快速开始·人机测试”；测试局直接进入本地牌桌，三名机器人统一使用最高难度并按权威队伍关系识别队友。存在固定 fixture 的开发构建才额外显示牌桌特效测试；旧双明牌教学、摸牌定庄和本机数据入口已退役；
- `CocosSocketClient` 断线重连、四席轮转与服务端权威的出牌/不要/贡还/下一局协议；
- Cocos 原生音频控制层；授权音频、固定 MIT 提交的 NiuMa 男女独立报牌包和循环背景音乐已接入，rFXGen 轻量音效保留为失败兜底。

特效架构、四阶段交付清单和人工测试矩阵见 [`docs/EFFECTS_AND_TESTING.md`](docs/EFFECTS_AND_TESTING.md)，开源素材版本与许可证见 [`THIRD_PARTY.md`](THIRD_PARTY.md)。

## 联机地址

`GameRoot` 的 `GameScene.lobbyEndpoint` 默认为空，防止真机错误连接到手机自己的 `127.0.0.1`。

Web Desktop 从 `localhost` 或 `127.0.0.1` 打开时会只在运行时采用 `ws://127.0.0.1:3002/weapp` 和 `http://127.0.0.1:3003`，因此本机预览无需把不安全地址写入场景；微信真机与发布构建不会触发这条回退。

- 局域网开发：填入 `ws://电脑局域网IP:3002/weapp`；
- 线上微信小游戏：填入已备案且配置为合法域名的 `wss://你的域名/weapp`。

服务端位于 `work/guandan-windows-source/server/weapp-ws.js`。它负责房间、状态脱敏、出牌/不要、贡还、下一局和快捷语广播；Cocos 客户端只发送操作意图。

### 平台 API、商城、商户与比赛匹配

`GameScene` 另有四个平台配置项：

| Inspector 属性 | 开发建议 | 生产要求 |
| --- | --- | --- |
| `platformEndpoint` | 本机 Web 使用 `http://127.0.0.1:3003`；真机使用电脑的局域网地址 | 使用已备案、已加入微信合法域名的 `https://你的域名` |
| `platformAllowDevelopmentLogin` | 只有在服务端同时启用 `PLATFORM_ENABLE_DEV_LOGIN=true` 时临时打开 | 必须关闭，客户端改用 `wx.login`，服务端配置真实 `WX_APPID` / `WX_SECRET` |
| `platformAllowInsecureEndpoint` | 仅本机/局域网 HTTP 联调临时打开 | 必须关闭，Bearer Token 只允许发送到 HTTPS |
| `platformAllowInsecureGameEndpoint` | 本机默认可接受 `ws://127.0.0.1`；局域网真机联调需要临时打开 | 必须关闭，匹配返回的 `GAME_ENDPOINT` 必须是 `wss://` |

除本机 Web 预览回退外，`platformEndpoint` 留空时，商城和比赛页只使用本地演示数据，商户页也只显示明确标注的只读合成示例，不会发生真实扣分、报名、匹配、入驻或发积分；填入地址后才启用平台登录、钱包、商城、赛事、商户技术预览和四人匹配接口。赛事当前额外提供一条固定16人、4桌、3轮且不重复同桌的可验证流程，包含检录、服务端分桌、轮次屏障和 Top 8 资格；它不代表已经支持任意人数、迟到弃权、自动补赛或晋级后新阶段。商户写操作都要求显式按钮提交并携带幂等键，但审核/申诉、撤销、核销、对账和独立运营后台仍未实现，不能作为正式商户后台上线。`lobbyEndpoint` 仍用于好友房直连，平台匹配则以签名票据内返回的 `gameEndpoint` 为准。

局域网真机联调示例（把 `192.168.1.10` 换成开发电脑地址；两个服务共享票据、结算和观战事件密钥，其中结算密钥与观战密钥必须不同）：

```sh
cd ../guandan-windows-source
PLATFORM_HOST=0.0.0.0 \
PLATFORM_ENABLE_DEV_LOGIN=true \
GAME_ENDPOINT=ws://192.168.1.10:3002/weapp \
GAME_TICKET_SECRET=local-development-game-ticket-secret-2026 \
GAME_RESULT_SECRET=local-development-game-result-secret-2026 \
GAME_SPECTATOR_EVENT_SECRET=local-development-spectator-event-secret-2026 \
npm run server:platform

# 另开终端；三组密钥必须与平台服完全一致
GAME_TICKET_REQUIRED=true \
GAME_TICKET_SECRET=local-development-game-ticket-secret-2026 \
GAME_RESULT_SECRET=local-development-game-result-secret-2026 \
GAME_SPECTATOR_EVENT_SECRET=local-development-spectator-event-secret-2026 \
GAME_RESULT_ENDPOINT=http://127.0.0.1:3003/api/v1/game/results \
GAME_SPECTATOR_EVENT_ENDPOINT=http://127.0.0.1:3003/api/v1/game/spectator-events \
npm run server:weapp
```

此时 Cocos 中设置 `platformEndpoint=http://192.168.1.10:3003`，并仅为这次局域网联调打开开发登录、HTTP 平台地址和 WS 牌局地址三个开发开关。生产环境只允许 HTTPS/WSS，关闭三个开发开关，限制 CORS，并通过密钥管理系统配置 `PLATFORM_ACCESS_SECRET`、`GAME_TICKET_SECRET`、`GAME_RESULT_SECRET`、`GAME_SPECTATOR_EVENT_SECRET`；平台服与牌局服必须共享后三项，且 `GAME_SPECTATOR_EVENT_SECRET` 不得与 `GAME_RESULT_SECRET` 相同。牌局服还需用 `GAME_RESULT_ENDPOINT` 与 `GAME_SPECTATOR_EVENT_ENDPOINT` 分别指向平台的结算和观战事件接口。

## 核心同步

```sh
node scripts/sync-core.mjs
```

不要直接编辑 `assets/scripts/core/generated`；修改规则时编辑根目录 `shared-core/src` 后重新同步。

## 授权音频导入

授权 CDN 清单首次接入或来源发生更新后运行：

```sh
node scripts/import-licensed-audio.mjs
```

脚本只下载 `third_party/licenses/gameabc2-audio/catalog.json` 中的 27 个 MP3，并生成带 SHA-256 的来源清单；被视觉筛选淘汰的 PNG 永远不会下载。运行环境没有全局 Node 时，可改用 Codex 随附的 Node 执行同一个脚本。

重新审计或恢复固定 MIT 来源的 NiuMa 音频时运行：

```sh
NIUMA_CLIENT_COCOS_DIR=/path/to/client-cocos node scripts/import-niuma-audio.mjs
NIUMA_CLIENT_COCOS_DIR=/path/to/client-cocos node scripts/import-niuma-male-audio.mjs
NIUMA_CLIENT_COCOS_DIR=/path/to/client-cocos node scripts/import-niuma-bgm.mjs
```

三条脚本校验上游 MIT 全文、固定 revision、旧文案数组和音频索引路由：默认女声包含 48 个白名单 MP3 与 1 个逐字一致的 OGG，可选男声包含 39 个出牌/不要 MP3 与同一句 OGG，背景音乐独立导入；全部生成 Cocos `.meta` 和 SHA-256 清单。其余快捷语以及 `feiji.mp3`、`yapai.mp3`、旧 `dealcard.ogg` 均明确排除。完整说明见 `docs/niuma-audio-import.md`。

## 自动验收

```sh
# 共享规则
node ../../shared-core/tests/round-smoke.cjs

# Cocos 类型检查（使用 Creator 自带 TypeScript）
node /Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/resources/3d/engine/node_modules/typescript/bin/tsc --noEmit -p tsconfig.json

# 音频/特效、页面架构、选牌、牌面皮肤、平台 API 与入桌回归守卫
node tests/audio-effects-regression.cjs
node tests/network-effects-regression.cjs
node tests/network-round-state-regression.cjs
node tests/architecture-regression.cjs
node tests/selection-regression.cjs
node tests/hand-grouping-regression.cjs
node tests/effect-lab-quick-chat-regression.cjs
node tests/card-skin-regression.cjs
node tests/platform-api-regression.cjs
node tests/merchant-console-regression.cjs
node tests/lobby-entry-regression.cjs

# 启动真实平台服务，验证客户端登录/商城/赛事/四人匹配契约
node tests/platform-live-contract.cjs

# Cocos Web 构建
/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator --project "$PWD" --build "platform=web-desktop;debug=false;useSplashScreen=false"

# Cocos 微信小游戏构建后检查首包、子包和加载页
/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator --project "$PWD" --build "platform=wechatgame;debug=false;useSplashScreen=false"
node scripts/verify-wechat-build.mjs

# Creator 某些 CLI 构建仍会回填默认开屏；发布前强制收口并验证构建产物
node scripts/finalize-web-build.mjs
node scripts/finalize-web-build.mjs --check
node tests/selection-regression.cjs --require-build
node tests/card-skin-regression.cjs --require-build

# 平台 API、票据、签名结算、WebSocket 房间和票据恢复（在 windows-source 目录运行）
cd ../guandan-windows-source
npm run test:platform
node server/weapp-ws.smoke.mjs
node server/weapp-ticket.smoke.mjs

# 上述三组服务端回归的汇总命令
npm run test:server
```

Creator 3.8.8 的 CLI 在 macOS 上可能在日志显示 `build Task ... Finished` 后返回 36；验收应同时检查构建日志、`build/web-desktop` 更新时间和浏览器控制台。
