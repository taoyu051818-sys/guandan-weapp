# 陵水掼蛋

当前维护的是 **Cocos Creator 微信小游戏 + 共享规则核心 + Node.js 权威服务端**，不是原生小程序或 React/Electron 项目。

| 目录 | 用途 |
| --- | --- |
| [work/guandan-cocos](work/guandan-cocos/README.md) | 正式 Cocos 3.8.8 客户端、构建脚本、资源及回归 |
| shared-core | TypeScript 规则、结算、AI 的唯一源头 |
| [work/guandan-windows-source](work/guandan-windows-source/README.md) | 权威牌局与平台服务；目录名为部署兼容路径，已无旧前端 |
| scripts | 仓库边界与防回流检查 |
| docs | 当前维护范围与归档记录 |

经典匹配为随机级牌独立单局；好友房支持定局/升级设置、机器人、落座调整和实时/延迟观战。商品商城仍是预览，赛事入口仍提示筹备中。代码与自动回归完备程度不等于真机验收或已部署状态。

## 开发与验证

使用 Node.js 22、pnpm 9；客户端构建使用 Cocos Creator 3.8.8。生产服务端本身不需要安装 React、Socket.IO、Vite 或其他外部运行包。

```sh
pnpm --dir shared-core install --frozen-lockfile
pnpm --dir work/guandan-cocos install --frozen-lockfile
pnpm --dir work/guandan-cocos test:ci
npm --prefix work/guandan-windows-source run check:server
npm --prefix work/guandan-windows-source run test:server
```

Creator 环境中的完整类型检查、微信/Web 构建、合法域名与包体核验见客户端 README。服务器配置凭据由环境提供；`.env*`、私钥、运行数据与构建缓存不能提交。公开测试中的本地端点和固定密钥仅用于隔离测试，不是小游戏正式连接配置。

## 历史工程隔离

旧原生微信客户端、旧 React/Electron/Capacitor 前端及已放弃的骨骼动画样例已从当前工作区移走，保存在仓库外。旧 Git 历史不重写，可以追溯，但不应把历史工程恢复到活动目录。

边界、迁出目录和恢复方式见 [历史工程隔离记录](docs/LEGACY_ISOLATION_20260908.md)。

当前 Cocos 的 `tests/support`、`migration`、许可素材源和布局模拟工具仍有测试、开发或许可追溯用途，不是旧应用工程，不应无差别删除。私有视觉验收截图仅保留本机，不随本次公开提交上传。

## 维护原则

- 服务端推进权威对局；客户端只发送意图并展示授权快照。
- 共享核心只修改源目录，由同步脚本生成客户端副本。
- 新职责放入独立模块，不扩张场景和服务组合根。
- 保留退役检查、包体核验、规则/客户端/服务端回归，不重新启用测试入口。
- 原始来源和许可证见各子工程 LICENSE、客户端 THIRD_PARTY 与素材许可清单。
