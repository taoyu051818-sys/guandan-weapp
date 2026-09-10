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


function fixture (hand, settings = {}) {
  const harness = createHarness(settings)
  harness.current = snapshot(hand)
  harness.view = () => harness.controller.submit({ ...harness.current, selectedCardIds: [...harness.authority.selectedCardIds] })
  harness.view()
  return harness
}

// Decision queries are read-only, reject invalid combinations with an explicit reason,
// and mutations always revalidate against the latest hand instead of an old decision.
{
  const { HandWorkspace } = require('../assets/scripts/game/HandWorkspace.ts')
  const workspace = new HandWorkspace()
  const hand = [card('a', 8), card('b', 8, 'heart'), card('c', 9)]
  const options = { roundId: 1, levelRank: 2, direction: 'desc', autoSort: true, ruleProfile: classicRuleProfile }
  workspace.syncAuthoritativeHand(hand, options)
  const reject = (ids, reason) => {
    const before = JSON.stringify(workspace.snapshot)
    assert.deepEqual(workspace.getLockDecision(classicRuleProfile, ids), { kind: 'unavailable', reason })
    assert.equal(workspace.applySelectionLock(ids, classicRuleProfile), false)
    assert.equal(JSON.stringify(workspace.snapshot), before, 'unavailable decisions must not change grouping')
  }
  reject([], 'empty-selection')
  reject(['a', 'a'], 'stale-selection')
  reject(['a', 'gone'], 'stale-selection')
  reject(['a'], 'invalid-combination')
  reject(['a', 'c'], 'invalid-combination')
  const beforeQuery = JSON.stringify(workspace.snapshot)
  assert.deepEqual(workspace.getLockDecision(classicRuleProfile, ['a', 'b']), { kind: 'lock' })
  assert.equal(JSON.stringify(workspace.snapshot), beforeQuery)
  workspace.applySelectionLock(['a', 'b'], classicRuleProfile)
  reject(['a'], 'partial-lock')
  reject(['a', 'b', 'c'], 'mixed-selection')
  assert.deepEqual(workspace.getLockDecision(classicRuleProfile, ['a', 'b']), { kind: 'unlock' })
  workspace.syncAuthoritativeHand([hand[0], hand[2]], options)
  reject(['a', 'b'], 'stale-selection')
}

// Rendering and every command must agree on the common policy, including off-turn
// preparation and tribute carrying the previous round's finishing order.
for (const phase of ['playing', 'tribute', 'settlement']) {
  for (const currentTurn of ['p1', 'p2']) for (const actionPending of [false, true]) {
    for (const trustee of [false, true]) for (const finished of [false, true]) {
      const h = fixture([card('a', 8), card('b', 8, 'heart')], { trustee, multiplayer: true, deadlinePlayerId: 'p1' })
      h.current = snapshot([card('a', 8), card('b', 8, 'heart')], {
        phase, actionPending, state: { currentTurn, finishedPlayers: finished ? ['p1'] : [] },
        tribute: { phase: 'tributing', isAntiTribute: false, actions: [{ from: 'p1', to: 'p2' }] },
      })
      const available = !actionPending && !trustee && phase !== 'settlement' && (phase !== 'playing' || !finished)
      const canGroup = available && phase === 'playing'
      const canSubmit = canGroup && currentTurn === 'p1'
      const label = JSON.stringify({ phase, currentTurn, actionPending, trustee, finished })
      const view = h.view()
      assert.equal(view.interactive, available, label)
      assert.equal(h.controller.canInteractWithCurrentHand(), available, label)
      h.controller.handleCardToggle('a', true)
      assert.equal(h.authority.selectedCardIds.has('a'), available, label)
      h.authority.replaceSelectedCards(['a', 'b'])
      h.current.playValidation = { canPlay: true, code: 'valid' }
      assert.deepEqual(h.view().lockDecision, canGroup ? { kind: 'lock' } : { kind: 'unavailable', reason: 'interaction-blocked' }, label)
      h.controller.handleLockAction()
      assert.equal(h.view().lockedCardIds.length, canGroup ? 2 : 0, label)
      h.controller.handleHint()
      h.controller.playSelected()
      assert.equal(h.authority.hintCalls.length, canSubmit ? 1 : 0, label)
      assert.equal(h.authority.playCalls, canSubmit ? 1 : 0, label)
      assert.equal(h.controller.handleArrangeIntent() !== null, available, label)
    }
  }
}

// The preview helper must never clear the rule selection, and live settings must
// be rechecked without waiting for another snapshot/render.
{
  const h = fixture([3, 4, 5, 6, 7].map(rank => card(`preview-${rank}`, rank, 'club')))
  h.controller.handleSuitIntent('club')
  assert.equal(h.view().selectedSuit, 'club')
  const selected = [...h.authority.selectedCardIds]
  h.controller.clearSuitPreview(false)
  assert.equal(h.view().selectedSuit, null)
  assert.deepEqual([...h.authority.selectedCardIds], selected)
  h.state.settings.trustee = true
  h.controller.handleCardToggle('preview-3', false)
  h.controller.handleLockAction()
  h.controller.handleHint()
  h.controller.playSelected()
  assert.equal(h.controller.handleArrangeIntent(), null)
  assert.deepEqual([...h.authority.selectedCardIds], selected)
  assert.equal(h.authority.playCalls, 0)
  assert.equal(h.authority.hintCalls.length, 0)
  assert.deepEqual(h.view().lockedCardIds, [])
}

// Tribute selection has an additional participant/deadline gate. Arrangement does
// not: it must work while waiting, with anti-tribute, and after a tribute action.
for (const phase of ['tributing', 'returning']) {
  for (const multiplayer of [false, true]) for (const deadlinePlayerId of ['p1', 'p2', null]) {
    for (const status of ['own', 'other', 'completed', 'anti', 'done', 'missing']) {
      const h = fixture([card('tribute', 9)], { multiplayer, deadlinePlayerId })
      const action = phase === 'tributing' ? { from: 'p1', to: 'p2' } : { from: 'p2', to: 'p1' }
      if (status === 'other') { action.from = 'p2'; action.to = 'p3' }
      if (status === 'completed') action[phase === 'tributing' ? 'card' : 'returnCard'] = card('sent', 8)
      h.current = snapshot([card('tribute', 9)], {
        phase: 'tribute', state: { finishedPlayers: ['p1', 'p2', 'p3', 'p4'] },
        tribute: status === 'missing' ? null : { phase: status === 'done' ? 'done' : phase, isAntiTribute: status === 'anti', actions: [action] },
      })
      const canSelect = status === 'own' && (!multiplayer || deadlinePlayerId === 'p1')
      const label = JSON.stringify({ phase, multiplayer, deadlinePlayerId, status })
      assert.equal(h.view().interactionMode, 'tribute', label)
      assert.equal(h.view().interactive, canSelect, label)
      h.controller.handleCardToggle('tribute', true)
      assert.equal(h.authority.selectedCardIds.has('tribute'), canSelect, label)
      assert.notEqual(h.controller.handleArrangeIntent(), null, label)
    }
  }
}

// The visible selection is the only selection: select -> lock -> restore.
for (const currentTurn of ['p1', 'p2']) {
  const h = fixture([card('nine-a', 9), card('nine-b', 9, 'heart'), card('loose', 4)])
  h.current.state.currentTurn = currentTurn
  h.view()
  h.controller.handleLockAction()
  assert.match(h.state.toasts.at(-1), /请先选择/)
  assert.equal(h.view().interactionMode, 'play', 'empty lock cannot enter a hidden editing mode')
  h.controller.handleCardToggle('nine-a')
  assert.deepEqual(h.view().lockDecision, { kind: 'unavailable', reason: 'invalid-combination' }, 'one card cannot lock')
  h.controller.handleLockAction()
  assert.deepEqual([...h.authority.selectedCardIds], ['nine-a'], 'invalid input remains selected for correction')
  h.controller.handleCardToggle('nine-b', true)
  assert.deepEqual(h.view().lockDecision, { kind: 'lock' })
  h.controller.handleLockAction()
  assert.equal(h.authority.clearCalls, 0, 'locking must not clear the selected cards')
  assert.deepEqual(new Set(h.view().lockedCardIds), new Set(['nine-a', 'nine-b']))
  assert.deepEqual(h.view().lockDecision, { kind: 'unlock' }, 'the same selected group can immediately be restored')
  for (const id of ['nine-a', 'nine-b']) {
    h.controller.handleCardToggle(id, false)
    assert.equal(h.authority.selectedCardIds.size, 0, 'every locked member cancels the whole group')
    h.controller.handleCardToggle(id, true)
    assert.equal(h.authority.selectedCardIds.size, 2, 'every locked member selects the whole group')
    h.controller.handleCardToggle(id, true)
    assert.equal(h.authority.selectedCardIds.size, 2, 'repeated drag target does not toggle it off')
  }
  h.controller.handleCardToggle('loose', true)
  assert.deepEqual(h.view().lockDecision, { kind: 'unavailable', reason: 'mixed-selection' }, 'mixing a lock and loose cards cannot silently relock/split')
  h.controller.handleLockAction()
  assert.equal(h.view().lockedCardIds.length, 2)
  h.controller.handleCardToggle('loose', false)
  h.controller.handleLockAction()
  assert.deepEqual(h.view().lockedCardIds, [])
  h.controller.handleCardToggle('nine-a', false)
  assert.deepEqual([...h.authority.selectedCardIds], ['nine-b'], 'restored upper card becomes individually selectable')
}

// Both manual and suit shortcuts share rule selection, and keep normal actions visible.
for (const smart of [false, true]) {
  const hand = [3, 4, 5, 6, 7].map(rank => card('flush-' + rank, rank, 'club'))
  const h = fixture(hand.concat(card('loose', 'A')))
  if (smart) h.controller.handleArrangeIntent()
  h.controller.handleSuitIntent('club')
  assert.equal(h.authority.selectedCardIds.size, 5)
  assert.equal(h.view().playSelectedCardIds.length, 5)
  assert.deepEqual(h.view().lockDecision, { kind: 'lock' })
  assert.equal(h.view().interactionMode, 'play')
  h.controller.handleLockAction()
  const group = h.view().groups.find(g => g.locked)
  assert.ok(group)
  assert.deepEqual(h.view().lockDecision, { kind: 'unlock' })
  h.controller.handleArrangeIntent()
  assert.equal(h.view().lockedCardIds.length, 5, 'arrange/restore cannot retire explicit locks')
  for (const id of group.cardIds) {
    h.controller.handleCardToggle(id, false)
    assert.equal(h.authority.selectedCardIds.size, 0)
  }
  for (const id of group.cardIds) {
    h.controller.handleCardToggle(id, true)
    assert.equal(h.authority.selectedCardIds.size, 5)
  }
  h.controller.handleHint()
  assert.ok(h.authority.hintCalls.at(-1).some(g => g.kind === 'locked' && g.cardIds.length === 5))
  h.current.playValidation = { canPlay: true, code: 'valid' }
  h.view()
  h.controller.playSelected()
  assert.equal(h.authority.playCalls, 1, 'a selected locked group is playable without an extra confirmation mode')
  h.controller.handleLockAction()
  assert.equal(h.view().lockedCardIds.length, 0)
}

// Loose smart stacks keep their per-card cancellation behavior.
{
  const h = fixture([3, 4, 5, 6, 7].map(rank => card('loose-' + rank, rank, 'club')))
  h.controller.handleArrangeIntent()
  const group = h.view().groups[0]
  h.controller.handleCardToggle(group.cardIds.at(-1), true)
  h.controller.handleCardToggle(group.cardIds[0], false)
  assert.equal(h.authority.selectedCardIds.size, 4)
}

// Revalidate phase/pending/trustee guards at commit time, not just button projection.
for (const blocked of ['pending', 'trustee', 'finished', 'settlement', 'tribute']) {
  const h = fixture([card('a', 8), card('b', 8, 'heart')])
  h.authority.replaceSelectedCards(['a', 'b'])
  h.view()
  if (blocked === 'pending') h.current.actionPending = true
  if (blocked === 'trustee') h.state.settings.trustee = true
  if (blocked === 'finished') h.current.state.finishedPlayers = ['p1']
  if (blocked === 'settlement' || blocked === 'tribute') h.current.phase = blocked
  h.view()
  h.controller.handleLockAction()
  assert.equal(h.view().lockedCardIds.length, 0, blocked)
  assert.deepEqual(h.view().lockDecision, { kind: 'unavailable', reason: 'interaction-blocked' })
}

// Partial/stale authoritative hands, round resets, and room tools.
{
  const h = fixture([card('a', 8), card('b', 8, 'heart')])
  h.authority.replaceSelectedCards(['a', 'b'])
  h.view()
  h.controller.handleLockAction()
  h.current.state.roundId = 2
  assert.equal(h.view().lockedCardIds.length, 0, 'deck IDs reused next round do not retain locks')
  h.current.state.players.p1.hand = [card('a', 8)]
  h.view()
  h.controller.handleLockAction()
  assert.equal(h.view().lockedCardIds.length, 0, 'stale selected IDs cannot lock')
  h.state.settings.autoSort = false
  assert.equal(h.controller.handleArrangeIntent(), null)
  h.controller.resetForRound()
  assert.equal(h.view().arrangeRestoreAvailable, false)
}

// More than one whole locked group may be restored together.
{
  const h = fixture([card('a', 8), card('b', 8, 'heart'), card('c', 9), card('d', 9, 'heart')])
  for (const ids of [['a', 'b'], ['c', 'd']]) {
    h.authority.replaceSelectedCards(ids)
    h.view()
    h.controller.handleLockAction()
  }
  h.authority.replaceSelectedCards(['a', 'b', 'c', 'd'])
  assert.deepEqual(h.view().lockDecision, { kind: 'unlock' })
  h.controller.handleLockAction()
  assert.equal(h.view().lockedCardIds.length, 0)
}

function verifyFinishedTeammateView () {
  const { TeammateHandProjector } = require('../assets/scripts/game/TeammateHandProjector.ts')
  const projector = new TeammateHandProjector()
  const ids = ['p1', 'p2', 'p3', 'p4']
  for (const humanId of ids) {
    const teammates = { p1: 'p3', p2: 'p4', p3: 'p1', p4: 'p2' }
    const teammateId = teammates[humanId]
    const cards = [card('pair-A', 'A'), card('pair-A2', 'A', 'heart'), card('five', 5)]
    const current = snapshot([], { state: {
      currentTurn: teammateId, finishedPlayers: [humanId],
      players: Object.fromEntries(ids.map(id => [id, player(id, id === humanId ? [] : cards.map(c => ({ ...c, id: `${id}-${c.id}` })))])),
    } })
    const saved = JSON.stringify(current)
    const view = projector.project(current, humanId, 'desc')
    assert.equal(view.view.playerId, teammateId)
    assert.equal(view.view.available, true)
    assert.equal(view.hand.interactive, false)
    assert.equal(view.hand.interactionMode, 'blocked')
    assert.deepEqual(view.hand.playSelectedCardIds, [])
    assert.deepEqual(view.hand.availableSuits, [])
    assert.equal(view.hand.groups.length, 1, 'readonly hand retains downward rank stacks')
    assert.equal(JSON.stringify(current), saved, 'view projection cannot rewrite rules or seat ownership')
    assert.deepEqual(projector.project(current, humanId, 'desc'), view, 'repeated snapshots stay stable')
    current.state.players[teammateId].hand.pop()
    assert.equal(projector.project(current, humanId, 'desc').hand.hand.length, 2, 'live teammate play updates immediately')
    current.state.players[teammateId].hand = [{ id: `hidden-${teammateId}-0` }]
    const denied = projector.project(current, humanId, 'desc')
    assert.equal(denied.view.available, false)
    assert.deepEqual(denied.hand.hand, [], 'revoked or missing data clears previous teammate cards; no placeholder faces')
    for (const phase of ['tribute', 'settlement']) assert.equal(projector.project({ ...current, phase }, humanId, 'desc'), null)
    current.state.finishedPlayers.push(teammateId)
    assert.equal(projector.project(current, humanId, 'desc'), null, 'both finished stops teammate view')
    current.state.finishedPlayers = []
    assert.equal(projector.project(current, humanId, 'desc'), null, 'next round returns to own hand')
  }
  const { controller, authority } = createHarness({ multiplayer: true })
  const finished = snapshot([], { state: { finishedPlayers: ['p1'], currentTurn: 'p3' } })
  controller.submit(finished)
  controller.handleCardToggle('p3-card')
  controller.playSelected()
  controller.handleHint()
  controller.handleLockAction()
  assert.equal(controller.handleArrangeIntent(), null)
  assert.deepEqual(authority.toggleCalls, [])
  assert.equal(authority.playCalls, 0, 'finished viewer never dispatches a play command')
  assert.deepEqual(authority.hintCalls, [])
  const nextRound = controller.submit(snapshot([card('own-next', 9)], { state: { roundId: 2 } }))
  assert.equal(nextRound.interactive, true, 'new round restores own selection permissions')
  controller.handleCardToggle('own-next')
  assert.ok(authority.toggleCalls.includes('own-next'))
  projector.reset()
}
verifyFinishedTeammateView()
process.stdout.write('table hand interaction controller regression checks passed\n')

for (const phase of ['tributing', 'returning']) {
  const { controller, authority } = createHarness({ multiplayer: true, deadlinePlayerId: 'p2' })
  const hand = [card('tribute-a', 7, 'spade'), card('tribute-b', 7, 'heart'), card('tribute-c', 7, 'club'), card('tribute-d', 4)]
  const current = snapshot(hand, { phase: 'tribute', tribute: { phase, isAntiTribute: false, actions: [{ from: 'p1', to: 'p2' }] } })
  controller.submit(current)
  assert.notEqual(controller.handleArrangeIntent(), null, 'tribute arrangement is allowed even while another player owes tribute')
  assert.equal(controller.submit(current).interactionMode, 'tribute', 'arranging must not enter lock/play mode')
  assert.equal(authority.toggleCalls.length, 0, 'arranging does not submit tribute or change rule selection')
  controller.submit({ ...current, actionPending: true })
  assert.equal(controller.handleArrangeIntent(), null, 'pending tribute still guards layout operations')
}
