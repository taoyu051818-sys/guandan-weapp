const steps = [
  ['游戏目标', '掼蛋由四人使用两副牌、两两配合。尽快出完手牌，争取头游，并让队友获得更好的名次。'],
  ['基本牌型', '支持单张、对子、三张、三带二、顺子、三连对、钢板、炸弹、同花顺和火箭。要用同牌型且更大的牌跟出。'],
  ['逢人配', '当前级牌的红桃是逢人配，可以替代除大小王以外的牌，帮助组成组合。'],
  ['进贡与还贡', '双下或末游的输家在下一局前交出最大牌；赢家还一张点数不高于10的牌。满足条件时可抗贡。'],
]
Page({ data: { index: 0, step: steps[0], total: steps.length }, previous() { const index = Math.max(0, this.data.index - 1); this.setData({ index, step: steps[index] }) }, next() { const index = Math.min(steps.length - 1, this.data.index + 1); this.setData({ index, step: steps[index] }) } })
