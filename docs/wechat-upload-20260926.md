# 微信上传记录：2026.9.26.1

日期：2026-09-26。AppID：`wxa79bf8bc567765a1`。

## 已完成

- 使用 Cocos Creator 3.8.8 从当前工作树重新构建 `work/guandan-cocos/build/wechatgame`，构建日志显示 Finished（CLI 成功退出码 36）。
- `finalize:wechat-build`、`verify:wechat-build` 和仓库/构建后台隔离检查通过。
- 本地包体：主包 3,357,624 字节，分包 8,650,469 字节，总包 12,008,093 字节。
- 微信开发者工具 CLI 上传版本 `2026.9.26.1`，说明为“大厅动效与资源优化；消息反馈入口接入（配套服务端待部署）”，最终返回 `✔ upload`。
- 微信上传统计：主包 3,335,530 字节，分包 8,650,220 字节，总包 11,985,750 字节。

## 未完成与限制

- **只确认开发版本上传成功，未确认设置为体验版。** 微信公众平台浏览器导航连续超时，未进入版本管理页面，不能把 CLI 上传成功表述为体验版切换成功。
- 首次带 `--info-output` 的 CLI 调用因输出路径报错而失败；移除该可选参数后的第二次调用成功。不是两次成功上传。
- 线上 `https://api.yutechhn.cn/guandan/api/v1/lobby/services/messages` 在本轮只读核验返回 HTTP 404 / `ROUTE_NOT_FOUND`。消息、反馈运营接口仍需配套服务端部署；本轮未部署/重启服务器或发布网页后台。
- 未提交 Git、未发布正式版、未完成微信真机验收。

本机日志：`/tmp/wechat-experience-20260926-build.log`、`/tmp/wechat-experience-20260926-verify.log`。临时日志不是永久发布工件。
