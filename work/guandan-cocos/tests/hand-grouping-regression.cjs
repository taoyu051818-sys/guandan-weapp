const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const compilerPath = '/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/resources/3d/engine/node_modules/typescript/lib/typescript.js'
const arrangementPath = path.join(projectRoot, 'assets/scripts/game/HandArrangement.ts')
const groupingPath = path.join(projectRoot, 'assets/scripts/game/HandGrouping.ts')
const stackLayoutPath = path.join(projectRoot, 'assets/scripts/game/HandStackLayout.ts')

assert.equal(fs.existsSync(compilerPath), true, 'Cocos Creator TypeScript compiler is required')
const ts = require(compilerPath)

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
  arrangeHandCardIds,
  recognizeHandGroup,
  selectNonOverlappingSuggestions,
  suggestHandGroups,
} = require(arrangementPath)
const { HandGrouping } = require(groupingPath)
const { createHandStackLayout, handStackRise } = require(stackLayoutPath)

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
}

function verifyGroupingLifecycle () {
  const ruleHand = [
    card('a', 2), card('b', 5), card('c', 8), card('d', 'J'), card('e', 'K'), card('f', 'A'),
  ]
  const originalRuleOrder = ruleHand.map(item => item.id)
  const grouping = new HandGrouping(ruleHand, { arrangement: { direction: 'asc', levelCards: 'natural' } })

  const first = grouping.createGroup(['a', 'b', 'c'])
  const second = grouping.createGroup(['d', 'e'])
  assert.deepEqual(grouping.getSnapshot().groups.map(group => group.id), [first, second])
  grouping.moveCard('c', { groupId: first, beforeCardId: 'a' })
  assert.deepEqual(grouping.getSnapshot().groups.find(group => group.id === first).cardIds, ['c', 'a', 'b'], 'cards must reorder within a group by cardId')
  grouping.moveCard('c', { groupId: second, beforeCardId: 'e' })
  assert.deepEqual(grouping.getSnapshot().groups.find(group => group.id === first).cardIds, ['a', 'b'])
  assert.deepEqual(grouping.getSnapshot().groups.find(group => group.id === second).cardIds, ['d', 'c', 'e'], 'cards must move across groups by cardId')

  assert.equal(grouping.undo(), true)
  assert.deepEqual(grouping.getSnapshot().groups.find(group => group.id === first).cardIds, ['c', 'a', 'b'])
  assert.equal(grouping.undo(), true)
  assert.deepEqual(grouping.getSnapshot().groups.find(group => group.id === first).cardIds, ['a', 'b', 'c'], 'multi-step undo must restore the earlier group')
  assert.equal(grouping.redo(), true)
  assert.deepEqual(grouping.getSnapshot().groups.find(group => group.id === first).cardIds, ['c', 'a', 'b'])

  assert.equal(grouping.splitGroup(second), true)
  assert.equal(grouping.getSnapshot().groups.some(group => group.id === second), false, 'split must return every group card to the ungrouped lane')
  assert.equal(grouping.restoreDefault(), true)
  assert.equal(grouping.getSnapshot().groups.length, 0)
  assert.deepEqual(grouping.getSnapshot().ungroupedCardIds, ['a', 'b', 'c', 'd', 'e', 'f'])
  assert.equal(grouping.undo(), true, 'restore-default itself must be undoable')
  assert.deepEqual(ruleHand.map(item => item.id), originalRuleOrder, 'manual grouping must never reorder rule-layer cards')

  grouping.restoreDefault()
  const serverGroup = grouping.createGroup(['a', 'b', 'c'])
  grouping.syncAuthoritativeHand(ruleHand.filter(item => item.id !== 'b'))
  let snapshot = grouping.getSnapshot()
  assert.equal(snapshot.canUndo, false, 'an authoritative hand update must invalidate old undo history')
  assert.equal(snapshot.canRedo, false)
  assert.equal(snapshot.displayCardIds.includes('b'), false, 'a played cardId must disappear from every presentation lane')
  assert.deepEqual(snapshot.groups.find(group => group.id === serverGroup).cardIds, ['a', 'c'])
  assert.equal(grouping.undo(), false, 'undo must never resurrect a card removed by the server')

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
    card('manual-K', 'K', 'heart'),
    card('manual-2', 2, 'diamond'),
    ...looseBomb,
    card('loose-A', 'A', 'spade'),
    card('loose-4', 4, 'heart'),
  ])
  const grouping = new HandGrouping(hand)
  const straightFlushGroupId = grouping.lockStraightFlush('club')
  const manualGroupId = grouping.createGroup(['manual-K', 'manual-2'])
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
  assert.deepEqual(snapshot.groups, lockedBefore, 'arrange must not reorder locked groups or cards inside a locked group')

  const lockedCardIds = new Set(lockedBefore.flatMap(group => group.cardIds))
  const expectedLooseOrder = arrangeHandCardIds(hand, arrangement).filter(cardId => !lockedCardIds.has(cardId))
  assert.deepEqual(snapshot.ungroupedCardIds, expectedLooseOrder, 'arrange must still sort every loose card')

  const looseBeforeAutoGroup = new Set(snapshot.ungroupedCardIds)
  const applied = grouping.autoGroup()
  snapshot = grouping.getSnapshot()
  assert.equal(applied.some(suggestion => suggestion.kind === 'bomb'), true, 'auto-group must still recognize patterns in loose cards')
  assert.equal(
    applied.every(suggestion => suggestion.cardIds.every(cardId => looseBeforeAutoGroup.has(cardId))),
    true,
    'auto-group suggestions must never consume a card from a locked group',
  )
  assert.deepEqual(snapshot.groups.slice(0, lockedBefore.length), lockedBefore, 'auto-group must append without modifying prior locks')
  assert.deepEqual(snapshot.groups.map(group => group.id).slice(0, 2), [straightFlushGroupId, manualGroupId])

  const newlyGrouped = new Set(applied.flatMap(suggestion => suggestion.cardIds))
  assert.deepEqual(
    snapshot.ungroupedCardIds,
    expectedLooseOrder.filter(cardId => !newlyGrouped.has(cardId)),
    'only newly recognized loose cards may leave the ungrouped lane',
  )
  idSetEquals(snapshot.displayCardIds, hand.map(item => item.id))

  const afterFirstAutoGroup = snapshot.groups
  assert.deepEqual(grouping.autoGroup(), [], 'a second auto-group pass must treat prior smart groups as locked')
  assert.deepEqual(grouping.getSnapshot().groups, afterFirstAutoGroup)
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
  assert.equal(triple.every(slot => slot.stackStep > 0), true)
  assert.equal(layout.laneCount, 4, 'two groups and two loose cards must use four horizontal lanes')
  assert.equal(layout.maxRise, handStackRise(3))
  assert.deepEqual(layout.slots.map(slot => slot.cardId), display, 'layout must preserve the presentation card-id order')

  const huge = createHandStackLayout(
    Array.from({ length: 10 }, (_, index) => `bomb-${index}`),
    [{ id: 'large-bomb', cardIds: Array.from({ length: 10 }, (_, index) => `bomb-${index}`) }],
    680,
  )
  assert.ok(huge.maxRise <= 96.001, 'large bombs must not grow through the action controls')
  assert.equal(new Set(huge.slots.map(slot => slot.cardId)).size, 10)
}

function verifyArchitectureBoundary () {
  const arrangementSource = fs.readFileSync(arrangementPath, 'utf8')
  const groupingSource = fs.readFileSync(groupingPath, 'utf8')
  for (const sourcePath of [arrangementPath, groupingPath, stackLayoutPath]) {
    assert.equal(fs.existsSync(`${sourcePath}.meta`), true, `missing Cocos metadata for ${sourcePath}`)
  }
  assert.doesNotMatch(groupingSource, /selectedCardIds|GameScene|GameManager|HandController/, 'grouping must remain independent from selection and scene state')
  assert.doesNotMatch(arrangementSource, /\.sort\(.*hand\)/, 'arrangement must sort a copy, never the rule hand itself')
  assert.match(groupingSource, /syncAuthoritativeHand/)
  assert.match(groupingSource, /undoStack/)
  assert.match(groupingSource, /redoStack/)
}

function verifyRuntimeIntegration () {
  const sceneSource = fs.readFileSync(path.join(projectRoot, 'assets/scripts/scenes/GameScene.ts'), 'utf8')
  const handSource = fs.readFileSync(path.join(projectRoot, 'assets/scripts/ui/HandController.ts'), 'utf8')
  assert.match(sceneSource, /private readonly handGrouping = new HandGrouping\(\)/, 'the table scene must own one presentation-only grouping state')
  assert.match(sceneSource, /handSignature !== this\.handGroupingSignature[\s\S]*syncAuthoritativeHand\(humanHand, \{ levelRank: snapshot\.state\.currentLevel \}\)/, 'an authoritative hand update must pass the current level into grouping state')
  assert.match(sceneSource, /this\.handGrouping\.autoGroup/, 'the table must expose smart grouping')
  assert.match(sceneSource, /this\.handGrouping\.createGroup\(selected\)/, 'the table must expose manual selected-card grouping')
  assert.match(sceneSource, /this\.handGrouping\.undo\(\)/, 'the table must expose grouping undo')
  assert.match(sceneSource, /this\.handGrouping\.redo\(\)/, 'the table must expose grouping redo')
  assert.match(sceneSource, /this\.handGrouping\.splitGroup\(this\.activeHandGroupId\)/, 'the table must expose group splitting')
  assert.match(sceneSource, /this\.handGrouping\.moveGroup/, 'the table must expose group movement')
  assert.match(sceneSource, /this\.handStackRise > 32 \? -47 : 47/, 'a raised hand stack must move the countdown below the action row')
  assert.match(sceneSource, /private readonly manualGroupingSelection = new Set<string>\(\)/, 'manual grouping must own a presentation-only selection')
  assert.match(sceneSource, /if \(!this\.manualGroupingMode\)[\s\S]*?(?:this\.gameManager|manager)\?\.toggleCard\(cardId\)/, 'normal taps must still route to the rule selection')
  assert.match(sceneSource, /getStackSelectionForBottomCard\(cardId\)[\s\S]*manager\.replaceSelectedCards/, 'a locked stack bottom must route through atomic rule selection')
  assert.match(sceneSource, /playingTapMode !== 'blocked' \|\| this\.canInteractWithHand/, 'manual grouping must remain interactive outside the local turn without bypassing pending actions')
  assert.doesNotMatch(sceneSource, /const selected = \[\.\.\.\(this\.gameManager\?\.selectedCardIds/, 'manual grouping must not reuse the play-selection set')
  assert.match(handSource, /displayCardIds\?: readonly string\[\]/, 'HandController must accept the presentation order without mutating rule cards')
  assert.match(handSource, /createHandStackLayout/, 'arranged groups must use the downward cascade layout')
  assert.match(handSource, /configureStackHitArea/, 'covered cards must only receive input on their exposed rank/suit strip')
  assert.match(handSource, /left\.slot\.stackIndex\s*-\s*right\.slot\.stackIndex/, 'later downward cards must render above the preceding card body')
  const cardViewSource = fs.readFileSync(path.join(projectRoot, 'assets/scripts/ui/CardView.ts'), 'utf8')
  assert.doesNotMatch(cardViewSource, /\bLabel\b|`\$\{this\.card\.rank\}\$\{this\.card\.suit\}`/, 'covered cards must not reintroduce the retired text renderer')
  assert.match(cardViewSource, /StackCornerRank/, 'covered cards need a compact classic rank sprite inside the exposed strip')
  assert.match(cardViewSource, /StackCornerSuit/, 'covered cards need a compact classic suit sprite inside the exposed strip')
  assert.match(cardViewSource, /setStackFrame\('rank',[\s\S]*plan\.cornerRank/, 'the compact rank must reuse the resolved classic PNG frame')
  assert.match(cardViewSource, /setStackFrame\('suit',[\s\S]*plan\.cornerSuit/, 'the compact suit must reuse the resolved classic PNG frame')
  assert.match(cardViewSource, /hiddenByStack[\s\S]*layer === 'cornerRank'[\s\S]*layer === 'cornerSuit'/, 'covered cards must hide the full-face corner layers before showing compact duplicates')
}

verifyArchitectureBoundary()
verifyRuntimeIntegration()
verifyArrangement()
verifyLevelRankPropagation()
verifyOneKeyRestoreSnapshot()
verifySuggestions()
verifyGroupingLifecycle()
verifyAutoGrouping()
verifyLockedGroupsSurviveArrangement()
verifyDownwardStackLayout()
process.stdout.write('hand arrangement/grouping regression checks passed\n')
