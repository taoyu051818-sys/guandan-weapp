# 退役清理与包体核验 · 2026-09-08

> 此为上一轮退役记录，保留当时的构建数据。后续单机分支、战役缓存、商城下单与空流程动效清理及最新包体见 [残留代码清理](RESIDUAL_CLEANUP_20260908.md)。

## 结论和范围

已完成 Cocos 玩家客户端的退役清理，并按追加要求完整删除实验室。旧页面、旧网关和 20 份不再播放的授权语音没有出现在新的微信／Web 构建中。没有改动认可的大厅和牌桌布局，也没有删除好友房观战、我的对局、正式动效或现有服务端数据。

本轮是包内功能和依赖边界清理，不是“整个历史仓库零死代码”的证明。共享核心、旧 React／原版小程序、参考工程、历史构建及未来服务端业务不在删除范围。工作区原有修改保留；没有提交、上传、部署或改动定时任务。

## 已退役内容

| 类别 | 执行结果 | 保留边界 |
| --- | --- | --- |
| 旧更多／设置／规则弹页 | 删除页面实现、相关路由、旧模态框基础设施和人机测试按钮回调 | 房间规则配置继续由好友房页面承担；规则说明投影迁到 migration/rules |
| 旧赛事页 | 删除 CompetitionPageDomain 和赛事返回路由 | 大厅赛事按钮仅显示“筹备中”，重复点击不切页、不发起报名或匹配请求 |
| 商户／旧赛事／旧 HTTP 观战网关 | 从玩家 factory 和开发示例聚合中移除，迁入 migration/platform | 旧合同测试继续在包外运行；服务端接口与数据未删除 |
| 实验室 | 删除 EffectLab、SceneHost、PreviewRunner、PageDomain、控制台桥接和所有页面入口 | 不保留隐藏入口或开发开关后门 |
| 固定牌局注入 | 删除 GameManager 注入方法、LocalMatchController 专用工厂和测试局进度开关 | 固定手牌数据转移到 tests/fixtures；构造适配器仅存在于 tests/support |
| 实验室专用动效方法 | 删除 previewAction、previewFlow、diagnostics、auditRuntimeAssets 和仅供其使用的类型 | 正式回合动效、飞牌、炸弹、对象池和恢复清理继续保留 |
| 旧授权音频 | 20 个 MP3 及运行 metadata 退出 assets，累计 288,339 bytes | 音频及 UUID 归档可恢复，授权记录与哈希保留 |

运行源码减少 10 个整文件（含迁移到包外的文件），当前 assets/scripts 有 217 个 TypeScript 文件、31,330 行，其中 37 个是共享核心生成副本。行数含空行和注释，不代表业务复杂度或测试覆盖率。

此次 20 个旧语音的完整路径、UUID、大小、SHA-256 和归档位置见 [退役清单](../asset-library/retired-runtime-20260908/manifest.json)。授权目录现在仅保留 bomb、deal、defeat、single_5_female 四个运行音频；22 个授权音频属于包外归档（含此前已归档的 2 个）。导入 catalog 与来源 manifest 已同步分流，再执行导入不会把这 20 个文件送回 assets。

NiuMa 女声、钢板 TTS、正式牌局音效保留。此前退役的男声不计入本轮 20 个音频或本轮节省量。对子不再显示竖排牌型标注，但对子理牌、选择和女声报牌仍正常保留。

## 实验室删除后的有效边界

- 正式场景不导入实验室，不安装 __guandanEffectLab，不提供固定牌局入口。
- 固定手牌只是自动测试数据；保留完整 108 张牌分配、物理 cardId 唯一性、队友视角和多组叠牌回归，不作为可游玩的用户功能。
- 快捷语测试从旧混合测试拆为 quick-chat-regression.cjs；屏蔽、节流、文案／音频映射、权威回声和气泡过期断言保留。
- 实验室使用的是正式牌桌的牌面和炸弹素材；没有发现只属于实验室的独立图片或音频，所以没有误删共享素材。
- 好友房实时／延迟观战、观战席让座仍使用正式房间协议。退役的是旧 HTTP 观战列表与旧客户端网关，不是这一功能。
- 我的对局、个人资料、商城只读预览、匹配、重连、局间准备及正式音效继续保留。

## 实际微信包体

统计对象是重新构建并执行正式配置收口后的 build/wechatgame 全部文件；按 game.json 的子包根目录划分主包／子包，未用源码行数估算包体。

| 部分 | 清理前 bytes | 清理后 bytes | 清理前 MiB | 清理后 MiB |
| --- | ---: | ---: | ---: | ---: |
| 主包 | 3,187,075 | 3,105,949 | 3.04 | 2.96 |
| game-assets 子包 | 13,725,337 | 13,433,169 | 13.09 | 12.81 |
| 总包 | 16,912,412 | 16,539,118 | 16.13 | 15.77 |

总计减少 **373,294 bytes，364.54 KiB（2.21%）**。主业务脚本从 861,650 bytes 降为 780,628 bytes。

对照的是本轮开始时已有的上一份本地构建，不是两个隔离工作树的严格 A/B 实验；总差值不可完全等同于本轮每条源码删除的单独贡献。20 份音频的 288,339 bytes 有独立哈希清单证明。

基线和最终测量数据分别见 [基线 JSON](retirement-package-baseline-20260908.json)、[最终 JSON](retirement-package-result-20260908.json)。

最终主业务脚本 SHA-256：

```text
eec6ed1cf930efd1d8b11544200501186618d21b2d7ea67a6886b8990c254f66
```

## 验证记录

- 默认 npm test 的 **75 项脚本全部通过**；包含启动、重连、好友房观战、匹配取消、理牌选牌、对子标注、快捷语、正式动效和隔离本地平台契约测试。
- runtime、ci-core、migration 三组类型检查通过；共享核心 37 个生成副本同步校验通过。
- 架构门禁通过：217 个模块、57 个原有剩余行数预算，没有提高预算。
- 全局源码清单检查通过：325 个文件、3 个有明确理由的非游戏入口，没有未解释的孤立文件。类型可达／语法可达不等同实际运行覆盖。
- Creator 3.8.8 微信和 Web 发行构建均完成；CLI 返回 36 且日志有 Finished，随后实际产物检查通过，不以退出码单独判成功。
- 微信与 Web 的脚本／JSON 均扫描退役标记；20 份语音的资源逻辑路径与 native UUID 负载均不存在，保留女声／钢板和四个授权音频仍在资源索引内。
- 微信检查覆盖当前项目既有包体阈值、AppID、严格合法域名配置、无未批准远程资源包、原生加载页与子包路径。
- 从实际微信构建读取并测试触摸起点坐标、无 URL 环境启动 96% → 100%、原生随机数与恢复重试 ID；这些环境使用 Cocos／网络／原生 mock，不等同真实手机测试。
- Web 构建音效、选牌和牌面检查通过，已清除默认 Cocos 开屏。旧参考素材测试报告 source not available，未重新验证上游原工程；现存许可清单、归档哈希、正式素材和实际包内边界检查仍已执行。

## 自动防回流门禁

scripts/verify-retirement.mjs 及 retirement-boundary-regression.cjs 已加入默认回归／微信构建检查，拦截以下情况：

1. 退役源码或孤立 metadata 重新进入 assets。
2. 运行代码导入 migration、asset-library 或 tests。
3. 旧页面、旧网关、实验室桥接及固定牌局路径重新进入源码或构建。
4. 旧音频重新进入运行清单、资源索引或 native 文件。
5. 归档音频哈希变化，或现役语音被误删。
6. 赛事按钮不再是纯提示，或好友房观战／我的对局边界被破坏。

复现命令（Cocos 项目根目录）：

```sh
npm run verify:retirement
npm run typecheck:runtime
npm run typecheck:ci-core
npm run typecheck:migration
npm run verify:core-sync
npm run verify:architecture
npm run verify:health
npm test

# Creator 微信构建完成后
npm run finalize:wechat-build
npm run verify:wechat-build

# Creator Web 构建完成后，本地预览
npm run finalize:web-preview
node scripts/finalize-web-build.mjs --check
node scripts/verify-retirement.mjs --web
node tests/audio-effects-regression.cjs --require-build
node tests/selection-regression.cjs --require-build
node tests/card-skin-regression.cjs --require-build
```

## 归档和交付

- 退役界面、实验室源码和本轮重要适配器快照：asset-library/retired-runtime-20260908/*.snapshot。
- 旧语音：art-source/audio/licensed-archive；metadata 保存为 .meta.snapshot，不让 Cocos 导入。
- 迁移合同：migration/platform、migration/rules；只读固定手牌：tests/fixtures。
- 恢复必须依据清单重新审查依赖、UUID、路由、资源许可与门禁，不能只把文件复制回 assets。原有未提交代码没有回滚。
- 新微信包：build/wechatgame；新网页包：build/web-desktop。旧预览快照未删除，也不会代表最新构建。
- **没有上传、没有部署、没有真实手机验收。** 上传前建议真机检查：匹配入桌 → 连续理牌／选牌 → 炸弹与对子报牌 → 好友房观战／换座 → 后台恢复 → 准备下一局。大厅重复点赛事只应出现渐隐“筹备中”，不存在实验室或固定牌局入口。
