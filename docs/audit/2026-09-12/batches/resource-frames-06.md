# resource-frames-06：共享牌面与头像资源

2026-09-12，root；HEAD `1d58999dc6e5455b049e1643660bbba3deee1406`。完整审阅 4 文件 / 182 行，哈希和 notes 见 [JSON](resource-frames-06.json)。新增 **RESOURCE-06-001 / P3**。

## RESOURCE-06-001：默认机器人头像失败后不再重试

位置：`work/guandan-cocos/assets/scripts/services/DefaultProfileFrames.ts:14`。

首次查询把 asset 加入 pending；加载错误或没有 texture 时直接 return，从未移除 pending。frames 没有值，下一次访问仍因 pending 而跳过加载。此缓存位于模块级，退出/重新进牌桌并不会重置。

真实调用：`TableHudPresenter.ts:133` 对 AI 席位在 render 时调用它；`TableHudSeatViewGroup.ts:214` 在拿不到定制 frame 时使用通用默认头像。因此影响是该机器人头像持续降级，**不是阻止进入游戏、发牌或断开连接**。

```sh
node docs/audit/2026-09-12/repro/profile-frame-retry-06.cjs
```

复现执行真实 DefaultProfileFrames 与 GameAssetLoader，只有 Cocos Bundle/Texture/Sprite 为合成端口：

1. 第一次 Bundle.load 合成报错，真实加载器完成错误 callback。
2. 令 Bundle 恢复；同一路径直接通过真实 loadGameAssetAsync 加载成功，证明底层已恢复。
3. 原默认头像缓存再调用 10 次，仍 undefined、加载重试次数为 0。
4. 新模块实例能够请求并复用正确 frame；这仅是进程重启恢复对照，不是假造已有 UI 重试接口。

建议另行修复时在成功/失败都清 pending，保留在途去重；失败可配退避，避免后续每帧持续重试。不在审计中改产品。

## 其他资源契约

```sh
node docs/audit/2026-09-12/repro/frame-stores-06.cjs
```

- ClassicCardFrameStore 实际 failed Promise 会在 finally 删除在途项，能正常重试；并发请求共用同一 Promise，37 组件每个成功请求一次，单牌全量与预载去重正确。
- ClassicCardGeometry 的参考和每层对象已冻结，尺寸为正；同一组几何被手牌/特效消费。没有用这些断言证明真机像素完全一致。
- ProfileAvatar 本地预置路径与 asset 白名单兜底、同键代理请求去重/失败重试、宽度超过1024拒绝、8秒图像看门狗、销毁节点不再赋 frame 的内存控制流通过。真实 auth/图片解码/微信授权不属于本探针；未调用外网。
- 共享牌面采用进程所有权，不因局部CardView销毁而销毁共用SpriteFrame。头像Map最多8键也不等于GPU资源必然释放；实际Creator对象生命周期/显存专项仍待核验。

四文件全部阅读；GameAssetLoader、HUD消费处及测试loader只作辅助调用链，未重复加覆盖。测试身份和图像均合成。只写本目录报告与复现脚本，保留原有修改、未构建/发布。
