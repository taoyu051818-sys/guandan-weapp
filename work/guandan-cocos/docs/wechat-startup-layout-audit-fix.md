# 微信大厅启动修复 · 2026-09-05

## 根因

微信开发者工具实际捕获：

```text
Unable to initialize the game scene.
ReferenceError: URLSearchParams is not defined
  at TableLayoutAuditBridge.install
  at GameScene.mountTableHud
  at GameScene.initializeGame
```

布局重叠诊断虽然是浏览器可选功能，但启动时无条件解析了非空 `location.search`。小游戏适配器可提供 location，却不保证存在浏览器 `URLSearchParams`，因此连未启用 `layoutAudit` 的环境也会抛异常。用户提供的 `reportUserBehavior:ok` 日志不是该异常。

## 修改

- 安装诊断前检查 Cocos `sys.isBrowser`，小游戏直接跳过。
- 检查 `URLSearchParams` 和 DOM 查询能力，仅在显式 `layoutAudit` 参数存在时发布浏览器诊断入口。
- 安装过程隔离异常；可选诊断失败只警告，不阻断大厅初始化。
- 保留浏览器的重叠面积/区域比例统计及所有权清理，不改变 UI 布局、选牌、正常下叠或区域重叠行为。

## 验证

- 测试执行真实桥接模块，在独立 VM 中模拟缺少浏览器 API 的小游戏环境，不再依赖 Node 自带的 URL API。
- 覆盖小游戏有/无浏览器兼容对象、浏览器缺少解析器/DOM、未开启或相似参数、正常启用与像素换算、清理归属、宿主接口抛错降级。
- `pnpm test` 全套客户端回归通过（含本地平台契约测试）；`pnpm typecheck:ci-core` 和 `pnpm verify:architecture` 通过。
- Creator 3.8.8 微信发行包已重新构建，注入广州正式 HTTPS/WSS 地址，`pnpm verify:wechat-build` 通过；主包 2.96 MiB、子包 6.64 MiB、总计 9.60 MiB。
- 微信开发者工具重新编译后，实际观察到陵水大厅显示；原来的 `URLSearchParams` 初始化异常消失。基础库自身的 `jsbridge not ready` 日志仍存在，不能声称控制台完全无日志。

手机端需要重新发起真机调试或重新生成预览，不能沿用修复前已加载的调试包。本轮没有代替用户完成手机端重测，也没有上传体验版或改动服务器。
