const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const controllerPath = path.join(projectRoot, 'assets/scripts/scenes/TableHandInteractionController.ts')
const { compilerPath, loadTypeScript } = require('./support/typescript.cjs')

assert.equal(fs.existsSync(compilerPath), true, 'a TypeScript compiler is required')
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

const { TableHandInteractionController } = require(controllerPath)
const classicRuleProfile = Object.freeze({
  allowA2345Straight: true,
  straightFlushAsBomb: true,
  enableTripleWithPair: true,
})
const rankValue = rank => ({ J: 11, Q: 12, K: 13, A: 14, Small: 16, Big: 17 }[rank] ?? Number(rank))
const card = (id, rank, suit = 'spade', overrides = {}) => ({
  id, rank, suit, value: rankValue(rank), isLevelCard: false, ...overrides,
})
const player = (id, hand = []) => ({
  id,
  name: id,
  isAI: id !== 'p1',
  team: id === 'p1' || id === 'p3' ? 'teamA' : 'teamB',
  hand,
  role: 'normal',
})
const snapshot = (hand, overrides = {}) => {
  const { state: stateOverrides, ...snapshotOverrides } = overrides
  return {
    state: {
      roundId: 1,
      currentLevel: 2,
      ruleProfile: classicRuleProfile,
      players: { p1: player('p1', hand), p2: player('p2'), p3: player('p3'), p4: player('p4') },
      currentTurn: 'p1',
      finishedPlayers: [],
      ...(stateOverrides ?? {}),
    },
    selectedCardIds: [],
    actionPending: false,
    playValidation: { code: 'empty', canPlay: false, resolution: null, requiredType: null },
    phase: 'playing',
    tribute: null,
    ...snapshotOverrides,
  }
}

const createAuthority = () => ({
  selectedCardIds: new Set(),
  toggleCalls: [],
  replaceCalls: [],
  clearCalls: 0,
  playCalls: 0,
  hintCalls: [],
  toggleCard (cardId) {
    this.toggleCalls.push(cardId)
    if (this.selectedCardIds.has(cardId)) this.selectedCardIds.delete(cardId)
    else this.selectedCardIds.add(cardId)
  },
  replaceSelectedCards (cardIds) {
    this.replaceCalls.push(cardIds.slice())
    this.selectedCardIds = new Set(cardIds)
  },
  clearRuleSelection () {
    this.clearCalls += 1
    this.selectedCardIds.clear()
  },
  hint (protectedGroups) { this.hintCalls.push(protectedGroups.map(group => ({ ...group, cardIds: group.cardIds.slice() }))) },
  playSelected () { this.playCalls += 1 },
})

const createHarness = (settingsOverrides = {}) => {
  const authority = createAuthority()
  const state = {
    humanId: 'p1',
    settings: {
      sortOrder: 'desc',
      autoSort: true,
      ruleProfile: classicRuleProfile,
      multiplayer: false,
      trustee: false,
      deadlinePlayerId: null,
      ...settingsOverrides,
    },
    refreshes: 0,
    toasts: [],
    notices: [],
    captured: [],
  }
  const controller = new TableHandInteractionController({
    ruleAuthority: authority,
    getHumanId: () => state.humanId,
    getRuntimeSettings: () => ({ ...state.settings }),
    refresh: () => { state.refreshes += 1 },
    showToast: message => state.toasts.push(message),
    showNotice: (title, detail) => state.notices.push([title, detail]),
    validationHint: validation => `validation:${validation.code}`,
    captureSelectedOrigins: ids => { state.captured.push(Array.from(ids)) },
  })
  return { authority, controller, state }
}

function verifyProjectionAndRuleSelection () {
  const hand = [
    card('pair-spade', 9, 'spade'), card('pair-heart', 9, 'heart'),
    card('pair-five-spade', 5, 'spade'), card('pair-five-heart', 5, 'heart'),
    card('loose-A', 'A', 'club'),
  ]
  const { authority, controller } = createHarness()
  const view = controller.submit(snapshot(hand))
  assert.equal(view.sortOrder, 'desc')
  assert.equal(view.interactive, true)
  assert.equal(view.groups.length, 2, 'each repeated physical rank must use one default stack projection')
  const stack = view.groups.find(group => group.cardIds.includes('pair-spade'))
  const secondStack = view.groups.find(group => group.cardIds.includes('pair-five-spade'))
  assert.ok(stack && secondStack)
  const bottomCardId = stack.cardIds.at(-1)
  const secondBottomCardId = secondStack.cardIds.at(-1)

  controller.handleCardToggle(bottomCardId)
  assert.deepEqual(authority.replaceCalls.at(-1), stack.cardIds, 'the visible stack bottom must select the whole stack atomically')
  controller.handleCardToggle(secondBottomCardId)
  assert.deepEqual(new Set(authority.replaceCalls.at(-1)), new Set(stack.cardIds.concat(secondStack.cardIds)), 'a second point stack must extend rather than replace the current rule selection')
  controller.handleCardToggle(bottomCardId)
  assert.deepEqual(new Set(authority.replaceCalls.at(-1)), new Set(secondStack.cardIds), 'pressing one selected stack again must remove only that stack')
  controller.handleCardToggle(secondBottomCardId)
  assert.deepEqual(authority.replaceCalls.at(-1), [], 'clearing the final selected stack must leave an empty rule selection')
  controller.handleCardToggle('loose-A')
  assert.deepEqual(authority.toggleCalls, ['loose-A'], 'an ordinary current-turn tap must stay in the rule authority')
}

function verifyOffTurnGroupingAndBlocking () {
  const hand = [card('five-a', 5, 'spade'), card('five-b', 5, 'heart'), card('loose', 'K', 'club')]
  const { authority, controller, state } = createHarness()
  let current = snapshot(hand, { state: { currentTurn: 'p2' } })
  let view = controller.submit(current)
  assert.equal(view.interactive, false, 'off-turn cards must be inert until locking is entered explicitly')
  controller.handleCardToggle('five-a')
  assert.equal(controller.submit(current).lockAction, 'start', 'an off-turn card tap must not silently start locking')
  controller.handleLockAction()
  assert.equal(controller.submit(current).interactionMode, 'lock-create')
  controller.handleCardToggle('five-a')
  controller.handleCardToggle('five-b')
  view = controller.submit(current)
  assert.deepEqual(view.lockDraftCardIds, ['five-a', 'five-b'])
  assert.equal(view.lockAction, 'commit')
  assert.deepEqual(authority.toggleCalls, [], 'off-turn grouping must never mutate rule selection')
  assert.equal(authority.clearCalls, 0, 'off-turn grouping must not clear an unrelated rule selection')
  controller.handleLockAction()
  view = controller.submit(current)
  const lockedPair = view.groups.find(group => group.kind === 'manual')
  assert.equal(view.lockAction, 'start')
  assert.equal(lockedPair?.locked, true, 'a recognized pair must commit as one explicit locked group')
  assert.deepEqual(new Set(view.lockedCardIds), new Set(['five-a', 'five-b']))

  controller.handleLockAction()
  controller.handleCardToggle('five-a')
  view = controller.submit(current)
  assert.equal(state.toasts.at(-1), '已选中锁牌组合，点击“解锁”拆分')
  assert.equal(view.lockAction, 'unlock')
  assert.deepEqual(new Set(view.lockDraftCardIds), new Set(['five-a', 'five-b']))
  controller.handleLockAction()
  view = controller.submit(current)
  assert.equal(view.lockAction, 'start')
  assert.deepEqual(view.lockedCardIds, [], 'unlock must remove persistent group ownership')

  controller.handleLockAction()
  controller.handleCardToggle('loose')
  assert.equal(controller.submit(current).lockAction, 'cancel')
  controller.handleLockAction()
  assert.equal(controller.submit(current).lockAction, 'start', 'an invalid one-card lock draft must cancel cleanly')

  state.settings.trustee = true
  view = controller.submit(current)
  assert.equal(view.interactive, false, 'trustee mode must block both rule and grouping input')
  const callCount = authority.toggleCalls.length
  controller.handleCardToggle('loose')
  assert.equal(authority.toggleCalls.length, callCount)

  state.settings.trustee = false
  current = snapshot(hand, { actionPending: true, state: { currentTurn: 'p2' } })
  assert.equal(controller.submit(current).interactive, false, 'an in-flight action must block off-turn grouping')
  current = snapshot(hand, { state: { currentTurn: 'p2', finishedPlayers: ['p1'] } })
  assert.equal(controller.submit(current).interactive, false, 'a finished hand must not re-enter grouping')
}

function verifyLockActionsRevalidateCurrentState () {
  const hand = [card('guard-nine-a', 9, 'spade'), card('guard-nine-b', 9, 'heart'), card('guard-loose', 4)]
  const { controller, state } = createHarness()
  let current = snapshot(hand, { state: { currentTurn: 'p2' } })
  const beginPairDraft = () => {
    controller.submit(current)
    controller.handleLockAction()
    controller.handleCardToggle('guard-nine-a')
    controller.handleCardToggle('guard-nine-b')
    assert.equal(controller.submit(current).lockAction, 'commit')
  }
  const selectLockedPair = () => {
    controller.submit(current)
    controller.handleLockAction()
    controller.handleCardToggle('guard-nine-a')
    assert.equal(controller.submit(current).lockAction, 'unlock')
  }
  controller.submit(current)

  state.settings.trustee = true
  controller.submit(current)
  controller.handleLockAction()
  let view = controller.submit(current)
  assert.equal(view.lockAction, 'start', 'trustee mode must not start a lock draft')
  assert.equal(state.toasts.at(-1), '当前阶段不能锁牌')

  state.settings.trustee = false
  beginPairDraft()

  current = snapshot(hand, { actionPending: true, state: { currentTurn: 'p2' } })
  controller.submit(current)
  controller.handleLockAction()
  view = controller.submit(current)
  assert.equal(view.lockAction, 'start', 'an in-flight action must retire rather than commit an existing lock draft')
  assert.deepEqual(view.lockedCardIds, [])

  current = snapshot(hand, { state: { currentTurn: 'p2' } })
  beginPairDraft()
  state.settings.trustee = true
  controller.submit(current)
  controller.handleLockAction()
  view = controller.submit(current)
  assert.equal(view.lockAction, 'start', 'trustee mode must retire rather than commit an existing lock draft')
  assert.deepEqual(view.lockedCardIds, [])

  state.settings.trustee = false
  beginPairDraft()
  current = snapshot(hand, { state: { currentTurn: 'p2', finishedPlayers: ['p1'] } })
  controller.submit(current)
  controller.handleLockAction()
  view = controller.submit(current)
  assert.equal(view.lockAction, 'start', 'a finished player must retire rather than commit an existing lock draft')
  assert.deepEqual(view.lockedCardIds, [])

  current = snapshot(hand, { state: { currentTurn: 'p2' } })
  beginPairDraft()
  controller.handleLockAction()
  view = controller.submit(current)
  assert.deepEqual(new Set(view.lockedCardIds), new Set(['guard-nine-a', 'guard-nine-b']))

  selectLockedPair()

  state.settings.trustee = true
  controller.submit(current)
  controller.handleLockAction()
  view = controller.submit(current)
  assert.equal(view.lockAction, 'start', 'trustee mode must retire the unlock draft without changing its group')
  assert.deepEqual(new Set(view.lockedCardIds), new Set(['guard-nine-a', 'guard-nine-b']))

  state.settings.trustee = false
  selectLockedPair()
  current = snapshot(hand, { actionPending: true, state: { currentTurn: 'p2' } })
  controller.submit(current)
  controller.handleLockAction()
  view = controller.submit(current)
  assert.equal(view.lockAction, 'start', 'an in-flight action must retire the unlock draft without changing its group')
  assert.deepEqual(new Set(view.lockedCardIds), new Set(['guard-nine-a', 'guard-nine-b']))

  current = snapshot(hand, { state: { currentTurn: 'p2' } })
  selectLockedPair()
  current = snapshot(hand, { state: { currentTurn: 'p2', finishedPlayers: ['p1'] } })
  controller.submit(current)
  controller.handleLockAction()
  view = controller.submit(current)
  assert.equal(view.lockAction, 'start', 'a finished player must retire the unlock draft without changing its group')
  assert.deepEqual(new Set(view.lockedCardIds), new Set(['guard-nine-a', 'guard-nine-b']))

  current = snapshot(hand, { state: { currentTurn: 'p2' } })
  selectLockedPair()
  controller.handleLockAction()
  assert.deepEqual(controller.submit(current).lockedCardIds, [], 'unlock must still succeed after the grouping window becomes legal again')
}

function verifyStraightFlushAndLockedArrangement () {
  const straightFlush = [6, 7, 8, 9, 10].map(rank => card(`club-${rank}`, rank, 'club'))
  const hand = straightFlush.concat(card('loose-Q', 'Q', 'spade'), card('loose-4', 4, 'diamond'))
  const { authority, controller, state } = createHarness()
  const current = snapshot(hand)
  authority.selectedCardIds.add('loose-Q')
  let view = controller.submit(current)
  assert.deepEqual(view.availableSuits, ['club'])

  controller.handleSuitIntent('club')
  view = controller.submit(current)
  assert.equal(authority.clearCalls, 1, 'current-turn grouping must clear only the live rule selection')
  assert.deepEqual(view.lockDraftCardIds, straightFlush.map(item => item.id))
  assert.equal(view.selectedSuit, 'club')
  assert.equal(view.lockAction, 'commit')
  controller.handleLockAction()
  view = controller.submit(current)
  const locked = view.groups.find(group => group.kind === 'straight-flush')
  assert.ok(locked, 'the selected suit candidate must commit as one straight-flush group')
  assert.equal(locked.locked, true)
  const lockedCopy = JSON.parse(JSON.stringify(locked))

  assert.equal(controller.handleArrangeIntent(), 'arranged')
  view = controller.submit(current)
  assert.deepEqual(view.groups.find(group => group.id === locked.id), lockedCopy, 'one-key arrangement must preserve explicit locks')
  assert.equal(view.arrangeRestoreAvailable, true)
  assert.equal(controller.handleArrangeIntent(), 'restored')
  view = controller.submit(current)
  assert.deepEqual(view.groups.find(group => group.id === locked.id), lockedCopy, 'restore must recover locked and loose baseline state')
  assert.equal(view.arrangeRestoreAvailable, false)

  controller.handleSuitIntent('spade')
  assert.equal(state.toasts.at(-1), '当前花色没有可组成的同花顺')
  assert.equal(controller.submit(current).lockAction, 'start')
}

function verifyPhaseAndAuthoritativeBoundaries () {
  const initialHand = [card('a', 3), card('b', 4), card('c', 5)]
  const { authority, controller, state } = createHarness({ sortOrder: 'asc', autoSort: false })
  let current = snapshot(initialHand, { state: { currentTurn: 'p2' } })
  let view = controller.submit(current)
  assert.deepEqual(view.displayCardIds, ['a', 'b', 'c'], 'disabled auto-sort must preserve the authoritative hand order')
  const autoSorted = createHarness({ sortOrder: 'asc', autoSort: true }).controller.submit(snapshot(initialHand))
  assert.deepEqual(autoSorted.displayCardIds, ['a', 'b', 'c'], 'friend-room auto-sort and direction must reach the workspace transaction')
  controller.handleLockAction()
  controller.handleCardToggle('a')
  assert.equal(controller.submit(current).lockAction, 'cancel')

  const changedHand = [card('c', 5), card('d', 6)]
  current = snapshot(changedHand, { state: { currentTurn: 'p2' } })
  view = controller.submit(current)
  assert.equal(view.lockAction, 'start', 'a changed authoritative hand must clear the lock draft')
  assert.deepEqual(view.displayCardIds, ['c', 'd'])

  controller.handleLockAction()
  controller.handleCardToggle('c')
  current = snapshot(changedHand, { phase: 'settlement', state: { currentTurn: 'p2' } })
  assert.equal(controller.submit(current).lockAction, 'start', 'leaving playing phase must retire the lock draft')

  const tribute = {
    isDoubleDown: false,
    isAntiTribute: false,
    phase: 'tributing',
    actions: [{ from: 'p1', to: 'p2', card: null, returnCard: null }],
  }
  const tributeHand = [card('tribute-nine-a', 9, 'spade'), card('tribute-nine-b', 9, 'heart'), card('tribute-loose', 4)]
  current = snapshot(tributeHand, { phase: 'tribute', tribute })
  assert.equal(controller.submit(current).interactive, true)
  const replaceCount = authority.replaceCalls.length
  controller.handleCardToggle('tribute-nine-a')
  assert.equal(authority.toggleCalls.at(-1), 'tribute-nine-a', 'tribute selection must continue through the rule authority one card at a time')
  assert.equal(authority.replaceCalls.length, replaceCount, 'a repeated-rank tribute card must not select its whole presentation stack')

  const returning = {
    isDoubleDown: false,
    isAntiTribute: false,
    phase: 'returning',
    actions: [{ from: 'p2', to: 'p1', card: card('received-tribute', 'A'), returnCard: null }],
  }
  current = snapshot(tributeHand, { phase: 'tribute', tribute: returning })
  assert.equal(controller.submit(current).interactive, true)
  controller.handleCardToggle('tribute-nine-b')
  assert.equal(authority.toggleCalls.at(-1), 'tribute-nine-b', 'return selection must also toggle exactly one repeated-rank card')
  assert.equal(authority.replaceCalls.length, replaceCount, 'return selection must never route through whole-stack replacement')

  state.settings.multiplayer = true
  state.settings.deadlinePlayerId = 'p2'
  assert.equal(controller.submit(current).interactive, false, 'multiplayer tribute must honor the authoritative deadline player')

  controller.resetForTableExit()
  const toggleCount = authority.toggleCalls.length
  controller.handleCardToggle('d')
  assert.equal(authority.toggleCalls.length, toggleCount, 'table exit must make retained hand callbacks inert')
}

function verifyPlayFeedbackBoundary () {
  const hand = [card('single', 8)]
  const { authority, controller, state } = createHarness()
  authority.selectedCardIds.add('single')
  controller.submit(snapshot(hand, {
    selectedCardIds: ['single'],
    playValidation: { code: 'not-high-enough', canPlay: false, resolution: null, requiredType: null },
  }))
  controller.playSelected()
  assert.deepEqual(state.toasts, ['validation:not-high-enough'])
  assert.deepEqual(state.captured, [['single']])
  assert.equal(authority.playCalls, 1, 'submission must stay delegated to the validating rule authority')

  state.toasts.length = 0
  controller.submit(snapshot(hand, {
    selectedCardIds: ['single'],
    playValidation: { code: 'valid', canPlay: true, resolution: null, requiredType: null },
  }))
  controller.playSelected()
  assert.deepEqual(state.toasts, [], 'valid submissions need no duplicate presentation message')
  assert.equal(authority.playCalls, 2)
}

function verifyExclusiveLockMode () {
  const hand = [card('lock-a', 6), card('lock-b', 6, 'heart'), card('loose-a', 'A')]
  const { authority, controller, state } = createHarness()
  const current = snapshot(hand)
  controller.submit(current)
  controller.handleLockAction()
  controller.handleCardToggle('lock-a')
  controller.handleCardToggle('lock-b')
  let view = controller.submit(current)
  assert.equal(view.interactionMode, 'lock-create')
  assert.deepEqual(new Set(view.lockDraftCardIds), new Set(['lock-a', 'lock-b']))
  assert.deepEqual(view.playSelectedCardIds, [], 'a lock draft must never masquerade as a playable selection')

  controller.handleHint()
  controller.playSelected()
  assert.equal(controller.handleArrangeIntent(), null)
  assert.equal(authority.hintCalls.length, 0, 'hint must not silently replace an active lock draft')
  assert.equal(authority.playCalls, 0, 'play must not submit the hidden rule selection while locking')
  assert.deepEqual(state.toasts.slice(-3), ['请先完成或取消锁牌', '请先完成或取消锁牌', '请先完成或取消锁牌'])
  view = controller.submit(current)
  assert.deepEqual(new Set(view.lockDraftCardIds), new Set(['lock-a', 'lock-b']), 'blocked commands must preserve the draft')

  controller.cancelManualSelection()
  view = controller.submit(current)
  assert.equal(view.interactionMode, 'play')
  assert.deepEqual(view.lockDraftCardIds, [])
}

function verifyHintProtectionProjection () {
  const hand = [card('locked-eight-a', 8), card('locked-eight-b', 8, 'heart'), card('loose-nine', 9)]
  const { authority, controller } = createHarness()
  let current = snapshot(hand, { state: { currentTurn: 'p2' } })
  controller.submit(current)
  controller.handleLockAction()
  controller.handleCardToggle('locked-eight-a')
  controller.handleCardToggle('locked-eight-b')
  controller.handleLockAction()

  current = snapshot(hand)
  controller.submit(current)
  controller.handleHint()
  assert.equal(authority.hintCalls.length, 1)
  assert.deepEqual(authority.hintCalls[0], [{
    id: authority.hintCalls[0][0].id,
    kind: 'locked',
    cardIds: ['locked-eight-a', 'locked-eight-b'],
  }], 'manual locks must reach the rule hint boundary as hard-protected card ids')

  const pairHarness = createHarness()
  pairHarness.controller.submit(snapshot(hand))
  pairHarness.controller.handleHint()
  assert.equal(pairHarness.authority.hintCalls[0].some(group =>
    group.kind === 'pair' && group.cardIds.includes('locked-eight-a') && group.cardIds.includes('locked-eight-b')), true,
  'an unlocked point stack must be classified as a pair rather than a UI lane')

  const rankedHand = [
    card('pair-5a', 5), card('pair-5b', 5, 'heart'),
    card('triple-7a', 7), card('triple-7b', 7, 'heart'), card('triple-7c', 7, 'club'),
    card('bomb-10a', 10), card('bomb-10b', 10, 'heart'), card('bomb-10c', 10, 'club'), card('bomb-10d', 10, 'diamond'),
  ]
  const rankedHarness = createHarness()
  rankedHarness.controller.submit(snapshot(rankedHand))
  rankedHarness.controller.handleHint()
  const kinds = rankedHarness.authority.hintCalls[0].map(group => group.kind).sort()
  assert.deepEqual(kinds, ['bomb', 'pair', 'triple'], 'rank stacks must project their actual pair, triple and bomb protection levels')
}

function verifyRoundBoundaryRetiresLocks () {
  const hand = [card('reused-nine-a', 9, 'spade'), card('reused-nine-b', 9, 'heart'), card('loose', 4)]
  const { controller } = createHarness()
  let current = snapshot(hand, { state: { roundId: 7, currentTurn: 'p2' } })
  controller.submit(current)
  controller.handleLockAction()
  controller.handleCardToggle('reused-nine-a')
  controller.handleCardToggle('reused-nine-b')
  controller.handleLockAction()
  assert.deepEqual(new Set(controller.submit(current).lockedCardIds), new Set(['reused-nine-a', 'reused-nine-b']))

  current = snapshot(hand, { state: { roundId: 8, currentTurn: 'p2' } })
  const nextRound = controller.submit(current)
  assert.deepEqual(nextRound.lockedCardIds, [], 'reused deck ids must not carry a manual lock into the next round')
  const rankStack = nextRound.groups.find(group => group.cardIds.includes('reused-nine-a'))
  assert.equal(rankStack?.origin, 'rank')
  assert.equal(rankStack?.locked, false)
}

verifyProjectionAndRuleSelection()
verifyOffTurnGroupingAndBlocking()
verifyLockActionsRevalidateCurrentState()
verifyStraightFlushAndLockedArrangement()
verifyPhaseAndAuthoritativeBoundaries()
verifyPlayFeedbackBoundary()
verifyExclusiveLockMode()
verifyHintProtectionProjection()
verifyRoundBoundaryRetiresLocks()
process.stdout.write('table hand interaction controller regression checks passed\n')
