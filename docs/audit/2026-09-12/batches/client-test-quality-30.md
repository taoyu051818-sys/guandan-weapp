# 第三十批：客户端交互测试与测试夹具边界

基线：`1d58999dc6e5455b049e1643660bbba3deee1406`，保留原有五处修改。本批完整审阅 **21文件 / 4,173行**；只是被审文件中的这一批，不是全库完成。逐文件哈希及具体结论见[JSON](client-test-quality-30.json)。

## 结论

- 未新增确认问题。累计仍为39项（17P2、22P3），尚未修复；不能用本批测试通过消除既有计时漏音、旧触摸恢复选择、跨桌投影等问题。
- 13个原有CJS回归入口全部通过。选牌/理牌包含实际规则与presentation workspace；阶段/时钟/网络测试使用实际owner配合模拟端口。
- 本地AI回合、同步worker、固定牌局已在tests目录。检索当前assets无这些实现的导入，实际消费者是local-match、fixed-fixtures、hand-grouping测试与退役边界检查。测试中的0.72秒延迟不是线上机器人当前延迟。
- 9类内存故障均被6个未改写原测试入口捕获；所有基线通过。详见[可重复探针](../repro/client-test-quality-30.cjs)。

## 测试能说明什么

| 范围 | 主要核验 | 明确局限 |
| --- | --- | --- |
| 手势/选择 | 从起点反选、同一卡只处理一次、长按/采样、离回合预选、锁组整选 | 源码regex较多；独立Set样例不能替代真实manager；无手机触控 |
| 理牌/锁牌 | 权威手牌变化、完整复原、锁组保留、紧凑居中、3带2护大对、普通顺子留手动 | 有超27张候选单元fixture；不证明最优手数或真机耗时 |
| 贡还/结算按钮 | actor/action门禁、确认还牌文案复用、准备/取消、终场单行按钮 | 合法动作policy和部分结算renderer为替身 |
| 时钟/快照 | 一次采样、合法deadline、reset/dispose、迟到tick、wire拷贝冻结 | 未含选牌update先于tick时序，CTL-06-001保留 |
| 牌面资源 | 54面、37PNG、122,620字节、尺寸/alpha/颜色、唯一映射/缓存 | 现有build config通过纹理路径检查，但没有构建新鲜度结论 |
| 固定/本地夹具 | 合成合法动作、状态投影、AI checkpoint、版本防护、物理卡ID | 无当前线上消费者；中局省略历史，不支持据此证明服务器恢复或完整不洗牌/转蛋/复式 |

测试夹具的局限不等于当前产品故障：
local-match中的`index:eventType`唯一性断言恒真，无法检查重复事件；其他事件次序断言有实际价值。建议后续整改时删弱断言或明确验证事件身份，而不是扩大本轮授权修改测试。LocalMatchController不传dealMode、LocalMatchEventController旧ROUND_PREPARED→tribute投影仅用于测试，后续新增线上用例应直接用活动服务器入口，避免让已退役适配器模拟全部玩法。

## 选择性故障注入

| 内存故障 | 原回归入口 | 检出信号 |
| --- | --- | --- |
| 起点选择反向错误 | selection | 起始卡tap selected不符 |
| 同次拖动忘记记录访问 | selection | 第二次claim不是null |
| 锁组点击只返回单张 | hand-grouping | 手动锁定5张只返回1张 |
| 旧手牌checkpoint错误接受 | hand-grouping | 应拒绝却返回true |
| dispose遗漏取消timer | table-turn-clock-controller | unschedule没有同一callback |
| reset保留旧snapshot | table-turn-clock-controller | 迟到tick仍产生HUD更新 |
| 接收wire不复制 | round-view-boundary | wire改rank后owned状态被改 |
| 还牌仍用贡牌文案 | table-phase-presenter | 确认贡牌≠确认还牌 |
| 普通级牌标识丢失 | card-presentation-mapper | levelCard false≠true |

6个基线入口共有1,890次原生assert调用（含循环和转译诊断），**不是1,890个独立场景**；9/9只针对上述人工挑选故障。探针在一次性子进程中拦截指定源码读取、返回变异字符串，不写产品文件，不改原测试断言。每项均因原AssertionError失败，而非编译/加载异常。

## 执行边界与后续

13个入口为table-hud-turn-timer-view、table-phase-presenter、table-progress-presentation、table-snapshot-presenter、table-turn-clock-controller、network-round-state、round-view-boundary、selection、hand-grouping、card-presentation-mapper、card-skin、fixed-match-fixtures、local-match-controller的-regression.cjs；命令、输出、文件哈希保存在JSON。

card-skin默认发现现有ignored build config并检查它，哈希为`774c02c2d9a466281bdb9f98d3b2b7e41afd3c44d66a797a663c6488b7caec1f`。没有写构建或证明包内脚本与工作树一致；上游旧素材路径缺失时原脚本跳过对应背景哈希分支，不算来源已验证。资源授权、第三方/锁文件和包体专项仍是独立未完成门槛。

UI/UX技能只用于可用性/状态反馈核对，没有改变视觉布局。新增文件均在审计目录；无业务修复、部署、推送或真实房间操作。刷新清单后进度应为535/629（85.06%），余94份第一方文件，继续剩余测试/迁移/发布脚本和依赖边界。
