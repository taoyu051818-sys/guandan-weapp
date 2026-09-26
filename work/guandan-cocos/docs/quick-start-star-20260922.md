# 快速开始按钮待机星光 · 2026-09-22

替换 2026-09-07 的角落微光，不改变大厅布局、按钮热区、文字、点击路由或按压反馈。

## 唯一资源与节奏

- 用户提供：`quick_start_star_fx_210_sheet.png`，840×184 RGBA，4×4，单帧 210×46。
- 原文件 153,526 字节，SHA-256 `e28b012288e1cbdd766b354aa36685ab5dbd73bd788a01e2cc3effc2d858c89d`。不重绘、不裁掉透明边、不改色，不推断其第三方许可证。
- 运行路径：`assets/game-assets/effects/lobby-v1/quick_start_star_fx_210_sheet.png`，通过现有 `game-assets` bundle 加载纹理。
- 16 帧从左到右、从上到下，15 fps；播放 16/15 秒后隐藏 2 秒，总周期约 3.067 秒。保留原有进入/恢复后 1 秒静置。
- 单张纹理、16 个 SpriteFrame、一个 Sprite；尺寸随现有按钮统一缩放。关闭 mipmap，clamp-to-edge，不参与动态图集重新打包。

## 层级和生命周期

按钮底板与海岸底图 → `LobbyAmbientDecoration/QuickStartStar` → 标题/副标题。

继续使用 `LobbyMotionPolicy` 和 `LobbyAmbientMotion`，不新增另一套定时器或动效框架。特效无触摸监听、无输入拦截、无自有缩放动画。点击反馈仍由现有按钮承担。

按压、弹窗、恢复请求、非大厅页面、后台、精简/关闭动效与浏览器减少运动偏好都会停止装饰。离页/禁用重置播放时钟，恢复不补播旧帧。异步加载取消、迟到回调防护和动态 SpriteFrame 释放保留；加载失败仅隐藏特效。

## 退役范围

- 删除旧 `CornerGlint`、`SoftRim` 与其 Graphics/UIOpacity 绘制和更新逻辑。
- 删除 `button-glint.png`、对应 `.meta` 和 `scripts/generate-lobby-glint.mjs`。
- 旧 PNG 在本地忽略目录 `release-artifacts/20260922-quick-start-star/retired-button-glint.png` 留有恢复备份，不进入资源图；旧代码和素材也可通过 Git 历史恢复。
- 日期化历史报告保留原始发布记录，不将历史构建冒充新版本；测试新增旧素材/生成器不存在断言。

## 验证口径

2026-09-24 覆盖范围修正：原图每帧四周有 5px 透明留边。保留原始 PNG 不变，运行时将每帧固定的 `(5,5,200,36)` 内容窗口映射到完整按钮尺寸，修复扫光小一圈；所有帧使用同一窗口，不逐帧自动裁切。帧数、循环、文字层级、热区和按压反馈不变。回归增加真实 alpha 像素四边覆盖检查。

`tests/lobby-motion-regression.cjs` 检查帧序/裁切、完整隐藏间隔、尺寸、层级、按压优先、背景/离页取消、加载失败、释放、真实 PNG alpha 和旧资源退役。真实引擎预览、目标包核验和真机状态分别记录；代码测试不能替代手机验收。

2026-09-22 本次验证结果：

- 98 项客户端回归入口全部通过；`typecheck:runtime`、`verify:architecture`、`verify:health` 通过。
- Creator 3.8.8 独立网页构建 `quick-start-star-20260922` 完成；874×402 大厅真实引擎预览通过。
- 浏览器连续观察完整循环，16 帧逐帧出现，帧间约 67 ms，隐藏间隔约 2,000 ms；另存播放帧与隐藏帧截图。
- 新构建只含一份与原图 SHA-256 一致的新图集；旧资源路径、UUID、PNG 内容和旧节点代码均未进入新构建。
- 证据保存在本地忽略目录 `release-artifacts/20260922-quick-start-star/`。此次没有替换历史构建、上传微信版本或宣称已真机验收。
