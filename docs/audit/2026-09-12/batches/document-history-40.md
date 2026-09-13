# 第四十批：文档历史、活动参考及退役边界

日期：2026-09-13。基线 HEAD：`1d58999dc6e5455b049e1643660bbba3deee1406`。仅新增本报告和同名 JSON，不更新中央状态、不修改产品、不执行测试/构建/安装/部署/迁移、不访问外部或真实数据。

## 结果与方法

81 份独立文档边界、521,708 bytes；全部现有 SHA-256 与 manifest 匹配。四份架构/验收参考归 `architecture-and-contract-docs`；其余77份按委托归 `historical-notes`（包含活动音效参考、离线工具说明、迁移/运维记录和归档文本，并不表示77份全是已退役文档）。

- 24份全文文档阅读：4份架构/验收 + 20份其他参考。全文阅读是文档内容核查，**不增加第一方源码逐文件覆盖率**。
- 51份日期化历史记录：定向阅读标题、日期、章节、内容/现状、退役/后续更新、测试/发布/真机限制段落；**不是全篇人工审阅**。
- 6份归档源码文本：首尾、导入/导出/历史标记、归档路径和来源哈希检查；**不是完整源码安全审查**。其中metadata快照9行正文恰好全部读完，但仍按归档边界方法记录。
- 62个解析到的仓库内相对Markdown链接目标均存在。未验证远程网址、absolute路径、所有锚点或代码块中的路径。
- 3份 `aug30-baseline` 文本的 Git blob 与恢复文档11–15行完全一致：Domain `22a2971a52e07598c6d3e72207f0e1e9830a52cf`，Profile `19edb54d7c5aa136fa450d9a49a29eef26ae7cc2`，Catalog `2b634bcb6b019b02d5f7d35a95042ba606b0787d`。静态检索活动assets/settings/profiles没有归档恢复根、被否定模块或快照名引用；沿用既有源码/包体审计，不称新构建验证。

每文件SHA-256、方法、字节数与结论见 [JSON](document-history-40.json) 的 `boundaryReviewed`。所有本批 `reviewed: []`；629份第一方源码覆盖率不变。

## DOC-39-001 的扩展证据（不新增问题计数）

仍为既有P3文档维护问题。历史事件本身不因后来变更而变假；问题在于活动指导/“当前”表格未明确隔离已退役或被替代说明。带明确历史/后续更新提示的记录不当作活动功能缺陷。

| 证据 | 现状对照与影响 |
| --- | --- |
| `docs/ARCHITECTURE.md:35,44,89`（本表未注明的docs均为Cocos docs） | 仍描述policyOverrides/fallbackDecision/runtimeIntel及旧多难度策略、36生成副本。当前 `shared-core/src/ai/engine.ts:8,21–29` 使用team journal和唯一最高策略；多个旧模块已不存在，生成副本当前39。错误的是开发导航，不是恢复旧策略的需求。 |
| `ARCHITECTURE.md:163` | 称resume令牌不持久化，只支持同进程；实际 `network/LobbyController.ts:104,407–409,470–480` 和 `LobbyResumeSession.ts:53–70`明确保存/读取/恢复。仅证实文档与实现相反，不承诺所有冷启动真机路径无缺陷。 |
| `CODE_FILE_INVENTORY.md:13–15,129,232,246`、`CODE_HEALTH.md:9–11,63–70` | 旧表319路径中24已不存在；当前同目录/后缀集合是客户端TS239、coreTS40、serverJS85，共364，其中69未列。HandGroupingHistory、ChatController、QuickChatPolicy被列runtime但已删除；生成副本不能双算独立源码。 |
| `feature-acceptance-matrix.md:31,34–38`、`ARCHITECTURE.md:143,149` | 仍把undo/redo、固定可玩实验室、聊天/男声写作能力。当前 `tests/round-view-boundary-regression.cjs:47–48`、`tests/quick-chat-regression.cjs:5–11`为禁止回流守卫；`scripts/verify-retirement.mjs:18–19,55`禁止EffectLab。相关测试文件仍存在，**不是missing test**，而是用途变为fixture/迁移/退役检查。 |
| `EFFECTS_AND_TESTING.md:19–20,43,48–51,71,73`、`VFX_DESIGN_SYSTEM.md:5,68–73,98` | 仍列旧特效/流程/设置/实验室与旧React/原微信构建。实际 `effects/EffectProfileResolver.ts:23–25` 将非炸弹impact VFX降为真实飞牌/一次报牌；`audio/AudioProfiles.ts:78–86`退役wildcard及同花顺额外音轨。是文档漂移，不是功能回流。 |
| `niuma-audio-import.md:13,17,36` | 同文件已声明聊天整体退役，却仍要求测试一条OGG及另外五按钮；应调整验收对象。 |
| `gameplay-audio-effects-spec.md:3,6,28–37,76,84,91,170,179` | 8月旧构建说明局部更新后仍作为统一基线，包含单机摸牌定庄、特殊VFX、级牌声及新增实验室建议；需明确历史失效范围，不能按旧文档恢复功能。 |
| `feature-acceptance-matrix.md:27`、`hong-kong-bare-ip-test.md:75`、`table-polish-20260910.md:5` | 7秒补位/500–1500ms旧节奏不对应当前 `server/platform/match-bot-fill.js:6` 的3秒与 `server/bot-turn-pacing.js:4–5` 的500–3000ms及10%三倍思考。根线程release扩展同一ID，不双计。 |

建议后续另行授权文档修订：刷新活动架构/路径清单，把退役功能验收改为不回流检查，历史记录增加日期及取代导航。不为满足旧文档而恢复产品能力。本批新增确认问题 **0**；全局既有 **41** 项未修复。

## 历史和可执行边界

- `effect-lab-fixtures.md:3`、`RETIREMENT_PACKAGE_AUDIT_20260908.md:3`、`friend-room-direct-table-20260909.md:3`、`friend-room-variant-rules-20260909.md:3`已有明确退役/后续提示。保留历史截图和旧条款，不错误当成活动功能。
- `MORE_FEATURE_RETIREMENT_PLAN.md`、旧吸收/旧流程/早期好友房说明被9月8–10日清理、房号、机器人、转蛋/复式、赛事中心和模型收口逐步取代。早期“未做”不是当前缺失，早期“已做”也不是当前回归证明。
- `visual-flow-polish-tracker-20260906.md:3,87–91`属于旧视觉任务及旧automation；其中历史active段不控制当前全库审计/automation-2。未依据文档重新启用旧任务。
- `migration/README.md:3–14`禁止.meta和assets导入；`tools/lobby-layout-lab/README.md:20,38,51–68`是包外回环Canvas模拟工具，不等于已退役的游戏内EffectLab。
- `existing-profile-reset-20260910.md:5–13`仅历史授权重置记录；真实数据/备份未读取，禁止无新请求重跑，禁止用整库旧备份覆盖后续游戏数据。
- 运维文档的具体release、健康状态、备份、账号数/包体数字仅为历史陈述，本批未连服务、未读取凭证或重放命令。手机、多人联机、音频听感、来源权利、上游blob和当前源码到产物新鲜度仍使用总审计既有限制。

## 操作说明

只执行了经过查看的只读 `sed/nl/rg`、内联Node库存/哈希/本地链接存在性检查、`git hash-object`（没有-w）和 `git status`。未执行产品模块/测试脚本。一次检索猜测的两个辅助文件名不存在，随后用rg找到真实 `round-view-boundary-regression.cjs` 和 `verify-retirement.mjs`；该工具查找错误不计产品问题。报告生成内存映射曾漏一个文档键，补齐后才写文件；未产生部分产品修改。

## 逐文件结论索引

方法标记：全文=文档全文读；定向=历史边界段落；归档=文本源快照边界。完整SHA-256在JSON中，不用截短哈希计覆盖。

| 文件 | 方法 | 结论 |
| --- | --- | --- |
| `work/guandan-cocos/art-source/ui-recovery/aug30-baseline/LobbyPageCatalog.ts.txt` | 归档 | 8月30日目录文本快照，旧模式列表非当前入口；Git blob与恢复说明一致。 |
| `work/guandan-cocos/art-source/ui-recovery/aug30-baseline/LobbyPageDomain.ts.txt` | 归档 | 8月30日大厅域快照，旧ClipboardService引用不属活动依赖；Git blob与恢复说明一致。 |
| `work/guandan-cocos/art-source/ui-recovery/aug30-baseline/LobbyPlayerProfilePresenter.ts.txt` | 归档 | 8月30日资料展示快照，旧本地身份算法非当前平台身份；Git blob与恢复说明一致。 |
| `work/guandan-cocos/art-source/ui-recovery/rejected/LobbyLandingView.ts.meta.txt` | 归档 | 归档metadata文本，正文JSON已读，imported=false；非活动.meta。 |
| `work/guandan-cocos/art-source/ui-recovery/rejected/LobbyLandingView.ts.txt` | 归档 | 首行标注Rejected 2026-09-06、outside runtime、do not re-enable；只核归档内容/入口。 |
| `work/guandan-cocos/art-source/ui-recovery/rejected/lobby-landing-regression.cjs.txt` | 归档 | 首行标注历史测试而非活动验收门禁；未执行旧测试或审阅全部源逻辑。 |
| `work/guandan-cocos/asset-library/retired-audio/level-card/README.md` | 全文 | 9月8级牌音效退役README，原路径/哈希/meta/禁止自动启用明确。 |
| `work/guandan-cocos/docs/ARCHITECTURE.md` | 全文 | 当前架构指导混有旧AI模块/36副本、快捷语、不持久化恢复凭证及退役页面热点；DOC-39-001扩展。 |
| `work/guandan-cocos/docs/CODE_AUDIT_AUDIO_PROFILE_FIXES_20260908.md` | 定向 | 9月8日音频/资料抽查修复记录；旧通过结果不覆盖第15批短音效取消缺陷，真机待验。 |
| `work/guandan-cocos/docs/CODE_AUDIT_FOLLOWUP_FIXES_20260908.md` | 定向 | 9月8日抽查及storage拆分；明确非全仓安全审计、未部署/上传，325文件数字仅该轮。 |
| `work/guandan-cocos/docs/CODE_AUDIT_RECOVERY_FIXES_20260908.md` | 定向 | 9月8日入桌/退出/回执恢复；本地丢包fixture非公网，328文件/包体为历史。 |
| `work/guandan-cocos/docs/CODE_FILE_INVENTORY.md` | 全文 | 全文319条文件行表已读；24路径消失、69当前同范围路径未列；当前239客户端TS/40coreTS/85serverJS。DOC-39-001扩展。 |
| `work/guandan-cocos/docs/CODE_HEALTH.md` | 全文 | 9月8日审查有范围限制，但当前计数/undo/master热点已过期；保留历史包体/测试结论，不作现行健康保证。DOC-39-001扩展。 |
| `work/guandan-cocos/docs/CODE_SMELL_FIXES_20260908.md` | 定向 | 9月8日抽查修复；明确未提供跨房持久化隔离，旧测试不排除后续审计缺陷。 |
| `work/guandan-cocos/docs/EFFECTS_AND_TESTING.md` | 全文 | 活动参考仍写逢人配/流光/流程VFX/设置/实验室及旧React/原微信构建；现行非炸弹只保留飞牌/报牌。DOC-39-001扩展。 |
| `work/guandan-cocos/docs/FRIEND_ROOM_OBSERVER_20260908.md` | 定向 | 9月8日观战/换座交付；本机15秒与可控时钟、三端配套及真机待验明确，不排除SA-01-001等。 |
| `work/guandan-cocos/docs/MORE_FEATURE_RETIREMENT_PLAN.md` | 全文 | 8月7日计划把更多/设置/人机/旧缓存当应保留入口；被9月8日清理取代，不据此恢复。DOC-39-001扩展。 |
| `work/guandan-cocos/docs/RESIDUAL_CLEANUP_20260908.md` | 定向 | 9月8日17文件退役与RoundRecord报告；历史包体/哈希、mock和未上传范围清楚，JSON证据链接存在。 |
| `work/guandan-cocos/docs/RESPONSIBILITY_SPLIT.md` | 全文 | 9月8日第一批拆分；旧行数/预算与贡还动效接口只属当轮，非现行接口保证。 |
| `work/guandan-cocos/docs/RESPONSIBILITY_SPLIT_PHASE2.md` | 全文 | 9月8日第二批拆分；真机待反馈/未部署后端清楚，旧React尚未分家已被后续隔离取代。 |
| `work/guandan-cocos/docs/RETIREMENT_PACKAGE_AUDIT_20260908.md` | 全文 | 3行明确上一轮记录；实验室/音频退役有效，快捷语仍存/赛事toast属于9月9日更新前历史。 |
| `work/guandan-cocos/docs/VFX_DESIGN_SYSTEM.md` | 全文 | 活动规范保留颜色/预算/Graphics禁令；EffectLab验收和非炸弹/流程运行映射已过时。DOC-39-001扩展。 |
| `work/guandan-cocos/docs/classic-modes-no-shuffle-20260910.md` | 定向 | 9月10日三模式/不洗牌交付；后端配套、构建模拟和手机待验分开，旧模式名非第四入口。 |
| `work/guandan-cocos/docs/commercial-ui-asset-inventory.md` | 全文 | 8月31日素材决策；不访问Downloads来源，候选非当前assets；授权合图仍受SOURCE-39-C01限制。 |
| `work/guandan-cocos/docs/counter-nicknames-20260908.md` | 定向 | 9月8日机器人网名/公开同花顺上界；非暗牌或概率，后续HAND-26-002误亮仍未修。 |
| `work/guandan-cocos/docs/default-profiles-20260910.md` | 定向 | 9月10日默认资料/上传记录；50请求范围不等于50成功素材，权利/真机待验保留，不访问QQ/UAPI。 |
| `work/guandan-cocos/docs/duplicate-eight-seat-20260909.md` | 定向 | 9月9日八席双桌本地交付；多端发布/真机待验清楚，跨桌需求不排除CS-01-001等。 |
| `work/guandan-cocos/docs/effect-lab-fixtures.md` | 全文 | 3行明确9月8日实验室完整退役；DEV/UI/控制台段仅历史，固定牌留在测试，不恢复产品入口。 |
| `work/guandan-cocos/docs/engineering-quality-20260910.md` | 定向 | 9月10日排名/时钟/行为回归记录；不代表真机、容量或发布，未重跑或改变门禁。 |
| `work/guandan-cocos/docs/feature-acceptance-matrix.md` | 全文 | 8月5日矩阵仍列undo/redo、EffectLab、快捷语/男声和旧任务/HTTP观战UI；7秒补位已变3秒。DOC-39-001扩展。 |
| `work/guandan-cocos/docs/friend-room-bot-buttons-20260909.md` | 定向 | 9月9日逐席机器人及release记录；不查询当前线上/备份，微信真实按钮与联网仍待验。 |
| `work/guandan-cocos/docs/friend-room-direct-table-20260909.md` | 定向 | 3行说明后续恢复六位房号弹窗；仅创建为上一阶段，长口令仍退役。 |
| `work/guandan-cocos/docs/friend-room-invite-20260908.md` | 定向 | 9月8日机器人/换座未做为历史，后续bot/number/duplicate已推进；分享仍仅wx替身。 |
| `work/guandan-cocos/docs/friend-room-number-and-variants-20260909.md` | 定向 | 9月9日房号阶段记录；八席未实现被后续variant/duplicate文档取代，非当前能力缺失。 |
| `work/guandan-cocos/docs/friend-room-settings-20260908.md` | 定向 | 9月8日经典设置与未决参考图；转蛋/复式待定是历史，不以设置已接通排除PG-17-001。 |
| `work/guandan-cocos/docs/friend-room-variant-rules-20260909.md` | 定向 | 3行有八席已实现更新；旧未实现仅历史，转蛋自动换队RP-13-001仍未修。 |
| `work/guandan-cocos/docs/gameplay-audio-effects-spec.md` | 全文 | 8月4旧基线局部更新至9月7；单机定庄/非炸弹VFX/级牌声/实验室建议与当前不符。DOC-39-001扩展。 |
| `work/guandan-cocos/docs/guangzhou-wechat-deployment.md` | 全文 | 9月5部署加9月6/7补记；命令仅阅读，release/健康/包体仅历史，单实例与真机限制有效。 |
| `work/guandan-cocos/docs/hand-centering-20260906.md` | 定向 | 9月6撤销强制分区；保留遮挡告警及小屏缩放非触控限制，不把固定局当当前入口。 |
| `work/guandan-cocos/docs/hand-group-labels-20260908.md` | 定向 | 9月8标签与wildcard退役；声音/meta包外与当前AudioProfiles一致，真机读字/听测待验。 |
| `work/guandan-cocos/docs/hand-lock-selection-20260910.md` | 定向 | 9月10锁牌/模型收口；浏览器内存状态非真机，不排除UI-25-002按钮高亮缺陷。 |
| `work/guandan-cocos/docs/hand-touch-origin-fix-20260906.md` | 定向 | 9月6触摸投影修复；模拟投影非鸿蒙真机，可进大厅不代表全部操作通过。 |
| `work/guandan-cocos/docs/hong-kong-bare-ip-test.md` | 全文 | 开发裸IP说明仅测试账号/端口收尾；75行7秒已为3秒，未执行部署或放宽配置。DOC-39-001扩展。 |
| `work/guandan-cocos/docs/in-game-abstraction-20260910.md` | 全文 | 14行明确HandGroupingHistory/meta/undo/redo退役；31行旧赛事超预算后续已修，不新计。 |
| `work/guandan-cocos/docs/legacy-absorption-inventory.md` | 定向 | 8月4/5/7旧工程吸收；读章节/日期/状态/退役/限制段，非417行全文；男声/undo/聊天/实验室已过时。DOC-39-001扩展。 |
| `work/guandan-cocos/docs/legacy-effect-migration.md` | 全文 | 5 allowed/39 rejected/0 runtime与39批证据一致；EffectLab验收/旧流程VFX运行描述过时。DOC-39-001扩展。 |
| `work/guandan-cocos/docs/lobby-approved-cocos-20260907.md` | 定向 | 9月7候选02迁入；脚本条件skip/隔离浏览器不当线上或真机，覆盖旧候选。 |
| `work/guandan-cocos/docs/lobby-aug30-restoration-20260906.md` | 定向 | 9月6恢复记录；3份文本Git blob复算全符，不虚构8月30提交，拒绝设计txt在包外。 |
| `work/guandan-cocos/docs/lobby-flow-polish-20260906.md` | 定向 | 9月6大厅/匹配候选；像素差及受控异步非完整真机，未重建微信/部署，旧网址不作活动服务。 |
| `work/guandan-cocos/docs/lobby-motion-20260907.md` | 定向 | 9月7轻动效；骨骼未交付、预览禁网络且手机帧率/耗电未验，不误作业务成功。 |
| `work/guandan-cocos/docs/lobby-profile-release-20260908.md` | 定向 | 9月8赛事仅toast被9月9赛事中心取代，资料授权真机未验。 |
| `work/guandan-cocos/docs/lobby-reference-layout-20260906.md` | 定向 | 9月6参考方案后被恢复/approved覆盖；不据旧设置/更多说明重启退役功能。 |
| `work/guandan-cocos/docs/lobby-refinement-20260906.md` | 定向 | 9月6审美候选；DPR缩图/模拟器CSS恢复与未微信部署明确，不作当前手机版本。 |
| `work/guandan-cocos/docs/niuma-audio-import.md` | 全文 | 女声/男声/快捷语退役边界基本清楚，但36行仍要求OGG快捷语和五按钮听测，和13/17行自相矛盾。DOC-39-001扩展。 |
| `work/guandan-cocos/docs/profile-preselection-polish-20260907.md` | 定向 | 9月7资料/快捷语/预选；聊天9月9退役，主动授权和浏览器样例不能当真机。 |
| `work/guandan-cocos/docs/random-level-friend-room-20260907.md` | 定向 | 9月7旧quick/classic全随机单局范围被9月10三模式扩展，非当前模式全集；需双端发布。 |
| `work/guandan-cocos/docs/remaining-card-count-20260907.md` | 定向 | 9月7公开余牌10阈值；显示样本非真实出牌到阈值，不涉及隐藏牌或重新发牌。 |
| `work/guandan-cocos/docs/server-variants-release-20260909.md` | 定向 | 9月9授权服务端release历史；不查询当前生产/备份，转蛋/复式多人手机待验。 |
| `work/guandan-cocos/docs/side-clock-release-20260907.md` | 定向 | 9月7时钟/匹配节奏；自动/构建模拟/手机/客户端更新分开，线上状态本批未复验。 |
| `work/guandan-cocos/docs/table-card-polish-20260908.md` | 定向 | 9月8记牌器/牌面；375px非横屏目标，样例已清除，真机读字/触控待验。 |
| `work/guandan-cocos/docs/table-controls-20260909.md` | 全文 | 9行聊天UI/协议/音频全退役与当前守卫一致；19行release仅历史，本批未查线上。 |
| `work/guandan-cocos/docs/table-matching-20260908.md` | 定向 | 9月8桌内匹配；读实现/示例/发布边界，真实排队/取消/后台仍待手机。 |
| `work/guandan-cocos/docs/table-polish-20260910.md` | 定向 | 5行500–1500ms与当前500–3000ms及10%三倍不符，历史调速DOC-39-001扩展。 |
| `work/guandan-cocos/docs/table-polish-bot-pacing-20260907.md` | 定向 | 9月7层级/节奏；浏览器失败不冒称截图通过，微信包/服务发布分离，非当前时序保证。 |
| `work/guandan-cocos/docs/table-seat-flight-polish-20260907.md` | 定向 | 9月7座位/80%飞牌；mock/告警/真机待验分开，不排除UI-25-001动态视角缺陷。 |
| `work/guandan-cocos/docs/teammate-view-20260907.md` | 定向 | 9月7队友视角；旧视觉任务暂停不控制本轮审计；固定局/裁切画面非四端手机。 |
| `work/guandan-cocos/docs/tournament-center-20260909.md` | 定向 | 9月9免费16人三轮赛事取代旧toast；签名结果fixture非16手机全流程，TO-11-001未修。 |
| `work/guandan-cocos/docs/tournament-polish-20260910.md` | 定向 | 9月10赛事刷新/取消；素材/自动1秒同步属于当轮，未上传/未16手机验收。 |
| `work/guandan-cocos/docs/tribute-controls-20260909.md` | 定向 | 9月9贡还/级牌；防御性规则强化与上线分开，红心配听测/贡还手机待验。 |
| `work/guandan-cocos/docs/ui-frame-system-20260909.md` | 定向 | 9月9统一UiFrameStyle约定；38行快捷语弹层是退役前历史截图，非活动入口。 |
| `work/guandan-cocos/docs/ui-product-polish-plan.md` | 全文 | 9月5待实施方案；不当已实现或新增授权，7秒及旧页面安排被后续交付取代。 |
| `work/guandan-cocos/docs/ui-recovery-20260905.md` | 定向 | 9月5恢复历史；外部tar不读取/恢复，不整包覆盖；7秒/平面选牌是当轮状态。 |
| `work/guandan-cocos/docs/visual-flow-polish-tracker-20260906.md` | 定向 | 9月6开始/9月7暂停旧视觉任务；定向段落非180行全文，旧automation及历史active不控制automation-2。 |
| `work/guandan-cocos/docs/wechat-friend-ranking-20260909.md` | 定向 | 同小游戏/上传键条件清楚；浏览器无真实好友，不核后台或好友数据，sharedCanvas手机待验。 |
| `work/guandan-cocos/docs/wechat-match-recovery-fix-20260907.md` | 定向 | 9月7继续牌局修复；无URL/crypto包内mock非真机，新包须重取且未自动上传。 |
| `work/guandan-cocos/docs/wechat-profile-friend-room-fix-20260909.md` | 定向 | 9月9资料/字段与旧线上版本冲突记录；非手机唯一根因，真实授权待验，当前release未查询。 |
| `work/guandan-cocos/docs/wechat-startup-layout-audit-fix.md` | 定向 | 9月5启动/布局修复；手机重测未代办，无上传/服务器操作，本批仅证据边界。 |
| `work/guandan-cocos/docs/wechat-startup96-compatibility-fix-20260906.md` | 定向 | 9月6条件URL复现不证明设备唯一根因；工具可见不算真机，无上传/部署。 |
| `work/guandan-cocos/migration/README.md` | 全文 | 迁移源码禁止.meta/assets导入，恢复须产品入口/所有权/测试/包体验收，非当前运行功能。 |
| `work/guandan-cocos/tools/lobby-layout-lab/README.md` | 全文 | 离线Canvas布局工具，候选02复用正式几何，01/原版仅历史；回环只读/模拟业务不进游戏，不与退役EffectLab混淆。 |
| `work/guandan-windows-source/docs/existing-profile-reset-20260910.md` | 全文 | 3普通用户/99跳过的历史授权重置；不读生产/备份，13行禁止无新请求重跑与全库恢复覆盖后来数据。 |

