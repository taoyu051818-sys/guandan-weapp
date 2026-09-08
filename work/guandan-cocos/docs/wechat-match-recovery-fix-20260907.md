# 手机端“继续牌局”只闪到账号同步中

## 证据及诊断边界

用户确认故障发生在微信手机端，点击后会闪到“账号同步中”。这说明点击触发了后续流程，不能再把问题简单归为按钮点击区域。

1. `MatchRecoveryAttemptTracker` 原先同步调用浏览器 `globalThis.crypto.getRandomValues`。微信小游戏原生接口为 `wx.getUserCryptoManager().getRandomValues({ length, success, fail })`，异步返回 `randomValues: ArrayBuffer`。浏览器成功不能证明手机兼容。关闭浏览器 crypto、仅提供微信原生回调的回归环境中，旧代码在 HTTP 请求前失败；新代码通过。
2. `PlatformMatchRecoveryCoordinator` 原先先 `showNotice`，再 `showRecoveryAvailable`。后者通过 `showRecoveryMenu → showMenu → closeModal` 清除刚创建的错误弹窗，同时刷新账号信息。浏览器只屏蔽 `/api/v1/matches/recover` 时复现：大厅中 `recoveryAvailable=true`，错误为“无法连接平台服务”，但 `modalPresent=false`。修复后同一故障下 `modalPresent=true`，提示可见。
3. 本机微信工具指向 `build/wechatgame`，检查到修复前主脚本仍为 9 月 6 日 17:38 构建，尚未包含后来浏览器版本的主按钮等待状态。本轮重新构建该目标。

尚未取得手机端本次失败的游戏异常堆栈，因此“浏览器 crypto 缺失”是已证实的兼容缺陷、与症状高度吻合的原因，不宣称已在用户手机捕获该异常。

原生接口依据：[微信小游戏官方 API 类型定义](https://github.com/wechat-miniprogram/minigame-api-typings/blob/master/types/wx/lib.wx.api.d.ts)，其中 `UserCryptoManager.getRandomValues` 标明基础库 2.17.3 起支持。官方网页在本轮工具中无法打开，以官方自动生成的类型及示例核对参数。

## 修改范围

- `network/LobbyEntryAttempt.ts` 增加异步安全随机数适配：微信原生、兼容直接 `wx.getRandomValues`、浏览器 Web Crypto；仍使用 16 字节／128 位随机值，编码为 22 字符 base64url。失败、返回长度错误、超时均明确拒绝，不使用 `Math.random`、时间戳或本地身份降级，不修改全局 crypto。
- `services/platform/MatchRecoveryAttempt.ts` 缓存正在生成的 Promise，连续调用共享同一恢复 ID；直到服务端入桌确认或明确放弃才轮换。原生生成失败可重试，迟到回调不能污染新尝试。
- `matchRecoveryGateway.ts` 等待随机值后发起原接口，既有票据、WSS 校验不变。
- `friendRoomGateway.ts` 同一随机数兼容问题也适用于创建／加入好友房，改为共用异步适配，并保留相同操作失败重试的 ID，不改变好友房规则／界面。
- `PlatformMatchRecoveryCoordinator.ts` 先恢复大厅／重试入口，再展示失败或自动重试暂停提示，避免弹窗被清除。手动继续而服务端返回空牌局时明确解释；普通冷启动没有历史牌局时保持安静。
- 不修改美术、按钮位置、理牌布局、游戏规则或生产服务器。不新增域名，不关闭合法域名检查。微信仍使用 `https://api.yutechhn.cn/guandan`、`wss://api.yutechhn.cn/guandan/weapp`。

UI/UX 技能只用于检查可见错误、清楚的下一步和失败后可重试，没有重新设计大厅。

## 回归及实际页面检查

- `tests/platform-api-regression.cjs`：无浏览器 crypto、原生异步返回、并发复用、确认轮换、原生失败、坏长度、超时、迟到回调、不支持环境拒绝、同环境好友房创建／加入／重试。
- `tests/lobby-entry-regression.cjs`：模拟大厅重建清掉弹窗，保证失败／恢复预算耗尽提示在重建后显示；手动空牌局有解释，正常冷启动空牌局无打扰；原有恢复、入桌、确认和重试用例保留。
- `tests/support/wechat-built-startup.cjs`：直接加载最终微信压缩包的 System.register 模块，禁用浏览器 URL、crypto；通过微信原生回调模拟完成真实网关恢复凭证解析、重试复用和确认轮换，检查最终包失败弹窗顺序。网络、微信 API 和 Cocos 渲染采用 mock，不等于真机通过。
- 全量 `pnpm test` 通过，包括客户端／本地服务端契约测试；架构预算和两套 TypeScript 检查通过。
- 浏览器本地房间 `171703`：正常匹配并入桌 → 安全退出 → 故意屏蔽恢复 HTTP → 错误弹窗保留 → 撤销屏蔽 → 点击继续 → 回到同一房间，`status=playing`、`route=null`、`modalPresent=false`。仅使用本地测试账号和机器人，未改生产状态；故障模拟已撤销。
- 已结束的前一个本地测试房间返回空结果时，实测显示“没有可恢复的牌局”，主入口恢复快速开始；检查后缩短该新提示文案，避免横屏小弹窗溢出。

## 构建和回滚

微信测试目录：`build/wechatgame`，Creator 3.8.8 正式构建。

`finalize:wechat-build`、`verify:wechat-build`、`verify:wechat-package` 全部通过：主包 2.99 MiB，资源分包 13.49 MiB，总包 16.48 MiB。最终 `assets/main/index.js` SHA-256：`9d83d230f293a451cca4fce5452c996224aaa7bdbd68a6f67251b2a06db767aa`。

覆盖前旧包备份：`/Users/mac/Documents/Codex/ui-baselines/guandan-wechat-before-recovery-20260907.tar.gz`。只备份该微信构建目录，没有重置工作区或删除历史预览。

本轮不上传体验版、不发布小程序、不部署服务器。旧体验版／旧二维码不会因本机重新构建自动更新。

## 手机验收

1. 微信开发者工具使用本项目 `build/wechatgame`，重新编译并重新生成预览／建立真机调试，手机重新扫码进入新包。若从已上传的体验版进入，需另行上传新版本后才能验证本轮修改。
2. 匹配进桌 → 返回大厅／安全退出 → 点击“继续牌局”，确认回到同一牌局和座位。
3. 切后台后返回再试；等待中的好友房也测试恢复。
4. 断网点击继续应能看到失败提示，恢复网络后可以重试。不存在可恢复房间时应明确解释，而非只有账号同步闪动。
5. 如仍失败，请截图完整错误弹窗；不需要提供密码、登录 token 或游戏票据。
