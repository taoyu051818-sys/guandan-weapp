const assert = require('node:assert/strict')
const core = require('../dist')
const classic = core.getRuleProfile('classic')
const tournament = core.getRuleProfile('tournament')

const deck = core.createDeck(2)

const take = (suit, rank, count = 1) => {
  const matches = deck.filter(card => card.suit === suit && card.rank === rank)
  assert.equal(matches.length >= count, true, `牌堆中缺少 ${count} 张 ${suit} ${rank}`)
  return matches.slice(0, count)
}

const takeRank = (rank, count) => {
  const matches = deck.filter(card => card.rank === rank)
  assert.equal(matches.length >= count, true, `牌堆中缺少 ${count} 张 ${rank}`)
  return matches.slice(0, count)
}

const wildcard = () => {
  const card = deck.find(item => item.suit === 'heart' && item.rank === 2 && item.isRedJoker)
  assert.ok(card, '打 2 时必须存在红桃级牌逢人配')
  return card
}

const action = (cards, profile = classic) => {
  const resolution = core.resolvePlay(cards, profile)
  assert.ok(resolution, '上家牌组必须可识别')
  return { playerId: 'p2', cards, type: resolution.type, resolution }
}

const findUsage = resolution => {
  assert.equal(resolution.wildcardUsages?.length, 1, '牌组应恰好使用一张逢人配')
  return resolution.wildcardUsages[0]
}

{
  const pairWildcard = wildcard()
  const pair = core.resolvePlay([...take('diamond', 5), pairWildcard], classic)
  assert.equal(pair?.type, core.PlayType.Pair, '逢人配应能补成对子')
  assert.equal(pair?.maxValue, 5)
  assert.equal(findUsage(pair).cardId, pairWildcard.id)
  assert.equal(findUsage(pair).representedValue, 5)

  const straightWildcard = wildcard()
  const straight = core.resolvePlay([
    ...take('diamond', 3),
    ...take('club', 4),
    ...take('diamond', 6),
    ...take('diamond', 7),
    straightWildcard,
  ], classic)
  assert.equal(straight?.type, core.PlayType.Straight, '逢人配应能补成 3-7 顺子')
  assert.equal(straight?.maxValue, 7)
  assert.equal(findUsage(straight).representedValue, 5)

  const flushWildcard = wildcard()
  const straightFlushCards = [
    ...take('diamond', 3),
    ...take('diamond', 4),
    ...take('diamond', 6),
    ...take('diamond', 7),
    flushWildcard,
  ]
  const straightFlush = core.resolvePlay(straightFlushCards, classic)
  assert.equal(straightFlush?.type, core.PlayType.StraightFlush, '逢人配应能补成同花顺')
  assert.equal(straightFlush?.maxValue, 5507)
  assert.equal(findUsage(straightFlush).representedValue, 5)
  assert.equal(findUsage(straightFlush).representedSuit, 'diamond')

  const tripleWithPairWildcard = wildcard()
  const tripleWithPairCards = [
    ...take('diamond', 7),
    ...take('club', 7),
    ...take('diamond', 9),
    ...take('club', 9),
    tripleWithPairWildcard,
  ]
  const tripleWithPairInfos = core.getPlayInfos(tripleWithPairCards, classic)
    .filter(info => info.type === core.PlayType.TripleWithPair)
    .map(info => info.maxValue)
    .sort((a, b) => a - b)
  assert.deepEqual(tripleWithPairInfos, [7, 9], '逢人配应保留三带二的两种合法解释')
  const tripleWithPair = core.resolvePlay(tripleWithPairCards, classic)
  assert.equal(tripleWithPair?.type, core.PlayType.TripleWithPair)
  assert.equal(tripleWithPair?.maxValue, 9, '最终解释应选择较大的三张点数')
  assert.equal(findUsage(tripleWithPair).representedValue, 9)

  const plateWildcard = wildcard()
  const plate = core.resolvePlay([
    ...take('diamond', 3), ...take('club', 3), ...take('spade', 3),
    ...take('diamond', 4), ...take('club', 4), plateWildcard,
  ], classic)
  assert.equal(plate?.type, core.PlayType.Plate, '逢人配应能补成钢板')
  assert.equal(plate?.maxValue, 4)
  assert.equal(findUsage(plate).representedValue, 4)

  const tubeWildcard = wildcard()
  const tube = core.resolvePlay([
    ...take('diamond', 3), ...take('club', 3),
    ...take('diamond', 4), ...take('club', 4),
    ...take('diamond', 5), tubeWildcard,
  ], classic)
  assert.equal(tube?.type, core.PlayType.Tube, '逢人配应能补成三连对')
  assert.equal(tube?.maxValue, 5)
  assert.equal(findUsage(tube).representedValue, 5)

  const rocketCards = [...take('joker', 'Small', 2), ...take('joker', 'Big', 2)]
  const fourBombCards = takeRank(8, 4)
  const sixBombCards = takeRank(8, 6)
  const rocket = core.resolvePlay(rocketCards, classic)
  const fourBomb = core.resolvePlay(fourBombCards, classic)
  const sixBomb = core.resolvePlay(sixBombCards, classic)
  assert.equal(rocket?.type, core.PlayType.Rocket, '四张王必须识别为最高牌型')
  assert.equal(fourBomb?.type, core.PlayType.Bomb)
  assert.equal(fourBomb?.length, 4)
  assert.equal(sixBomb?.type, core.PlayType.Bomb)
  assert.equal(sixBomb?.length, 6)
  assert.equal(core.canPlay(rocketCards, action(sixBombCards), classic), true, '四王应压过六张炸弹')
  assert.equal(core.canPlay(straightFlushCards, action(fourBombCards), classic), true, '同花顺应压过四张炸弹')
  assert.equal(core.canPlay(fourBombCards, action(straightFlushCards), classic), false, '四张炸弹不能压过同花顺')
  assert.equal(core.canPlay(sixBombCards, action(straightFlushCards), classic), true, '六张炸弹应压过同花顺')

  const lowerPair = takeRank(4, 2)
  const higherPair = takeRank(5, 2)
  assert.equal(core.diagnosePlay(higherPair, action(lowerPair), classic).code, 'valid', '可压过的选择应明确返回 valid')
  assert.equal(core.diagnosePlay(lowerPair, action(higherPair), classic).code, 'not-high-enough', '同牌型但点数不足应明确返回 not-high-enough')
  assert.equal(core.diagnosePlay(takeRank(6, 3), action(higherPair), classic).code, 'type-mismatch', '不同普通牌型应明确返回 type-mismatch')
  assert.equal(core.diagnosePlay([take('diamond', 3)[0], take('club', 4)[0]], action(higherPair), classic).code, 'invalid-combination', '无法组成牌型时应明确返回 invalid-combination')
  assert.equal(core.diagnosePlay(higherPair, action(sixBombCards), classic).code, 'requires-bomb', '面对炸弹的普通牌应提示需要更大炸弹')
  assert.equal(core.diagnosePlay(fourBombCards, action(sixBombCards), classic).code, 'bomb-too-small', '较小炸弹应明确返回 bomb-too-small')
  assert.equal(core.diagnosePlay(sixBombCards, action(rocketCards), classic).code, 'rocket-unbeatable', '天王炸之后应明确返回不可压过')
  assert.equal(core.diagnosePlay([], action(higherPair), classic).code, 'empty', '空选择应返回 empty')

  const invalidTenToTwo = core.resolvePlay([
    ...take('diamond', 10),
    ...take('club', 'J'),
    ...take('diamond', 'Q'),
    ...take('club', 'K'),
    ...take('diamond', 2),
  ], classic)
  assert.equal(invalidTenToTwo, null, '非万能级牌 2 不能组成 10-J-Q-K-2 顺子')

  const plainLevelInStraight = core.resolvePlay([
    ...take('diamond', 2),
    ...take('club', 3),
    ...take('diamond', 4),
    ...take('club', 5),
    ...take('diamond', 6),
  ], classic)
  assert.equal(plainLevelInStraight, null, '非红桃级牌不能进入连续牌型')

  // 打 2 时普通花色 2 是级牌，无法用于 A2345；改用打 6 的语义牌验证 preset。
  const presetDeck = core.createDeck(6)
  const presetTake = (suit, rank) => {
    const card = presetDeck.find(item => item.suit === suit && item.rank === rank)
    assert.ok(card, `预设牌堆缺少 ${suit} ${rank}`)
    return card
  }
  const presetAceLow = [
    presetTake('spade', 'A'), presetTake('club', 2), presetTake('diamond', 3),
    presetTake('club', 4), presetTake('diamond', 5),
  ]
  assert.equal(core.resolvePlay(presetAceLow, classic)?.type, core.PlayType.Straight, 'classic 应允许 A2345')
  assert.equal(core.resolvePlay(presetAceLow, classic)?.maxValue, 5)

  assert.equal(core.resolvePlay(presetAceLow, tournament), null, 'tournament 应禁止 A2345')
  const naturalDiamondStraight = [
    ...take('diamond', 3), ...take('diamond', 4), ...take('diamond', 5),
    ...take('diamond', 6), ...take('diamond', 7),
  ]
  assert.equal(core.resolvePlay(naturalDiamondStraight, tournament)?.type, core.PlayType.Straight, 'tournament 中同花连续牌按普通顺子处理')
}

console.log('shared-core rules regression passed')
