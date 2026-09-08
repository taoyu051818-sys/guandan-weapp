# 广州腾讯云部署与微信真机验收

记录日期：2026-09-05。本轮完成服务器部署与微信发行包配置，尚未上传微信体验版，也未完成真实微信登录和四机联机验收。当前适合受控体验测试，不代表完成正式运营上线。

## 地址与边界

| 项目 | 当前值 |
| --- | --- |
| 服务器 | 广州腾讯云 `42.193.229.164` |
| SSH 用户 | `ubuntu`，小写 |
| 实际 HTTPS 域名 | `api.yutechhn.cn` |
| 网页外观预览 | <https://api.yutechhn.cn/guandan/> |
| 客户端平台根地址 | `https://api.yutechhn.cn/guandan` |
| 平台健康检查 | <https://api.yutechhn.cn/guandan/api/v1/health> |
| 游戏连接 | `wss://api.yutechhn.cn/guandan/weapp` |
| 微信 AppID | `wxa79bf8bc567765a1` |
| 本地微信包 | `build/wechatgame` |
| 本次发布目录 | `/srv/guandan/releases/20260905-1648` |

用户提供的域名拼写为 `api.yuteachhn.cn`；部署前检查发现该拼写没有有效 DNS，服务器原有 DNS、Nginx 和证书使用的是表中的 `api.yutechhn.cn`。因此沿用经过核实的现有域名，不为错误拼写关闭证书校验。

网页构建与微信构建都使用正式 HTTPS/WSS 配置，不启用开发登录。普通浏览器没有 `wx.login`，网页预览不能替代微信账号登录与联机验收。

## 部署隔离

- 新增独立系统用户 `guandan`，两个 systemd 服务均使用该用户，不使用 root 运行游戏。
- 平台仅监听 `127.0.0.1:33103`；牌局服务仅监听 `127.0.0.1:33102`。对外复用 Nginx 的 443，不额外暴露两个内部端口。
- `/guandan/api/v1/` 转发到平台，`/guandan/weapp` 转发到牌局服务，`/guandan/` 提供网页静态资源。
- 未替换原有业务；现有 `/api/v1/health` 部署后仍返回 200。
- 使用服务器已有 `/opt/node-v24.19.0/bin/node`，未更改系统默认 Node。
- 数据保存在 `/srv/guandan/shared/data`，当前是 JSON 单实例存储。不要启动第二个平台或游戏进程并发读写同一份文件；扩容前需另做数据库迁移、备份恢复和负载验收。

配置模板在 `ops/guangzhou/`：两个 systemd 单元、Nginx 路由片段、幂等生产环境初始化脚本及非业务写入的部署检查脚本。

## 密钥

AppSecret 不属于小游戏客户端配置。它只供服务端兑换微信登录 code 使用。

- 本地：服务端项目 `.env.wechat.local`，权限 600，已由 Git 忽略；可用 `npm run server:platform:wechat` 启动本地平台。
- 服务器：`/srv/guandan/shared/wechat.env`，root 所有、权限 600，仅平台服务读取。
- 服务器：`/srv/guandan/shared/production.env`，root 所有、权限 600；四种签名密钥独立随机生成，初始化脚本不会覆盖已有密钥。
- `PLATFORM_ENABLE_DEV_LOGIN=false`、`GAME_TICKET_REQUIRED=true`；客户端三个开发/不安全地址开关都为 false。
- 本轮扫描微信构建未发现 AppSecret；扫描服务器网页 393 个文件，AppSecret 出现次数为 0。

不要把秘密复制到 `project.config.json`、前端脚本、日志、文档、截图或 Git。聊天中曾提供明文凭据，建议交付后轮换 AppSecret 和 SSH 密码，并使用 SSH 密钥登录；本轮未擅自修改登录凭据。

## 微信构建复现

在 Cocos 项目目录运行，确保 shared-core 已构建且已同步：

```sh
/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator --project "$PWD" --build 'platform=wechatgame;debug=false;sourceMaps=false;outputName=wechatgame;useSplashScreen=false'
pnpm finalize:wechat-build
pnpm verify:wechat-build
```

本轮发行包检查：主包 2.96 MiB，`game-assets` 子包 6.64 MiB，总计 9.60 MiB；AppID、小游戏类型、合法域名校验开关、资源分包、加载图、正式地址与开发开关均通过检查。

2026-09-06 起，微信模板默认带上述正式 HTTPS/WSS 地址，不再依赖手工设置环境变量。遗留环境变量如指向本机、IP、其他域名或打开开发登录，后处理会拒绝；不要关闭合法域名校验来绕过。

`pnpm verify:wechat-package` 现在也强制检查正式网络配置和域名校验开关，但不验证真实微信登录、后台域名/备案状态或真机牌局，仍不可代替完整发布验收。

## 2026-09-06 合法域名回归修复

问题包是只经过包结构验收的重建产物，`game.js` 缺少正式配置注入。原运行时又仅按 `location.hostname` 判断本地网页，没有先排除微信模拟器，因此可能回退 `http://127.0.0.1:3003`。之前对“微信包结构通过”的验收不足以保护连接配置，此次补齐：

- `build-templates/wechatgame/game.ejs` 在加载适配器前注入正式地址和微信目标标记，Creator 直接构建也有安全默认值。
- `RuntimeClientConfig` 优先识别微信目标/微信 API；缺配置直接报错，不回退 Inspector、本地服务或开发网关。三个开发开关必须全部为 false。
- `WechatNetworkPolicy` 对业务请求只允许 `https://api.yutechhn.cn/guandan/...` 和 `wss://api.yutechhn.cn/guandan/...`；HTTP、裸 IP、localhost、相似拼写、未知域名、带凭证或额外端口的地址都被拒绝。
- HTTP 和 WebSocket 传输入口再校验一次，覆盖服务端票据和旧恢复记录中的地址。测试验证非法地址产生 **0 次网络打开**，并且不会断开已有合法连接。
- 微信完整校验与 package-only 均强制验证网络配置、`urlCheck=true`，并拒绝 private 配置关闭校验、未审查远程资源包。当前美术/音频通过本地资源及微信分包提供，没有新增 CDN 请求。

实测：新包在当前微信开发者工具重新编译后进入大厅；`gameContext` 中确认 HTTPS/WSS 地址和三个 false 开关；Network 以 `api.yutechhn.cn` 筛选命中 2 个业务请求，已观察 `wallet` 返回 200。外部健康接口返回 200，TLS 校验通过，连接服务器为 `42.193.229.164`。本轮没有执行购买、开房、生产部署或上传。

开发者工具内部页面地址 `127.0.0.1:56247/game/...` 属于模拟器自身，不是游戏业务后端；不把该地址的堆栈链接误当成仍在请求 3003。工具仍显示基础库 `getSystemInfo / jsbridge not ready` 的启动日志及灰度库警告，不属于本次合法域名错误，不能宣称控制台全部零错误。

本轮通过：客户端全量 `pnpm test`、194 模块/42 预算架构检查、CI/Cocos TypeScript、微信构建、后处理及两种微信包验证。包大小：主包 2.98 MiB，game-assets 13.49 MiB，总计 16.47 MiB。测试日志 `/tmp/guandan-wechat-domain-fix-tests.log`；构建日志 `/tmp/guandan-wechat-domain-fix-build.log`。启动画面：`docs/visual-polish-20260906/wechat-domain-fix-20260906.jpg`。

仍需用户核对公众平台 **socket 合法域名**含 `wss://api.yutechhn.cn`（本次提供的日志只证明 request 列表）。备案/主体/审核状态以官方后台为准，HTTPS 通或健康接口 200 不能代替备案证明。真实设备和全新微信 code 登录仍需后续验收。

## 微信后台与真机：尚待完成

2026-09-06 补充：已修复 96% 初始化阶段对浏览器 `URL` 的依赖，并重新构建微信包。无 URL 的源码回归、最终压缩包回归及默认全量测试已通过；鸿蒙真机尚待确认。阶段编号和验收步骤见 [启动 96% 兼容修复](wechat-startup96-compatibility-fix-20260906.md)。不要将模拟器正常显示或包验证通过等同于真机通过。

1. 确认该 AppID 对应的是微信**小游戏**，并有项目开发与上传权限。当前构建类型是 `game`，不是普通小程序网页包。
2. 在公众平台的服务器域名设置中核对：request 合法域名 `https://api.yutechhn.cn`；socket 合法域名 `wss://api.yutechhn.cn`。合法域名填域名根地址，不把 `/guandan` 路由作为域名。以后若引入远程下载资源，再按实际下载地址配置 downloadFile 域名。服务器部署不能代替公众平台的配置操作。
3. 微信开发者工具导入本项目 `build/wechatgame`，核对 AppID，保留合法域名/HTTPS 校验，不通过关闭校验绕过问题。
4. 真实账号执行一次 `wx.login → /auth/wx-login → profile → 匹配 → WSS 签名入桌`，确认不永久停留在“账号同步中”。本轮只确认密钥配置存在，未通过真实 code 验证其有效性。
5. 先一台手机快速匹配：2026-09-07 已调整为最早玩家等待满 3 秒后，在服务端轮询事务中补齐空位并开局；不要求精确到 3.000 秒。匹配页不展示补位和服务器确认过程，后台保留席位类型与审计信息。最新发布与验证见 [左右闹钟与匹配节奏验收](side-clock-release-20260907.md)。
6. 再用两个和四个真实账号同时进入同一经典场：不得重复占座、重复开局；取消匹配与恰好配桌同时发生时不得留幽灵队列。赛事不套用普通场机器人补位规则。
7. 牌桌测试：连续选牌/取消/提示/出牌，不要后继续选牌，倒计时 20 秒与托管，切后台恢复，Wi-Fi/蜂窝切换重连，出完提示、结算、四人准备、贡还、下一局和安全退出。
8. 至少一台 Android 和一台 iPhone：核对 874×402 目标稿、刘海安全区、下叠牌露点与花色、音效、触摸命中、冷启动资源失败重试。重连不得重播历史动效。
9. 完成上述流程后再上传体验版。版本上传、体验成员、备案/小游戏运营资质与审核状态均未在本轮核验，不以服务器可访问替代这些条件。

域名与工具配置参考：[微信小游戏网络文档](https://developers.weixin.qq.com/minigame/dev/guide/base-ability/network.html)、[团结引擎官方微信小游戏部署说明](https://docs.unity.cn/cn/tuanjiemanual/Manual/UploadWeixinMiniGame.html)。

## 本轮已验证与未验证

已验证：共享核心同步 36 个 TS 文件；服务端语法/模块预算检查与全套 `test:server`；客户端运行配置回归；微信完整发行校验与 Web 发行校验。

服务器实测：平台健康 200；网页入口 200；匿名 profile 401；开发登录 403；WSS TLS、升级与应用协议响应正常；不受信任 Origin 返回 403；两个新服务和 Nginx 均 active；原有业务健康接口仍为 200。

未验证：真实微信登录、四机真实牌局、公众平台配置与上传。浏览器自动化打开线上预览超时，虽然 HTTP 入口检查成功，但本轮不声称完成线上页面截图和视觉验收。UI 改进计划依据当前源码及已有页面记录，下一轮应在真机对照验收。

## 维护与回退

在服务器运行：

```sh
sudo systemctl status guandan-platform guandan-game --no-pager
sudo journalctl -u guandan-platform -u guandan-game --since '15 minutes ago' --no-pager
/opt/node-v24.19.0/bin/node /srv/guandan/ops/verify-deployment.mjs
```

最后一条对应仓库 `ops/guangzhou/verify-deployment.mjs`，已安装到服务器的独立运维目录。该脚本不创建用户、房间或比赛，检查鉴权边界时仅调用拒绝路径。

Nginx 路由片段：`/etc/nginx/snippets/guandan.conf`。原有站点在 `/etc/nginx/sites-available/yanqing-api`，部署前备份在 `/srv/guandan/shared/yanqing-api.before-guandan.conf`。

后续更新使用新的 release 目录，通过 `/srv/guandan/current` 切换，再重启两个掼蛋服务并检查；如需回退，在保持数据兼容的前提下切回上一 release。不要删除 shared 数据或覆盖签名密钥。本次是首发，没有上一掼蛋版本；撤销路由时只移除掼蛋 include，先核对原有站点有无后续修改，`nginx -t` 成功后才 reload，不盲目覆盖整份站点。

持续运营前另补：数据备份及恢复演练、证书续期验证、服务与磁盘告警、容量压测。本轮没有新增这些运维承诺。
