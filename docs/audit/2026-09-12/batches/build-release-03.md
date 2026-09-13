# 构建、模板与发布入口审计：第三批

基线 HEAD：`1d58999dc6e5455b049e1643660bbba3deee1406`；完整审阅15文件，逐项SHA-256见[机器清单](build-release-03.json)。本批只写审计材料，不运行正式构建、修改产物、访问线上或读取私密配置。

## 审阅范围

6个模板/部署配置（上一批分类修正纳入的目标）、5个package/tsconfig、4个微信配置/构建门禁/交付启动测试。每个文件的行数与结论见JSON，辅助调用链与已审运行时模块不重复计覆盖。

## BUILD-03-001 · P3：构建配置校验与运行时路径策略不一致

位置：`work/guandan-cocos/scripts/runtime-client-config.mjs:73`；相关接线：`finalize-wechat-build.mjs:18/30`、`verify-wechat-build.mjs:87/149`、`tests/support/wechat-built-startup.cjs:9-24`。

构建端使用WHATWG URL校验协议和主机，但路径只判断原始字符串是否以合法域名的`/guandan`为前缀。实际客户端的`WechatNetworkPolicy`额外拒绝点路径及转义斜杠。三种路径因此表现不同：

| 配置 | 构建helper/注入后再校验 | 实际TS运行时 |
| --- | --- | --- |
| https://api.yutechhn.cn/guandan/../other | 接受 | 拒绝 |
| https://api.yutechhn.cn/guandan/%2e%2e/other | 接受 | 拒绝 |
| wss://api.yutechhn.cn/guandan/%2fweapp | 接受 | 拒绝 |

交付冒烟虽加载交付JS模块，却将固定有效config注入上下文，而非取实际game.js的嵌入值，因此不能证明嵌入配置能启动。

触发前提是有人在发布环境误配这类路径。当前模板默认值通过双方策略；本次没有证明当前包无法启动，更不是允许访问不合法域名的安全绕过——实际运行时仍会拒绝。按发布门禁漏检、延迟发现误配置计P3。

复现：在仓库根目录运行：

```sh
node docs/audit/2026-09-12/repro/build-config-03.cjs
```

探针使用真实构建纯函数和内存转译的当前RuntimeClientConfig，模拟环境注入与配置提取，不写构建目录、不发网络请求。三例均输出`buildAccepted: true, runtimeRejected: true`，默认值输出`currentDefaultsValid: true`。这不等于已运行完整错误配置包的verify-wechat-build或手机启动。

建议：端点策略统一，增加构建/运行时同一组合法/非法输入对照；交付冒烟改为实际嵌入配置驱动。审计授权下不实施这些产品修改。

## 其他结论与边界

- 构建模板先注入正式配置/微信标记，再加载adapter；首屏结束后才启动Cocos。当前没有确认新的首屏或配置默认值问题。
- systemd以独立服务用户运行，配置目录与可写数据目录范围明确；仅审阅仓库模板，未核远程实例是否采用、未读EnvironmentFile秘密。
- nginx片段有业务前缀路由、内部API屏蔽和WS升级。其父级TLS/请求体大小配置未知，不能据单片段认定缺少限制。
- 普通tsconfig依赖Creator生成配置；纯CI不等价于Cocos全量类型检查和交付包新鲜度。主包/资源/退役marker门禁有价值，但仍需完整发布专项。
- 直接node脚本入口路径均存在。此检查覆盖package中可识别的直接node路径，不证明全部shell语义、工具版本或线上发布正确。
- `replaceOrInsert`是未使用的私有helper，可在后续授权清理时移除；没有产品影响，不追加一条缺陷夸大数量。

## 验证

- 上述隔离探针通过并复现差异。
- `node tests/runtime-platform-config-regression.cjs`（Cocos目录）通过，但既有测试没有上述构建/运行时一致性断言。
- 初次运行探针误用了Cocos目录下的相对路径，产生MODULE_NOT_FOUND；随后在仓库根目录重跑成功。没有把失败命令计成验证通过。
