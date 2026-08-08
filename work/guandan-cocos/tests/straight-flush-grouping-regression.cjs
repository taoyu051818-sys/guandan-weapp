const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const compilerPath = '/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/resources/3d/engine/node_modules/typescript/lib/typescript.js'
const arrangementPath = path.join(projectRoot, 'assets/scripts/game/HandArrangement.ts')
const groupingPath = path.join(projectRoot, 'assets/scripts/game/HandGrouping.ts')
const workspacePath = path.join(projectRoot, 'assets/scripts/game/HandWorkspace.ts')
const gameManagerPath = path.join(projectRoot, 'assets/scripts/game/GameManager.ts')
const gameScenePath = path.join(projectRoot, 'assets/scripts/scenes/GameScene.ts')

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
  STRAIGHT_FLUSH_SUITS,
  getStraightFlushSuitAvailability,
  isHeartLevelWildcard,
  selectStraightFlushForSuit,
  suggestStraightFlushGroups,
} = require(arrangementPath)
const { HandGrouping } = require(groupingPath)

const rankValue = rank => ({ J: 11, Q: 12, K: 13, A: 14, Small: 16, Big: 17 }[rank] ?? Number(rank))
const card = (id, rank, suit, overrides = {}) => Object.freeze({
  id,
  rank,
  suit,
  value: rankValue(rank),
  isLevelCard: false,
  ...overrides,
})
const straight = (suit, ranks, prefix = suit) => ranks.map(rank => card(`${prefix}-${rank}`, rank, suit))

function verifyEverySuitCanLight () {
  const hand = STRAIGHT_FLUSH_SUITS.flatMap(suit => straight(suit, [3, 4, 5, 6, 7]))
  const availability = getStraightFlushSuitAvailability(hand)
  assert.deepEqual(availability.map(item => item.suit), ['spade', 'heart', 'club', 'diamond'])
  assert.deepEqual(availability.map(item => item.available), [true, true, true, true], 'all four physical suits must light independently')
  for (const item of availability) {
    assert.deepEqual(item.cardIds, [3, 4, 5, 6, 7].map(rank => `${item.suit}-${rank}`))
    assert.equal(item.cardIds.length, 5)
  }
}

function verifyHeartLevelWildcard () {
  const wildcard = card('heart-level-wild', 7, 'heart', { value: 15, isLevelCard: true, isRedJoker: true })
  const hand = straight('spade', [5, 6, 8, 9], 'spade-wild').concat(wildcard)
  const selected = selectStraightFlushForSuit(hand, 'spade')
  assert.ok(selected, 'the heart-level wildcard must complete another suit')
  assert.deepEqual(selected.cardIds, ['spade-wild-5', 'spade-wild-6', 'heart-level-wild', 'spade-wild-8', 'spade-wild-9'])
  assert.deepEqual(selected.wildcardUsages, [{ cardId: 'heart-level-wild', representedValue: 7, representedSuit: 'spade' }])

  const malformedJoker = card('not-a-wildcard', 'Big', 'joker', { isRedJoker: true })
  assert.equal(isHeartLevelWildcard(malformedJoker), false, 'an actual joker must never pass the heart-level wildcard predicate')
  assert.equal(
    selectStraightFlushForSuit(straight('club', [5, 6, 8, 9]).concat(malformedJoker), 'club'),
    null,
    'a malformed joker flag must not fill a straight-flush gap',
  )
}

function verifyDeterministicCandidate () {
  const hand = straight('spade', [2, 3, 4, 5, 6, 7, 8, 9, 10], 'multi')
    .concat(card('multi-6-copy', 6, 'spade'))
  const first = selectStraightFlushForSuit(hand, 'spade')
  const second = selectStraightFlushForSuit(hand.slice().reverse(), 'spade')
  assert.ok(first && second)
  assert.deepEqual(first.cardIds, ['multi-6', 'multi-7', 'multi-8', 'multi-9', 'multi-10'], 'the strongest natural sequence must be selected')
  assert.deepEqual(second.cardIds, first.cardIds, 'candidate selection must not depend on authoritative hand order')
  assert.equal(getStraightFlushSuitAvailability(hand).find(item => item.suit === 'spade').candidateCount, 5)

  const aceLow = straight('diamond', ['A', 2, 3, 4, 5], 'ace-low')
  assert.ok(selectStraightFlushForSuit(aceLow, 'diamond'))
  assert.equal(selectStraightFlushForSuit(aceLow, 'diamond', { allowAceLowStraight: false }), null)
}

function verifyNoCandidate () {
  const hand = straight('heart', [2, 4, 6, 8, 10], 'gapped')
  assert.equal(selectStraightFlushForSuit(hand, 'heart'), null)
  assert.equal(suggestStraightFlushGroups(hand).length, 0)
  assert.deepEqual(getStraightFlushSuitAvailability(hand).map(item => item.available), [false, false, false, false])
}

function verifyLockAndBottomSelection () {
  const hand = straight('club', [6, 7, 8, 9, 10], 'locked')
    .concat(card('loose', 'A', 'diamond'))
  const grouping = new HandGrouping(hand)
  assert.equal(grouping.selectStraightFlush('club').cardIds.length, 5)
  const groupId = grouping.lockStraightFlush('club')
  assert.ok(groupId)

  const group = grouping.getSnapshot().groups.find(candidate => candidate.id === groupId)
  assert.equal(group.kind, 'straight-flush')
  assert.deepEqual(group.cardIds, ['locked-6', 'locked-7', 'locked-8', 'locked-9', 'locked-10'])
  assert.deepEqual(grouping.getStackSelectionForBottomCard('locked-10'), group.cardIds, 'the fully visible bottom card must select the whole stack')
  assert.deepEqual(grouping.getStackSelectionForBottomCard('locked-6'), [], 'a covered stack strip must not impersonate the bottom-card action')

  const copy = grouping.getGroupForCard('locked-8')
  assert.equal(copy.id, groupId)
  copy.cardIds.length = 0
  assert.equal(grouping.getGroupForCard('locked-8').cardIds.length, 5, 'group queries must not leak mutable state')
  assert.equal(grouping.lockStraightFlush('diamond'), null, 'locking an unavailable suit must be a no-op')
}

function verifyTableIntegration () {
  const scene = fs.readFileSync(gameScenePath, 'utf8')
  const workspace = fs.readFileSync(workspacePath, 'utf8')
  const manager = fs.readFileSync(gameManagerPath, 'utf8')
  const suitHandlerStart = scene.indexOf('private handleTableHudSuit')
  const suitHandlerEnd = scene.indexOf('private handleTableHudHandLock', suitHandlerStart)
  assert.notEqual(suitHandlerStart, -1, 'the table scene must handle suit selection')
  assert.notEqual(suitHandlerEnd, -1, 'the suit handler must remain a bounded interaction method')
  const suitHandler = scene.slice(suitHandlerStart, suitHandlerEnd)

  assert.match(scene, /availableSuits: this\.handWorkspace\.straightFlushAvailability/, 'the four-suit HUD must receive authoritative availability')
  assert.match(suitHandler, /handWorkspace\.selectStraightFlush\(suit/, 'pressing a lit suit must delegate its exact candidate to the hand transaction')
  assert.match(workspace, /suggestion\.cardIds\.forEach\(cardId => this\.manualSelection\.add\(cardId\)\)/, 'one suit press must select all five cards')
  assert.doesNotMatch(suitHandler, /\.arrange/, 'suit controls must not reorder the whole hand')
  assert.match(scene, /stackSelectionForBottomCard\(cardId\)[\s\S]*replaceSelectedCards\(stackIsExactSelection \? \[\] : stackCardIds\)/, 'the visible bottom card must toggle the complete stack in one snapshot')
  assert.match(manager, /public replaceSelectedCards \(cardIds: readonly string\[\]\): void/, 'GameManager must expose an atomic stack-selection entry point')
  assert.match(manager, /this\.selectedCardIds = new Set\(requested\)[\s\S]*diagnosePlay\(cards, this\.state\.lastValidPlay\)/, 'batch selection must use the same authoritative play diagnosis as ordinary taps')
}

verifyEverySuitCanLight()
verifyHeartLevelWildcard()
verifyDeterministicCandidate()
verifyNoCandidate()
verifyLockAndBottomSelection()
verifyTableIntegration()
process.stdout.write('straight-flush grouping regression checks passed\n')
