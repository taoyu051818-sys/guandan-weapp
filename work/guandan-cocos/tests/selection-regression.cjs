const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const { compilerPath, loadTypeScript } = require('./support/typescript.cjs')
const gameManagerPath = path.join(projectRoot, 'assets/scripts/game/GameManager.ts')
const networkMatchSnapshotControllerPath = path.join(projectRoot, 'assets/scripts/game/NetworkMatchSnapshotController.ts')
const localHandSelectionControllerPath = path.join(projectRoot, 'assets/scripts/game/LocalHandSelectionController.ts')
const handInteractionPolicyPath = path.join(projectRoot, 'assets/scripts/game/HandInteractionPolicy.ts')
const handInteractionStatePath = path.join(projectRoot, 'assets/scripts/game/HandInteractionState.ts')
const handDragSelectionPolicyPath = path.join(projectRoot, 'assets/scripts/game/HandDragSelectionPolicy.ts')
const handControllerPath = path.join(projectRoot, 'assets/scripts/ui/HandController.ts')
const cardViewPath = path.join(projectRoot, 'assets/scripts/ui/CardView.ts')
const handStackLayoutPath = path.join(projectRoot, 'assets/scripts/game/HandStackLayout.ts')
const gameScenePath = path.join(projectRoot, 'assets/scripts/scenes/GameScene.ts')
const tableMatchCoordinatorPath = path.join(projectRoot, 'assets/scripts/scenes/TableMatchCoordinator.ts')
const tableHandInteractionControllerPath = path.join(projectRoot, 'assets/scripts/scenes/TableHandInteractionController.ts')
const tableOverlayControllerPath = path.join(projectRoot, 'assets/scripts/scenes/TableOverlayController.ts')
const tableTurnClockControllerPath = path.join(projectRoot, 'assets/scripts/scenes/TableTurnClockController.ts')
const playerSeatPath = path.join(projectRoot, 'assets/scripts/ui/PlayerSeatController.ts')
const lobbyControllerPath = path.join(projectRoot, 'assets/scripts/network/LobbyController.ts')
const lobbyMessageRouterPath = path.join(projectRoot, 'assets/scripts/network/LobbyMessageRouter.ts')
const lobbySyncTrackerPath = path.join(projectRoot, 'assets/scripts/network/LobbySyncTracker.ts')
const webBuildPath = path.join(projectRoot, 'build/web-desktop')

function readUtf8 (filePath) {
  return fs.readFileSync(filePath, 'utf8')
}

function countMatches (source, pattern) {
  return [...source.matchAll(pattern)].length
}

function loadPureTs (filePath) {
  assert.equal(fs.existsSync(compilerPath), true, 'Cocos Creator TypeScript compiler is required')
  const ts = loadTypeScript()
  const result = ts.transpileModule(readUtf8(filePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
    fileName: filePath,
    reportDiagnostics: true,
  })
  const errors = (result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
  assert.deepEqual(errors, [], `failed to transpile ${filePath}`)
  const module = { exports: {} }
  new Function('exports', 'module', 'require', '__filename', '__dirname', result.outputText)(module.exports, module, require, filePath, path.dirname(filePath))
  return module.exports
}

function verifySourceConversions () {
  const gameManager = readUtf8(gameManagerPath)
  const networkMatchSnapshotController = readUtf8(networkMatchSnapshotControllerPath)
  const localHandSelectionController = readUtf8(localHandSelectionControllerPath)
  const handController = readUtf8(handControllerPath)
  const cardView = readUtf8(cardViewPath)
  const stackLayout = readUtf8(handStackLayoutPath)
  const gameScene = readUtf8(gameScenePath)
  const tableMatchCoordinator = readUtf8(tableMatchCoordinatorPath)
  const tableHandInteractionController = readUtf8(tableHandInteractionControllerPath)
  const tableOverlayController = readUtf8(tableOverlayControllerPath)
  const tableTurnClockController = readUtf8(tableTurnClockControllerPath)
  const playerSeat = readUtf8(playerSeatPath)
  const lobbyController = readUtf8(lobbyControllerPath)
  const lobbyMessageRouter = readUtf8(lobbyMessageRouterPath)
  const lobbySyncTracker = readUtf8(lobbySyncTrackerPath)

  assert.equal(fs.existsSync(handInteractionPolicyPath), true, 'the shared hand-interaction policy must exist')
  assert.equal(fs.existsSync(`${handInteractionPolicyPath}.meta`), true, 'the hand-interaction policy must have Cocos metadata')
  assert.equal(fs.existsSync(handDragSelectionPolicyPath), true, 'the mobile drag-selection policy must exist')
  assert.equal(fs.existsSync(`${handDragSelectionPolicyPath}.meta`), true, 'the drag-selection policy must have Cocos metadata')
  assert.equal(fs.existsSync(localHandSelectionControllerPath), true, 'the playable selection controller must exist')
  assert.equal(fs.existsSync(`${localHandSelectionControllerPath}.meta`), true, 'the playable selection controller must have Cocos metadata')

  assert.equal(
    countMatches(gameManager, /Array\.from\(this\.selectedCardIds\)/g) >= 1,
    true,
    'GameManager must materialize its snapshot selection with Array.from',
  )
  assert.doesNotMatch(
    gameManager,
    /\[\.\.\.this\.selectedCardIds\]/,
    'Do not spread a Set in GameManager; the Creator web build can emit [].concat(set)',
  )
  assert.match(
    handController,
    /Array\.from\(cardIds\)/,
    'HandController.captureCardOrigins must materialize its Iterable with Array.from',
  )
  assert.doesNotMatch(
    handController,
    /\[\.\.\.cardIds\]/,
    'Do not spread a generic Iterable in HandController; the Creator web build can emit [].concat(iterable)',
  )
  assert.match(
    networkMatchSnapshotController,
    /applyServerState[\s\S]*?this\.commit\(state,[\s\S]*?this\.ports\.clearSelection\(\)/,
    'authoritative recovery snapshots must clear choices from an earlier turn',
  )
  assert.match(localHandSelectionController, /canSelectPlayingHand\(context\.state, context\.humanId, context\.actionPending\)/, 'the selection controller must use the shared playing-hand policy')
  assert.match(tableHandInteractionController, /canSelectPlayingHand\(snapshot\.state, humanId, snapshot\.actionPending\)/, 'the hand interaction owner must use the same playing-hand policy')
  assert.match(localHandSelectionController, /diagnosePlay\(cards, context\.state\.lastValidPlay, context\.state\.ruleProfile\)/, 'selection feedback must use the shared authoritative play diagnosis and explicit profile')
  assert.match(gameManager, /diagnosePlay\(cards, this\.state\.lastValidPlay, this\.ruleProfile\)/, 'submission must repeat authoritative diagnosis before local or network dispatch')
  assert.match(gameManager, /if \(!validation\.canPlay\) return this\.emitSnapshot\(playValidationHint\(validation\)\)/, 'both local and network submissions must stop before sending an invalid selection')
  assert.match(gameManager, /playValidation,\s*phase:/, 'GameManager snapshots must expose the current play validation to presentation')
  assert.match(tableMatchCoordinator, /const visible = \[controls\.hint, controls\.pass, controls\.play\]/, 'the three turn actions must be stable throughout the human action window')
  assert.match(gameScene, /this\.hintButton\?\.on\(Node\.EventType\.TOUCH_END, this\.tableHandInteraction\.handleHint, this\.tableHandInteraction\)/, 'the hint button must route through the hand coordinator so locks are visible to the policy')
  assert.match(gameScene, /this\.hintButton\?\.off\(Node\.EventType\.TOUCH_END, this\.tableHandInteraction\.handleHint, this\.tableHandInteraction\)/, 'scene teardown must release the exact hint controller binding')
  assert.doesNotMatch(gameScene, /this\.hintButton\?\.on\(Node\.EventType\.TOUCH_END, manager\.hint, manager\)/, 'the scene must not bypass hand protection when requesting a hint')
  assert.doesNotMatch(tableMatchCoordinator, /selectedCardIds\.length && .*resetButton|playValidation\.canPlay && .*play/, 'selection state must not control action-button visibility')
  assert.doesNotMatch(gameScene, /resetButton|ResetButton|'重置'/, 'the obsolete table reset action must be removed completely')
  assert.match(tableHandInteractionController, /public playSelected[\s\S]*!snapshot\.playValidation\.canPlay[\s\S]*showToast\(this\.dependencies\.validationHint\(snapshot\.playValidation\)\)[\s\S]*ruleAuthority\.playSelected\(\)/, 'the always-visible play action must explain an invalid click while retaining authoritative submission validation')
  assert.match(cardView, /public bind[\s\S]*?this\.syncInputBinding\(\)/, 'rebinding a card must refresh touch handlers when interaction becomes available again')
  assert.match(cardView, /CardSelectionOverlay/, 'selection feedback must render on a dedicated layer above the classic PNG face')
  assert.match(cardView, /new Color\(8, 18, 24, 82\)/, 'selected cards must receive a neutral darkening wash')
  assert.match(cardView, /strokeColor = new Color\(255, 205, 64, 255\)[\s\S]*?lineWidth = 4/, 'selected cards must retain one heavy high-contrast outline')
  assert.match(cardView, /locked\?: boolean/, 'card presentation must expose an independent persistent lock state')
  assert.match(cardView, /CardLockOverlay[\s\S]*new Color\(48, 205, 226, 255\)/, 'locked cards must use a dedicated cool-colour overlay distinct from gold selection')
  assert.match(cardView, /if \(this\.stackCovered\)[\s\S]*this\.hitAreaHeight[\s\S]*selectionOverlay\.roundRect/, 'selected covered cards must paint the full exposed strip')
  assert.match(cardView, /configureStackHitArea[\s\S]*refreshStateVisuals\(\)/, 'changing stack exposure must redraw selection and lock overlays')
  assert.match(stackLayout, /export const STACK_EXPOSURE_HEIGHT = 40/, 'every rank lane must use one fixed point-sized exposure')
  assert.match(stackLayout, /return STACK_EXPOSURE_HEIGHT/, 'large stacks must not compress their per-card exposure')
  assert.doesNotMatch(cardView, /StackRankSuit|StackCornerRank|StackCornerSuit|contentHeight|rankWidth|suitWidth/, 'compressed hit areas must not shrink or replace card artwork')
  assert.doesNotMatch(cardView, /SelectedCardCapHitArea|configureSelectedCapHitArea/, 'flat selection must not keep the obsolete raised-card cap target')
  assert.doesNotMatch(cardView, /selected \? 32|selectionPosition/, 'selecting a hand card must never change its vertical position')
  assert.doesNotMatch(cardView, /lineTo\(-2, 59\)|lineTo\(9, 69\)/, 'the obsolete selected-card check mark must not be drawn')
  assert.match(cardView, /Node\.EventType\.TOUCH_MOVE/, 'card hit areas must forward continuous touch movement on mobile')
  assert.match(cardView, /public hitTestScreenPoint[\s\S]*?\.hitTest\(point\)/, 'the dedicated hit area must support screen-space swipe resolution')
  assert.match(handController, /new HandDragSelectionPolicy\(\)/, 'one hand-level policy must own the active pointer gesture')
  assert.match(handController, /LONG_PRESS_SELECTION_SECONDS = 0\.3[\s\S]*scheduleOnce\(this\.activateLongPressSelection/, 'a stationary long press must activate mobile sweep selection')
  assert.doesNotMatch(handController, /leftSelectedLoose|rightSelectedLoose/, 'selection must never move a card to a higher render layer')
  assert.match(handController, /sampleHandDragSegment[\s\S]*?findTopCardAt/, 'fast movement must be sampled across every crossed card hit area')
  assert.match(handController, /public setTouchExclusionPredicate \(/, 'the hand must accept a presentation-layer touch exclusion predicate')
  assert.match(handController, /isTouchExcluded\(detail\.screenPoint\)[\s\S]*dragSelection\.cancel\(detail\.pointerId\)/, 'touches that enter a HUD control must cancel the hand gesture')
  assert.match(handController, /findTopCardAt[\s\S]*if \(this\.isTouchExcluded\(screenPoint\)\) return null/, 'drag sampling must not select cards beneath an overlapping HUD control')
  assert.match(handController, /right\[1\]\.getSiblingIndex\(\) - left\[1\]\.getSiblingIndex\(\)/, 'overlaps must resolve to the visually topmost hand card')
  assert.match(handController, /lockedCardIds\?: readonly string\[\][\s\S]*locked: lockedIds\.has\(card\.id\)/, 'the optional lock projection must reach every card presentation')
  assert.doesNotMatch(handController, /node\.setScale|scale:\s*(?:selected|locked)/, 'selection and lock projection must not alter card-node scale')
  assert.match(cardView, /Math\.max\(1, Math\.min\(visibleWidth, spacing\)\)/, 'narrow-screen hit targets must not overlap their fan spacing')
  assert.match(tableTurnClockController, /roomStatus === 'ready'/, 'multiplayer countdown and actions must wait for room recovery')
  assert.match(tableTurnClockController, /reset \(\): void[\s\S]*?this\.countdownKey = ''[\s\S]*?this\.remainingSeconds = DEFAULT_TURN_SECONDS/, 'leaving the table must reset countdown identity and value')
  assert.match(gameScene, /this\.tableTurnClock\?\.reset\(\)/, 'the composition root must reset its countdown owner on table exit')
  assert.match(tableMatchCoordinator, /if \(controls\.hintLabel\) controls\.hintLabel\.node\.active = false/, 'persistent engine hint chrome must remain retired')
  assert.match(tableOverlayController, /this\.ownChatLabel\.node\.setPosition\(new Vec3\([\s\S]*-viewport\.halfWidth \+ viewport\.safeLeft \+ 220,[\s\S]*viewport\.halfHeight - viewport\.safeTop - 235/, 'the visible local quick-chat echo must stay in the upper-left table lane, clear of the hand and actions')
  assert.match(tableOverlayController, /const safeTop = viewport\.halfHeight - viewport\.safeTop - 158[\s\S]*const safeBottom = -viewport\.halfHeight \+ viewport\.safeBottom \+ 260[\s\S]*Math\.min\(560, safeWidth - 32\)/, 'short-lived table feedback must be constrained to its central safe corridor')
  assert.doesNotMatch(gameScene, /statusLaneWidth|statusLaneY/, 'retired persistent side status rails must not continue reserving or overlapping space')
  const connectivityStart = tableMatchCoordinator.indexOf('private syncSeatConnections')
  const connectivityEnd = tableMatchCoordinator.indexOf('private prepareRecoveryVisualBaseline', connectivityStart)
  assert.notEqual(connectivityStart, -1, 'the match coordinator must project authoritative room membership onto seats')
  assert.notEqual(connectivityEnd, -1, 'seat connectivity projection must remain a bounded presentation method')
  const connectivitySource = tableMatchCoordinator.slice(connectivityStart, connectivityEnd)
  assert.match(connectivitySource, /snapshot\.members\.includes\(id\)/, 'seat connectivity must derive from authoritative room members')
  assert.match(connectivitySource, /seat\.setOffline/, 'missing room members must be projected through the seat UI')
  assert.doesNotMatch(
    connectivitySource,
    /selectedCardIds|toggleCard|clearSelected|applyServerState|hand\?\.render/,
    'seat connectivity updates must not enter the hand-selection state machine',
  )
  assert.match(playerSeat, /showConnectionStatus\('离线'/, 'offline seats must display a dedicated status badge')
  assert.match(playerSeat, /showConnectionStatus\('已恢复'/, 'reconnected seats must briefly confirm recovery')
  assert.match(lobbyController, /resumeToken/, 'room recovery must use a private resume token')
  assert.match(lobbyController, /new LobbyMessageRouter\(/, 'the lobby controller must compose the server-message owner')
  assert.match(lobbyMessageRouter, /acceptRoomMessage/, 'late room messages must be filtered after leaving')
  assert.match(lobbyMessageRouter, /sync\.acceptVersion\(/, 'the message owner must gate same-version events by type')
  assert.match(lobbySyncTracker, /processedVersionedEvents/, 'duplicate authoritative state packets must not clear a fresh selection')
}

function verifyTurnInteractionLifecycle () {
  const { canSelectPlayingHand } = loadPureTs(handInteractionPolicyPath)
  const { HandInteractionStateMachine } = loadPureTs(handInteractionStatePath)
  const state = (currentTurn, finishedPlayers = []) => ({ currentTurn, finishedPlayers })

  assert.equal(canSelectPlayingHand(state('p1'), 'p1', false), true, 'the local hand must be interactive on its turn')
  assert.equal(canSelectPlayingHand(state('p2'), 'p1', false), false, 'the local hand must stop accepting taps on another turn')
  assert.equal(canSelectPlayingHand(state('p1'), 'p1', false), true, 'interaction must return when the turn cycles back')
  assert.equal(canSelectPlayingHand(state('p1'), 'p1', true), false, 'a pending network intent must temporarily lock the hand')
  assert.equal(canSelectPlayingHand(state('p1'), 'p1', false), true, 'a rejected or completed intent must release the temporary lock')
  assert.equal(canSelectPlayingHand(state('p1', ['p1']), 'p1', false), false, 'a player who has finished must not keep selecting cards')

  const machine = new HandInteractionStateMachine()
  const context = overrides => ({ phase: 'playing', isCurrentTurn: true, actionPending: false, trustee: false, finished: false, ...overrides })
  assert.equal(machine.sync(context({})).mode, 'play')
  assert.equal(machine.sync(context({ isCurrentTurn: false })).mode, 'blocked', 'off-turn tapping must remain blocked until locking is explicit')
  assert.equal(machine.startLock(), true, 'the lock control may explicitly enter grouping off-turn')
  assert.equal(machine.state.mode, 'lock-create')
  assert.equal(machine.sync(context({ isCurrentTurn: false, actionPending: true })).mode, 'blocked', 'a pending intent must retire lock mode')
  assert.equal(machine.startLock(), false)
}

function verifyOffTurnGroupingIsolation () {
  const handInteraction = readUtf8(tableHandInteractionControllerPath)
  const handlerStart = handInteraction.indexOf('public handleCardToggle')
  const handlerEnd = handInteraction.indexOf('public playSelected', handlerStart)
  assert.notEqual(handlerStart, -1, 'the card-toggle handler must exist')
  assert.notEqual(handlerEnd, -1, 'the card-toggle handler must remain bounded')
  const handler = handInteraction.slice(handlerStart, handlerEnd)
  assert.match(handler, /const mode = this\.interaction\.state\.mode[\s\S]*mode === 'play' \|\| mode === 'tribute'/, 'card taps must route through the exclusive interaction mode')
  assert.match(handler, /mode !== 'lock-create' && mode !== 'lock-unlock'\) return/, 'blocked off-turn taps must not start a lock draft implicitly')
  assert.match(handler, /if \(!this\.canInteract\(snapshot, humanId, settings\)\) return[\s\S]*ruleAuthority\.toggleCard\(cardId\)/, 'only the authoritative action path may reach normal rule selection')
  assert.match(handInteraction, /this\.interaction\.startLock\(\)/, 'only the explicit lock action may enter lock-create mode')
  assert.match(handInteraction, /clearCurrentTurnRuleSelection[\s\S]*canSelectPlayingHand\(snapshot\.state, humanId, snapshot\.actionPending\)[\s\S]*ruleAuthority\.clearRuleSelection\(\)/, 'switching modes may clear rule selection only while the local player can legally act')
  assert.match(handInteraction, /!this\.interaction\.isLocking && this\.workspace\.isManualSelectionActive[\s\S]*workspace\.cancelManualSelection\(\)/, 'phase and authority changes must retire lock drafts through the state machine')
  const coordinator = readUtf8(tableMatchCoordinatorPath)
  assert.match(coordinator, /interactionMode === 'lock-create' \|\| interactionMode === 'lock-unlock'\) return/, 'play, pass and hint controls must be hidden while the lock transaction is active')
}

function verifySelectionSnapshotSemantics () {
  const selected = new Set()
  const snapshot = () => Array.from(selected)

  assert.deepEqual(snapshot(), [], 'an empty selection must emit an empty array')
  selected.add('card-heart-2')
  assert.deepEqual(snapshot(), ['card-heart-2'], 'a selected card id must be emitted directly')
  assert.equal(snapshot().includes('card-heart-2'), true, 'the hand view must be able to find the selected id')
  selected.delete('card-heart-2')
  assert.deepEqual(snapshot(), [], 'deselecting the card must return to an empty array')

  selected.add('old-turn-card')
  selected.clear()
  assert.deepEqual(snapshot(), [], 'an authoritative server snapshot must not restore a previous-turn choice')

  const originIds = Array.from(new Set(['left-card', 'right-card']))
  assert.deepEqual(originIds, ['left-card', 'right-card'], 'flight origins must receive card ids, not a Set wrapper')
}

function verifyDragSelectionPolicy () {
  const { HandDragSelectionPolicy, sampleHandDragSegment } = loadPureTs(handDragSelectionPolicyPath)
  const policy = new HandDragSelectionPolicy()

  policy.begin(7, 'card-a', false, { x: 10, y: 20 })
  assert.equal(policy.move(7, { x: 14, y: 20 }), null, 'small finger jitter must remain a tap')
  assert.deepEqual(policy.end(7), { cardId: 'card-a', selected: true }, 'a tap must toggle exactly its starting card')

  policy.begin(8, 'card-a', true, { x: 0, y: 0 })
  const segment = policy.move(8, { x: 40, y: 0 })
  assert.deepEqual(segment, { from: { x: 0, y: 0 }, to: { x: 40, y: 0 } })
  assert.equal(policy.claim('card-a'), false, 'a drag starting on a selected card must deselect crossed cards')
  assert.equal(policy.claim('card-a'), null, 'one drag must never toggle the same physical card twice')
  assert.equal(policy.claim('card-b'), false, 'the starting intent must apply consistently across the gesture')
  assert.equal(policy.move(99, { x: 80, y: 0 }), null, 'another finger must not steal the active gesture')
  assert.equal(policy.end(8), null, 'a completed drag must not also emit a tap')

  policy.begin(9, 'card-hold', false, { x: 12, y: 18 })
  assert.deepEqual(
    policy.activateLongPress(9),
    { from: { x: 12, y: 18 }, to: { x: 12, y: 18 } },
    'a long press must activate selection without requiring initial movement',
  )
  assert.equal(policy.claim('card-hold'), true, 'the held starting card must join the sweep')
  assert.deepEqual(policy.move(9, { x: 52, y: 18 }), { from: { x: 12, y: 18 }, to: { x: 52, y: 18 } })
  assert.equal(policy.claim('card-next'), true, 'dragging after the hold must select every newly crossed card')
  assert.equal(policy.end(9), null, 'a long-press sweep must not emit an extra tap')

  const samples = sampleHandDragSegment({ from: { x: 0, y: 0 }, to: { x: 81, y: 0 } })
  assert.deepEqual(samples[0], { x: 0, y: 0 })
  assert.deepEqual(samples.at(-1), { x: 81, y: 0 })
  assert.equal(samples.length > 10, true, 'a fast swipe must be subdivided across narrow card lanes')
  assert.equal(samples.slice(1).every((point, index) => point.x - samples[index].x <= 8), true)
}

function listJavaScriptFiles (directory) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return listJavaScriptFiles(entryPath)
    return entry.isFile() && entry.name.endsWith('.js') ? [entryPath] : []
  })
}

function verifyBuiltArtifacts (requireBuild) {
  const files = listJavaScriptFiles(webBuildPath)
  if (!files.length) {
    assert.equal(requireBuild, false, `web build is missing: ${webBuildPath}`)
    return false
  }

  const forbiddenTransforms = [
    /\[\]\.concat\(\s*this\.selectedCardIds\s*\)/,
    /\[\]\.concat\(\s*cardIds\s*\)/,
  ]
  const offenders = []
  for (const filePath of files) {
    const source = readUtf8(filePath)
    if (forbiddenTransforms.some(pattern => pattern.test(source))) {
      offenders.push(path.relative(projectRoot, filePath))
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Creator emitted an unsafe non-array Iterable transform in: ${offenders.join(', ')}`,
  )
  return true
}

const requireBuild = process.argv.includes('--require-build')
verifySourceConversions()
verifySelectionSnapshotSemantics()
verifyDragSelectionPolicy()
verifyTurnInteractionLifecycle()
verifyOffTurnGroupingIsolation()
const buildChecked = requireBuild ? verifyBuiltArtifacts(true) : false

process.stdout.write(`selection regression checks passed (web build ${buildChecked ? 'checked' : 'not requested'})\n`)
