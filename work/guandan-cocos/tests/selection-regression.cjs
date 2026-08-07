const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const compilerPath = '/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/resources/3d/engine/node_modules/typescript/lib/typescript.js'
const gameManagerPath = path.join(projectRoot, 'assets/scripts/game/GameManager.ts')
const handInteractionPolicyPath = path.join(projectRoot, 'assets/scripts/game/HandInteractionPolicy.ts')
const handDragSelectionPolicyPath = path.join(projectRoot, 'assets/scripts/game/HandDragSelectionPolicy.ts')
const handControllerPath = path.join(projectRoot, 'assets/scripts/ui/HandController.ts')
const cardViewPath = path.join(projectRoot, 'assets/scripts/ui/CardView.ts')
const gameScenePath = path.join(projectRoot, 'assets/scripts/scenes/GameScene.ts')
const playerSeatPath = path.join(projectRoot, 'assets/scripts/ui/PlayerSeatController.ts')
const lobbyControllerPath = path.join(projectRoot, 'assets/scripts/network/LobbyController.ts')
const webBuildPath = path.join(projectRoot, 'build/web-desktop')

function readUtf8 (filePath) {
  return fs.readFileSync(filePath, 'utf8')
}

function countMatches (source, pattern) {
  return [...source.matchAll(pattern)].length
}

function loadPureTs (filePath) {
  assert.equal(fs.existsSync(compilerPath), true, 'Cocos Creator TypeScript compiler is required')
  const ts = require(compilerPath)
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
  const handController = readUtf8(handControllerPath)
  const cardView = readUtf8(cardViewPath)
  const gameScene = readUtf8(gameScenePath)
  const playerSeat = readUtf8(playerSeatPath)
  const lobbyController = readUtf8(lobbyControllerPath)

  assert.equal(fs.existsSync(handInteractionPolicyPath), true, 'the shared hand-interaction policy must exist')
  assert.equal(fs.existsSync(`${handInteractionPolicyPath}.meta`), true, 'the hand-interaction policy must have Cocos metadata')
  assert.equal(fs.existsSync(handDragSelectionPolicyPath), true, 'the mobile drag-selection policy must exist')
  assert.equal(fs.existsSync(`${handDragSelectionPolicyPath}.meta`), true, 'the drag-selection policy must have Cocos metadata')

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
    gameManager,
    /applyServerState[\s\S]*?this\.selectedCardIds\.clear\(\)/,
    'authoritative recovery snapshots must clear choices from an earlier turn',
  )
  assert.match(gameManager, /canSelectPlayingHand\(this\.state, this\.humanId, this\.actionPending\)/, 'GameManager must use the shared playing-hand policy')
  assert.match(gameScene, /canSelectPlayingHand\(snapshot\.state, humanId, snapshot\.actionPending\)/, 'GameScene must use the same playing-hand policy')
  assert.match(gameManager, /diagnosePlay\(cards, this\.state\.lastValidPlay\)/, 'selection feedback and submission must use the shared authoritative play diagnosis')
  assert.match(gameManager, /if \(!validation\.canPlay\) return this\.emitSnapshot\(playValidationHint\(validation\)\)/, 'both local and network submissions must stop before sending an invalid selection')
  assert.match(gameManager, /playValidation,\s*phase:/, 'GameManager snapshots must expose the current play validation to presentation')
  assert.match(gameScene, /const visible = \[this\.hintButton, this\.passButton, this\.playButton\]/, 'the three turn actions must be stable throughout the human action window')
  assert.doesNotMatch(gameScene, /selectedCardIds\.length && this\.resetButton|playValidation\.canPlay && this\.playButton/, 'selection state must not control action-button visibility')
  assert.doesNotMatch(gameScene, /resetButton|ResetButton|'重置'/, 'the obsolete table reset action must be removed completely')
  assert.match(gameScene, /playSelectedWithEffect[\s\S]*!validation\.canPlay[\s\S]*showFinishToast\(playValidationHint\(validation\)\)[\s\S]*manager\.playSelected\(\)/, 'the always-visible play action must explain an invalid click while retaining authoritative submission validation')
  assert.match(cardView, /public bind[\s\S]*?this\.syncInputBinding\(\)/, 'rebinding a card must refresh touch handlers when interaction becomes available again')
  assert.match(cardView, /CardSelectionOverlay/, 'selection feedback must render on a dedicated layer above the classic PNG face')
  assert.match(cardView, /new Color\(8, 18, 24, 82\)/, 'selected cards must receive a neutral darkening wash')
  assert.match(cardView, /strokeColor = new Color\(255, 205, 64, 255\)[\s\S]*?lineWidth = 4/, 'selected cards must retain one heavy high-contrast outline')
  assert.doesNotMatch(cardView, /SelectedCardCapHitArea|configureSelectedCapHitArea/, 'flat selection must not keep the obsolete raised-card cap target')
  assert.doesNotMatch(cardView, /selected \? 32|selectionPosition/, 'selecting a hand card must never change its vertical position')
  assert.doesNotMatch(cardView, /lineTo\(-2, 59\)|lineTo\(9, 69\)/, 'the obsolete selected-card check mark must not be drawn')
  assert.match(cardView, /Node\.EventType\.TOUCH_MOVE/, 'card hit areas must forward continuous touch movement on mobile')
  assert.match(cardView, /public hitTestScreenPoint[\s\S]*?\.hitTest\(point\)/, 'the dedicated hit area must support screen-space swipe resolution')
  assert.match(handController, /new HandDragSelectionPolicy\(\)/, 'one hand-level policy must own the active pointer gesture')
  assert.match(handController, /sampleHandDragSegment[\s\S]*?findTopCardAt/, 'fast movement must be sampled across every crossed card hit area')
  assert.match(handController, /right\[1\]\.getSiblingIndex\(\) - left\[1\]\.getSiblingIndex\(\)/, 'overlaps must resolve to the visually topmost hand card')
  assert.match(cardView, /Math\.max\(1, Math\.min\(visibleWidth, spacing\)\)/, 'narrow-screen hit targets must not overlap their fan spacing')
  assert.match(gameScene, /roomStatus === 'ready'/, 'multiplayer countdown and actions must wait for room recovery')
  assert.match(gameScene, /this\.actionCountdownKey = ''[\s\S]*?this\.actionCountdown = 20/, 'leaving the table must reset countdown identity and value')
  assert.match(gameScene, /if \(this\.hintLabel\) this\.hintLabel\.node\.active = false/, 'persistent engine hint chrome must remain retired')
  assert.match(gameScene, /if \(this\.ownChatLabel\) this\.ownChatLabel\.node\.active = false/, 'the local quick-chat echo must not cover the hand/action lane')
  assert.match(gameScene, /const safeTop = this\.screen\?\.safeTopY\(158\)[\s\S]*const safeBottom = this\.screen\?\.safeBottomY\(260\)[\s\S]*Math\.min\(560, safeWidth - 32\)/, 'short-lived table feedback must be constrained to its central safe corridor')
  assert.doesNotMatch(gameScene, /statusLaneWidth|statusLaneY/, 'retired persistent side status rails must not continue reserving or overlapping space')
  const connectivityStart = gameScene.indexOf('private syncSeatConnections')
  const connectivityEnd = gameScene.indexOf('private setTableVisible', connectivityStart)
  assert.notEqual(connectivityStart, -1, 'GameScene must project authoritative room membership onto seats')
  assert.notEqual(connectivityEnd, -1, 'seat connectivity projection must remain a bounded presentation method')
  const connectivitySource = gameScene.slice(connectivityStart, connectivityEnd)
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
  assert.match(lobbyController, /acceptRoomMessage/, 'late room messages must be filtered after leaving')
  assert.match(lobbyController, /acceptVersion \(eventType: string/, 'same-version messages must be deduplicated per event type')
  assert.match(lobbyController, /processedVersionedEvents/, 'duplicate authoritative state packets must not clear a fresh selection')
}

function verifyTurnInteractionLifecycle () {
  const { canSelectPlayingHand, resolvePlayingHandTapMode } = loadPureTs(handInteractionPolicyPath)
  const state = (currentTurn, finishedPlayers = []) => ({ currentTurn, finishedPlayers })

  assert.equal(canSelectPlayingHand(state('p1'), 'p1', false), true, 'the local hand must be interactive on its turn')
  assert.equal(canSelectPlayingHand(state('p2'), 'p1', false), false, 'the local hand must stop accepting taps on another turn')
  assert.equal(canSelectPlayingHand(state('p1'), 'p1', false), true, 'interaction must return when the turn cycles back')
  assert.equal(canSelectPlayingHand(state('p1'), 'p1', true), false, 'a pending network intent must temporarily lock the hand')
  assert.equal(canSelectPlayingHand(state('p1'), 'p1', false), true, 'a rejected or completed intent must release the temporary lock')
  assert.equal(canSelectPlayingHand(state('p1', ['p1']), 'p1', false), false, 'a player who has finished must not keep selecting cards')

  assert.equal(resolvePlayingHandTapMode(state('p1'), 'p1', false, false), 'play', 'an ordinary current-turn tap must remain a rule selection')
  assert.equal(resolvePlayingHandTapMode(state('p2'), 'p1', false, false), 'grouping', 'an off-turn tap must enter presentation-only grouping')
  assert.equal(resolvePlayingHandTapMode(state('p1'), 'p1', false, true), 'grouping', 'explicit lock mode must keep current-turn taps out of rule selection')
  assert.equal(resolvePlayingHandTapMode(state('p2'), 'p1', true, false), 'blocked', 'a pending intent must not be bypassed by off-turn grouping')
  assert.equal(resolvePlayingHandTapMode(state('p2', ['p1']), 'p1', false, false), 'blocked', 'a finished hand cannot enter grouping mode')
}

function verifyOffTurnGroupingIsolation () {
  const gameScene = readUtf8(gameScenePath)
  const handlerStart = gameScene.indexOf('private readonly handleCardToggle')
  const handlerEnd = gameScene.indexOf('private playSelectedWithEffect', handlerStart)
  assert.notEqual(handlerStart, -1, 'the card-toggle handler must exist')
  assert.notEqual(handlerEnd, -1, 'the card-toggle handler must remain bounded')
  const handler = gameScene.slice(handlerStart, handlerEnd)
  assert.match(handler, /tapMode === 'grouping'[\s\S]*this\.manualGroupingMode = true[\s\S]*this\.manualGroupingSelection\.clear\(\)/, 'an off-turn tap must enter presentation-only grouping')
  const groupingStart = handler.indexOf("tapMode === 'grouping'")
  const ruleSelectionStart = handler.indexOf('if (!this.manualGroupingMode)', groupingStart)
  const groupingEntry = handler.slice(groupingStart, ruleSelectionStart)
  assert.doesNotMatch(groupingEntry, /gameManager|selectedCardIds|toggleCard|replaceSelectedCards|clearSelected/, 'off-turn grouping entry must not mutate rule selection')
  assert.match(handler, /if \(!this\.canInteractWithHand\(snapshot, humanId\)\) return[\s\S]*manager\?\.toggleCard\(cardId\)/, 'only the authoritative action path may reach normal rule selection')
  assert.match(gameScene, /playingTapMode !== 'blocked' \|\| this\.canInteractWithHand/, 'off-turn grouping must make the hand interactive without enabling a rule action')
  assert.match(gameScene, /clearCurrentTurnRuleSelection[\s\S]*canSelectPlayingHand\(snapshot\.state, humanId, snapshot\.actionPending\)[\s\S]*gameManager\?\.clearRuleSelection\(\)/, 'switching modes may clear rule selection only while the local player can legally act')
  assert.match(gameScene, /snapshot\.phase !== 'playing' && this\.manualGroupingMode[\s\S]*cancelManualGrouping\(false\)/, 'tribute and settlement phases must retire presentation-only lock selection')
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
