# 第十八批：身份、授权、资料保存与好友排行

基线 `1d58999dc6e5455b049e1643660bbba3deee1406`。新增20文件、2661行完整审阅，路径、SHA-256与逐文件结论见 [JSON](identity-boundaries-18.json)。本批未新增确认问题，既有26项尚未修复。

## 审阅结论

- 平台crypto完整实现：固定HMAC、目的/受众/期限、房间和席位/机器人/观战规则绑定、canonical设置、消费深拷贝及签名独立密钥边界。消费记忆有容量和进程寿命，不是永久全局去重保证。
- 资料授权：只有编辑入口挂原生按钮；静默读取要求privacy与scope先通过，超时/取消后不保存。新生成或手动保存的身份不被自动覆盖。
- 资料保存：共享队列串行提交，只发布最新revision，失败重新读确认资料。关闭编辑器不等于取消已提交保存。
- 好友排行：主域只提交本人综合分，好友记录在开放域过滤/排序/分页并绘制，主域只显示共享画布纹理。关闭清除数据并隔离迟到回调；未访问真实好友或发表云存储写入。
- 个人中心确有赛季任务入口与服务端对应路由，不能因“没有独立任务奖励文件”就判断功能不存在或退役。

## 验证

- `node work/guandan-windows-source/server/platform/platform.test.mjs`：通过。
- `node work/guandan-cocos/tests/profile-save-order-regression.cjs`：通过。
- `node work/guandan-cocos/tests/wechat-friend-ranking-regression.cjs`：通过。
- `node work/guandan-cocos/tests/profile-capsule-regression.cjs`：通过。
- `node work/guandan-cocos/tests/lobby-profile-polish-regression.cjs`：通过。
- `node docs/audit/2026-09-12/repro/identity-boundaries-18.cjs`：通过。

补充探针：28张合法签名票；1148次损坏、重用、绑定错误、字段错误或过期拒绝；22个回调签名/时间窗口对照；8个假微信code验证场景；6个静默读取阶段取消/禁止；3个原生控制生命周期；40次保存串行且只显示最后结果；40待发综合分取消后零写，40个同分请求只写一次。

平台既有测试使用临时回环HTTP和test合成账户/事件，JSON持久化只在mkdtemp的新目录内进行并finally清理；Redis和Wx为假端口。结算fixture人工构造，不是完整随机打牌。补充测试完全无外网/监听/文件写，密钥、身份和时钟均合成；报告不输出token或session_key。

## 尚未证明

未校验微信公众平台真实隐私声明、当前SDK原生返回范围、真机授权/后台/图像/字体与GPU效果；未检查真实部署密钥、全局去重容量极限或跨进程完整账号切换。主域不接收好友记录的结论来自当前数据路径代码与VM测试，不等于整个宿主环境隐私认证。

ProfileImagePicker与头像渲染协作者只追接口，不新增覆盖；FrontPageController只读相关片段，仍在待完整审阅清单。UI技能仅用于交互生命周期/反馈一致性审查，没有视觉改动。没有发现不等于这些边界已全部安全。
