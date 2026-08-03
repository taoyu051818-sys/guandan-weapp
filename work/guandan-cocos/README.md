# 掼蛋大师 · Cocos Creator 客户端

这是微信小游戏主客户端。它不复用 React / Electron UI；只复用根目录 `shared-core` 的规则、结算、进贡和 AI。

## 打开方式

1. 使用 Cocos Creator 3.8.8 导入本目录。
2. 运行 `node scripts/sync-core.mjs`，将共享核心同步到 `assets/scripts/core/generated`。
3. 打开现有的 `assets/scenes/Game.scene`。场景已包含横屏 Canvas 和 `GameScene`；首次运行会自动装配 `GameSession`、牌局、座位、出牌区、菜单、大厅和音频控制器，方便在没有正式 prefab 前直接预览完整流程。
4. 在 Project Settings 的屏幕设置中选择横屏；构建目标选择「微信小游戏」。

`GameScene`、`GameManager`、`HandController`、`PlayerSeatController`、`PlayAreaController` 与 `LobbyController` 已经提供：

- 两副牌完整开局、AI 回合和合法出牌；
- 选牌上移、手牌响应式排布；
- 横屏安全区及 16:9 到超宽屏布局；
- 可替换的发牌、出牌和炸弹 tween 动画入口；
- 标准、双明牌、战役、教程、设置、战绩、摸牌定庄和多人大厅；
- `CocosSocketClient` 断线重连、四席轮转与服务端权威的出牌/不要/贡还/下一局协议；
- Cocos 原生音频控制层；将原项目的音频文件导入 `assets/resources/audio` 后可直接按键名加载。

## 核心同步

```sh
node scripts/sync-core.mjs
```

不要直接编辑 `assets/scripts/core/generated`；修改规则时编辑根目录 `shared-core/src` 后重新同步。
