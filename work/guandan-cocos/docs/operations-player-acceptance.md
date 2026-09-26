# 玩家运营功能验收

更新：2026-09-26。范围：Cocos 大厅消息、反馈及服务入口状态；不包含会员开通或支付。本文记录代码与自动测试证据，不等同于微信真机验收或生产发布。

## 实际接入点

| 边界 | 实际文件与职责 |
| --- | --- |
| 大厅入口与生命周期 | `assets/scripts/scenes/FrontPageController.ts` 注入运营页面，处理路由、尺寸、前后台和销毁；`front-pages/LobbyServiceActions.ts` 每次点击获取服务状态；`PageRouter.ts` 注册 `operations-messages` / `operations-feedback` |
| 接口与登录 | `assets/scripts/services/OperationsGatewayContracts.ts` 定义玩家契约；`FrontPageGatewayContracts.ts` 注入能力；`platform/factory.ts` 与现有认证 `platform/client.ts` 共享玩家登录及令牌刷新，不引入管理员会话 |
| HTTP 与校验 | `assets/scripts/services/platform/operationsGateway.ts` 调用消息、已读、本人反馈及提交接口；`operationsValidation.ts` 严格解析记录和分页；`lobbyServiceGateway.ts` 获取公开服务状态，异常不是“未开放” |
| 页面控制与呈现 | `assets/scripts/scenes/front-pages/OperationsPageController.ts` 管理请求、分页和失效回调；同目录 `OperationsPageModel.ts` / `OperationsPageView.ts` / `OperationsPageUi.ts` 管理长文本分页、原生输入、方形海岸风面板和安全区 |
| 提交保护 | `assets/scripts/services/FeedbackSubmission.ts` 保留未确认草稿及相同内容的幂等键；重试和登录刷新沿用该键；成功后清空草稿并释放键 |
| 服务端权威 | 邻项目 `guandan-windows-source/server/platform/operations-http.js` 使用现有玩家 Bearer 鉴权；`operations-service.js`、`operations-feedback-service.js`、`operations-message-projection.js` 负责归属、公开时窗、已读、回复和服务门控 |

玩家请求：公开 `GET /api/v1/lobby/services/:id`；认证 `GET /api/v1/messages`、`POST /api/v1/messages/:id/read`、`GET /api/v1/feedback`、`POST /api/v1/feedback`。提交正文仅有 `category/content`，幂等键放在 `Idempotency-Key`；不发送客户端指定的用户 ID，也不引入管理员身份或管理员凭证。

## 用户验收表

准备：隔离测试环境、玩家 A/B、授权运营测试账号；至少五条有效公告、一条过期/草稿公告，以及 A 的反馈和运营回复。账号仅记录代号，截图与日志遮挡个人信息和凭证。下表人工结果均待填写。

| ID | 操作 | 通过标准 | 当前证据 / 人工结果 |
| --- | --- | --- | --- |
| P01 消息 | 大厅点“消息”，翻页、刷新 | 每页最多 4 条；显示标题、日期、未读数；只有发布且在有效时窗内的公告及自己的反馈回复；空列表有说明 | 网关/页面/服务端自动测试通过；人工待验 |
| P02 已读 | 只打开列表，再打开一条详情；模拟已读请求失败并重试 | 列表不自动标记；打开详情才请求已读，服务端确认后更新；失败保留未读并提供重试；刷新与旧回执交错不重复扣减 | 自动测试通过；人工待验 |
| P03 长内容 | 打开 4000 字公告及长反馈回复，连续翻阅内容页 | 可读到完整正文、换行与 Unicode 内容；上下页边界正确，不以缩小整篇文字代替分页 | 逻辑与最长返回解析通过；实际排版待验 |
| P04 反馈输入 | 点“写反馈”，切换三种分类，输入空白、2000 字、超长内容 | 原生多行 EditBox；明确标签、计数和错误；分类切换不丢正文；空白/超限不能提交 | 自动测试通过；中文输入法、粘贴和键盘待验 |
| P05 反馈提交 | 连点提交；模拟服务端已写入但客户端响应丢失，再重试 | 提交中禁用输入/提交；成功显示真实记录；失败保留正文；同一未确认内容重试仅产生一条反馈，认证刷新也复用同一键 | 自动测试通过；弱网实测待验 |
| P06 我的反馈 | 查看本人反馈；运营回复或修改状态后返回列表刷新 | 展示待处理/已处理、回复数量；详情含原反馈和全部回复；服务端状态为准，不伪造答复 | 页面与服务端自动测试通过；双端人工待验 |
| P07 回复消息 | 运营给 A 回复，分别以 A/B 打开消息 | A 能查看该回复及原反馈上下文；B 不收到 A 的回复，不能通过猜 ID 标记 A 的消息已读 | 服务端隔离与归属自动测试通过；双账号人工待验 |
| P08 服务开关 | 将消息/反馈设为关闭或维护，再点大厅入口；页面已开时停用功能 | 显示服务端标题/说明；已开页面的后续请求仍被服务端阻止；网络失败显示错误，不冒充“未开放” | 自动测试通过；人工待验 |
| P09 会员 | 点“会员”，检查运营端是否可开放会员 | 仅展示服务端说明；没有开通、购买或支付 UI；服务端拒绝把未实现的会员设为开放 | 自动测试通过；人工待验 |
| P10 错误与限流 | 断网、登录失效、异常响应、超过服务端反馈频率限制 | 明确失败并可恢复；无假成功/假数据；异常枚举、分页及数量被拒绝；限流由服务端实施（当前每小时最多 5 条新反馈） | 网关/服务端自动测试通过；真实弱网待验 |
| P11 页面生命周期 | 请求进行中返回大厅、重进页面、切后台/恢复、调整尺寸 | 旧响应与旧按钮不能拉回已离开的页面；草稿保留；原生输入关闭；重进时旧提交完成不会抢占当前视图或永久禁用提交 | 自动测试通过；微信系统键盘和前后台待验 |
| P12 隐私与布局 | 检查反馈说明、长文、窄横屏及安全区 | 提示“反馈仅你与授权运营人员可查看”；不公开其他玩家反馈；不渲染 HTML、不显示管理员身份；主要操作、错误及计数无重叠 | 代码/逻辑审查通过；视觉与真机待验 |

## 已执行验证与限制

本轮通过的命令：

```sh
node tests/operations-gateway-regression.cjs
node tests/operations-page-regression.cjs
node tests/lobby-services-regression.cjs
pnpm typecheck:runtime
pnpm typecheck:ci-core
pnpm verify:architecture
# 在 guandan-windows-source 中：
node --test server/platform/operations-service.test.mjs server/platform/admin-http.test.mjs
```

网关回归执行真实客户端/解析器与可控传输；页面回归使用受控 Cocos 渲染端口，覆盖原生控件配置与异步时序，并非实际设备触摸。服务端 HTTP 测试覆盖真实本地 HTTP 路由，不代表生产网络已经发布。

- 草稿与客户端幂等键保存在当前页面控制器内存中，支持返回、重进、尺寸变化及前后台；**不承诺进程退出、刷新网页或重启小游戏后恢复未确认提交**。服务端幂等记录持久化，但重启后客户端没有旧键。
- 公告内容上限 4000、反馈和单条回复各 2000；回复消息包含原反馈与回复，客户端支持合并后的完整内容。长度按 JavaScript 字符串单位校验，部分 emoji 占两单位。
- 新客户端依赖包含 `id/status/version/updatedAt` 的服务状态响应；旧服务端仅返回文案会报协议错误，应先上线兼容服务端，再发布客户端。
- **微信开发者工具与 iOS/Android 微信真机尚未在本验收中测试。** 必测中文组合输入、多行粘贴、长草稿键盘滚动、键盘收起、胶囊/刘海安全区、前后台恢复及弱网重试。Cocos 原生 EditBox 接入和自动回归通过不能替代这些结果。
- 本文不宣称屏幕阅读器、动态字体、减少动态效果或所有屏幕尺寸已完成无障碍认证；浏览器构建/截图证据由本轮集成验收另行记录。本文步骤未执行生产部署。
