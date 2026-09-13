# 网络 authority 路由独立回归（2026-09-13）

新增 `work/guandan-cocos/tests/network-authority-route-regression.cjs`，没有修改产品代码或审计原件。默认测试链由主代理登记。

执行真实 `LobbyController`、入桌/恢复身份持有者、`LobbyMessageRouter`、`FriendRoomViewReceiver`、`LobbySyncTracker`、`GameManager`、`NetworkMatchSnapshotController` 和 `GameSession` 源码。仅 Cocos 生命周期/事件/内存存储与 socket 端口合成；不依赖审计目录或 Creator，不复制供应商源码，不打开网络，主动阻止真实 fetch/WebSocket。

两组分别从 A 桌 round 1 / settled / revision 11 切换到 B 桌 playing / revision 2 与 50，覆盖：

- 通过公开 `enterMatchedRoom` 和实际 `roomCreated` 路由建立 match identity、保存恢复身份及首次计账，不直接设置控制器私有身份。
- 不同桌独立版本空间；路由拒绝旧 gameVersion 和旧房间 version；同桌强制恢复旧状态仍被 GameManager 版本门拒绝；合法后续版本可继续前进。
- B 桌观战结算不记参赛统计；回到 A、A 桌旧 playing 快照、abort 后恢复均不重复计账。
- 新建全部 Lobby/Manager/Session 实例后，经持久身份加载 → `rejoinRoom` 请求 → `roomRejoined` 响应恢复原结算，gamesPlayed 仍为 1、bombsPlayed 仍为 7。
- 同房号进入真正不同 match identity 后，gamesPlayed 正常变为 2、bombsPlayed 变为 14，排除通过关闭计账掩盖问题。

干净环境验证 exit0：

```sh
env -i PATH=/opt/homebrew/bin:/usr/bin:/bin /opt/homebrew/bin/node work/guandan-cocos/tests/network-authority-route-regression.cjs
```

这是内存端口驱动的原生业务路由回归，不是微信真机、WebSocket 服务端集成或渲染验收。
