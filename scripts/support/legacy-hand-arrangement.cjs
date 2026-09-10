// Frozen pre-planner selection for benchmark comparability; never shipped.
const { suggestHandGroups } = require('../../work/guandan-cocos/assets/scripts/game/HandGroupSuggestions.ts')
const { getPlayInfo } = require('../../work/guandan-cocos/assets/scripts/core/generated/index.ts')
const selectLegacySuggestions = suggestions => {
  const used = new Set(), result = []
  for (const item of suggestions) {
    if (item.kind === 'straight' || item.kind === 'pair' || item.kind === 'triple') continue
    if (item.kind === 'triple-with-pair' && (item.pairValue ?? Infinity) >= 10) continue
    if (item.cardIds.some(id => used.has(id))) continue
    result.push(item); item.cardIds.forEach(id => used.add(id))
  }
  return result
}
const legacyArrangement = (hand, profile) => {
  const picked = selectLegacySuggestions(suggestHandGroups(hand, { ruleProfile: profile }))
  const used = new Set(picked.flatMap(g => g.cardIds))
  const groups = picked.map(g => hand.filter(c => g.cardIds.includes(c.id)))
  const ranks = new Map()
  hand.filter(c => !used.has(c.id)).forEach(c => {
    const bucket = ranks.get(c.value) ?? []; bucket.push(c); ranks.set(c.value, bucket)
  })
  for (const cards of ranks.values()) {
    if (getPlayInfo(cards, profile)) groups.push(cards)
    else cards.forEach(c => groups.push([c]))
  }
  return groups.map(cards => ({ cards, resolution: getPlayInfo(cards, profile) }))
}
module.exports = { selectLegacySuggestions, legacyArrangement }
