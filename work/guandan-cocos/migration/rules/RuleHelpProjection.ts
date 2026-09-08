import type { RuleProfile } from '../../assets/scripts/core/generated'

export type RuleHelpPage = Readonly<{ icon: string, title: string, content: string }>

const frozenPage = (page: RuleHelpPage): RuleHelpPage => Object.freeze(page)

/** Builds help copy from the same profile consumed by validation and comparison. */
export const projectRuleHelp = (profile: RuleProfile): readonly RuleHelpPage[] => Object.freeze([
  frozenPage({
    icon: '基',
    title: '基础与目标',
    content: '四人分成两队，对面座位互为队友，使用两副牌共108张。\n每局按座位顺序轮流行动；首家可出任意合法牌型，其他玩家依次压牌或选择不出。\n一轮中其余三家都不出时，最后出牌者获得下一轮首出权。先出完手牌者为头游。',
  }),
  frozenPage({
    icon: '型',
    title: '牌型与识别',
    content: `普通牌型：单张、对子、三张；${profile.enableTripleWithPair ? '三带二可用' : '三带二关闭'}。\n连续牌型：五张顺子、三连对（连续三组对子）、钢板（连续两组三张）；${profile.allowA2345Straight ? 'A2345可作为最小顺子' : 'A2345不能组成顺子'}。\n特殊牌型：四张及以上同点数炸弹、四王炸${profile.straightFlushAsBomb ? '，以及五张同花顺' : ''}。`,
  }),
  frozenPage({
    icon: '比',
    title: '大小与压牌',
    content: `普通牌只能用相同牌型、相同张数比较，比较该牌型的主点数。\n炸弹可以压普通牌；同为炸弹时先比较张数，再比较点数。\n${profile.straightFlushAsBomb ? '同花顺按五张半炸弹比较：高于五张炸弹、低于六张及以上炸弹。' : '同花顺按普通顺子识别，不具有炸弹层级。'}\n四王炸为最高牌型。没有合法更大牌时应选择不出。`,
  }),
  frozenPage({
    icon: '配',
    title: '出牌与配合',
    content: '红桃级牌是“逢人配”，可代替除大小王外的点数，系统会显示它代表的牌。\n其他花色的级牌不能直接组成顺子、连对或钢板；一次选牌必须组成一种完整合法牌型。\n队友接近出完时应优先送出其可能接住的小牌；对手接近出完时要控制出牌权。提示只给合法候选，最终选择仍由玩家确认。',
  }),
  frozenPage({
    icon: '杯',
    title: '升级与胜负',
    content: '头游与队友包揽前二为“双下”，本队升3级；队友第三名升2级；队友末游升1级。\n下一局通常由末游向头游进贡最大合法牌，赢家还一张不高于10的牌；双下时双方各进贡一次。\n单贡方持有至少两张王可抗贡；双贡两人合计四张王，或合计至少两张大王，也可抗贡。打到A级后仍需取得至少升2级的结果才能“过A”。',
  }),
])
