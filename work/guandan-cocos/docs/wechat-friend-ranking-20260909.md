# 微信资料与好友综合分排行

## 已接入

- 个人中心新增「好友综合分排行」，不增加大厅入口。使用原有小圆角方框样式。
- 昵称头像：首次由 `wx.createUserInfoButton` 发起原生授权并自动保存；已授权时通过 `getPrivacySetting → getSetting → getUserInfo` 静默同步。回到大厅和个人中心均检查，编辑中或账号变化后不覆盖用户操作。
- 好友权限：用户点击榜单才执行 `requirePrivacyAuthorize → getSetting → authorize(scope.WxFriendInteraction)`。拒绝可重试或从按钮打开 `openSetting`。没有自动批准权限的流程。
- 仅将已登录平台返回的综合分写入本人 `setUserCloudStorage`，键 `comprehensive_score_v1`。静默同步需隐私和好友权限均已授权，未变化分数不重复写入。
- `openDataContext` 单独调用 `getFriendCloudStorage`，排序、分页、头像和名字绘制均留在开放数据域。主域只贴 sharedCanvas 纹理，不接收朋友 OpenID、昵称、头像列表。
- 每页 5 人；同分并列；缺失/无效分数不伪造为零。加载超时、授权失败、空榜、头像失败有对应状态。关闭及切后台清除名单、释放纹理、停止更新。

## 明确边界

- 此处使用微信客户端写入本人云分数，来源为已认证平台 dashboard；展示榜不是可信奖惩账本，不能据此发奖或修改服务器积分。需要防篡改奖励榜时另行接服务端云存储写入。
- 好友必须使用同一小游戏且同步过该键才有记录。旧版未上传分数的朋友不会凭空出现；微信新好友关系可能存在平台同步延迟。
- 不接群排行、潜在好友、好友互动分发及未使用的权限。用户提供的接口列表是能力清单，不是全部必接。
- 浏览器无微信好友数据，仅能验收界面和错误状态。真机授权和真实好友榜尚需验收。

## 公众平台配置（开发者操作）

使用这个 AppID 的**小游戏账号**登录微信公众平台，在设置中的用户隐私保护指引按实际用途声明：

- 昵称、头像：展示个人资料、牌桌身份、对局记录；对应 `getUserInfo`、`createUserInfoButton`。
- 微信朋友关系：展示使用同一小游戏的微信好友综合分排行；对应 `getFriendCloudStorage`。
- 使用后台现有信息项，不自行扩大用途；填写真实联系方式并提交。授权弹窗/发布审核以后台当前提示为准。

`getUserProfile` 不作为本次小游戏自动同步入口。隐私同意和好友 scope 同意是两层权限，不能互相替代。

官方参考：
- https://developers.weixin.qq.com/minigame/dev/api/open-api/user-info/wx.createUserInfoButton.html
- https://developers.weixin.qq.com/minigame/dev/api/open-api/data/wx.getFriendCloudStorage.html
- https://developers.weixin.qq.com/minigame/dev/api/open-api/data/wx.setUserCloudStorage.html
- https://developers.weixin.qq.com/minigame/dev/api/open-api/authorize/wx.authorize.html

## 包体与回归

`finalize:wechat-build` 自动复制开放数据域 3 个 JS 并写入生成的 game.json；`--check` 逐文件比对，禁止漏包或旧文件。

测试覆盖：静默权限边界、拒绝/超时、分数去重与合法性、取消后的迟到写入、开放域关闭后迟到结果、排序同分、分页边界、空榜和读取失败。

真机验收：
1. 新授权账号点头像授权，返回后自动显示微信昵称头像，再启动不重复要求已授予权限。
2. 打开个人中心 → 好友综合分排行，允许朋友信息；另一微信好友也使用新版并进入大厅/榜单同步分数。
3. 核对榜上综合分与各自个人中心一致，昵称头像来自微信；不同分排序、同分名次正确。
4. 拒绝权限、断网、恢复网络刷新、快速关闭重开、切后台；不得卡游戏或显示上一轮私有数据。
5. 全程无需手动输入好友信息、复制口令或开通群权限。

### 构建核验结果

- TypeScript runtime/refactor 类型检查通过；架构检查 225 个模块、58 个大小预算通过。
- 新增回归覆盖真实 modal 的可变 children 数组，加载/错误/刷新后仅保留一个面板；头像异步回调在关闭后不得重绘。
- 微信发布包核验通过：主包 3,117,267 字节（2.97 MiB），分包 13,433,169 字节（12.81 MiB），总包 15.78 MiB。开放数据域入口、配置和三个脚本逐文件比对通过。
- 自动测试使用的是隔离 fixture/native mock，不代表真机已经通过授权；真实微信好友和 sharedCanvas 纹理显示仍以手机验收为准。
