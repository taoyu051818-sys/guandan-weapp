# 陵水掼蛋 · Cocos Creator 客户端

这是微信小游戏主客户端。它不复用 React / Electron UI；只复用根目录 `shared-core` 的规则、结算、进贡和 AI。

广州腾讯云服务器已部署到 <https://api.yutechhn.cn/guandan/>，微信 AppID 为 `wxa79bf8bc567765a1`。配置、构建复现、密钥边界、部署检查与尚待完成的微信真机验收见 [`docs/guangzhou-wechat-deployment.md`](docs/guangzhou-wechat-deployment.md)；下一轮大厅/牌桌流程收束见 [`docs/ui-product-polish-plan.md`](docs/ui-product-polish-plan.md)。网页只是外观预览，不代替真实微信登录。

## 打开方式

1. 使用 Cocos Creator 3.8.8 导入本目录。
2. 运行 `node scripts/sync-core.mjs`，将共享核心同步到 `assets/scripts/core/generated`。
3. 打开现有的 `assets/scenes/Game.scene`。场景已包含横屏 `1280×720` 设计分辨率和 `GameScene`；首次运行会自动装配 `GameSession`、牌局、座位、出牌区、菜单、大厅和音频控制器，方便在没有正式 prefab 前直接预览完整流程。
4. 构建目标选择「微信小游戏」。横屏设计分辨率已经提交到 `settings/v2/packages/project.json`。

## 架构基线

当前分层与状态所有权见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)；2026-09-08 的代码清理、开发入口和风险结论见 [`docs/CODE_HEALTH.md`](docs/CODE_HEALTH.md)，逐文件清单见 [`docs/CODE_FILE_INVENTORY.md`](docs/CODE_FILE_INVENTORY.md)。专项退役与真实包体对比见 [`docs/RETIREMENT_PACKAGE_AUDIT_20260908.md`](docs/RETIREMENT_PACKAGE_AUDIT_20260908.md)。新增模块先运行 `npm run verify:architecture`、`npm run verify:health` 和 `npm run verify:retirement`；共享规则只改 `shared-core/src`，再同步到客户端。

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

脚本会检查 AppID、小游戏类型、合法域名校验开关、子包声明与输出路径、加载图主包依赖、原生首屏接管顺序、未使用引擎产物、包体限制、正式运行地址和退役代码／资源防回流。2026-09-08 退役及残留清理后的 Creator 3.8.8 发行构建首包为 `2.93 MiB`，`game-assets` 子包为 `12.81 MiB`，总计 `15.74 MiB`；残留清理比上一轮再减少 `35,295 bytes`。最新对照及验收边界见 [`docs/RESIDUAL_CLEANUP_20260908.md`](docs/RESIDUAL_CLEANUP_20260908.md)，上一轮记录保留在 [`docs/RETIREMENT_PACKAGE_AUDIT_20260908.md`](docs/RETIREMENT_PACKAGE_AUDIT_20260908.md)。只检查包结构可运行 `pnpm verify:wechat-package`，但它不能替代完整发布检查。

运行时由 `FrontPageController + PageRouter` 管理页面，`RuntimeUiFactory` 构建 UI。页面模块存在不代表普通玩家入口已开放：迁移功能在 `migration` 中独立检查；实验室页面、控制台桥接和固定牌局注入已删除。`GameScene` 负责组合，交互、计时、弹层和快照投影由独立控制器持有；联机状态以服务端为准。

- 两副牌完整开局、AI 回合和合法出牌；
- 选牌上移、手牌响应式排布；
- `ScreenAdapter` 监听 `canvas-resize`，用真实可视尺寸和安全区重新布局牌桌、手牌、座位、操作区和快捷语，并重绘背景；
- `assets/game-assets/backgrounds/lobby-lingshui-coast-v1.jpg` 是菜单和大厅的海滨背景，`assets/game-assets/backgrounds/table-perspective-blue-v2.jpg` 是对局牌桌背景；两者会按页面状态淡入切换，并由 `ScreenAdapter` 以等比 cover 方式适配横屏尺寸和安全区；
- `CardSkinResolver` 用 36 张项目授权牌面组件和 1 张 NiuMa MIT 牌底组合 54 种单副牌面；手牌、桌面牌和飞牌特效只使用这一条经典 PNG 渲染链路，共用同一帧缓存。全部牌面在大厅初始化前预加载，缺图时停留在资源重试页，不再切换为文字牌面；
- 统一 `EffectController`：规则语义解析、L0-L3 强度、四方飞牌、对象池、牌型标签、逢人配、炸弹/同花顺/天王炸、胜负升级和跳过动画；
- `AudioProfiles` 统一局开始、发牌、出牌、三种不要、0–5 倒计时、关键牌型与胜负的语义音频映射；报牌仅使用女声（NiuMa、授权单张 5 女声和钢板 TTS），资源缺失会安全回退或静默；
- 手牌已加入错峰发牌、固定尺寸的选中/锁定反馈和重排过渡；选中、锁定与堆叠均不改变卡牌缩放或层级；正式桌面牌先显示，装饰特效不阻塞输入、AI 或网络消息；震屏仅作用于 `GameTableShakeRoot`，HUD 和返回按钮保持稳定；
- 特效控制器保留「完整 / 精简 / 关闭」质量配置和震动策略，但没有玩家设置页或实验室入口；断线重连和跨局恢复只显示最终状态，不重放历史大特效；联机倒计时严格读取服务端 `turnDeadlineAt`，连续超时、主动托管和断线托管都由服务端权威驱动；
- 局间由四个座位分别准备/取消准备；返回入口区分安全退出和全员解散投票，投票拒绝、超时与断线恢复都有明确状态；
- 手牌排列、锁组与一键理牌分别由 `HandWorkspace`、`HandDisplayOrdering`、`HandGrouping` 和展示层负责；排序仅改变显示 cardId，不修改权威手牌。高牌组可以进入中间，不强制左右分区；重叠以报告告警处理，不自动把元素挤开。
- 「提示」先由 shared-core 生成合法候选，再按当前锁组和理牌组评估拆牌损伤：只要存在替代选择就不部分拆锁组，并依次保护天王炸、炸弹、组合牌、三张和对子；同等候选优先保留红桃级牌。提示只替换本地选中 cardId，实际出牌仍由同一规则内核及联机服务端复核；
- 开发构建的「固定牌局 · 音效/动效实验室」提供固定开局、逢人配/炸弹手牌、炸弹压制，以及所有牌型、贡还、结算和倒计时 fixture；固定牌局结算不会写入战绩；
- 大厅头像/资料栏进入个人中心，显示真实账号、积分和平台数据；当前文案为“我的对局”。微信头像昵称通过平台允许的用户交互流程设置，不使用假同步状态。
- 对局记录与公开事件播放器保留独立实现，按服务端 sequence 去重排序；只能读取授权的公开事件，不推断未公开手牌。开发示例不作为玩家大厅入口。
- 商户、赛事管理和旧 HTTP 观战接口已移入 `migration/platform`，不再注册到玩家网关、不进入 Cocos 包；服务端商户数据与能力不在本次收束范围内；
- 匹配等待进入牌桌背景，使用轻量三牌洗牌循环和取消入口。补位时限由服务端配置，机器人使用固定网名库；所有赛事队列仍按实际服务端策略处理，不伪造在线人数或 ETA。Web Desktop 用 `874×402` 设备框模拟移动横屏；底层设计坐标和安全区由 Cocos 适配。
- 玩家大厅已移除测试用途的“更多”、玩法说明和设置页；旧赛事页面只保留“筹备中”提示。实验室连同开发开关后的入口也已删除，固定手牌仅在 `tests/fixtures` 中用于回归。
- `CocosSocketClient` 断线重连、四席轮转与服务端权威的出牌/不要/贡还/下一局协议；
- Cocos 原生音频控制层统一管理语音与播放生命周期；当前报牌只使用女声。已停用的级牌专属提示音、出牌电子音和旧视觉效果不得通过兜底逻辑重新启用。

特效架构、四阶段交付清单和人工测试矩阵见 [`docs/EFFECTS_AND_TESTING.md`](docs/EFFECTS_AND_TESTING.md)，开源素材版本与许可证见 [`THIRD_PARTY.md`](THIRD_PARTY.md)。本地参考工程中的商业 UI、MIT 候选、授权阻塞项和明确拒绝项统一记录在 [`docs/commercial-ui-asset-inventory.md`](docs/commercial-ui-asset-inventory.md)。

## 联机地址

当前阶段的香港裸 IPv4 联调、固定桌面移动端画布、服务器测试档和验收清单见 [`docs/hong-kong-bare-ip-test.md`](docs/hong-kong-bare-ip-test.md)。裸 IP 档只允许用于 HTTP/WS 测试，不能进入正式发布。

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

除本机 Web 预览回退外，`platformEndpoint` 留空时只提供明确的本地只读预览，不进行真实兑换或匹配；配置地址后启用账号、钱包、玩家资料、我的对局、匹配和好友房接口。商城仅展示商品预览，不提供兑换下单接口。赛事按钮目前只提示“筹备中”，不会启动旧赛事页或报名请求。商城下单、商户、固定 16 人赛事及旧 HTTP 观战的契约实现和测试保留在 `migration/platform`，不是当前玩家客户端功能；服务端数据和未来业务能力没有删除。好友房实时／延迟观战继续通过正式好友房协议运行，与退役的旧观战页面无关。`lobbyEndpoint` 用于好友房直连，平台匹配以签名票据返回的 `gameEndpoint` 为准。

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

脚本按 `third_party/licenses/gameabc2-audio/catalog.json` 的分流清单处理 26 个 MP3：仅 4 个进入 Cocos 运行时，22 个进入 `art-source/audio/licensed-archive`，并生成带 SHA-256 的来源清单；被视觉筛选淘汰的 PNG 永远不会下载。运行环境没有全局 Node 时，可改用 Codex 随附的 Node 执行同一个脚本。

重新审计或恢复固定 MIT 来源的 NiuMa 音频时运行：

```sh
NIUMA_CLIENT_COCOS_DIR=/path/to/client-cocos node scripts/import-niuma-audio.mjs
NIUMA_CLIENT_COCOS_DIR=/path/to/client-cocos node scripts/import-niuma-bgm.mjs
```

两条脚本校验上游 MIT 全文、固定 revision、旧文案数组和音频索引路由：女声及流程音效包含 48 个白名单 MP3 与 1 个逐字一致的 OGG，背景音乐独立导入；生成 Cocos `.meta` 和 SHA-256 清单。男声导入脚本已经退役，不能恢复到运行资源。其余快捷语以及 `feiji.mp3`、`yapai.mp3`、旧 `dealcard.ogg` 均明确排除。完整说明见 `docs/niuma-audio-import.md`。

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
node tests/quick-chat-regression.cjs
node tests/retirement-boundary-regression.cjs
node tests/fixed-match-fixtures-regression.cjs
node tests/card-skin-regression.cjs
node tests/platform-api-regression.cjs
node tests/merchant-console-regression.cjs
node tests/lobby-entry-regression.cjs

# 启动真实平台服务，验证客户端登录/商城/赛事/四人匹配契约
node tests/platform-live-contract.cjs

# Cocos Web 构建
/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator --project "$PWD" --build "platform=web-desktop;debug=false;useSplashScreen=false"

# Cocos 微信小游戏构建后注入正式平台地址，再检查首包、子包和加载页
/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator --project "$PWD" --build "platform=wechatgame;debug=false;sourceMaps=false;useSplashScreen=false"
GUANDAN_PLATFORM_ENDPOINT=https://platform.example pnpm finalize:wechat-build
GUANDAN_PLATFORM_ENDPOINT=https://platform.example pnpm verify:wechat-build

# Creator 某些 CLI 构建仍会回填默认开屏；发布前强制收口并验证构建产物
GUANDAN_PLATFORM_ENDPOINT=https://platform.example pnpm finalize:web-build
GUANDAN_PLATFORM_ENDPOINT=https://platform.example pnpm verify:web-build
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
