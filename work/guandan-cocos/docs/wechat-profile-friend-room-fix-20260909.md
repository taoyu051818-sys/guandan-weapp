# 微信资料与好友房修复 · 2026-09-09

## 已确认的原因

- 线上运行 `/srv/guandan/releases/20260907-profile-preselect`，其好友房严格字段表不包含 `upgradeTarget`、`counterEnabled`、`disableVoice`。当前客户端表单已经发送这些字段；不是应该删掉字段或关闭校验，而是服务端没有同步发布。
- 资料授权始终创建按钮，没有按微信小游戏文档区分已经授权的用户。之前只读取 `userInfo`，现在也兼容成功回调的 `rawData`，只提取展示用的昵称与头像。
- Cocos 进入后台时直接销毁授权按钮，使尚未返回的授权回调失效。现在暂时隐藏，回前台恢复，关闭编辑器或授权成功才清理。
- 新授权头像还未保存时，预览请求只能读取数据库中的旧头像，客户端发现 URL 不一致就回退默认头像。现在提供经过认证和 URL 白名单限制的草稿预览，不提前保存资料。
- 原生按钮不能跟随 Cocos 按钮的入场/按压缩放。获取原生矩形前结束该按钮缩放，避免点击范围缩小；打开编辑器即可出现原生入口，不再先点一次游戏按钮才生成第二个按钮。

以上是代码与线上版本确认的缺陷。尚未收到本轮手机授权报错，不能断言这些是特定真机唯一的失败原因。

## 边界

- 使用微信**小游戏**的 `getSetting → getUserInfo / createUserInfoButton`，没有把普通小程序 `chooseAvatar` WXML 组件移植到 Cocos。
- 不在启动或登录时读取头像昵称；用户主动打开资料编辑器后才走获取/授权流程。拒绝后可重试或手动填写昵称，保存仍需点击“保存”。
- 头像通过业务域名的认证代理加载，未增加小游戏请求域名。仍只允许 HTTPS 的 `thirdwx.qlogo.cn` / `wx.qlogo.cn` 下 `/mmopen/` 地址，拒绝跳转、任意主机、端口、凭证及非 PNG/JPEG 数据，最多 512 KiB。
- 资料解析独立在 `WechatProfileResult.ts`；原生授权生命周期由 `WechatProfileProvider.ts` 管理，未向场景新增规则职责。
- 头像预览：`POST /api/v1/profile/avatar`，正文 `{ avatarUrl }`。旧版 `GET` 继续返回已保存的本人头像，两者都要求登录。预览不会修改昵称或头像。

官方依据：

- [小游戏用户信息获取](https://developers.weixin.qq.com/minigame/dev/guide/open-ability/user-info.html)
- [createUserInfoButton](https://developers.weixin.qq.com/minigame/dev/api/open-api/user-info/wx.createUserInfoButton.html)
- [UserInfoButton.onTap](https://developers.weixin.qq.com/minigame/dev/api/open-api/user-info/UserInfoButton.onTap.html)

## 验证

- Cocos 默认全量回归、运行时/CI TypeScript、共享核心同步、架构与健康检查通过。213 个运行模块，58 项模块体积预算。
- 服务端全套 `test:server` 通过，71 个生产 JS 文件/35 项体积预算通过。
- 新增真实客户端表单→HTTP 服务契约，验证过6、过10、过A、过A翻山，以及记牌器、语音开关、延迟观战配置；创建后清理测试房间。全部使用独立内存测试服务，不修改线上账号。
- 原生 API 替身覆盖已授权直接获取、首次授权、拒绝、损坏数据、原始 JSON 回调、后台返回、关闭后迟到回调及重复回调。
- 实际 Cocos 渲染中使用临时原生接口替身，验证按钮完整范围、后台期间授权后昵称更新、头像预览参数正确。验收后刷新清除了替身；这不等同于真机授权通过。
- 微信发行包主包 2.93 MiB、资源子包 12.81 MiB，总计 15.74 MiB，严格域名与包体检查通过；未上传微信体验版。

## 广州部署

- 已切换 `/srv/guandan/current` 到 `/srv/guandan/releases/20260909-profile-room-fix`，两个服务重新启动并处于 active。
- 发布前游戏连接数 0、进行中牌局数 0；激活脚本再次检查后才停止服务。
- 原版本保留为 `20260907-profile-preselect`；数据备份位于 `/srv/guandan/backups/20260909-profile-room-fix/data`。
- 发布归档 SHA-256：`d80a72dd0e0a2f637b6b4a16968a56202c1ea99fd3ec981e7aa29648e94c01d4`。
- 已核对线上 `friend-room-settings.js` 与 `platform/http.js` 哈希和本地相同；在线上新发布目录验证四种升级目标均被严格校验接受。
- 外部健康接口/网页 200，匿名资料 401，开发登录 403，WSS 升级与协议检查通过，非信任 Origin 返回 403。
- 本轮没有创建线上测试账号、修改微信后台设置或上传小游戏。正式 HTTPS/WSS 域名继续使用 `api.yutechhn.cn`。

## 手机待验收

1. 微信开发者工具重新编译 `build/wechatgame`，用新预览码打开，不复用旧体验包。
2. 打开个人资料；未授权用户点击原生授权并同意，已经授权用户直接读取。昵称应更新，新头像应显示；点击保存，关闭后重开应保持一致。
3. 授权时切后台再返回、拒绝后重试、修改昵称后保存，都不得出现没有反馈或原生按钮残留。
4. 分别创建定局和升级好友房，测试过6与过A翻山，确认无“不支持字段”提示，入桌规则摘要与选择一致。
5. 若仍失败，保留具体提示与真机日志；需进一步核对该 AppID 后台隐私保护指引及用户授权状态，不关闭域名校验或伪造头像昵称。
