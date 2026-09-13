# 第十七批：平台客户端、好友房规则往返与HTTP边界

基线：`1d58999dc6e5455b049e1643660bbba3deee1406`；26个文件、3760行逐文件完整审阅。SHA-256与逐文件说明见 [JSON](platform-gateways-17.json)。本批2项新增：1项P2、1项P3；业务未修复。

## PG-17-001（P2）：关闭记牌器不生效

表单存在真实开关，但客户端房间配置白名单漏了 `counterEnabled`。请求发出前已丢失，接收配置时也会再丢失；服务端本来支持，牌桌则按“没有明确false就开启”显示。

定局、升级、转蛋、复式各测开启/关闭，共8例。4个关闭都复现“请求/存储/返回省略，HUD仍开启”；直接输入正确配置的HUD对照关闭正常。

定位：`work/guandan-cocos/assets/scripts/services/platform/friendRoomGateway.ts:32–46`，发送点139–144，接收点85；生产者 `FriendRoomSettingsPolicy.ts:137–139`，消费者 `TableHudPresenter.ts:144`。

建议统一完整配置编解码，并测试关闭值经过创建、保存、重入和HUD仍有效。不应删开关或强制全局关闭来规避。保留字段disableVoice虽同样漏出白名单，但未发现当前活动开关/消费者，不扩报第二项功能问题。

## PG-17-002（P3）：改变规则误用旧请求ID

`friendRoomGateway.ts:126–131` 的操作摘要漏了发牌方式、升级目标、队友轮换、转蛋计分四项。创建已提交但响应丢失时保留旧请求ID是正确的；改变意图后仍沿用该ID则会与服务端完整摘要冲突。

复现刻意等待**旧房实际默认租约过期**（人工时钟推进30分钟+1ms），再修改四种配置各一例。第二次请求报冲突，第三次点击清掉旧ID后成功。相同配置重试对照复用ID且只有一个房间。因此是额外一次、可恢复的冲突，不是永久无法建房、双重建房或隐式改错规则。

建议创建身份使用完整canonical配置；相同意图保留幂等ID，不同意图更新，同时保留占位释放/过期保护。

## 验证和限制

- `node work/guandan-cocos/tests/platform-api-regression.cjs`：通过。
- `node work/guandan-cocos/tests/friend-room-settings-policy-regression.cjs`：通过。
- `node work/guandan-cocos/tests/platform-live-contract.cjs`：通过。
- `node work/guandan-windows-source/server/platform/config.test.mjs`：通过。
- `node docs/audit/2026-09-12/repro/platform-gateways-17.cjs`：通过。

补充探针还有24个交错401 POST，只发生一次登录/清token，各自重放保持原body和幂等头；5种真实XHR回调分支以假XHR检查通过。

既有live-contract实际启动临时回环HTTP、显式test环境和memory store，并在finally关闭；不是线上平台或实际游戏WebSocket。新增探针加载真实表单/factory/client/service/store/HUD逻辑，HTTP/签票/显示端口合成；无微信原生授权、真机像素、实际用户或外网请求。既有测试全通过但未断言关闭记牌器跨层保存，所以不能替代本批复现。

迁移factory仍委托生产factory、赛事迁移文件仅重导出生产实现，不能仅因测试导入migration就说未覆盖实际赛事网关。旧只读fixture/擦除类型与运行僵尸功能区分记录，未擅自删除。

UI/UX技能只帮助检查“选择与实际生效一致”，未做页面或视觉修改。26文件之外的检索与辅助追查不计完整审阅；完整字段、路径和证据见JSON。
