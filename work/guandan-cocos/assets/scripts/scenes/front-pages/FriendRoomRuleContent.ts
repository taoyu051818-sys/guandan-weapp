import { VARIANT_SCORE_ROWS } from '../../core/generated/lib/variantRules'

export type FriendRuleTopic = 'rounds' | 'upgrade' | 'rotating' | 'duplicate'
export type RuleSection = Readonly<{ title: string, paragraphs?: readonly string[], columns?: readonly string[], rows?: readonly (readonly string[])[] }>
export const FRIEND_RULE_TOPICS: readonly { id: FriendRuleTopic, label: string }[] = [
  { id: 'rounds', label: '定局玩法' }, { id: 'upgrade', label: '传统升级' },
  { id: 'rotating', label: '转蛋' }, { id: 'duplicate', label: '复式' },
]
const signed = (value: number): string => value > 0 ? `+${value}` : `${value}`

/** Product rules and score-table source are separate from view construction. */
export const friendRuleSections = (topic: FriendRuleTopic): readonly RuleSection[] => {
  if (topic === 'rotating') return [
    { title: '四人换队 · 个人累计积分', paragraphs: ['每局两人一队，按设置打满局数；不升级、不进贡。级牌可固定或每局随机，积分始终跟随玩家，不跟随座位或临时队伍。'] },
    { title: '队友轮换', paragraphs: ['随机抽牌：发牌前随机指定一种普通牌（不含大小王）。分别拿到两张同牌的玩家成为对家；两张都在一人手中时，原座次不变。', '顺时针轮换：首局沿用原座次；之后每局东位玩家不动，另外三人顺时针换位，更换队友和对手。'] },
    { title: '3分制 · 胜方加分，负方扣分', columns: ['胜方游次', '胜方每人', '负方每人'], rows: VARIANT_SCORE_ROWS.map(row => [row.label, signed(row.three[0]), signed(row.three[1])]) },
    { title: '6分制 · 双方均按名次得分', columns: ['胜方游次', '胜方每人', '负方每人'], rows: VARIANT_SCORE_ROWS.map(row => [row.label, `${row.six[0]}`, `${row.six[1]}`]) },
    { title: '整场结算', paragraphs: ['每局把当前队伍对应得分加到各自的个人积分。全部局数结束后按个人总分排名，同分并列；下一局重新按设置换队。'] },
  ]
  if (topic === 'duplicate') return [
    { title: '八人双桌 · 红蓝对抗', paragraphs: ['八名玩家分红、蓝两队，各四人，在A、B两张桌子同时对局。准备页可移动到空座，房主可补充机器人；八席准备后由房主开始。'] },
    { title: '相同牌序 · 公平比较', paragraphs: ['两桌对应方位拿相同的牌，两桌红蓝方位对调。默认固定打2；选择不固定时，两桌每局共同随机一个级数。不升级、不进贡。', '首局两桌由相同方位先出，后续每小局按顺时针轮换先出方位。两桌全部结束后，才能进入下一局。'] },
    { title: '每桌计分', columns: ['胜方游次', '胜方得分', '负方得分'], rows: VARIANT_SCORE_ROWS.map(row => [row.label, `${row.duplicate}`, '0']) },
    { title: '整场结算与观战', paragraphs: ['将两桌每局红、蓝队所得积分分别累计。完成约定局数后，总分高的一队获胜，同分平局。', '先结束的一桌可观看另一桌；观战不能代打。两桌都结束且八人准备后才发下一副牌，断线恢复保持原席位和积分。'] },
  ]
  if (topic === 'upgrade') return [
    { title: '从2开始，打过目标级', paragraphs: ['四人对家搭档，双方分别记录级数。可选过6、过10、过A或过A翻山；目标级必须实际打过，不能直接跳过。'] },
    { title: '升级与过关', paragraphs: ['头游和二游同队：按设置升3级或4级；头游和三游同队升2级；头游和末游同队升1级。', '己方打目标级时，需取得头游且搭档不是末游，才算过关。过A翻山：己方三次冲A未过，回到2级。'] },
    { title: '进贡与还贡', paragraphs: ['房主可选择进贡或不进贡。开启后按上局名次进入进贡、还贡流程；可选牌和抗贡由服务器按本房间规则判定。'] },
  ]
  return [
    { title: '四人定局 · 打满约定局数', paragraphs: ['四人对家搭档，每局独立计分。支持固定级牌或每局随机2至A，不需要从2一路打到A；不升级、不进贡。'] },
    { title: '计分', paragraphs: ['头游和二游同队：按设置得3分或4分；头游和三游同队得2分；头游和末游同队得1分。负方不加分。', '完成约定局数后比较两队总分，高分获胜，同分平局。大厅经典匹配为随机级牌单局，好友房局数由房主设置。'] },
    { title: '公共设置', paragraphs: ['出牌时间、托管、记牌器、一键理牌、聊天和观战以创建时的设置为准。无托管不自动倒计时代打，房间总时长限制仍有效。', '观战可设置实时或延迟；延迟由服务器执行。仅开局前可站起、坐下调整座位。'] },
  ]
}
