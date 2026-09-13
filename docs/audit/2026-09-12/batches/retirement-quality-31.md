# 第三十一批：退役边界、迁移模块与质量门禁

基线 `1d58999`；保留五处原有修改。新增完整审阅 **32 文件 / 1,765 行**。累计 **567 / 629（90.14%）**，62文件待审，资源/第三方/发布与跨模块收尾仍未完成。

本批没有新增当前产品确认缺陷，累计仍为 **39项（17 P2 / 22 P3）**；只写审计目录，没有修复、删除功能、构建、提交或部署。

## 审查与验证

| 项目 | 证据与结论 | 不代表什么 |
| --- | --- | --- |
| 旧功能是否回流 | 17运行源/元数据未复活；239资产TS转译后的553条引用未导入migration/tests/asset-library，未发现非字面require | 不等于全库所有代码都有活动入口 |
| 旧声音与实验室 | 20归档音频288,339字节哈希一致；快捷语1个25,562字节哈希一致；6组源码/meta快照存在而活动路径缺席 | 未执行归档快照，也未确认全部外部授权 |
| 原有门禁 | 9 CJS入口、2服务器测试通过；其中master入口在一次性内存loader改指当前src，未信任ignored dist | 静态merchant/quick-chat/网页模拟器检查不是用户交互实测 |
| 类型约束 | runtime/refactor/migration三份noEmit检查通过；14条负类型语句确有语义拒绝；隔离never收窄后两条nested readonly仍拒绝 | 不把转译通过或unused变量错误算类型正确 |
| 迁移网关 | 实际四种merchant操作+shop兑换共20种不确定响应重试；10非法输入无请求、3跨商户响应拒绝、5开发写接口拒绝 | 请求端口全是内存，不调用商户/兑换线上服务 |
| 规则旧帮助 | 五个冻结页面，8组flags的三带二/A2345/同花顺5.5文本一致 | 这是旧传统帮助，不是现行所有赛制文案验收 |
| 既有发布包 | 只读退役检查通过，网页327文件；微信主包3,302,334、分包13,743,105、总17,045,439字节 | 未重新构建，不证明当前HEAD/dirty源码已上线 |

现有微信总包比Sep8历史基线16,912,412字节多133,027字节；两次构建并非隔离A/B，所以不把差值归因于某一项退役更改，也不继续沿用历史清理报告的缩包数字描述当前包。

## 迁移关注项 MIG-31-C01

[旧停止策略](../../../../work/guandan-cocos/migration/spectator/SpectatorPollingPolicy.ts:12)只接受`finished / aborted`。真实迁移decoder和开发feed接受并返回`completed`；把完成feed交给停止策略，`timelineComplete=true`仍返回false，改为`finished`或`aborted`才停止。

[原回归](../../../../work/guandan-cocos/tests/spectator-polling-regression.cjs)分别测策略与feed，未组合两者。本次[补充探针](../repro/retirement-quality-31.cjs)已组合复现。

这几份文件位于迁移目录，没有当前玩家入口或运行引用。**只列重新启用前风险，不将它计为当前好友房观战故障。** 建议保持退役；如以后重新启用，先统一terminal枚举并加端到端组合断言。

## 门禁的真实边界

- 原16模块可达性检查只遍历import declaration，遗漏export-from、dynamic import和require的全图意义；本轮另核发射后的所有字面模块引用，但仍不声称每个源文件都活跃。
- merchant、快捷语、网页模拟器大部分检查只是源码文本。补充gateway行为探针仅覆盖数据/幂等，不覆盖商户页真实授权流程。
- `refactor-type-contracts.ts`先故意执行`player.dashboard=null`，会让随后if分支被推断为never。隔离该行后，名称赋值确因只读拒绝，数组push也确因只读拒绝；当前模型声明成立，但原负测试最好独立组织，避免未来误用无关错误满足expect-error。
- 负类型探针首轮CompilerHost cwd错误，产生165条类型路径错误。已匹配真实tsc项目cwd后重测；这是探针设置错误，不是产品类型检查失败。
- .gitignore的env/build/temp例外和保留的两个发布profiles按合成路径验证；运行数据忽略只是`var/weapp-rooms.json*`与`var/spectator-outbox.json*`等具体路径，不概括为任意数据都不会入库。

## 文件记录与复跑

逐文件哈希、完整审阅说明、测试输出和边界见[机器报告](retirement-quality-31.json)。补充复现：

```sh
node docs/audit/2026-09-12/repro/retirement-quality-31.cjs
```

仅读取当前源/已审依赖/归档哈希，网关为合成端口，TypeScript修改只在内存。下一批继续剩余服务器集成测试、工具/构建配置与依赖清单；不跳过安全审阅直接运行可能触网或操作持久数据的脚本。
