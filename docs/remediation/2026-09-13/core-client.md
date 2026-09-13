# 核心、客户端状态及文档整改

2026-09-13；17 项原审计问题。本轮修改源代码和回归，不部署、不提交，不覆盖原有五处未提交修改；审计原件保持不变。客户端简称 app=`work/guandan-cocos`。

| ID | 修复 | 对应回归/验证 |
| --- | --- | --- |
| BUILD-03-001 | 构建配置先检查原始路径，拒绝编码、点段、空白、反斜杠和无效百分号；交付启动夹具读取包内实际嵌入配置，不再另造测试配置 | `runtime-platform-config-regression.cjs` 的 9 类双侧拒绝及合法配置对照；本轮未重建微信，不声称新包启动通过 |
| CORE-CONTRACT-06-001 | 独立局无抗贡断言改用真实事件名 `ANTI_TRIBUTE_DECLARED` | `shared-core/tests/match-format.test.ts`；不存在的旧枚举名已移除 |
| CORE-RULES-01-001 | 兼容 `dealNextRound` 保留 matchFormat | `legacy-round-recovery.test.ts`，个人排名后续局不因双上提前终止 |
| CORE-RULES-01-002 | 兼容过牌定位末次非 Pass 动作，不依赖 JSON 无法保留的对象同一性 | 同上，恢复前后同一后继座位/末次出牌；主 transition 的 125 项核心测试通过 |
| CS-01-001 | `NetworkMatchSnapshotController` 按可信 match/table/view authority 分区，换桌重建版本/阶段基线；同 authority 仍拒绝旧包 | `network-authority-recovery-regression.cjs`：A settled rev11→B playing rev2/50、同桌旧 rev；补 optional-null/缺省 ports reset 生命周期边界 |
| CS-01-002 | 统计按稳定 match/table/participant/round 身份写入同一会话快照的有界去重账本；reset 不抹一次性记录；无可信 match 的旧事件只展示 | 同上：重复、reset、新 Session 冷恢复只计一次，新 match 复用房号仍计新局，observer 不计分；本地账本最多 256 条，不是服务端积分或永久无限日志 |
| CTL-06-001 | 显示秒数与声音已播秒数分离，按权威 deadline/action 身份重置；选择刷新不消耗 tick 的音效票据 | `table-turn-clock-controller-regression.cjs`：每个最后 5 秒前先 update，再 tick 仍 5/4/3/2/1 各一次 |
| RESOURCE-06-001 | 默认头像失败/空纹理均释放 pending，下一次渲染可以重试 | `default-profile-retry-regression.cjs`：失败、空结果、并发合并、成功缓存 |
| RESOURCE-27-001 | 背景 setMode 触发现有有界/coalesced preload，不只 apply 已有纹理 | `scene-backdrop-controller-regression.cjs`：失败后同模式重入、合并请求、旧背景保留和销毁后迟到结果 |
| HAND-26-001 | A2345 按 represented faces 判低 A，不把 5505 炸弹强度当顺子端点；组内判断只计算一次 | `hand-projection-recovery-regression.cjs`：4 花色×自然/配牌×auto/lock 共 16 组，加 16 对照 |
| HAND-26-002 | 普通级牌不能占同花顺的普通序列槽；红心级牌单独进入通配池，不重复计算 | 同上：520 个精确未知牌场景（150 原误亮应拒、370 合法），另 150 红心配补槽对照；仍只用公开未知牌上界 |
| PG-17-001 | 规范化保留 `counterEnabled` 布尔字段，默认缺省语义不变 | `friend-gateway-settings-regression.cjs`：4 赛制×2布尔值，提交/平台存储/恢复/HUD 8 条完整往返 |
| PG-17-002 | 新开房意图键覆盖完整、固定字段顺序的规范化设置，不再人工列出不完整子集 | 同上：4类改配置第一次即用新ID；相同配置未知结果重试同ID |
| LP-19-001 | 新菜单订阅进行中的资料请求；回填后重绘当前菜单、不抢路由；无资料且请求已失败时显示“同步未完成”而非永远同步中 | `lobby-dashboard-lifecycle-regression.cjs`：2往返路由×2响应顺序、3失败组合、正常/离页/销毁对照 |
| RP-19-001 | 回放后台暂停后同时刷新当前回放页的按钮文案，旧 timer 失效 | `page-background-lifecycle-regression.cjs`：显示播放、显式点击才继续、seek与迟到详情不抢路由；80条时间线/5280游标比较 |
| LP-28-001 | 大厅赛事副标题显示“16人积分赛”，保留原美术和几何 | `lobby-aug30-restore-regression.cjs` 更新活动功能断言；原 artwork/refinement/layout/tournament 回归保留 |
| DOC-39-001 | README/架构/第三方清单按源码修订；新增当前能力基线，旧文档显式历史化，原验收表五处用户改动之一保持原样；重新生成 368 文件清单 | `documentation-baseline-regression.cjs` 校验路径全集与退役/资源条目；历史说明不再作为现行功能恢复指令 |

## 新增回归的边界

以上是原生测试入口，已登记 app `package.json` 的默认 `test`；不导入审计目录中的“断言旧缺陷”探针。Cocos 节点、输入、存储、时钟与网络端口部分使用可控替身；手牌测试使用真实规则与服务端 `stateForViewer`，不读取真实用户或调用外部 API。832 组理牌、4160 布局、2770 合法提示是主机回归，不是手机延迟或胜率测量。

同期独立复核确认当前完整路由的换桌与记账行为；发现可选 authority=null 的独立控制器 reset 边界后，已用 undefined 初始化哨兵修复并加入反例。当前 GameManager 仍总是提供非空序列化身份，没有通过取消同桌版本校验掩盖缺陷。

## 依赖维护（不并入 41 项产品缺陷）

`vitest` 及锁定的 `@vitest/mocker` 从 4.1.10 升至 4.1.11，保留现有 TypeScript/Vite 主版本；使用 `--ignore-scripts` 安装。按[维护者公告](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9)，4.1.11 是该文件读取漏洞的修复版本。核心 20 文件 / 125 测试在新版本通过。

这只关闭已知公告的版本处置，不是全依赖安全证明；全部在线公告覆盖、非本机包许可、外部素材权利链和上游选中文件 blob 来源仍不宣称已完成。

## 回归中遇到并修正的阻断

- 新增测试未登记默认命令、展示排序和服务端生命周期超行数预算：补登记、收紧重复实现，未提高预算。
- 旧源码快照断言仍要求“筹备中”、资料一直“账号同步中”、旧比分表达式：按新语义修改断言，并保留动态行为测试，不删除功能防线。
- 资料失败分支新增测试实测仍显示“账号同步中”：补 Presenter 状态区分后通过，不只修成功路径。
- 新文档守卫把“22 clips”误匹配成“2 clips”：修正数词边界；未改资源以迁就测试。
- 工具层 `pnpm --network-timeout` 参数不支持，改用 fetch-timeout；macOS shasum 的环境 locale 失败后使用 Node SHA-256。两者不是产品缺陷。

各端最终全链路结果与仍需交付包/真机的部分，以本目录 README 与人工验收表为准。
