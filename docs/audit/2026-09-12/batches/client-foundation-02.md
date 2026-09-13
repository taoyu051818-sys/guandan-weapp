# 客户端会话、网络配置与资源边界：client-foundation-02

基线 `1d58999dc6e5455b049e1643660bbba3deee1406`，2026-09-12。完整审阅 13 文件、1,272 行；精确路径、SHA-256 和逐文件结论见同名 JSON。无新增确认缺陷；会话恢复重复累计本地统计交叉引用已有 CS-01-002，未重复计数。

## 范围及结论

- `session/GameSession.ts`、`GameSessionModel.ts`：会话生命周期、本地白名单还原、身份/路由不从缓存复活、女声限制和观战者统计隔离。已有本地重复入账问题仍成立；当前平台个人资料不消费这些本地统计。存储失败会保留内存状态并警告，不能承诺落盘成功。
- `game/RoundRecord.ts`、`services/DataSnapshot.ts`：玩家炸弹计数的数据源选择、深拷贝与冻结。snapshot 仅接受普通 JSON DTO；循环对象、引擎节点、Date 不属于声明支持的契约，没有把这类人为输入算作产品漏洞。
- `services/RuntimeClientConfig.ts`、`NetworkEndpoint.ts`、`WechatNetworkPolicy.ts`：注入配置优先、微信禁止本地回退及开发开关、绝对地址的严格子集解析、批准 host 与路径边界、防编码路径穿越；传输层仍执行微信地址策略。当前未证明旁路。此代码检查不替代微信后台合法域名配置。
- `services/WechatLoginProvider.ts`：凭证回调一次结算，缺API、失败、空code、同步异常、超时和迟到回调边界。
- `services/GameAssetLoader.ts`：bundle 单飞加载、进度错误隔离、每项资源超时/取消、AbortSignal 监听清理和迟到结果忽略。取消不会撤销底层引擎下载，资源缓存所有权属于 Cocos；未证明当前有泄漏路径。
- 四个测试文件完整审阅：`residual-cleanup-regression.cjs`、`runtime-platform-config-regression.cjs`、`service-lifecycle-regression.cjs`、`wechat-runtime-compatibility-regression.cjs`。核实它们使用内存存储、vm、XHR/WebSocket/引擎存根，没有实际网络和正式包写入。`service-lifecycle` 的未使用 MockNode 属于测试夹具小残留，无产品行为影响，未扩充为新增产品缺陷。

## 本地验证

在 `work/guandan-cocos` 运行以下四项，均退出 0：

```sh
node tests/residual-cleanup-regression.cjs
node tests/runtime-platform-config-regression.cjs
node tests/service-lifecycle-regression.cjs
node tests/wechat-runtime-compatibility-regression.cjs
```

额外可重放检查在仓库根目录执行：

```sh
node docs/audit/2026-09-12/repro/client-foundation-02.cjs
```

该脚本内存转译当前 TypeScript 源码，不写业务文件、不读取真实用户缓存、不访问外部服务。已通过嵌套冻结/副本隔离、无效缓存归一化、路径编码拒绝，以及登录成功/失败/超时/重复和迟到回调断言。

## 验证边界

以上不是微信真机授权、手机存储、Cocos 引擎时序和实际渲染验收。既有测试使用 source transpile 和部分 dist 依赖，前一批 CI/同步检查通过，但不据此证明任意历史构建包新鲜。辅助读取契约和调用点不计入完整审阅量。

本批只写审计报告及隔离检查脚本，未修改业务逻辑、已有用户修改、发布包、服务器或 Git 提交。
