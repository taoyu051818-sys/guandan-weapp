# 掼蛋大师 · Cocos Creator 客户端

这是微信小游戏主客户端。它不复用 React / Electron UI；只复用根目录 `shared-core` 的规则、结算、进贡和 AI。

## 打开方式

1. 使用 Cocos Creator 3.8.8 导入本目录。
2. 运行 `node scripts/sync-core.mjs`，将共享核心同步到 `assets/scripts/core/generated`。
3. 在 Creator 中新建横屏场景 `assets/scenes/Game.scene`，根节点挂载 `GameScene`，并放置 `Canvas`。在 Project Settings 的屏幕设置中选择横屏；通过 Inspector 绑定 `GameManager`、`HandController`、提示文本和操作按钮；这些组件均已使用 `@ccclass` / `@property` 注册，符合 Creator 场景序列化规范。
4. 构建目标选择「微信小游戏」。

`GameScene`、`GameManager`、`HandController` 和 `TableLayout` 已经提供：

- 两副牌完整开局、AI 回合和合法出牌；
- 选牌上移、手牌响应式排布；
- 横屏安全区及 16:9 到超宽屏布局；
- 可替换的发牌、出牌和炸弹 tween 动画入口；
- `CocosSocketClient` 断线重连和纯数据事件协议，可直接接现有 WebSocket 服务端。

## 核心同步

```sh
node scripts/sync-core.mjs
```

不要直接编辑 `assets/scripts/core/generated`；修改规则时编辑根目录 `shared-core/src` 后重新同步。
