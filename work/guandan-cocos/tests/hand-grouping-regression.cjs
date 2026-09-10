const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const { compilerPath, loadTypeScript } = require('./support/typescript.cjs')
const arrangementPath = path.join(projectRoot, 'assets/scripts/game/HandArrangement.ts')
const arrangementModelPath = path.join(projectRoot, 'assets/scripts/game/HandArrangementModel.ts')
const displayOrderingPath = path.join(projectRoot, 'assets/scripts/game/HandDisplayOrdering.ts')
const groupSuggestionsPath = path.join(projectRoot, 'assets/scripts/game/HandGroupSuggestions.ts')
const groupingPath = path.join(projectRoot, 'assets/scripts/game/HandGrouping.ts')
const groupingStatePath = path.join(projectRoot, 'assets/scripts/game/HandGroupingState.ts')
const workspacePath = path.join(projectRoot, 'assets/scripts/game/HandWorkspace.ts')
const stackLayoutPath = path.join(projectRoot, 'assets/scripts/game/HandStackLayout.ts')

assert.equal(fs.existsSync(compilerPath), true, 'Cocos Creator TypeScript compiler is required')
const ts = loadTypeScript()

require.extensions['.ts'] = (module, filePath) => {
  const result = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
    fileName: filePath,
    reportDiagnostics: true,
  })
  const errors = (result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
  assert.deepEqual(errors, [], `failed to transpile ${filePath}`)
  module._compile(result.outputText, filePath)
}

const {
  arrangeHandGroupCardIds,
  arrangeHandCardIds,
  recognizeHandGroup,
  selectNonOverlappingSuggestions,
  sortHandDisplayUnits,
  suggestHandGroups,
} = require(arrangementPath)
const { HandGrouping } = require(groupingPath)
const { HandWorkspace } = require(workspacePath)
const { createHandStackLayout, handStackRise, STACK_EXPOSURE_HEIGHT } = require(stackLayoutPath)
const { handDisplayZone } = require(displayOrderingPath)
const { projectHandRenderModel } = require(path.join(projectRoot, 'assets/scripts/game/HandRenderProjector.ts'))
const { PlayType } = require(path.join(projectRoot, 'assets/scripts/core/generated/index.ts'))
const classicRuleProfile = Object.freeze({
  allowA2345Straight: true,
  straightFlushAsBomb: true,
  enableTripleWithPair: true,
})
const tournamentRuleProfile = Object.freeze({
  ...classicRuleProfile,
  straightFlushAsBomb: false,
})

const rankValue = rank => ({ J: 11, Q: 12, K: 13, A: 14, Small: 16, Big: 17 }[rank] ?? Number(rank))
const card = (id, rank, suit = 'spade', overrides = {}) => Object.freeze({
  id,
  rank,
  suit,
  value: rankValue(rank),
  isLevelCard: false,
  ...overrides,
})
const idSetEquals = (left, right) => {
  assert.equal(left.length, right.length)
  assert.deepEqual(new Set(left), new Set(right))
}

function verifyArrangement () {
  const hand = Object.freeze([
    card('two-spade', 2, 'spade'),
    card('ace-club', 'A', 'club'),
    card('level-heart', 7, 'heart', { value: 15, isLevelCard: true, isRedJoker: true }),
    card('level-spade', 7, 'spade', { value: 15, isLevelCard: true }),
    card('small-joker', 'Small', 'joker'),
  ])
  const original = hand.map(item => item.id)

  assert.deepEqual(
    arrangeHandCardIds(hand, { direction: 'asc', levelCards: 'back' }),
    ['two-spade', 'ace-club', 'small-joker', 'level-spade', 'level-heart'],
    'rank ascending and level-card back placement must be independent controls',
  )
  assert.deepEqual(
    arrangeHandCardIds(hand, { direction: 'desc', levelCards: 'front' }),
    ['level-spade', 'level-heart', 'small-joker', 'ace-club', 'two-spade'],
    'rank descending must support level cards at the front',
  )
  assert.deepEqual(
    arrangeHandCardIds(hand, {
      mode: 'suit',
      direction: 'asc',
      levelCards: 'natural',
      suitOrder: ['heart', 'spade', 'club', 'diamond', 'joker'],
    }),
    ['level-heart', 'two-spade', 'level-spade', 'ace-club', 'small-joker'],
    'suit mode must keep a configurable suit lane and rank order inside each lane',
  )
  assert.deepEqual(hand.map(item => item.id), original, 'presentation sorting must not mutate the rule-layer hand')

  const currentLevelHand = Object.freeze([
    card('ordinary-king', 'K', 'club'),
    card('current-level-heart', 2, 'heart'),
    card('big-joker', 'Big', 'joker'),
    card('ordinary-ace', 'A', 'spade'),
    card('current-level-spade', 2, 'spade'),
    card('small-joker-2', 'Small', 'joker'),
    card('stale-level-flag', 7, 'diamond', { value: 15, isLevelCard: true }),
  ])
  assert.deepEqual(
    arrangeHandCardIds(currentLevelHand, { direction: 'desc', levelRank: 2 }),
    [
      'big-joker',
      'small-joker-2',
      'current-level-spade',
      'current-level-heart',
      'ordinary-ace',
      'ordinary-king',
      'stale-level-flag',
    ],
    'descending rank arrangement must put the current level below jokers and above every ordinary rank',
  )
  assert.deepEqual(
    arrangeHandCardIds(currentLevelHand, { direction: 'asc', levelRank: 2 }),
    [
      'stale-level-flag',
      'ordinary-king',
      'ordinary-ace',
      'current-level-spade',
      'current-level-heart',
      'small-joker-2',
      'big-joker',
    ],
    'ascending rank arrangement must preserve the same level-card boundary in reverse',
  )
  const aceLevelHand = [
    card('ace-level-big', 'Big', 'joker'),
    card('ace-level-small', 'Small', 'joker'),
    card('ace-level-ace', 'A', 'heart'),
    card('ace-level-king', 'K', 'club'),
  ]
  assert.deepEqual(
    arrangeHandCardIds(aceLevelHand, { direction: 'desc', levelRank: 'A' }),
    ['ace-level-big', 'ace-level-small', 'ace-level-ace', 'ace-level-king'],
    'when A is level it must sit below both jokers and above K',
  )
}

function verifyLevelRankPropagation () {
  const hand = [
    card('prop-level', 3, 'heart'),
    card('prop-ace', 'A', 'spade'),
    card('prop-small-joker', 'Small', 'joker'),
  ]
  const grouping = new HandGrouping()
  grouping.syncAuthoritativeHand(hand, { levelRank: 3 })
  assert.equal(grouping.getSnapshot().arrangement.levelRank, 3)
  assert.deepEqual(
    grouping.getSnapshot().ungroupedCardIds,
    ['prop-small-joker', 'prop-level', 'prop-ace'],
    'HandGrouping must retain the authoritative level rank while reconciling newly dealt cards',
  )
}

function verifyUnifiedDisplayOrdering () {
  const ordinaryHand = [
    card('ordinary-big', 'Big', 'joker'),
    card('ordinary-small', 'Small', 'joker'),
    card('level-7-a', 7, 'spade'), card('level-7-b', 7, 'heart'),
    card('ordinary-A', 'A', 'club'),
    card('ordinary-K-a', 'K', 'spade'), card('ordinary-K-b', 'K', 'heart'), card('ordinary-K-c', 'K', 'club'),
    card('ordinary-Q-a', 'Q', 'spade'), card('ordinary-Q-b', 'Q', 'heart'),
    card('ordinary-3', 3, 'diamond'),
  ]
  const units = [
    { key: 'big', groupId: null, origin: 'single', locked: false, cardIds: ['ordinary-big'] },
    { key: 'small', groupId: null, origin: 'single', locked: false, cardIds: ['ordinary-small'] },
    { key: 'level-pair', groupId: 'level-pair', origin: 'rank', locked: false, cardIds: ['level-7-a', 'level-7-b'] },
    { key: 'ace', groupId: null, origin: 'single', locked: false, cardIds: ['ordinary-A'] },
    { key: 'king-triple', groupId: 'king-triple', origin: 'rank', locked: false, cardIds: ['ordinary-K-a', 'ordinary-K-b', 'ordinary-K-c'] },
    { key: 'queen-pair', groupId: 'queen-pair', origin: 'rank', locked: false, cardIds: ['ordinary-Q-a', 'ordinary-Q-b'] },
    { key: 'three', groupId: null, origin: 'single', locked: false, cardIds: ['ordinary-3'] },
  ]
  assert.deepEqual(
    sortHandDisplayUnits(ordinaryHand, units.slice().reverse(), classicRuleProfile, 'point-stacked', { direction: 'desc', levelRank: 7 }).map(unit => unit.key),
    ['big', 'small', 'level-pair', 'ace', 'king-triple', 'queen-pair', 'three'],
    'single, pair and triple lanes must interleave by effective rank, with level cards between jokers and A',
  )

  const aceLevelUnits = units.filter(unit => ['big', 'small', 'ace', 'king-triple'].includes(unit.key))
  assert.deepEqual(
    sortHandDisplayUnits(ordinaryHand, aceLevelUnits.slice().reverse(), classicRuleProfile, 'point-stacked', { direction: 'desc', levelRank: 'A' }).map(unit => unit.key),
    ['big', 'small', 'ace', 'king-triple'],
    'when A is level its lane must sit between both jokers and K',
  )
  const lockedMultiplicityUnits = units
    .filter(unit => ['ace', 'king-triple', 'queen-pair'].includes(unit.key))
    .map(unit => ({ ...unit, locked: unit.key !== 'ace' }))
  assert.deepEqual(
    sortHandDisplayUnits(ordinaryHand, lockedMultiplicityUnits.slice().reverse(), classicRuleProfile, 'point-stacked', { direction: 'asc', levelRank: 7 }).map(unit => unit.key),
    ['king-triple', 'queen-pair', 'ace'],
    'locked triples must precede locked pairs regardless of the ordinary point direction',
  )

  const structuredHand = [
    card('rocket-big-a', 'Big', 'joker'), card('rocket-big-b', 'Big', 'joker'),
    card('rocket-small-a', 'Small', 'joker'), card('rocket-small-b', 'Small', 'joker'),
    ...Array.from({ length: 6 }, (_, index) => card(`bomb-6-${index}`, 9, ['spade', 'heart', 'club', 'diamond'][index % 4])),
    ...[10, 'J', 'Q', 'K', 'A'].map(rank => card(`flush-${String(rank)}`, rank, 'spade')),
    ...Array.from({ length: 5 }, (_, index) => card(`bomb-5-${index}`, 8, ['spade', 'heart', 'club', 'diamond'][index % 4])),
    ...Array.from({ length: 4 }, (_, index) => card(`bomb-4-${index}`, 'K', ['spade', 'heart', 'club', 'diamond'][index])),
    ...[6, 7].flatMap(rank => Array.from({ length: 3 }, (_, index) => card(`plate-${rank}-${index}`, rank, ['spade', 'heart', 'club'][index]))),
    card('structured-A', 'A', 'diamond'),
  ]
  const structuredUnits = [
    { key: 'ordinary', groupId: null, origin: 'single', locked: false, cardIds: ['structured-A'] },
    { key: 'plate', groupId: 'plate', origin: 'auto', locked: false, cardIds: structuredHand.filter(item => item.id.startsWith('plate-')).map(item => item.id) },
    { key: 'bomb-4', groupId: 'bomb-4', origin: 'auto', locked: false, cardIds: structuredHand.filter(item => item.id.startsWith('bomb-4-')).map(item => item.id) },
    { key: 'bomb-5', groupId: 'bomb-5', origin: 'auto', locked: false, cardIds: structuredHand.filter(item => item.id.startsWith('bomb-5-')).map(item => item.id) },
    { key: 'straight-flush', groupId: 'straight-flush', origin: 'auto', locked: false, cardIds: structuredHand.filter(item => item.id.startsWith('flush-')).map(item => item.id) },
    { key: 'bomb-6', groupId: 'bomb-6', origin: 'auto', locked: false, cardIds: structuredHand.filter(item => item.id.startsWith('bomb-6-')).map(item => item.id) },
    { key: 'rocket', groupId: 'rocket', origin: 'auto', locked: false, cardIds: structuredHand.filter(item => item.id.startsWith('rocket-')).map(item => item.id) },
  ]
  assert.deepEqual(
    sortHandDisplayUnits(structuredHand, structuredUnits, classicRuleProfile, 'smart-arranged', { direction: 'desc', levelRank: 7 }).map(unit => unit.key),
    ['rocket', 'bomb-6', 'straight-flush', 'bomb-5', 'bomb-4', 'ordinary', 'plate'],
    'smart layout keeps bomb strength order left, ordinary low lanes central and structured groups right',
  )
  const lockedStructuredUnits = structuredUnits.map(unit => ({ ...unit, locked: unit.groupId !== null }))
  assert.deepEqual(
    sortHandDisplayUnits(structuredHand, lockedStructuredUnits, classicRuleProfile, 'point-stacked', { direction: 'desc', levelRank: 7 }).map(unit => unit.key),
    ['rocket', 'bomb-6', 'straight-flush', 'bomb-5', 'bomb-4', 'plate', 'ordinary'],
    'explicit locks must form a left zone ordered by shared rule strength without entering smart arrangement',
  )
  assert.deepEqual(
    sortHandDisplayUnits(structuredHand, lockedStructuredUnits, tournamentRuleProfile, 'point-stacked', { direction: 'desc', levelRank: 7 }).map(unit => unit.key),
    ['rocket', 'bomb-6', 'bomb-5', 'bomb-4', 'plate', 'straight-flush', 'ordinary'],
    'a tournament straight flush must stay in the structured locked tier instead of masquerading as a bomb',
  )

  // A real-sized 27-card hand creates the intended low central silhouette.
  const zonedHand = Object.freeze([
    ...['spade', 'heart', 'club', 'diamond'].map((suit, i) => card(`z-bomb-${i}`, 9, suit)),
    ...[3, 4, 5, 6, 7].map(rank => card(`z-flush-${rank}`, rank, 'spade')),
    ...[3, 4, 5, 6, 7].map((rank, i) => card(`z-straight-${rank}`, rank, i % 2 ? 'heart' : 'club')),
    ...[10, 'J'].flatMap(rank => ['spade', 'heart', 'club'].map((suit, i) => card(`z-plate-${rank}-${i}`, rank, suit))),
    card('z-big', 'Big', 'joker'), card('z-small', 'Small', 'joker'),
    card('z-A-1', 'A', 'club'), card('z-A-2', 'A', 'diamond'),
    card('z-K-1', 'K', 'club'), card('z-K-2', 'K', 'diamond'), card('z-Q', 'Q', 'club'),
  ])
  assert.equal(zonedHand.length, 27)
  const zoneUnit = (key, prefix, locked = false) => ({ key, groupId: key, origin: 'auto', locked, cardIds: zonedHand.filter(item => item.id.startsWith(prefix)).map(item => item.id) })
  const zonedUnits = [
    zoneUnit('bomb', 'z-bomb'), zoneUnit('flush', 'z-flush'), zoneUnit('straight', 'z-straight'), zoneUnit('plate', 'z-plate'),
    zoneUnit('ace', 'z-A', true), zoneUnit('king', 'z-K'), zoneUnit('queen', 'z-Q'), zoneUnit('big', 'z-big'), zoneUnit('small', 'z-small'),
  ]
  const before = JSON.stringify({ zonedHand, zonedUnits })
  const zonedOrder = sortHandDisplayUnits(zonedHand, zonedUnits.slice().reverse(), classicRuleProfile, 'smart-arranged', { levelRank: 2 })
  assert.deepEqual(zonedOrder.slice(0, 2).map(unit => unit.key), ['flush', 'bomb'])
  assert.deepEqual(zonedOrder.slice(-2).map(unit => unit.key), ['straight', 'plate'], 'tallest ordinary combination sits at the outer right edge')
  assert.ok(zonedOrder.slice(2, -2).every(unit => unit.cardIds.length <= 2), 'central lanes remain low even when a pair is explicitly locked')
  assert.equal(JSON.stringify({ zonedHand, zonedUnits }), before, 'zoning never mutates rule cards or lock membership')
  assert.deepEqual(sortHandDisplayUnits(zonedHand, zonedOrder, classicRuleProfile, 'smart-arranged', { levelRank: 2 }), zonedOrder, 'repeated arrangement is deterministic')
  const stack = createHandStackLayout(zonedOrder.flatMap(unit => unit.cardIds), zonedOrder.filter(unit => unit.cardIds.length > 1).map(unit => ({ id: unit.key, cardIds: unit.cardIds })), 900)
  const middleIds = new Set(zonedOrder.slice(2, -2).flatMap(unit => unit.cardIds))
  assert.ok(stack.slots.filter(slot => middleIds.has(slot.cardId)).every(slot => slot.y <= STACK_EXPOSURE_HEIGHT))
  const zonedGrouping = new HandGrouping(zonedHand, { ruleProfile: classicRuleProfile, arrangement: { levelRank: 2 } })
  zonedGrouping.autoGroup()
  const arranged = zonedGrouping.getSnapshot()
  zonedGrouping.syncAuthoritativeHand(zonedHand.slice().reverse(), { levelRank: 2 })
  assert.deepEqual(zonedGrouping.getSnapshot().displayCardIds, arranged.displayCardIds, 'server transport order cannot reshuffle zoned hand after other players act')

  const regressionHand = [
    card('regression-A', 'A', 'spade'),
    card('regression-K', 'K', 'club'),
    card('regression-5-a', 5, 'spade'),
    card('regression-5-b', 5, 'heart'),
    card('regression-3-a', 3, 'spade'),
    card('regression-3-b', 3, 'heart'),
    card('regression-3-c', 3, 'club'),
    card('regression-3-d', 3, 'diamond'),
  ]
  const grouping = new HandGrouping(regressionHand, { arrangement: { direction: 'desc', levelRank: 7 }, ruleProfile: classicRuleProfile })
  grouping.stackMatchingRanks()
  grouping.arrange({ direction: 'desc' })
  assert.deepEqual(
    grouping.getSnapshot().displayUnits.map(unit => unit.cardIds),
    [['regression-A'], ['regression-K'], ['regression-5-a', 'regression-5-b'], ['regression-3-a', 'regression-3-b', 'regression-3-c', 'regression-3-d']],
    'point-stacked mode must keep even a four-card bomb at its effective point instead of promoting it left',
  )
  assert.equal(grouping.getSnapshot().layoutMode, 'point-stacked')
  grouping.autoGroup()
  grouping.stackMatchingRanks()
  assert.equal(grouping.getSnapshot().layoutMode, 'smart-arranged')
  assert.deepEqual(grouping.getSnapshot().displayUnits[0].cardIds, ['regression-3-a', 'regression-3-b', 'regression-3-c', 'regression-3-d'])
}

function verifyOneKeyRestoreSnapshot () {
  const hand = [
    card('restore-3', 3, 'spade'),
    card('restore-4', 4, 'spade'),
    card('restore-5', 5, 'spade'),
    card('restore-6', 6, 'spade'),
    card('restore-7', 7, 'spade'),
    card('restore-A', 'A', 'heart'),
  ]
  const grouping = new HandGrouping(hand)
  const baseline = grouping.getSnapshot()
  grouping.arrange({ direction: 'asc' })
  grouping.autoGroup()
  assert.notDeepEqual(grouping.getSnapshot().displayCardIds, baseline.displayCardIds, 'one-key arrangement must change this fixture')
  assert.equal(grouping.restoreSnapshot(baseline), true)
  assert.deepEqual(grouping.getSnapshot().groups, baseline.groups)
  assert.deepEqual(grouping.getSnapshot().ungroupedCardIds, baseline.ungroupedCardIds)

  grouping.replaceHandFromServer(hand.slice(0, -1))
  assert.equal(grouping.restoreSnapshot(baseline), false, 'restore must reject a checkpoint from an older authoritative hand')
}

function verifyMatchingRankStacksAndCompleteRestore () {
  const hand = [
    card('rank-9-spade', 9, 'spade'),
    card('rank-9-heart', 9, 'heart'),
    card('rank-K-spade', 'K', 'spade'),
    card('rank-K-club', 'K', 'club'),
    card('rank-4-single', 4, 'diamond'),
  ]
  const grouping = new HandGrouping(hand)
  const untouched = grouping.getSnapshot()
  const stacked = grouping.stackMatchingRanks()
  let snapshot = grouping.getSnapshot()
  assert.equal(stacked.length, 2, 'every repeated physical rank must receive one default stack')
  assert.deepEqual(snapshot.groups.map(group => group.kind), ['rank-stack', 'rank-stack'], 'default same-rank stacks must remain editable presentation units')
  assert.deepEqual(snapshot.groups.map(group => group.cardIds), [
    ['rank-K-spade', 'rank-K-club'],
    ['rank-9-spade', 'rank-9-heart'],
  ])
  assert.deepEqual(snapshot.ungroupedCardIds, ['rank-4-single'])
  assert.equal(grouping.restoreSnapshot(untouched), true)
  assert.deepEqual(grouping.getSnapshot().displayCardIds, untouched.displayCardIds, 'restore must recover every formerly loose card')

  const originalGroupId = grouping.createLockedGroup(['rank-9-spade', 'rank-9-heart'], classicRuleProfile)
  const mixedBaseline = grouping.getSnapshot()
  grouping.arrange({ direction: 'asc' })
  grouping.stackMatchingRanks()
  snapshot = grouping.getSnapshot()
  assert.equal(snapshot.groups.length, 2)
  assert.equal(grouping.restoreSnapshot(mixedBaseline), true)
  snapshot = grouping.getSnapshot()
  assert.deepEqual(snapshot.groups.map(group => group.id), [originalGroupId], 'pre-existing groups must survive restore exactly')
  assert.deepEqual(snapshot.ungroupedCardIds, mixedBaseline.ungroupedCardIds, 'all cards outside the original group must recover their baseline order')

  grouping.replaceHandFromServer(hand.slice().reverse())
  assert.equal(grouping.restoreSnapshot(mixedBaseline), true, 'the same authoritative card set may be restored even if transport order changes')
}

function verifyWorkspaceTransactionBoundary () {
  const hand = [
    card('workspace-9-spade', 9, 'spade'),
    card('workspace-9-heart', 9, 'heart'),
    card('workspace-9-club', 9, 'club'),
    card('workspace-9-diamond', 9, 'diamond'),
    card('workspace-A', 'A', 'spade'),
    card('workspace-3', 3, 'club'),
  ]
  const workspace = new HandWorkspace()
  const syncOptions = { roundId: 1, levelRank: 2, direction: 'desc', autoSort: true, ruleProfile: classicRuleProfile }
  assert.equal(workspace.syncAuthoritativeHand(hand, syncOptions), true)
  assert.equal(workspace.syncAuthoritativeHand(hand.slice().reverse(), syncOptions), false, 'transport order alone must not reset presentation state')
  assert.deepEqual(workspace.snapshot.groups.map(group => group.kind), ['rank-stack'])
  assert.equal(workspace.snapshot.layoutMode, 'point-stacked')
  assert.deepEqual(
    workspace.snapshot.displayUnits.map(unit => unit.cardIds),
    [['workspace-A'], ['workspace-9-spade', 'workspace-9-heart', 'workspace-9-club', 'workspace-9-diamond'], ['workspace-3']],
    'an untouched four-card point stack must remain between higher and lower points',
  )

  workspace.toggleArrangement({ direction: 'desc', allowAceLowStraight: true })
  assert.equal(workspace.snapshot.groups.some(group => group.kind === 'bomb'), true, 'smart arrangement must consume editable default stacks')
  assert.equal(workspace.snapshot.layoutMode, 'smart-arranged')
  assert.deepEqual(workspace.snapshot.displayUnits[0].cardIds, ['workspace-9-spade', 'workspace-9-heart', 'workspace-9-club', 'workspace-9-diamond'])
  assert.equal(workspace.canRestoreArrangement, true)
  workspace.toggleArrangement({ direction: 'desc', allowAceLowStraight: true })
  assert.deepEqual(workspace.snapshot.groups.map(group => group.kind), ['rank-stack'], 'restore must recover the complete pre-arrangement stack state')
  assert.equal(workspace.snapshot.layoutMode, 'point-stacked')

  assert.deepEqual(workspace.getLockDecision(classicRuleProfile, ['workspace-9-spade', 'workspace-9-heart']), { kind: 'lock' })
  assert.equal(workspace.applySelectionLock(['workspace-9-spade', 'workspace-9-heart'], classicRuleProfile), true)
  const locked = workspace.snapshot.groups.find(group => group.cardIds.includes('workspace-9-spade'))
  assert.ok(locked)
  assert.notEqual(locked.kind, 'rank-stack')
  assert.equal(locked.origin, 'manual')
  assert.equal(locked.locked, true)
  assert.equal(workspace.snapshot.displayCardIds[0], 'workspace-9-spade', 'an explicit lock must move directly into the left locked zone')
  assert.equal(workspace.snapshot.displayCardIds.at(-1), 'workspace-3')

  const lockedSnapshot = JSON.parse(JSON.stringify(locked))
  workspace.toggleArrangement({ direction: 'asc', allowAceLowStraight: true })
  assert.deepEqual(
    workspace.snapshot.groups.find(group => group.id === locked.id),
    lockedSnapshot,
    'one-key arrangement must preserve an explicit locked group byte-for-byte',
  )
  workspace.toggleArrangement({ direction: 'asc', allowAceLowStraight: true })
  assert.deepEqual(workspace.snapshot.groups.find(group => group.id === locked.id), lockedSnapshot)

  assert.deepEqual(workspace.getLockDecision(classicRuleProfile, locked.cardIds), { kind: 'unlock' })
  assert.equal(workspace.applySelectionLock(locked.cardIds, classicRuleProfile), true)
  assert.equal(workspace.snapshot.displayCardIds[0], 'workspace-A', 'unlocking must return released cards to point-stacked rank order')
}

function verifyLockChangesStayIndependentFromArrangementRestore () {
  const hand = [
    card('independent-A', 'A', 'spade'),
    card('independent-Q-a', 'Q', 'spade'),
    card('independent-Q-b', 'Q', 'heart'),
    card('independent-3-a', 3, 'spade'),
    card('independent-3-b', 3, 'heart'),
    card('independent-3-c', 3, 'club'),
    card('independent-3-d', 3, 'diamond'),
    card('independent-2', 2, 'club'),
  ]
  const workspace = new HandWorkspace()
  workspace.syncAuthoritativeHand(hand, {
    roundId: 8,
    levelRank: 2,
    direction: 'desc',
    autoSort: true,
    ruleProfile: classicRuleProfile,
  })
  workspace.syncAuthoritativeHand(hand.filter(item => item.id !== 'independent-2'), {
    roundId: 8,
    levelRank: 2,
    direction: 'desc',
    autoSort: true,
    ruleProfile: classicRuleProfile,
  })
  assert.deepEqual(
    workspace.snapshot.displayUnits.map(unit => unit.cardIds),
    [
      ['independent-A'],
      ['independent-Q-a', 'independent-Q-b'],
      ['independent-3-a', 'independent-3-b', 'independent-3-c', 'independent-3-d'],
    ],
    'an authoritative hand update must not promote an existing four-card point stack before smart arrangement',
  )
  workspace.toggleArrangement({ direction: 'desc', allowAceLowStraight: true })
  assert.equal(workspace.snapshot.layoutMode, 'smart-arranged')

  assert.equal(workspace.applySelectionLock(['independent-Q-a', 'independent-Q-b'], classicRuleProfile), true)
  const lockedPair = workspace.snapshot.groups.find(group => group.cardIds.includes('independent-Q-a'))
  assert.ok(lockedPair?.locked, 'a lock created during smart arrangement must persist independently')

  assert.equal(
    workspace.toggleArrangement({ direction: 'desc', allowAceLowStraight: true }),
    'fallback-restored',
    'changing lock membership invalidates only the old layout checkpoint',
  )
  assert.equal(workspace.snapshot.layoutMode, 'point-stacked')
  assert.deepEqual(workspace.snapshot.groups.find(group => group.id === lockedPair.id), lockedPair)
  assert.deepEqual(
    workspace.snapshot.displayUnits.map(unit => unit.cardIds),
    [
      ['independent-Q-a', 'independent-Q-b'],
      ['independent-A'],
      ['independent-3-a', 'independent-3-b', 'independent-3-c', 'independent-3-d'],
    ],
    'fallback restore must keep the locked zone left while returning every other card to point stacks',
  )
}

function verifyRankStacksReconcileAndUnlock () {
  const initialHand = [
    card('merge-A', 'A', 'spade'),
    card('merge-Q-a', 'Q', 'spade'),
    card('merge-Q-b', 'Q', 'heart'),
    card('merge-3', 3, 'club'),
  ]
  const syncOptions = {
    roundId: 11,
    levelRank: 2,
    direction: 'desc',
    autoSort: true,
    ruleProfile: classicRuleProfile,
  }
  const workspace = new HandWorkspace()
  workspace.syncAuthoritativeHand(initialHand, syncOptions)
  const originalRankStack = workspace.snapshot.groups.find(group => group.origin === 'rank')
  assert.ok(originalRankStack)

  workspace.syncAuthoritativeHand(initialHand.concat(
    card('merge-Q-c', 'Q', 'club'),
    card('merge-Q-d', 'Q', 'diamond'),
  ), syncOptions)
  let qStacks = workspace.snapshot.groups.filter(group =>
    group.origin === 'rank' && group.cardIds.some(cardId => cardId.startsWith('merge-Q-')),
  )
  assert.equal(qStacks.length, 1, 'new cards of an existing physical rank must merge into one presentation lane')
  assert.equal(qStacks[0].id, originalRankStack.id, 'reconciling a rank lane should preserve its stable group id')
  idSetEquals(qStacks[0].cardIds, ['merge-Q-a', 'merge-Q-b', 'merge-Q-c', 'merge-Q-d'])

  assert.equal(workspace.applySelectionLock(['merge-Q-a', 'merge-Q-b'], classicRuleProfile), true)
  const lockedPair = workspace.snapshot.groups.find(group => group.locked && group.cardIds.includes('merge-Q-a'))
  assert.ok(lockedPair)
  const unlockedPairStack = workspace.snapshot.groups.find(group =>
    group.origin === 'rank' && group.cardIds.includes('merge-Q-c'),
  )
  assert.ok(unlockedPairStack, 'locking part of a rank lane must restack the remaining same-rank cards')
  idSetEquals(unlockedPairStack.cardIds, ['merge-Q-c', 'merge-Q-d'])
  assert.equal(workspace.applySelectionLock(['merge-Q-a', 'merge-Q-b'], classicRuleProfile), true)

  qStacks = workspace.snapshot.groups.filter(group =>
    group.origin === 'rank' && group.cardIds.some(cardId => cardId.startsWith('merge-Q-')),
  )
  assert.equal(qStacks.length, 1, 'unlocking a group must immediately rebuild one physical-rank lane')
  idSetEquals(qStacks[0].cardIds, ['merge-Q-a', 'merge-Q-b', 'merge-Q-c', 'merge-Q-d'])
  assert.equal(workspace.lockedCardIds.length, 0)
}

function verifySmartArrangementRecomputesAfterAuthorityChange () {
  const initialHand = [
    card('recompute-A', 'A', 'spade'),
    card('recompute-3-a', 3, 'spade'),
    card('recompute-3-b', 3, 'heart'),
    card('recompute-3-c', 3, 'club'),
    card('recompute-3-d', 3, 'diamond'),
    card('recompute-5-a', 5, 'spade'),
    card('recompute-5-b', 5, 'heart'),
    card('recompute-5-c', 5, 'club'),
  ]
  const syncOptions = {
    roundId: 12,
    levelRank: 2,
    direction: 'desc',
    autoSort: true,
    ruleProfile: classicRuleProfile,
  }
  const workspace = new HandWorkspace()
  workspace.syncAuthoritativeHand(initialHand, syncOptions)
  workspace.toggleArrangement({ direction: 'desc', allowAceLowStraight: true })
  assert.equal(
    workspace.snapshot.groups.some(group => group.origin === 'auto' && group.kind === 'bomb' && group.cardIds.every(cardId => cardId.startsWith('recompute-3-'))),
    true,
  )

  const changedHand = initialHand
    .filter(item => item.id !== 'recompute-3-d')
    .concat(card('recompute-5-d', 5, 'diamond'))
  workspace.syncAuthoritativeHand(changedHand, syncOptions)
  assert.equal(workspace.snapshot.layoutMode, 'smart-arranged')
  assert.equal(workspace.canRestoreArrangement, true)
  assert.equal(
    workspace.snapshot.groups.some(group => group.origin === 'auto' && group.kind === 'bomb' && group.cardIds.every(cardId => cardId.startsWith('recompute-5-'))),
    true,
    'smart arrangement must recompute current legal groups after an authoritative hand change',
  )
  assert.equal(
    workspace.snapshot.groups.some(group => group.kind === 'bomb' && group.cardIds.some(cardId => cardId.startsWith('recompute-3-'))),
    false,
    'smart arrangement must discard a combination invalidated by the authoritative hand',
  )
}

function verifySmartUnlockReprojectsTheLayout () {
  const hand = [
    card('unlock-smart-A', 'A', 'spade'),
    card('unlock-smart-K', 'K', 'club'),
    card('unlock-smart-3', 3, 'heart'),
    card('unlock-smart-4', 4, 'heart'),
    card('unlock-smart-5', 5, 'heart'),
    card('unlock-smart-6', 6, 'heart'),
    card('unlock-smart-7', 7, 'heart'),
  ]
  const workspace = new HandWorkspace()
  workspace.syncAuthoritativeHand(hand, {
    roundId: 13,
    levelRank: 2,
    direction: 'desc',
    autoSort: true,
    ruleProfile: classicRuleProfile,
  })
  const flushIds = workspace.straightFlushCardIds('heart')
  assert.equal(flushIds.length, 5)
  assert.equal(workspace.applySelectionLock(flushIds, classicRuleProfile), true)
  assert.equal(workspace.lockedCardIds.length, 5)
  workspace.toggleArrangement({ direction: 'desc', allowAceLowStraight: true })

  assert.equal(workspace.applySelectionLock(flushIds, classicRuleProfile), true)
  const snapshot = workspace.snapshot
  assert.equal(snapshot.layoutMode, 'smart-arranged')
  assert.equal(workspace.lockedCardIds.length, 0, 'unlocking must remove persistent lock ownership')
  assert.equal(snapshot.displayUnits[0].origin, 'auto')
  assert.equal(snapshot.groups[0].kind, 'straight-flush')
  assert.equal(snapshot.groups[0].locked, false, 'smart recognition after unlock must remain recomputable')
  idSetEquals(snapshot.groups[0].cardIds, ['unlock-smart-3', 'unlock-smart-4', 'unlock-smart-5', 'unlock-smart-6', 'unlock-smart-7'])
}

function verifySuggestions () {
  const straightFlush = [3, 4, 5, 6, 7].map(rank => card(`sf-${rank}`, rank, 'heart'))
  const bomb = ['a', 'b', 'c', 'd'].map(suffix => card(`bomb-${suffix}`, 9, suffix === 'a' ? 'spade' : suffix === 'b' ? 'heart' : suffix === 'c' ? 'club' : 'diamond'))
  const plate = [
    card('plate-10-a', 10, 'spade'), card('plate-10-b', 10, 'heart'), card('plate-10-c', 10, 'club'),
    card('plate-J-a', 'J', 'spade'), card('plate-J-b', 'J', 'heart'), card('plate-J-c', 'J', 'club'),
  ]
  const tube = [2, 3, 4].flatMap(rank => [card(`tube-${rank}-a`, rank, 'spade'), card(`tube-${rank}-b`, rank, 'club')])
  const triplePair = [
    card('tp-Q-a', 'Q', 'spade'), card('tp-Q-b', 'Q', 'heart'), card('tp-Q-c', 'Q', 'club'),
    card('tp-K-a', 'K', 'spade'), card('tp-K-b', 'K', 'heart'),
  ]
  const hand = Object.freeze(straightFlush.concat(bomb, plate, tube, triplePair))
  const before = JSON.stringify(hand)
  const suggestions = suggestHandGroups(hand)

  const expectExact = (kind, expectedIds, candidates = suggestions) => {
    const found = candidates.find(suggestion => suggestion.kind === kind &&
      suggestion.cardIds.length === expectedIds.length &&
      expectedIds.every(id => suggestion.cardIds.includes(id)))
    assert.ok(found, `missing ${kind} suggestion for ${expectedIds.join(',')}`)
    return found
  }
  expectExact('straight-flush', straightFlush.map(item => item.id))
  expectExact('bomb', bomb.map(item => item.id))
  expectExact('plate', plate.map(item => item.id))
  expectExact('tube', tube.map(item => item.id), suggestHandGroups(tube))
  const recognizedTriplePair = expectExact('triple-with-pair', triplePair.map(item => item.id))
  assert.equal(recognizeHandGroup(hand, triplePair.map(item => item.id)).kind, 'triple-with-pair')
  assert.equal(recognizeHandGroup(hand, [triplePair[0].id, triplePair[1].id]), null, 'an ordinary pair is not a smart compound group')
  assert.equal(JSON.stringify(hand), before, 'suggestion generation must be side-effect free')

  const chosen = selectNonOverlappingSuggestions(suggestions)
  const chosenIds = chosen.flatMap(suggestion => suggestion.cardIds)
  assert.equal(new Set(chosenIds).size, chosenIds.length, 'automatic suggestions must assign a cardId at most once')
  assert.ok(recognizedTriplePair.priority > 0)

  const wildcard = card('wild-level', 7, 'heart', { value: 15, isLevelCard: true, isRedJoker: true })
  const wildcardHand = [
    card('wild-sf-5', 5, 'spade'),
    card('wild-sf-6', 6, 'spade'),
    wildcard,
    card('wild-sf-8', 8, 'spade'),
    card('wild-sf-9', 9, 'spade'),
  ]
  const wildcardFlush = suggestHandGroups(wildcardHand).find(suggestion =>
    suggestion.kind === 'straight-flush' && suggestion.primaryValue === 9 && suggestion.cardIds.length === 5)
  assert.ok(wildcardFlush, 'a red-heart level wildcard must be able to complete a straight flush suggestion')
  assert.deepEqual(wildcardFlush.wildcardUsages, [{ cardId: 'wild-level', representedValue: 7, representedSuit: 'spade' }])

  const naturalBombWithWildcard = bomb.concat(wildcard)
  const preferredBomb = selectNonOverlappingSuggestions(suggestHandGroups(naturalBombWithWildcard))
    .find(suggestion => suggestion.kind === 'bomb')
  assert.ok(preferredBomb)
  assert.equal(preferredBomb.wildcardUsages.length, 0, 'automatic grouping must not waste a wildcard on an already complete natural bomb')

  const jokerPairWithWildcards = [card('small-a', 'Small', 'joker'), card('small-b', 'Small', 'joker'), wildcard,
    card('wild-level-2', 7, 'heart', { value: 15, isLevelCard: true, isRedJoker: true })]
  assert.equal(
    suggestHandGroups(jokerPairWithWildcards).some(suggestion => suggestion.kind === 'bomb'),
    false,
    'wildcards must never be suggested as additional small/big jokers',
  )

  const conflictWildcard = card('conflict-wild', 7, 'heart', { value: 15, isLevelCard: true, isRedJoker: true })
  const wildcardConflictHand = [
    card('conflict-s5', 5, 'spade'),
    card('conflict-s6', 6, 'spade'),
    conflictWildcard,
    card('conflict-s8', 8, 'spade'),
    card('conflict-s9', 9, 'spade'),
    card('conflict-h9', 9, 'heart'),
    card('conflict-c9', 9, 'club'),
  ]
  const conflictSuggestions = suggestHandGroups(wildcardConflictHand)
  const conflictFlush = conflictSuggestions.find(suggestion => suggestion.kind === 'straight-flush' &&
    suggestion.wildcardUsages.some(usage => usage.cardId === conflictWildcard.id))
  const conflictBomb = conflictSuggestions.find(suggestion => suggestion.kind === 'bomb' &&
    suggestion.wildcardUsages.some(usage => usage.cardId === conflictWildcard.id))
  assert.ok(conflictFlush && conflictBomb, 'the shared wildcard must produce both competing candidates')
  assert.ok(
    conflictSuggestions.indexOf(conflictFlush) < conflictSuggestions.indexOf(conflictBomb),
    'shared rule strength must rank a straight flush above a four-card bomb',
  )
  const selectedConflict = selectNonOverlappingSuggestions(conflictSuggestions)
  assert.equal(selectedConflict[0]?.key, conflictFlush.key, 'smart grouping must spend the conflicting wildcard on the stronger straight flush')
  assert.equal(selectedConflict.some(suggestion => suggestion.key === conflictBomb.key), false)
  assert.deepEqual(
    selectNonOverlappingSuggestions(suggestHandGroups(wildcardConflictHand.slice().reverse())),
    selectedConflict,
    'wildcard conflict resolution must not depend on authoritative hand order',
  )

  const tournamentConflictSuggestions = suggestHandGroups(wildcardConflictHand, {
    allowAceLowStraight: tournamentRuleProfile.allowA2345Straight,
    ruleProfile: tournamentRuleProfile,
  })
  const tournamentConflict = selectNonOverlappingSuggestions(tournamentConflictSuggestions, tournamentRuleProfile)
  assert.equal(
    tournamentConflict[0]?.kind,
    'bomb',
    'a tournament straight flush is an ordinary straight and must not outrank a conflicting bomb',
  )
  const tournamentGrouping = new HandGrouping(wildcardConflictHand, { ruleProfile: tournamentRuleProfile })
  assert.equal(
    tournamentGrouping.autoGroup({ allowAceLowStraight: tournamentRuleProfile.allowA2345Straight })[0]?.kind,
    'bomb',
    'automatic grouping must use the rule profile owned by HandGrouping',
  )

  const secondConflictWildcard = card('conflict-wild-2', 7, 'heart', { value: 15, isLevelCard: true, isRedJoker: true })
  const naturalBombConflictHand = wildcardConflictHand
    .concat(secondConflictWildcard, card('conflict-d9', 9, 'diamond'))
  const naturalConflictSuggestions = suggestHandGroups(naturalBombConflictHand)
  const naturalBombCandidates = naturalConflictSuggestions.filter(suggestion =>
    suggestion.kind === 'bomb' && suggestion.primaryValue === 9)
  assert.equal(naturalBombCandidates.length, 1, 'a complete natural bomb must suppress wildcard-extended dominated variants')
  assert.equal(naturalBombCandidates[0].cardIds.length, 4)
  assert.equal(naturalBombCandidates[0].wildcardUsages.length, 0)
  const naturalConflictFlush = naturalConflictSuggestions.find(suggestion => suggestion.kind === 'straight-flush')
  assert.ok(naturalConflictFlush)
  assert.ok(
    naturalConflictSuggestions.indexOf(naturalConflictFlush) < naturalConflictSuggestions.indexOf(naturalBombCandidates[0]),
    'the filtered bomb-family order must still put a straight flush above the overlapping natural four-bomb',
  )
  assert.deepEqual(
    selectNonOverlappingSuggestions(suggestHandGroups(naturalBombConflictHand.slice().reverse())),
    selectNonOverlappingSuggestions(naturalConflictSuggestions),
    'natural-bomb and two-wildcard conflicts must remain stable under reversed input',
  )

  const strengthOrderHand = [
    card('strength-small-a', 'Small', 'joker'), card('strength-small-b', 'Small', 'joker'),
    card('strength-big-a', 'Big', 'joker'), card('strength-big-b', 'Big', 'joker'),
    ...['a', 'b', 'c', 'd', 'e', 'f'].map((suffix, index) =>
      card(`strength-Q-${suffix}`, 'Q', ['spade', 'heart', 'club', 'diamond'][index % 4])),
    ...[2, 3, 4, 5, 6].map(rank => card(`strength-flush-${rank}`, rank, 'heart')),
  ]
  const strengthOrder = suggestHandGroups(strengthOrderHand)
  const kingBombIndex = strengthOrder.findIndex(suggestion => suggestion.kind === 'king-bomb')
  const sixBombIndex = strengthOrder.findIndex(suggestion => suggestion.kind === 'bomb' && suggestion.cardIds.length === 6)
  const straightFlushIndex = strengthOrder.findIndex(suggestion => suggestion.kind === 'straight-flush')
  const fiveBombIndex = strengthOrder.findIndex(suggestion => suggestion.kind === 'bomb' && suggestion.cardIds.length === 5)
  assert.ok(
    kingBombIndex < sixBombIndex && sixBombIndex < straightFlushIndex && straightFlushIndex < fiveBombIndex,
    'bomb-family suggestions must retain rocket > 6+ bomb > straight flush > 4/5 bomb ordering',
  )
}

function verifyGroupingLifecycle () {
  const ruleHand = [
    card('a', 2, 'spade'), card('b', 2, 'heart'), card('c', 5, 'spade'),
    card('d', 5, 'heart'), card('e', 'K'), card('f', 'A'),
  ]
  const originalRuleOrder = ruleHand.map(item => item.id)
  const grouping = new HandGrouping(ruleHand, { arrangement: { direction: 'asc', levelCards: 'natural' } })

  const first = grouping.createLockedGroup(['a', 'b'], classicRuleProfile, 0)
  const second = grouping.createLockedGroup(['c', 'd'], classicRuleProfile, 1)
  assert.deepEqual(grouping.getSnapshot().groups.map(group => group.id), [first, second])
  grouping.moveGroup(second, first)
  assert.deepEqual(grouping.getSnapshot().groups.map(group => group.id), [second, first], 'whole groups may be reordered without changing locked membership')


  assert.equal(grouping.splitGroup(second), true)
  assert.equal(grouping.getSnapshot().groups.some(group => group.id === second), false, 'split must return every group card to the ungrouped lane')
  assert.equal(grouping.restoreDefault(), true)
  assert.equal(grouping.getSnapshot().groups.length, 0)
  assert.deepEqual(grouping.getSnapshot().ungroupedCardIds, ['a', 'b', 'c', 'd', 'e', 'f'])
  assert.deepEqual(ruleHand.map(item => item.id), originalRuleOrder, 'manual grouping must never reorder rule-layer cards')

  grouping.restoreDefault()
  const serverGroup = grouping.createLockedGroup(['a', 'b'], classicRuleProfile)
  grouping.syncAuthoritativeHand(ruleHand.filter(item => item.id !== 'b'))
  let snapshot = grouping.getSnapshot()
  assert.equal(snapshot.displayCardIds.includes('b'), false, 'a played cardId must disappear from every presentation lane')
  assert.equal(snapshot.groups.some(group => group.id === serverGroup), false, 'a changed manual lock must release every survivor')
  assert.equal(snapshot.ungroupedCardIds.includes('a') && snapshot.ungroupedCardIds.includes('c'), true)
  assert.equal(grouping.isCardLocked('a'), false)

  grouping.replaceHandFromServer(ruleHand.filter(item => !['b', 'c'].includes(item.id)).concat(card('new-card', 3, 'diamond')))
  snapshot = grouping.getSnapshot()
  assert.equal(snapshot.groups.some(group => group.id === serverGroup), false, 'a group with fewer than two remaining cards must dissolve')
  assert.equal(snapshot.ungroupedCardIds.includes('new-card'), true, 'newly dealt server cards must join the ungrouped order')
  assert.equal(new Set(snapshot.displayCardIds).size, snapshot.displayCardIds.length)
  idSetEquals(snapshot.displayCardIds, snapshot.handCardIds)
}


function verifyAutoGrouping () {
  const hand = [
    card('auto-3-a', 3, 'spade'), card('auto-3-b', 3, 'heart'), card('auto-3-c', 3, 'club'), card('auto-3-d', 3, 'diamond'),
    card('auto-5', 5), card('auto-7', 7),
  ]
  const grouping = new HandGrouping(hand)
  const applied = grouping.autoGroup()
  const snapshot = grouping.getSnapshot()
  assert.equal(applied.some(suggestion => suggestion.kind === 'bomb'), true)
  assert.equal(snapshot.groups.some(group => group.kind === 'bomb'), true)
  assert.equal(new Set(snapshot.displayCardIds).size, hand.length)
  idSetEquals(snapshot.displayCardIds, hand.map(item => item.id))
}

function verifyLockedGroupsSurviveArrangement () {
  const straightFlush = [2, 3, 4, 5, 6].map(rank => card(`locked-club-${rank}`, rank, 'club'))
  const looseBomb = [
    card('loose-nine-spade', 9, 'spade'),
    card('loose-nine-heart', 9, 'heart'),
    card('loose-nine-club', 9, 'club'),
    card('loose-nine-diamond', 9, 'diamond'),
  ]
  const hand = straightFlush.concat([
    card('manual-K-heart', 'K', 'heart'),
    card('manual-K-spade', 'K', 'spade'),
    ...looseBomb,
    card('loose-A', 'A', 'spade'),
    card('loose-4', 4, 'heart'),
  ])
  const grouping = new HandGrouping(hand)
  const straightFlushGroupId = grouping.lockStraightFlush('club')
  const manualGroupId = grouping.createLockedGroup(['manual-K-heart', 'manual-K-spade'], classicRuleProfile)
  assert.ok(straightFlushGroupId)

  const lockedBefore = grouping.getSnapshot().groups
  assert.deepEqual(lockedBefore.map(group => group.id), [straightFlushGroupId, manualGroupId])
  assert.deepEqual(lockedBefore.map(group => group.kind), ['straight-flush', 'manual'])

  const arrangement = {
    mode: 'suit',
    direction: 'asc',
    levelCards: 'natural',
    suitOrder: ['diamond', 'club', 'heart', 'spade', 'joker'],
  }
  assert.equal(grouping.arrange(arrangement), true)
  let snapshot = grouping.getSnapshot()
  for (const previous of lockedBefore) {
    const current = snapshot.groups.find(group => group.id === previous.id)
    assert.ok(current, 'arrange must retain every explicit lock')
    assert.equal(current.locked, true)
    assert.equal(current.origin, 'manual')
    idSetEquals(current.cardIds, previous.cardIds)
  }
  assert.equal(snapshot.layoutMode, 'point-stacked')
  assert.equal(snapshot.groups[0].id, straightFlushGroupId, 'basic suit sorting must use the configured suit anchor without switching to smart mode')

  const lockedCardIds = new Set(lockedBefore.flatMap(group => group.cardIds))
  const expectedLooseOrder = arrangeHandCardIds(hand, arrangement).filter(cardId => !lockedCardIds.has(cardId))
  assert.deepEqual(snapshot.ungroupedCardIds, expectedLooseOrder, 'arrange must still sort every loose card')

  const looseBeforeAutoGroup = new Set(snapshot.ungroupedCardIds)
  const applied = grouping.autoGroup()
  snapshot = grouping.getSnapshot()
  assert.equal(snapshot.layoutMode, 'smart-arranged')
  assert.equal(snapshot.groups[0].id, straightFlushGroupId, 'smart arrangement may promote a protected large combination by rule strength')
  assert.equal(applied.some(suggestion => suggestion.kind === 'bomb'), true, 'auto-group must still recognize patterns in loose cards')
  assert.equal(
    applied.every(suggestion => suggestion.cardIds.every(cardId => looseBeforeAutoGroup.has(cardId))),
    true,
    'auto-group suggestions must never consume a card from a locked group',
  )
  assert.equal(snapshot.groups.find(group => group.id === straightFlushGroupId)?.locked, true)
  assert.equal(snapshot.groups.find(group => group.id === manualGroupId)?.locked, true)
  const autoGroups = snapshot.groups.filter(group => group.origin === 'auto')
  assert.equal(autoGroups.length > 0, true)
  assert.equal(autoGroups.every(group => group.locked === false), true, 'smart grouping must remain recomputable rather than becoming a lock')

  const newlyGrouped = new Set(applied.flatMap(suggestion => suggestion.cardIds))
  assert.deepEqual(
    snapshot.ungroupedCardIds,
    expectedLooseOrder.filter(cardId => !newlyGrouped.has(cardId)),
    'only newly recognized loose cards may leave the ungrouped lane',
  )
  idSetEquals(snapshot.displayCardIds, hand.map(item => item.id))

  const secondPass = grouping.autoGroup()
  assert.equal(secondPass.some(suggestion => suggestion.kind === 'bomb'), true, 'a second pass must deterministically recompute unlocked smart groups')
  const afterSecondPass = grouping.getSnapshot()
  assert.equal(afterSecondPass.groups.filter(group => group.origin === 'manual').length, 2)
  assert.equal(afterSecondPass.groups.filter(group => group.origin === 'auto').every(group => group.locked === false), true)
  idSetEquals(afterSecondPass.displayCardIds, hand.map(item => item.id))
}

function verifyDownwardStackLayout () {
  const display = ['g-a', 'g-b', 'g-c', 'loose-a', 'pair-a', 'pair-b', 'loose-b']
  const layout = createHandStackLayout(display, [
    { id: 'triple', cardIds: ['g-a', 'g-b', 'g-c'] },
    { id: 'pair', cardIds: ['pair-a', 'pair-b'] },
  ], 680)
  const triple = layout.slots.filter(slot => slot.stackId === 'triple')
  assert.deepEqual(triple.map(slot => slot.x), [triple[0].x, triple[0].x, triple[0].x], 'one arranged group must consume one horizontal lane')
  assert.ok(triple[0].y > triple[1].y && triple[1].y > triple[2].y, 'cards in an arranged group must cascade downward')
  assert.equal(triple[2].y, 0, 'the final full card must remain on the normal hand baseline')
  assert.equal(triple.every(slot => slot.stackStep === STACK_EXPOSURE_HEIGHT), true, 'every covered card must expose one fixed point strip')
  assert.equal(layout.laneCount, 4, 'two groups and two loose cards must use four horizontal lanes')
  assert.equal(layout.maxRise, handStackRise(3))
  assert.deepEqual(layout.slots.map(slot => slot.cardId), display, 'layout must preserve the presentation card-id order')

  const huge = createHandStackLayout(
    Array.from({ length: 10 }, (_, index) => `bomb-${index}`),
    [{ id: 'large-bomb', cardIds: Array.from({ length: 10 }, (_, index) => `bomb-${index}`) }],
    680,
  )
  assert.equal(huge.maxRise, STACK_EXPOSURE_HEIGHT * 9, 'large stacks must retain the same exposure instead of being compressed')
  assert.deepEqual(
    huge.slots.slice(0, -1).map((slot, index) => slot.y - huge.slots[index + 1].y),
    Array(9).fill(STACK_EXPOSURE_HEIGHT),
    'every adjacent card, including joker ids, must use one identical pixel step',
  )
  assert.equal(new Set(huge.slots.map(slot => slot.cardId)).size, 10)

  const mixedFaces = createHandStackLayout(
    ['normal', 'small-joker', 'big-joker'],
    [{ id: 'mixed-faces', cardIds: ['normal', 'small-joker', 'big-joker'] }],
    680,
  )
  assert.deepEqual(mixedFaces.slots.map(slot => slot.stackStep), [40, 40, 40], 'normal cards and both jokers share the same stack geometry')
}

function verifyCompactGroupGeometry () {
  const make = (left, centre, right, width = 940) => {
    const groups = []
    const display = []
    for (const [zone, count] of [[0, left], [1, centre], [2, right]]) {
      for (let index = 0; index < count; index += 1) {
        const ids = Array.from({ length: zone === 0 ? 4 : zone === 2 ? 5 : 1 }, (_, cardIndex) => `${zone}-${index}-${cardIndex}`)
        display.push(...ids)
        if (ids.length > 1) groups.push({ id: `${zone}-${index}`, zone, cardIds: ids })
      }
    }
    return { groups, display, layout: createHandStackLayout(display, groups, width) }
  }
  for (const width of [280, 640, 940]) {
    for (const [left, centre, right] of [[1, 0, 0], [0, 0, 1], [3, 0, 3], [6, 3, 0], [0, 2, 5], [1, 18, 1], [0, 27, 0], [0, 1, 0], [0, 0, 0]]) {
      const { display, layout } = make(left, centre, right, width)
      assert.deepEqual(layout.slots.map(slot => slot.cardId), display, 'compact geometry never reorders or loses physical cards')
      const lanes = layout.slots.filter(slot => slot.stackIndex === 0)
      const expectedSpacing = lanes.length <= 1 ? 0 : Math.min(68, width / (lanes.length - 1))
      lanes.forEach((lane, index) => {
        assert.ok(Math.abs(lane.x - (index - (lanes.length - 1) / 2) * expectedSpacing) < 1e-8, 'all categories share one content-sized centred pack')
        assert.ok(Number.isFinite(lane.x) && Math.abs(lane.x) <= width / 2 + 1e-8, 'each centre stays inside the hand width')
        if (index < lanes.length - 1) {
          assert.ok(lane.x < lanes[index + 1].x, 'manual/display order and hit order remain monotonic')
          assert.equal(lane.nextLaneSpacing, lanes[index + 1].x - lane.x, 'hit projection uses the actual neighbouring slot')
        }
      })
      layout.slots.filter(slot => slot.stackSize > 1).forEach(slot => assert.equal(slot.stackStep, 40))
    }
  }
  const split = make(1, 0, 1)
  assert.equal(split.layout.slots[0].nextLaneSpacing, 68, 'bomb and combination are neighbours without a forced central gap')
  assert.deepEqual(split.layout.slots.filter(slot => slot.stackIndex === 0).map(slot => slot.x), [-34, 34])
  for (const remaining of split.groups) {
    const afterPlay = createHandStackLayout(remaining.cardIds, split.groups, 940)
    assert.ok(afterPlay.slots.every(slot => slot.x === 0), 'after either side is played, the remaining tall group moves to the centre')
    const partial = createHandStackLayout(remaining.cardIds.slice(1), split.groups, 940)
    assert.ok(partial.slots.every(slot => slot.x === 0), 'partial group removal stays centred and preserves downward stacking')
    const last = createHandStackLayout(remaining.cardIds.slice(-1), split.groups, 940)
    assert.equal(last.slots[0].x, 0, 'a stale group reduced to one card does not reserve a side zone')
  }
  const packWithSingle = make(1, 1, 1)
  const withoutSingle = createHandStackLayout(packWithSingle.groups.flatMap(group => group.cardIds), packWithSingle.groups, 940)
  assert.deepEqual(packWithSingle.layout.slots.filter(slot => slot.stackIndex === 0).map(slot => slot.x), [-68, 0, 68])
  assert.deepEqual(withoutSingle.slots.filter(slot => slot.stackIndex === 0).map(slot => slot.x), [-34, 34], 'removing the middle single closes its lane instead of retaining an empty bay')
  const withoutCategories = createHandStackLayout(split.display, split.groups.map(({ zone, ...group }) => group), 940)
  assert.deepEqual(withoutCategories, split.layout, 'semantic categories cannot change coordinates or hit areas')
  assert.deepEqual(createHandStackLayout([], split.groups, 940).slots, [], 'no occupied lanes remain after the hand is empty')
  const manualDisplay = [...split.groups[1].cardIds, ...split.groups[0].cardIds]
  const manual = createHandStackLayout(manualDisplay, split.groups, 940)
  assert.deepEqual(manual.slots.map(slot => slot.cardId), manualDisplay, 'a manual cross-zone move is never silently reversed')
  assert.deepEqual(manual.slots.filter(slot => slot.stackIndex === 0).map(slot => slot.x), [-34, 34], 'noncanonical manual order keeps compact ordered layout')
  assert.deepEqual(createHandStackLayout(['last'], [], 940).slots.map(slot => slot.x), [0], 'last ordinary card stays central')
  assert.equal(handDisplayZone(PlayType.StraightFlush, classicRuleProfile), 0)
  assert.equal(handDisplayZone(PlayType.StraightFlush, tournamentRuleProfile), 2, 'semantic zones respect the live room rule profile')

  const hand = [card('l1', 8), card('l2', 8, 'heart'), card('l3', 8, 'club'), card('l4', 8, 'diamond'), card('c', 'K')]
  const grouping = new HandGrouping(hand, { ruleProfile: classicRuleProfile })
  grouping.autoGroup()
  const snapshot = grouping.getSnapshot()
  const before = JSON.stringify(snapshot)
  const input = {
    hand, grouping: snapshot, mode: 'play', playSelectedCardIds: ['l1'],
    sortOrder: 'desc', interactive: true, lockedCardIds: [], availableSuits: [], selectedSuit: null,
    lockDecision: { kind: 'lock' }, arrangeRestoreAvailable: true,
  }
  const projected = projectHandRenderModel(input)
  assert.equal(projected.groups.find(group => group.cardIds.includes('l1')).zone, 0, 'live renderer receives semantic zones, not just sorted ids')
  assert.equal(JSON.stringify(snapshot), before, 'projection leaves the undo/sync snapshot untouched')
  assert.deepEqual(projectHandRenderModel(input), projected, 'selection refreshes cannot jitter lane classification')
  const unselected = projectHandRenderModel({ ...input, playSelectedCardIds: [] })
  assert.deepEqual(createHandStackLayout(unselected.displayCardIds, unselected.groups, 940), createHandStackLayout(projected.displayCardIds, projected.groups, 940), 'selecting or deselecting never changes horizontal geometry')
  assert.equal(projectHandRenderModel({ ...input, grouping: { ...snapshot, layoutMode: 'point-stacked' } }).groups, snapshot.groups, 'point arrangement preserves the original projection')

  const { TABLE_LAYOUT_FIXTURES } = require(path.join(projectRoot, 'tests/fixtures/TableLayoutFixtures.ts'))
  for (const fixture of TABLE_LAYOUT_FIXTURES) {
    const state = fixture.createState()
    const fixedGrouping = new HandGrouping(state.players.p1.hand, { ruleProfile: state.ruleProfile })
    fixedGrouping.autoGroup()
    fixedGrouping.stackMatchingRanks()
    const fixedProjection = projectHandRenderModel({ ...input, hand: state.players.p1.hand, grouping: fixedGrouping.getSnapshot() })
    const fixedLayout = createHandStackLayout(fixedProjection.displayCardIds, fixedProjection.groups, 940)
    const lanes = fixedLayout.slots.filter(slot => slot.stackIndex === 0)
    if (state.players.p1.hand.length === 0) {
      assert.equal(lanes.length, 0, 'finished own hand has no stale selectable lanes')
      continue
    }
    assert.ok(Math.abs(lanes[0].x + lanes[lanes.length - 1].x) < 1e-8, 'live fixture hand is centred regardless of its group categories')
    assert.ok(lanes.some(slot => Math.abs(slot.x) <= 34), 'high-only fixtures may occupy the middle')
    if (fixture.id === 'match-layout-all-bombs') assert.ok(fixedProjection.groups.every(group => group.zone === 0))
    if (fixture.id === 'match-layout-combinations') assert.deepEqual(fixedProjection.groups.map(group => group.zone), [2, 2])
  }
}

function verifyAvailablePlayButtons () {
  const { TablePlayActionPolicy } = require(path.join(projectRoot, 'assets/scripts/ui/TablePlayActionPolicy.ts'))
  const policy = new TablePlayActionPolicy()
  const pair = { playerId: 'p4', type: PlayType.Pair, cards: [card('t1', 5), card('t2', 5, 'heart')] }
  const state = { ruleProfile: classicRuleProfile, players: { p1: { hand: [card('a', 'A')] } }, lastValidPlay: pair }
  assert.deepEqual(policy.resolve(state, 'p1'), ['pass'], 'a single A cannot answer a pair; selection/hint controls must be hidden')
  state.players.p1.hand = [card('h1', 6), card('h2', 6, 'heart')]
  assert.deepEqual(policy.resolve(state, 'p1'), ['hint', 'pass', 'play'], 'an empty selection must not hide valid response controls')
  state.players.p1.hand = ['spade', 'heart', 'club', 'diamond'].map((suit, index) => card(`bomb-${index}`, 3, suit))
  assert.deepEqual(policy.resolve(state, 'p1'), ['hint', 'pass', 'play'], 'a lower-rank bomb still answers an ordinary pair')
  state.lastValidPlay = { playerId: 'p4', type: PlayType.Rocket, cards: [card('s1', 'Small', 'joker'), card('s2', 'Small', 'joker'), card('b1', 'Big', 'joker'), card('b2', 'Big', 'joker')] }
  assert.deepEqual(policy.resolve(state, 'p1'), ['pass'], 'no response exists against four jokers')
  state.lastValidPlay = pair
  state.players.p1.hand = [card('six', 6), card('wild', 2, 'heart', { value: 15, isLevelCard: true, isRedJoker: true })]
  assert.deepEqual(policy.resolve(state, 'p1'), ['hint', 'pass', 'play'], 'wildcard responses must be decided by the rule engine')
  state.players.p1.hand = [card('six', 6), card('wild', 2, 'heart')]
  assert.deepEqual(policy.resolve(state, 'p1'), ['pass'], 'changed wildcard semantics invalidate the cache despite identical card IDs')
  state.lastValidPlay = null
  assert.deepEqual(policy.resolve(state, 'p1'), ['hint', 'play'], 'a fresh lead must not offer an illegal pass')
  state.players.p1.hand = []
  assert.deepEqual(policy.resolve(state, 'p1'), [], 'a finished empty hand has no play controls')
}

function verifyArchitectureBoundary () {
  const arrangementSource = fs.readFileSync(arrangementPath, 'utf8')
  const arrangementModelSource = fs.readFileSync(arrangementModelPath, 'utf8')
  const displayOrderingSource = fs.readFileSync(displayOrderingPath, 'utf8')
  const groupSuggestionsSource = fs.readFileSync(groupSuggestionsPath, 'utf8')
  const groupingSource = fs.readFileSync(groupingPath, 'utf8')
  const workspaceSource = fs.readFileSync(workspacePath, 'utf8')
  for (const sourcePath of [
    arrangementPath,
    arrangementModelPath,
    displayOrderingPath,
    groupSuggestionsPath,
    groupingPath,
    groupingStatePath,
    workspacePath,
    stackLayoutPath,
  ]) {
    assert.equal(fs.existsSync(`${sourcePath}.meta`), true, `missing Cocos metadata for ${sourcePath}`)
  }
  assert.doesNotMatch(groupingSource, /selectedCardIds|GameScene|GameManager|HandController/, 'grouping must remain independent from selection and scene state')
  assert.doesNotMatch(workspaceSource, /from 'cc'|GameScene|GameManager|HandController|TableGameHud/, 'the hand transaction must remain independent from Cocos and UI state')
  assert.doesNotMatch(arrangementModelSource, /\.sort\(.*hand\)/, 'arrangement must sort a copy, never the rule hand itself')
  assert.doesNotMatch(arrangementSource, /resolvePlay|allocatePattern/, 'the stable arrangement facade must not absorb implementation responsibilities')
  assert.doesNotMatch(arrangementModelSource, /resolvePlay|HandDisplayOrdering|HandGroupSuggestions/, 'the base arrangement model must remain independent from display and candidate discovery')
  assert.doesNotMatch(displayOrderingSource, /HandGroupSuggestions|suggestHandGroups/, 'display ordering must not discover semantic group candidates')
  assert.doesNotMatch(groupSuggestionsSource, /HandDisplayOrdering|sortHandDisplayUnits/, 'candidate discovery must not depend on presentation ordering')
  assert.match(groupingSource, /syncAuthoritativeHand/)
  assert.match(groupingSource, /normalizeHandGroupingState/, 'the grouping aggregate must delegate snapshot normalization to its state boundary')
  assert.doesNotMatch(groupingSource, /private normalizeState \(/, 'snapshot normalization must not grow back into the grouping aggregate')
  assert.doesNotMatch(groupingSource, /public createGroup \(/, 'arbitrary unchecked group creation must not remain public')
  assert.doesNotMatch(groupingSource, /public moveCard \(/, 'single-card movement must not bypass locked-group invariants')
}

function verifyRuntimeIntegration () {
  const sceneSource = fs.readFileSync(path.join(projectRoot, 'assets/scripts/scenes/GameScene.ts'), 'utf8')
  const matchCoordinatorSource = fs.readFileSync(path.join(projectRoot, 'assets/scripts/scenes/TableMatchCoordinator.ts'), 'utf8')
  const interactionSource = fs.readFileSync(path.join(projectRoot, 'assets/scripts/scenes/TableHandInteractionController.ts'), 'utf8')
  const turnClockSource = fs.readFileSync(path.join(projectRoot, 'assets/scripts/scenes/TableTurnClockController.ts'), 'utf8')
  const workspaceSource = fs.readFileSync(workspacePath, 'utf8')
  const handSource = fs.readFileSync(path.join(projectRoot, 'assets/scripts/ui/HandController.ts'), 'utf8')
  assert.match(sceneSource, /new TableHandInteractionController\(\{/, 'the table scene must compose one hand interaction owner')
  assert.match(matchCoordinatorSource, /handInteraction\.submit\(snapshot\)/, 'the live-match coordinator must project snapshots through the hand interaction owner')
  assert.match(interactionSource, /private readonly workspace: HandWorkspace/, 'the hand interaction owner must exclusively hold the presentation workspace')
  assert.doesNotMatch(interactionSource, /HandInteractionStateMachine|private readonly interaction/, 'derived input state must not have a second mutable lifecycle')
  assert.match(interactionSource, /this\.workspace\.syncAuthoritativeHand\(hand, \{[\s\S]*levelRank: snapshot\.state\.currentLevel/, 'an authoritative hand update must pass the current level into the hand workspace')
  assert.doesNotMatch(interactionSource, /from 'cc'/, 'the hand interaction owner must remain independently testable without Cocos')
  assert.match(workspaceSource, /this\.grouping\.autoGroup/, 'the hand workspace must own smart grouping')
  assert.match(workspaceSource, /this\.grouping\.stackMatchingRanks\(\)/, 'default table presentation must stack repeated ranks')
  assert.match(workspaceSource, /this\.grouping\.createLockedGroup\(cardIds, ruleProfile\)/, 'the workspace locks current selected IDs using the rule profile')
  assert.doesNotMatch(turnClockSource, /handStackRise/, 'the countdown layer must not react to presentation-only hand height')
  assert.match(turnClockSource, /const countdownY = update\.controlsY \+ 47/, 'the countdown must remain fixed above the action row')
  assert.doesNotMatch(sceneSource, /Math\.max\(0, this\.handStackRise - 32\)/, 'table controls must not move to avoid card stacks')
  assert.doesNotMatch(workspaceSource, /lockDraft|beginManualSelection/, 'no hidden draft selection may remain')
  assert.match(interactionSource, /resolveHandCapabilities\(snapshot, humanId, settings\)\.canSelect[\s\S]*this\.dependencies\.ruleAuthority\.toggleCard\(cardId\)/, 'the common capability policy must gate card taps')
  assert.match(interactionSource, /playSelectionForCard\(cardId\)[\s\S]*ruleAuthority\.replaceSelectedCards/, 'an eligible stack member must route through atomic rule selection')
  assert.match(interactionSource, /interactive: capabilities\.canSelect/, 'rendering must use the same eligibility policy as input')
  assert.match(interactionSource, /Array\.from\(this\.dependencies\.ruleAuthority\.selectedCardIds\)/, 'locking uses the visible selection')
  assert.doesNotMatch(sceneSource, /toggleArrangePanel|ArrangeMenu|arrangeNodes|groupEditMode|activeHandGroupId/, 'retired hidden grouping controls must not remain in the live scene')
  assert.match(handSource, /displayCardIds\?: readonly string\[\]/, 'HandController must accept the presentation order without mutating rule cards')
  assert.match(handSource, /createHandStackLayout/, 'arranged groups must use the downward cascade layout')
  assert.match(handSource, /configureStackHitArea/, 'covered cards must only receive input on their exposed rank/suit strip')
  assert.match(handSource, /left\.slot\.stackIndex\s*-\s*right\.slot\.stackIndex/, 'later downward cards must render above the preceding card body')
  const cardViewSource = fs.readFileSync(path.join(projectRoot, 'assets/scripts/ui/CardView.ts'), 'utf8')
  assert.doesNotMatch(cardViewSource, /`\$\{this\.card\.rank\}\$\{this\.card\.suit\}`/, 'covered cards must not reintroduce the retired rank/suit text renderer')
  assert.equal((cardViewSource.match(/addComponent\(Label\)/g) || []).length, 1, 'only the level corner marker uses a text label')
  assert.doesNotMatch(cardViewSource, /StackRankSuit|StackCornerRank|StackCornerSuit|contentHeight|rankWidth|suitWidth/, 'stack hit geometry must never replace or resize the natural classic artwork')
  assert.match(cardViewSource, /CLASSIC_CARD_LAYER_GEOMETRY\[layer\][\s\S]*geometry\.width[\s\S]*geometry\.height/, 'every stacked card must keep the shared natural card geometry')
  assert.match(cardViewSource, /configureStackHitArea[\s\S]*applyHitAreaGeometry\(\)[\s\S]*refreshStateVisuals\(\)/, 'stack exposure must affect only input and exposed state overlays')
  assert.match(handSource, /lockedCardIds\?: readonly string\[\]/, 'the hand renderer must accept an explicit persistent lock projection')
  assert.match(handSource, /group\.locked \? group\.cardIds : \[\]/, 'live grouping projections must infer explicit locks when the optional id list is omitted')
  assert.match(handSource, /locked: lockedIds\.has\(card\.id\)/, 'each card view must receive its persistent lock state')
}

// Lock creation and positioning are one revision; only explicit baselines restore it.
for (const mode of ['manual', 'suggestion']) {
  const grouping = new HandGrouping([card('a', 3), card('b', 3, 'heart'), card('c', 8), card('d', 10)])
  const before = grouping.getSnapshot()
  const lock = () => mode === 'manual'
    ? grouping.createLockedGroup(['a', 'b'], classicRuleProfile)
    : grouping.applySuggestion({ cardIds: ['a', 'b'], kind: 'pair' })
  lock()
  const after = grouping.getSnapshot()
  assert.equal(after.revision - before.revision, 1, mode + ': creation must record only one transaction')
  assert.equal(after.groups.filter(group => group.locked).length, 1)
  assert.equal(grouping.restoreSnapshot(before), true)
  assert.deepEqual(grouping.getSnapshot().groups, before.groups)
  assert.equal(grouping.restoreSnapshot(after), true)
  assert.deepEqual(grouping.getSnapshot().groups, after.groups)
  assert.deepEqual(grouping.getSnapshot().displayCardIds, after.displayCardIds)
}

verifyArchitectureBoundary()
verifyRuntimeIntegration()
verifyArrangement()
verifyLevelRankPropagation()
verifyUnifiedDisplayOrdering()
verifyOneKeyRestoreSnapshot()
verifyMatchingRankStacksAndCompleteRestore()
verifyWorkspaceTransactionBoundary()
verifyLockChangesStayIndependentFromArrangementRestore()
verifyRankStacksReconcileAndUnlock()
verifySmartArrangementRecomputesAfterAuthorityChange()
verifySmartUnlockReprojectsTheLayout()
verifySuggestions()
verifyGroupingLifecycle()
verifyAutoGrouping()
verifyLockedGroupsSurviveArrangement()
verifyDownwardStackLayout()
verifyCompactGroupGeometry()
verifyAvailablePlayButtons()
// IDs intentionally put the large pair first lexically: attachment rank must win.
const attachmentHand = [card('t1', 7), card('t2', 7, 'heart'), card('t3', 7, 'club'),
  card('z-small1', 3), card('z-small2', 3, 'heart'), card('a-large1', 'A'), card('a-large2', 'A', 'heart')]
const attachment = selectNonOverlappingSuggestions(suggestHandGroups(attachmentHand)).find(item => item.kind === 'triple-with-pair')
assert.ok(attachment)
assert.equal(attachment.pairValue, 3)
assert.ok(attachment.cardIds.includes('z-small1'))
const tubeFirstHand = attachmentHand.filter(item => !item.id.startsWith('a-large')).concat(
  [4, 5, 9].flatMap(rank => [card(`pair-${rank}-1`, rank), card(`pair-${rank}-2`, rank, 'heart')]))
const tubeFirst = selectNonOverlappingSuggestions(suggestHandGroups(tubeFirstHand))
assert.equal(tubeFirst[0].kind, 'tube', 'three consecutive pairs stay ahead of triple attachments')
assert.equal(tubeFirst.find(item => item.kind === 'triple-with-pair').pairValue, 9, 'do not dismantle the protected three-pair run')
for (const rank of [10, 'J', 'Q', 'K', 'A', 'Small', 'Big']) {
  const highPair = [card('high-a', rank, rank === 'Small' || rank === 'Big' ? 'joker' : 'spade'),
    card('high-b', rank, rank === 'Small' || rank === 'Big' ? 'joker' : 'heart')]
  const hand = attachmentHand.slice(0, 3).concat(highPair)
  assert.equal(selectNonOverlappingSuggestions(suggestHandGroups(hand)).some(group => group.kind === 'triple-with-pair'), false,
    `auto-arrange must preserve the ${rank} pair`)
  assert.equal(recognizeHandGroup(hand, hand.map(item => item.id))?.kind, 'triple-with-pair', 'manual grouping remains legal')
}
const highTube = [10, 'J', 'Q'].flatMap(rank => [card(`run-${rank}-a`, rank), card(`run-${rank}-b`, rank, 'heart')])
assert.equal(selectNonOverlappingSuggestions(suggestHandGroups(highTube))[0]?.kind, 'tube', 'high three-pair runs remain eligible')
process.stdout.write('hand arrangement/grouping regression checks passed\n')
