# 牌桌特效架构与测试清单

## 四阶段交付

### 阶段一：规则语义

- `PlayResolution` 随 `PlayAction` 保存牌型、最大值和炸弹张数。
- `WildcardUsage` 保存每张逢人配实际替代的点数与花色。
- `resolvePlay()` 是表现层明确入口；旧 `getPlayInfo()` 保持兼容。
- 六张三连对和钢板按真实牌型输出，不再用 `cards.length >= 6` 猜炸弹。

### 阶段二：表现基础设施

- `EffectProfileResolver` 将牌型语义解析为 L0-L3 配置。
- `EffectDesignSystem` 与 `EffectPrimitives` 固定“海岛夜局”的六个语义色族、墨色暗场、七层顺序、五级字阶、四阶段时间线和 Full/Reduced/Off 节点预算；完整规范见 `docs/VFX_DESIGN_SYSTEM.md`。
- `EffectController` 统一负责调度、覆盖、音效、震动和恢复。
- `EffectRendererRegistry` 将语义 key 映射到可替换 Renderer；`EffectHandle` 与 `TransientEffectNodePool` 统一管理完成、跳过、重连和销毁。
- `EffectAssetCatalog` 只允许运行时加载已登记资源；旧库来源、MIT 许可证、SHA-256 与 39 项拒绝图片由 `third_party/legacy-effects/manifest.json` 固定。
- `AudioProfiles` 将局开始、发牌、三种不要、0–5 倒计时、炸弹、同花顺、天王炸、逢人配和胜负映射到授权/NiuMa 音频及 rFXGen 兜底；普通出牌只保留人声报牌，不再叠加电子落牌声。
- 通用的从左向右 `PatternSweep` 和对子旧流光已从真实牌局表现链卸载。普通炸弹已替换为独立投掷物、贝塞尔轨迹、到点爆炸与爆点音效；旧对子配方只允许在开发版“音效/动效资产库”中手动预览。
- `EffectNodePool` 与 `CardFlightController` 使用临时卡牌快照，不移动真实手牌节点。
- `GameTableShakeRoot` 只包含座位和桌面出牌区；手牌、HUD、聊天与返回入口不会震动。
- L0/L1 可并行；同一时刻最多一个 L2/L3，新高等级表现可替换低等级表现。

默认效果预算由 `EffectPolicy` 固定为：最多一个 L2/L3 主特效、允许高等级替换低等级、动画期间始终允许牌桌输入。主特效的 active 回调只控制「跳过动画」按钮，不负责禁用按钮或触摸节点。

三档视觉质量和声音开关相互独立：

| 模式 | 飞牌/标签 | 暗场/震屏 | 牌型音效 | 震动 |
| --- | --- | --- | --- | --- |
| 完整 | 完整 | 按 L2/L3 配置 | 由声音开关决定 | 由震动开关决定 |
| 精简 | 缩短并降到 L0/L1 | 关闭 | 由声音开关决定 | 关闭 |
| 关闭 | 关闭 | 关闭 | 由声音开关决定 | 关闭 |

资源加载失败会依配置顺序尝试通用声音，所有候选均失败时静默结束，不抛错、不重试风暴、不阻塞规则、输入或网络消息。

### 阶段三：牌桌反馈

- 己方从被选手牌的世界坐标聚拢、弧线飞至出牌区。
- 左、右、上方玩家从各自座位的虚拟出牌点起飞。
- 普通牌轻落地；顺子、三连对、钢板显示短标签和扫光。
- 炸弹按张数分小、中、大：普通炸弹由玩家位置投向落点后才触发闪光、冲击波、火星、火焰、碎片、烟雾和桌面震动；同花顺和天王炸使用专属配色、暗场与震屏。
- 只有规则结果含 `wildcardUsages` 时才显示「逢人配」。

### 阶段四：局外与韧性

- 结算显示胜利/失败和升级信息；胜利有金色反馈与音效。
- 发牌、级牌提示、托管呼吸、左右聊天波纹、贡还牌、玩家出完和匹配成功已经接入统一流程动效。
- 匹配页显示三张牌循环洗牌。
- 设置支持完整、精简、关闭三档特效及震动开关。
- 主特效出现时可点「跳过动画」，直接保留最终牌桌状态。
- 初次快照、动作序号回退、一次跨越多个动作均视为恢复，不重播历史特效。

## 平台与生产联机配置

平台能力由 `GameScene.platformEndpoint` 控制：留空时只展示本地演示商城和比赛；配置平台服务的 origin（例如 `http://127.0.0.1:3003`）后，客户端会自行追加 `/api/v1/...` 路径，登录、钱包、商品、报名和四人匹配才使用真实服务。好友房仍使用 `lobbyEndpoint`，匹配入桌必须使用平台签发票据中经过校验的 `gameEndpoint`、固定席位和过期时间。

- 本机 Web 联调可使用 `http://127.0.0.1:3003` 和 `ws://127.0.0.1:3002/weapp`。默认地址策略只为本机回环地址放行明文 WebSocket。
- 局域网真机联调时，平台服设置 `PLATFORM_HOST=0.0.0.0`，`GAME_ENDPOINT` 设置为电脑的 `ws://局域网IP:3002/weapp`；客户端临时打开 `platformAllowInsecureGameEndpoint`。只有无法使用 `wx.login` 的本地联调才同时打开 `platformAllowDevelopmentLogin` 和服务端 `PLATFORM_ENABLE_DEV_LOGIN=true`。
- 生产发布时两个客户端开关都必须关闭，`platformEndpoint` 必须使用 HTTPS，平台返回的牌局地址必须使用 WSS，并加入微信合法域名。服务端启用 `GAME_TICKET_REQUIRED=true`，配置真实微信凭证和至少32字符的独立密钥；平台服与牌局服必须共享 `GAME_TICKET_SECRET`、`GAME_RESULT_SECRET`。
- 当前内存/JSON/Redis 原型存储只适用于单实例开发验证。正式环境仍需数据库事务与唯一约束、Redis 原子匹配与票据消费、密钥轮换、限流、审计、备份和多实例故障测试。

## 自动测试

1. 共享核心编译与 `round-smoke.cjs`：完整 AI 对局、进贡、结算、三连对非炸弹、逢人配语义。
2. `audio-effects-regression.cjs`：音频事件覆盖、合法资源存在、缺失降级、三档质量、单主特效预算和输入不阻塞守卫。
3. `effect-design-system-regression.cjs` 与 `effect-renderer-migration-regression.cjs`：统一 token/primitives、Renderer 注册、句柄清理、确定性炸弹素材哈希、三档质量和重连不补播。
4. `legacy-effect-assets-regression.cjs`：固定来源、许可证、SHA-256、5 项允许输入与 39 项拒绝资源。
5. Cocos 严格 TypeScript 检查。
6. Cocos Web Desktop 构建，确认登记资源进入 resources bundle，拒绝旧图不进入产物。
7. Windows React 客户端 TypeScript 与 Vite 生产构建。
8. WebSocket 四客户端集成：建房、入房、脱敏、出牌、聊天、离房。
9. 微信小程序原生产物构建，并确认新共享核心进入 `dist/core`。
10. `platform-api-regression.cjs`：登录刷新并发、响应校验、HTTPS/WSS 地址策略、商城幂等键复用、价格/报名费快照和匹配票据校验。
11. `lobby-entry-regression.cjs`：重复入桌防护、超时、过期票据、晚到响应清理和同一票据恢复。
12. `platform-live-contract.cjs`：启动真实平台服务，用实际 Cocos HTTP 客户端完成登录、钱包、商品兑换、赛事报名、四人匹配和取消竞态契约。
13. 服务端 `platform.test.mjs`：平台 API、存储、票据签发/消费和 HMAC 签名结算幂等；`weapp-ticket.smoke.mjs`：四个固定席位、强制票据、成功响应丢失后的同票据恢复和抢占拒绝。

对应命令：

```sh
# guandan-cocos 目录
node tests/platform-api-regression.cjs
node tests/lobby-entry-regression.cjs
node tests/platform-live-contract.cjs

# guandan-windows-source 目录
cd ../guandan-windows-source
npm run test:platform
node server/weapp-ticket.smoke.mjs
npm run test:server
```

自动测试只证明代码路径和本机进程内契约，不替代真实微信账号、真实网络、四台设备以及服务重启/多实例条件下的验收。

## 必须人工执行的真机测试

### 规则与同步

- 用两台以上真实设备加入同一房间，四个席位至少各出牌一次。
- 人为制造弱网、切后台 10 秒、断网后恢复，确认只出现最终桌面，不重播历史炸弹。
- 验证普通六张三连对、钢板不触发炸弹；四王、同花顺与 4/6/8 张炸弹强度逐级提升。
- 验证红心级牌正常当本身使用时不出现「逢人配」，只有实际替代才出现。

### 操作与节奏

- 连续点击提示，确认合法提示轮换、选牌上移且出牌后位置复原。
- 检查无牌可压时只显示居中的「不要」；其他情况按钮数量变化后仍居中。
- 在 L2/L3 播放中立刻选牌、聊天、返回，确认输入不被锁死；点「跳过动画」确认无残留遮罩或幽灵牌。
- 让多名玩家在 1 秒内连续出炸弹，确认只保留一个主特效，正式桌面牌始终先可见。

### 屏幕与性能

- 至少覆盖 iPhone 刘海屏、主流安卓 1080p、低端安卓和桌面 1280×720。
- 横竖屏切换再切回横屏，检查手牌、倒计时、对家操作区和返回按钮。
- 完整特效连续打一整局，观察帧率、内存与机身温度；低端机用「精简」档复测。
- 关闭音效、关闭震动、关闭特效分别复测，确认设置重启后仍保存。

### 美术与音频

- 确认炸弹暗场不遮住倒计时、返回大厅和网络状态。
- 检查红黑花色、牌型标签、桌面牌和飞牌快照一致，不出现错牌或重复牌。
- rFXGen 只作为资源失败兜底；新接入的 Female 报牌、三种“不要”、倒计时和胜负音仍必须按响度、节奏与品牌风格逐项真机听测。

### 平台、商城与四人匹配

- 四台真实手机分别使用不同微信账号进入快速匹配，确认恰好四人成桌、每端固定获得唯一的 `p1`—`p4` 席位、非 p1 先到也能等待、四席到齐自动发牌；逐端核对自己的手牌不可被其他三端看到。
- 在匹配中分别测试切后台、飞行模式、弱网和 WebSocket 重连；确认成功响应丢失后，同一张未过期票据能回到原席位、拿到原 `resumeToken` 和当前最终状态，不重复发牌或播放历史特效。再验证过期票据、不同票据和已有活动连接占位均会被拒绝。
- 在第四人到齐的瞬间点击「取消匹配」，覆盖“取消先到”和“分配先到”两种顺序：前者应离开队列，后者应收到已分配结果并继续进入对应牌桌，不能留下三人死房或同时进入两个房间。
- 商城兑换时人为丢弃第一次 HTTP 响应后重试，确认客户端复用同一 `Idempotency-Key`，只生成一张订单、只扣一次积分和库存；用同一键改正文应返回冲突。兑换前在服务端调整价格，确认返回 `PRODUCT_PRICE_CHANGED`、不扣分并要求刷新后重新确认。
- 赛事报名同样验证重复点击/超时重试只扣一次；报名费在页面展示后变化时返回 `TOURNAMENT_PRICE_CHANGED`，刷新前不可按新价格静默扣分。
- 关闭客户端 `platformAllowDevelopmentLogin` 和服务端 `PLATFORM_ENABLE_DEV_LOGIN`，配置真实 `WX_APPID` / `WX_SECRET`，用真机验证 `wx.login` 一次性 code 登录、过期/伪造 code 拒绝、重新登录仍关联原用户与钱包。检查客户端、平台日志和代理记录均不打印 `code`、`openid` 或 `session_key`。
- 生产候选环境必须经 HTTPS/WSS 和微信合法域名访问；确认 HTTP/WS 非回环地址被客户端拒绝，证书错误不会降级成明文连接，并复测结算回调重复投递只入账一次、签名错误或席位映射不一致不会入账。
