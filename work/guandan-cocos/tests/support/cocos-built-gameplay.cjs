// Explicit release gate: requires a real Cocos build (no skip-if-missing path).
const assert = require('node:assert/strict')
const { createBuiltRuntime } = require('./cocos-built-runtime.cjs')
const target = process.argv[2] || 'wechatgame'
const { get } = createBuiltRuntime(target)
const rules = get('rules')
const { createDeck } = get('deck')
const { createGame } = get('engine')
const { createSeededRandom } = get('random')
const { structuralLegalMoves } = get('legalMoves')
const { rankHintMoves } = get('handHintPolicy')
const { HandWorkspace } = get('HandWorkspace')
const { LocalHandSelectionController } = get('LocalHandSelectionController')
const profile = rules.getRuleProfile('classic')
const deck = createDeck(9)
const ids = cards => Array.from(cards, card => card.id).sort()
const key = cards => ids(cards).join(',')
const own = (ranks, suit = null) => {
  const used = new Set()
  return ranks.map((rank, index) => {
    const card = deck.find(card => card.rank === rank && !used.has(card.id) &&
      card.suit === (suit || ['spade', 'club', 'diamond', 'heart'][index % 4]))
    assert.ok(card, `missing fixture card ${rank}`)
    used.add(card.id)
    return card
  })
}
const ordinary = own([3, 4, 5, 6, 7, 10, 10, 'Q'])
const classic = createGame(9, 'p1', profile, createSeededRandom(260910), 'random')
const concentrated = createGame(9, 'p1', profile, createSeededRandom(260910), 'no-shuffle')
const fixtures = [
  ['three singles', own([3, 7, 'Q'])],
  ['straight and pair', ordinary],
  ['straight with wildcard', [...own([3, 4, 5, 6]), deck.find(card => card.isRedJoker)]],
  ['double-copy straight flush', own([3, 4, 5, 6, 7, 3, 4, 5, 6, 7], 'club')],
  ['classic 27', classic.players.p1.hand],
  ['no-shuffle 27', concentrated.players.p1.hand],
  ['tribute 29', [...classic.players.p1.hand, ...classic.players.p2.hand.slice(0, 2)]],
]

// Actual artifact must not export the retired search/score API.
assert.throws(() => get('planner'), /missing built module/, 'retired whole-hand planner is absent')
assert.throws(() => get('HandArrangementJob'), /missing built module/, 'retired asynchronous planner is absent')
for (const [name, hand] of fixtures) {
  const before = JSON.stringify(hand)
  const candidates = structuralLegalMoves(hand, profile)
  assert.ok(candidates.length > 0, `${name}: built legal enumeration must not silently return zero`)
  for (const cards of candidates) assert.ok(rules.getPlayInfo(cards, profile), `${name}: illegal candidate`)

  const workspace = new HandWorkspace()
  const options = { roundId: 1, levelRank: 9, direction: 'desc', autoSort: true, ruleProfile: profile }
  workspace.syncAuthoritativeHand(hand, options)
  const baseline = Array.from(workspace.snapshot.displayCardIds)
  assert.equal(workspace.toggleArrangement({ direction: 'desc', allowAceLowStraight: profile.allowA2345Straight }), 'arranged')
  assert.equal(workspace.canRestoreArrangement, true)
  assert.deepEqual(Array.from(workspace.snapshot.displayCardIds).sort(), ids(hand))
  const handById = new Map(hand.map(card => [card.id, card]))
  for (const group of workspace.snapshot.groups.filter(group => group.origin === 'auto')) {
    assert.notEqual(group.kind, 'straight', 'ordinary straights are manual-only')
    assert.ok(rules.getPlayInfo(group.cardIds.map(id => handById.get(id)), profile), 'auto group is legal')
  }
  const arrangedIds = Array.from(workspace.snapshot.displayCardIds)
  const arrangedGroupCount = workspace.snapshot.groups.length
  assert.equal(workspace.toggleArrangement({ direction: 'desc', allowAceLowStraight: profile.allowA2345Straight }), 'restored')
  assert.deepEqual(Array.from(workspace.snapshot.displayCardIds), baseline, `${name}: restore original layout`)

  assert.equal(workspace.toggleArrangement(options), 'arranged', 'no pending/search phase')
  assert.deepEqual(Array.from(workspace.snapshot.displayCardIds), arrangedIds)
  const hints = rankHintMoves({ hand, lastPlay: null, ruleProfile: profile, protectedGroups: [] })
  assert.ok(hints.length > 0, `${name}: a lead must recommend cards`)
  for (const hint of hints) assert.ok(rules.resolvePlayForContext(hint.cards, null, profile), `${name}: hint must be legal`)
  assert.equal(JSON.stringify(hand), before, `${name}: no mutation of authoritative cards`)
  console.log(`Built ${target}: ${name} — ${candidates.length} legal candidates, ${arrangedGroupCount} groups, ${hints.length} hints`)
}

// Exercise the actual button-facing controller, including cached hint cycling,
// a changed target, locks, and a legitimate no-follow result.
const state = { ...classic, currentTurn: 'p1', roundId: 1, revision: 1,
  players: { ...classic.players, p1: { ...classic.players.p1, hand: ordinary } } }
const context = { state, humanId: 'p1', actionPending: false, phase: 'playing', tribute: null }
const selection = new LocalHandSelectionController()
const hints = rankHintMoves({ hand: ordinary, lastPlay: null, ruleProfile: profile, protectedGroups: [],
  observation: { self: 'p1', team: 'teamA', seats: Object.values(state.players).map(player =>
    ({ id: player.id, team: player.team, count: player.hand.length })), order: state.turnOrder,
  history: [], historyComplete: true, level: 9, finishedPlayers: [], roundId: 1, revision: 1 } })
const cycle = []
for (let index = 0; index <= hints.length; index++) {
  assert.match(selection.hint(context), /可出/)
  const chosen = selection.selectedCards(state, 'p1')
  assert.ok(chosen.length && rules.resolvePlayForContext(chosen, null, profile))
  cycle.push(key(chosen))
}
assert.equal(cycle[0], cycle[cycle.length - 1], 'hint cycle returns to first choice')
assert.equal(new Set(cycle.slice(0, -1)).size, hints.length)

const targetCards = own([8, 8])
state.lastValidPlay = { playerId: 'p2', cards: targetCards, ...rules.getPlayInfo(targetCards, profile) }
state.revision++
assert.match(selection.hint(context), /可出/)
assert.ok(rules.resolvePlayForContext(selection.selectedCards(state, 'p1'), state.lastValidPlay, profile))
const lock = { id: 'locked-pair', kind: 'locked', cardIds: ids(ordinary.filter(card => card.rank === 10)) }
assert.match(selection.hint(context, [lock]), /可出/)
assert.deepEqual(ids(selection.selectedCards(state, 'p1')), lock.cardIds, 'hints must select the whole locked pair')

const workspace = new HandWorkspace()
const options = { roundId: 1, levelRank: 9, direction: 'desc', autoSort: true, ruleProfile: profile }
workspace.syncAuthoritativeHand(ordinary, options)
assert.equal(workspace.applySelectionLock(lock.cardIds, profile), true)
workspace.toggleArrangement({ direction: 'desc', allowAceLowStraight: profile.allowA2345Straight })
assert.deepEqual(Array.from(workspace.lockedCardIds).sort(), lock.cardIds, 'Arrange preserves manual locks')
const remaining = ordinary.filter(card => card.rank !== 'Q')
workspace.syncAuthoritativeHand(remaining, options)
assert.deepEqual(Array.from(workspace.snapshot.displayCardIds).sort(), ids(remaining), 'replan after a played card')
assert.equal(workspace.toggleArrangement({ direction: 'desc', allowAceLowStraight: profile.allowA2345Straight }), 'fallback-restored')
assert.deepEqual(Array.from(workspace.lockedCardIds).sort(), lock.cardIds)

const rocket = deck.filter(card => card.suit === 'joker')
state.lastValidPlay = { playerId: 'p2', cards: rocket, ...rules.getPlayInfo(rocket, profile) }
state.revision++
assert.match(selection.hint(context), /不要/)
assert.equal(selection.selectedCardIds.size, 0, 'unbeatable target clears stale hint selection')

// The same built master policy is used by bots/trustees. Force its inference,
// strength and shedding-route branches instead of a trivial finish shortcut.
for (const counts of [[27, 27, 27], [2, 4, 10]]) {
  const hand = concentrated.players.p1.hand
  const view = { hand, self: 'p1', team: 'teamA', order: ['p1', 'p2', 'p3', 'p4'],
    seats: ['p1', 'p2', 'p3', 'p4'].map((id, index) => ({ id,
      team: index % 2 === 0 ? 'teamA' : 'teamB', count: index === 0 ? 27 : counts[index - 1] })),
    lastPlay: null, history: [], historyComplete: false, level: 9, profile, finishedPlayers: [] }
  const leads = () => structuralLegalMoves(hand, profile)
  const decision = get('policy').chooseTeamPlay(view, leads(), leads, createSeededRandom(42))
  assert.ok(decision.cards?.length)
  assert.ok(decision.record.sampleCount > 0 && decision.record.beliefs.length === 3)
  assert.ok(Number.isFinite(decision.record.estimatedTurns) && decision.record.strength)
  for (const candidate of decision.record.candidates) assert.ok(Number.isFinite(candidate.score))
  assert.ok(rules.resolvePlayForContext(decision.cards, null, profile))
}
console.log(`Built ${target} gameplay passed: arrangement/restore, hint cycling/follow/pass, locks and master-policy inference (rendering/native services mocked)`)

// Keep checking physical no-shuffle deals; six automatic groups is no longer
// a valid contract after the user retired automatic ordinary-straight grouping.
const levels = get('matchFormat').MATCH_LEVELS
for (let index = 0; index < levels.length; index++) {
  const hands = get('dealing').dealGameCards(levels[index], 'no-shuffle', createSeededRandom(931000 + index))
  assert.deepEqual(Object.values(hands).map(hand => hand.length), [27, 27, 27, 27])
  assert.deepEqual(ids(Object.values(hands).flat()), ids(createDeck(levels[index])))
}
console.log('Built no-shuffle: all levels preserve 108 unique physical cards, 27 per seat')
