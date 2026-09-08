# 微信真机启动停在 96%：兼容修复

## 证据与限制

用户设备日志标记 `platform: ohos`，基础库 3.17.2；用户确认失败进度为 96%。此阶段已通过 `game-assets` 分包和大厅／37 张牌面纹理的预加载，正在执行 `GameScene.initializeGame()`。日志中没有捕获到游戏初始化异常正文，不能仅凭进度断言该手机缺少 `URL`。

修复前用当前 `StartupCoordinator` 和真实配置解析器隔离复现：正常 `URL` 环境可到 100%；将 `URL` 设为 `undefined`，同一个正式 HTTPS/WSS 配置在 96% 抛出“运行时平台地址格式无效”。原微信构建没有提供 `URL` polyfill。原加载层又把所有失败标题写成“资源加载失败”，导致初始化问题被误判为下载问题。

## 修改边界

- 新增 `services/NetworkEndpoint.ts`，只解析项目需要的绝对 HTTP(S)/WS(S) 业务地址，不依赖浏览器 `URL`、DOM 或 Node，也不污染全局对象。它不是通用 WHATWG URL polyfill：接受 ASCII 域名、规范 IPv4、括号十六进制 IPv6；拒绝凭证、歧义 authority、无效端口、反斜杠、空白和损坏的转义。
- 统一用于运行时配置、微信业务白名单、平台网关、匹配／好友房票据解码和断线恢复存储，避免只修入口而把错误推迟到入桌。
- 微信仍只允许 `https://api.yutechhn.cn/guandan` 和 `wss://api.yutechhn.cn/guandan` 下的业务地址；拒绝 localhost、裸 IP、相似拼写、外域、额外端口、路径穿越及其编码形式。不关闭域名校验，不回退本地服务，不增加 CDN。
- 仅修改加载错误文案与恢复动作。大厅、牌桌布局、美术、规则和生产服务器不变。

## 错误编号

| 编号 | 阶段 | 屏幕标题 | 恢复方式 |
| --- | --- | --- | --- |
| GD-S01 | 分包下载（3–85%） | 资源下载失败 | 检查网络，重试加载 |
| GD-S02 | 大厅／牌面预加载（88%） | 画面准备失败 | 重试加载 |
| GD-S03 | 游戏初始化（96%） | 游戏初始化失败 | 重新进入，禁止在部分初始化场景上重复创建 |
| GD-S04 | 重启失败 | 重新进入失败 | 关闭小游戏后再次打开；再次点击的失败也会被捕获 |

屏幕保留失败百分比及编号；控制台用 `[GuandanStartup:编号]` 标记原始异常。原始异常、凭证、请求头不直接拼进屏幕文案。

## 回归覆盖

`tests/wechat-runtime-compatibility-regression.cjs` 在独立 VM 内分别模拟 `URL` 缺失、构造器抛错、正常接口。使用真实启动协调器、配置解析器和网关工厂（Cocos 节点／资源下载采用 mock），验证 96%→100%。另测匹配地址、恢复记录、HTTP/WSS 入口；非法地址打开网络次数必须为 0，拒绝非法替换不能断开已有合法连接。

启动回归覆盖分包失败重试、牌面失败重试、部分初始化禁止原地重试、重复重启失败捕获。加载层真实 `showError` 方法验证四种标题、错误编号、按钮文字和百分比保留。默认 `pnpm test` 注册兼容测试，构建验证器检查最终微信主脚本已包含新解析器和四个编号、没有 `new URL(...)`，避免只测试新源码却交付旧包。

这些自动测试不能替代完整 Cocos 渲染或鸿蒙真机验收。

## 本轮验证结果

- `pnpm test` 全量通过（包括最终客户端／本地服务端契约测试）；日志 `/tmp/guandan-wechat-startup96-tests.log`。
- `pnpm verify:architecture` 通过：195 个模块、42 个大小预算，无提高预算；CI 核心和 Creator 工程两套 TypeScript 检查通过；`git diff --check` 通过。
- Creator 3.8.8 微信发行构建完成（日志中的 Build Task Finished；CLI 正常完成码 36）；构建日志 `/tmp/guandan-wechat-startup96-build.log`。
- `pnpm finalize:wechat-build`、`pnpm verify:wechat-build`、`pnpm verify:wechat-package` 通过：主包 2.98 MiB，资源分包 13.49 MiB，总计 16.47 MiB。
- 验证器还运行 `tests/support/wechat-built-startup.cjs`，直接执行**最终压缩包**中的 System.register 模块（非重新转译 TS），在 `URL` 不存在时通过配置、网关、票据解析及启动 96%→100%；Cocos 渲染／资源仍使用 mock。
- 本次构建 `assets/main/index.js` SHA-256：`0336c97a45aae72f182a01f9e15f5c7449a142625c9ec2291fb30bb128a8eb7e`。
- 检查微信工具时大厅可见，但用户正操作上传窗口，因此停止自动操作；未把该画面宣称为本轮真机验收通过。助手未执行上传或服务器部署。

## 真机验收

1. 微信开发者工具使用本项目 `build/wechatgame`，刷新项目配置、重新编译并重新建立真机调试；不要继续使用旧调试包。
2. 保持合法域名校验开启，冷启动确认 96% 后进入大厅，且没有“地址格式无效”。
3. 再验证账号同步、经典匹配、入桌，以及切后台后恢复；这些路径也使用新解析器。
4. 若仍失败，截图保留百分比和 `GD-Sxx`；在**游戏上下文**控制台筛选 `GuandanStartup`，复制该行后的异常正文／堆栈。微信基础库的 `reportUserBehavior:ok` 不能替代游戏异常。

本轮不上传体验版、不部署服务器。

后续用户反馈：已能进入大厅，启动失败已恢复；用户也反馈已添加 socket 合法域名。该反馈不等于完整联网／切后台恢复／多机型验收。随后发现的滑选起点偏移独立记录在 [滑选修复](hand-touch-origin-fix-20260906.md)。
