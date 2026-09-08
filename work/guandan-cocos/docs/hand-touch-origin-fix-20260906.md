# 滑动选牌起点偏移修复

## 现象与根因

用户已确认可进入大厅，并反馈已添加 socket 合法域名；随后反馈滑选从手牌中间开始，而不是从触摸点开始。启动已恢复不代表整局联网及所有机型已经验收。

`CardView.touchDetail()` 原先把 `event.getUILocation()` 放进名为 `screenPoint` 的字段。它经过 `HandController` → `HandDragSelectionPolicy`，最终进入 `CardView.hitTestScreenPoint()` 和 HUD 排除热区的 `UITransform.hitTest()`。

核对本机 Creator 3.8.8 引擎 `cocos/2d/framework/ui-transform.ts`：`hitTest(screenPoint)` 内部调用 `camera.screenToWorld`；而 `cocos/input/types/touch.ts` 的 `getUILocation()` 已执行 `_convertToUISpace`。两种坐标混用造成重复换算，在缩放或视口偏移时，命中位置离开真实手指。拖动策略本身会保存传入起点，并非主动把起点设为手牌中间。

## 最小修改

- `assets/scripts/ui/CardView.ts` 改用 `event.getLocation().clone()`；明示 `HandCardTouch.screenPoint` 的屏幕坐标约定。
- 保持滑动起点、逐牌命中和按钮热区排除使用同一套坐标。
- 不改牌序、布局、金边／滤色、手势阈值、点选权限、网络配置或美术。按 `ui-ux-pro-max` 的拖动替代交互要求，点选保持可用，并纳入回归。

## 验证证据

1. 新增 `tests/hand-touch-coordinates-regression.cjs`，使用真实 CardView 触摸处理、HandController 和拖动策略，只模拟引擎节点／命中投影。旧代码在 0.5 倍缩放时失败：应传屏幕 `(149,42)`，实际误传 UI `(222,60)`；修复后通过。
2. 覆盖 0.5／1／2／3 倍缩放与不同视口偏移、正反向划选、折返不重复切换、单牌点击、静止长按、取消后重新触摸、HUD 遮挡排除及向下叠牌逐张命中。已加入默认 `pnpm test`。
3. `tests/support/wechat-built-startup.cjs` 直接执行实际微信压缩包里的 `CardView.touchDetail()`；禁止调用 `getUILocation()`。旧包先失败，新包通过；同时保留无 URL 环境启动 96%→100% 检查。
4. 全量 `pnpm test`、architecture（195 模块／42 预算）、CI 核心与 Creator 工程两套 TypeScript 检查、`git diff --check` 通过。
5. Creator 3.8.8 微信发行构建完成（Finished，CLI 返回 36）；finalize、verify:wechat-build、verify:wechat-package 通过。主包 2.98 MiB，资源包 13.49 MiB，总包 16.47 MiB。

输出目录：`build/wechatgame`。主脚本 SHA-256：`dc2f0ec58f7aa2f44a647dec02a9a9d3a6815d8e8e2ba2412f11436d2e07dd97`。

日志：`/tmp/guandan-wechat-touch-origin-tests.log`、`/tmp/guandan-wechat-touch-origin-build.log`。未上传微信版本、未部署服务器、未修改冻结网页。

## 待用户真机确认

微信开发者工具对上述目录重新编译、重新生成真机调试／预览包，不继续使用手机上的旧包。轮到自己且未托管时验证：

- 从左、中、右不同手牌开始向两个方向滑动，第一张选中必须是实际触摸牌。
- 沿叠牌露出的点数／花色向下划动，只选择路径经过的牌；折返不重复反选。
- 点击单张、松手后再选、他人出牌后再选仍正常；理牌／出牌按钮不误触手牌。

自动测试使用模拟投影，不能替代鸿蒙／其他手机的真实坐标和渲染验收。当前没有宣称真机滑选已验收通过。
