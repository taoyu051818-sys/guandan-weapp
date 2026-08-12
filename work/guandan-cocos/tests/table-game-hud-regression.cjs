const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const sourcePath = path.join(projectRoot, 'assets/scripts/ui/TableGameHud.ts')
const metaPath = `${sourcePath}.meta`
const foundationPath = path.join(projectRoot, 'assets/scripts/ui/TableGameHudFoundation.ts')
const foundationMetaPath = `${foundationPath}.meta`
const dynamicRendererPath = path.join(projectRoot, 'assets/scripts/ui/TableHudDynamicRenderer.ts')
const dynamicRendererMetaPath = `${dynamicRendererPath}.meta`
const seatGroupPath = path.join(projectRoot, 'assets/scripts/ui/TableHudSeatViewGroup.ts')
const seatGroupMetaPath = `${seatGroupPath}.meta`
const turnTimerViewPath = path.join(projectRoot, 'assets/scripts/ui/TableHudTurnTimerView.ts')
const turnTimerViewMetaPath = `${turnTimerViewPath}.meta`
const layoutPolicyPath = path.join(projectRoot, 'assets/scripts/ui/TableHudLayoutPolicy.ts')
const layoutPolicyMetaPath = `${layoutPolicyPath}.meta`
const safeAreaPath = path.join(projectRoot, 'assets/scripts/ui/SafeAreaLayout.ts')
const scenePath = path.join(projectRoot, 'assets/scripts/scenes/GameScene.ts')
const tableMatchCoordinatorPath = path.join(projectRoot, 'assets/scripts/scenes/TableMatchCoordinator.ts')
const presenterPath = path.join(projectRoot, 'assets/scripts/scenes/TableHudPresenter.ts')
const presenterMetaPath = `${presenterPath}.meta`
const turnClockPath = path.join(projectRoot, 'assets/scripts/scenes/TableTurnClockController.ts')
const workspacePath = path.join(projectRoot, 'assets/scripts/game/HandWorkspace.ts')
const groupingPath = path.join(projectRoot, 'assets/scripts/game/HandGrouping.ts')
const playAreaPath = path.join(projectRoot, 'assets/scripts/ui/PlayAreaController.ts')
const replayPath = path.join(projectRoot, 'assets/scripts/ui/ReplayBoardView.ts')
const timerArtPath = path.join(projectRoot, 'assets/game-assets/ui/table/chicken-timer-frame.png')
const avatarArtPath = path.join(projectRoot, 'assets/game-assets/ui/common/default-avatar.jpg')
const { compilerPath, loadTypeScript } = require('./support/typescript.cjs')

assert.equal(fs.existsSync(sourcePath), true, 'the standalone table HUD source must exist')
assert.equal(fs.existsSync(metaPath), true, 'the standalone table HUD needs Cocos metadata')
assert.equal(fs.existsSync(foundationPath), true, 'the table HUD needs a standalone model and drawing foundation')
assert.equal(fs.existsSync(foundationMetaPath), true, 'the table HUD foundation needs Cocos metadata')
assert.equal(fs.existsSync(dynamicRendererPath), true, 'the table HUD needs an extracted dynamic-surface renderer')
assert.equal(fs.existsSync(dynamicRendererMetaPath), true, 'the dynamic-surface renderer needs Cocos metadata')
assert.equal(fs.existsSync(seatGroupPath), true, 'the table HUD needs a standalone seat lifecycle owner')
assert.equal(fs.existsSync(seatGroupMetaPath), true, 'the seat lifecycle owner needs Cocos metadata')
assert.equal(fs.existsSync(turnTimerViewPath), true, 'the table HUD needs a standalone turn-timer lifecycle owner')
assert.equal(fs.existsSync(turnTimerViewMetaPath), true, 'the turn-timer lifecycle owner needs Cocos metadata')
assert.equal(fs.existsSync(layoutPolicyPath), true, 'the table HUD needs a standalone layout policy')
assert.equal(fs.existsSync(layoutPolicyMetaPath), true, 'the layout policy needs Cocos metadata')
assert.equal(fs.existsSync(presenterPath), true, 'the table HUD needs a scene-facing presenter')
assert.equal(fs.existsSync(presenterMetaPath), true, 'the table HUD presenter needs Cocos metadata')
assert.equal(fs.existsSync(compilerPath), true, 'Cocos Creator TypeScript compiler is required')

const source = fs.readFileSync(sourcePath, 'utf8')
const foundationSource = fs.readFileSync(foundationPath, 'utf8')
const dynamicRendererSource = fs.readFileSync(dynamicRendererPath, 'utf8')
const turnTimerViewSource = fs.readFileSync(turnTimerViewPath, 'utf8')
const hudSources = `${foundationSource}\n${dynamicRendererSource}\n${turnTimerViewSource}\n${source}`
const seatGroupSource = fs.readFileSync(seatGroupPath, 'utf8')
const layoutPolicySource = fs.readFileSync(layoutPolicyPath, 'utf8')
const scene = fs.readFileSync(scenePath, 'utf8')
const tableMatchCoordinator = fs.readFileSync(tableMatchCoordinatorPath, 'utf8')
const presenterSource = fs.readFileSync(presenterPath, 'utf8')
const turnClock = fs.readFileSync(turnClockPath, 'utf8')
const workspace = fs.readFileSync(workspacePath, 'utf8')
const grouping = fs.readFileSync(groupingPath, 'utf8')
const playArea = fs.readFileSync(playAreaPath, 'utf8')
const replay = fs.readFileSync(replayPath, 'utf8')
const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
const foundationMetadata = JSON.parse(fs.readFileSync(foundationMetaPath, 'utf8'))
const dynamicRendererMetadata = JSON.parse(fs.readFileSync(dynamicRendererMetaPath, 'utf8'))
const seatGroupMetadata = JSON.parse(fs.readFileSync(seatGroupMetaPath, 'utf8'))
const turnTimerViewMetadata = JSON.parse(fs.readFileSync(turnTimerViewMetaPath, 'utf8'))
const layoutPolicyMetadata = JSON.parse(fs.readFileSync(layoutPolicyMetaPath, 'utf8'))
const presenterMetadata = JSON.parse(fs.readFileSync(presenterMetaPath, 'utf8'))
const ts = loadTypeScript()
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2015, target: ts.ScriptTarget.ES2019 },
  fileName: sourcePath,
  reportDiagnostics: true,
})
const errors = (transpiled.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
assert.deepEqual(errors, [], 'TableGameHud.ts must transpile without syntax errors')

const evaluateTypeScriptModule = (filePath, requireDependency = require) => {
  const result = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
    fileName: filePath,
    reportDiagnostics: true,
  })
  const compileErrors = (result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
  assert.deepEqual(compileErrors, [], `${path.basename(filePath)} must transpile without syntax errors`)
  const module = { exports: {} }
  Function('require', 'module', 'exports', result.outputText)(requireDependency, module, module.exports)
  return module.exports
}
const safeArea = evaluateTypeScriptModule(safeAreaPath)
const layoutPolicy = evaluateTypeScriptModule(layoutPolicyPath, request => request === './SafeAreaLayout' ? safeArea : require(request))
const closeTo = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.001, `${message}: expected ${expected}, received ${actual}`)

assert.equal(metadata.importer, 'typescript')
assert.match(metadata.uuid, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)
assert.equal(foundationMetadata.importer, 'typescript')
assert.match(foundationMetadata.uuid, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)
assert.equal(dynamicRendererMetadata.importer, 'typescript')
assert.match(dynamicRendererMetadata.uuid, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)
assert.equal(seatGroupMetadata.importer, 'typescript')
assert.match(seatGroupMetadata.uuid, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)
assert.equal(turnTimerViewMetadata.importer, 'typescript')
assert.match(turnTimerViewMetadata.uuid, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)
assert.equal(layoutPolicyMetadata.importer, 'typescript')
assert.match(layoutPolicyMetadata.uuid, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)
assert.equal(presenterMetadata.importer, 'typescript')
assert.match(presenterMetadata.uuid, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)
assert.match(source, /export class TableGameHud/)
assert.match(source, /public mount \(parent: Node\): Node/)
assert.match(source, /public render \(state: TableGameHudState\): void/)
assert.match(source, /public update \(patch: Partial<TableGameHudState>\): void/)
assert.match(source, /public layout \(viewport: TableGameHudViewport\): void/)
assert.match(source, /public setVisible \(visible: boolean\): void/)
assert.match(source, /public dispose \(\): void/)
assert.match(source, /public setActions \(actions: TableGameHudActions\): void/)
assert.match(source, /public setTurnActionNodes \(nodes: readonly \(Node \| null \| undefined\)\[\]\): void/)
assert.match(source, /public setTimerArtwork \(artwork: Node \| null\): void/)
assert.match(source, /public hitTestInteractiveScreenPoint \(/, 'the visually topmost HUD must expose its interactive screen-space hit region')
assert.match(hudSources, /getComponent\(UITransform\)\?\.hitTest\(point\)/, 'HUD hit arbitration must use Cocos screen-space transforms')
assert.match(source, /public setDefaultAvatarFrame \(frame: SpriteFrame \| null\): void/)
assert.match(source, /export \{ TABLE_GAME_HUD_DESIGN_SIZE \}/, 'the HUD facade must preserve its existing design-size export')
assert.match(layoutPolicySource, /TABLE_GAME_HUD_DESIGN_SIZE = Object\.freeze\(\{ width: 1280, height: 720 \}\)/)
assert.match(foundationSource, /TABLE_GAME_HUD_CARD_COUNTER_STATUS = 'active'/, 'the card counter must declare its active presentation status')
for (const counterBoundary of ["this.createCounter(root)", "new Node('CardCounter')", 'private renderCounter', "new Node('CounterDragHandle')"]) {
  assert.equal(source.includes(counterBoundary), true, `the active card counter is missing ${counterBoundary}`)
}
for (const counterBoundary of ['publicCardCounts', 'counterExpanded', 'onCounterVisibilityChange', 'TABLE_GAME_HUD_COUNTER_RANKS']) {
  assert.equal(presenterSource.includes(counterBoundary), true, `the table HUD presenter is missing ${counterBoundary}`)
}
assert.match(foundationSource, /counterExpanded: boolean[\s\S]*cardCounts: Readonly<Partial<Record<TableGameHudCounterRank, number>>>/, 'counter visibility and public counts must remain authoritative HUD state')
assert.match(foundationSource, /onCounterVisibilityChange\?: \(expanded: boolean\) => void/, 'the restored counter must emit its visibility intent')
assert.match(presenterSource, /cardCounts: this\.publicCardCounts\(snapshot, humanId\)/, 'the presenter must inject card counts instead of letting the HUD infer game state')
assert.match(scene, /setTouchExclusionPredicate\(screenPoint =>/, 'the scene must arbitrate overlapping HUD and hand touches without moving either surface')
assert.match(presenterSource, /Counts public unknowns only:[\s\S]*rank === '小王' \|\| rank === '大王' \? 2 : 8[\s\S]*players\[humanId\]\.hand\.forEach\(card => remove\(card\.rank\)\)[\s\S]*state\.playArea\.forEach\(action => action\.cards\.forEach\(card => remove\(card\.rank\)\)\)/, 'the counter must subtract only the viewer hand and publicly revealed plays from the two-deck totals')
assert.match(foundationSource, /BASE_TOOLBAR_WIDTH = 420/, 'the enlarged table tools need their reserved toolbar width')
assert.match(layoutPolicySource, /TABLE_HUD_MIN_SCALE = 0\.78/, 'responsive HUD layout must not shrink text below its legible presentation scale')
assert.match(foundationSource, /const MIN_HUD_FONT_SIZE = 20/, 'all HUD labels must retain an explicit 20px floor')
assert.match(foundationSource, /createTableHudLabel[\s\S]*const resolvedFontSize = Math\.max\(MIN_HUD_FONT_SIZE, Math\.round\(fontSize\)\)[\s\S]*label\.fontSize = resolvedFontSize[\s\S]*return applyForegroundTextStyle\(label,[\s\S]*resolvedFontSize >= 24 \? 3 : 2\)/, 'HUD labels must combine the minimum font size with the shared heavy outline')
assert.match(source, /resolveTableHudFrameLayout\(\{/, 'the view must delegate geometry instead of owning safe-area policy')
assert.doesNotMatch(source, /resolveSafePriorityRects|safeWidth \/ TABLE_GAME_HUD_DESIGN_SIZE/, 'the Cocos view must not duplicate pure safe-area calculations')
assert.match(layoutPolicySource, /safeLeft[\s\S]*safeRight[\s\S]*safeTop[\s\S]*safeBottom/)
assert.match(layoutPolicySource, /safeWidth \/ TABLE_GAME_HUD_DESIGN_SIZE\.width/)
assert.match(layoutPolicySource, /safeHeight \/ TABLE_GAME_HUD_DESIGN_SIZE\.height/)
assert.doesNotMatch(layoutPolicySource, /from 'cc'|\bNode\b|\bUITransform\b|\bVec3\b/, 'the layout policy must remain executable without Cocos')

const standardLayout = layoutPolicy.resolveTableHudFrameLayout({
  viewport: { width: 1280, height: 720 },
  backSize: { width: 60, height: 60 },
  roundSize: { width: 272, height: 84 },
  seatSize: { width: 280, height: 100 },
  suitSize: { width: 480, height: 68 },
  toolbarSize: { width: 540, height: 70 },
})
assert.equal(standardLayout.bounds.scale, 1, 'the design viewport must preserve 1:1 HUD scale')
assert.deepEqual(standardLayout.seats.top, { x: -210, y: 218, scale: 1, visible: true }, 'the opposite seat must remain left of the top play area')
assert.equal(standardLayout.top.back.visible, true)
assert.equal(standardLayout.top.round.visible, true)
const bottomGap = standardLayout.bottom.toolbar.x - 540 * standardLayout.bottom.toolbar.scale / 2
  - (standardLayout.bottom.suitBar.x + 480 * standardLayout.bottom.suitBar.scale / 2)
closeTo(bottomGap, layoutPolicy.TABLE_HUD_BOTTOM_GROUP_GAP * standardLayout.bottom.toolbar.scale, 'suit and toolbar groups must remain adjacent')

const operationRow = layoutPolicy.resolveTableHudOperationRow([112, 112, 128])
assert.deepEqual(operationRow, { size: { width: 494, height: 112 }, timerX: -191, actionXs: [-69, 53, 183] }, 'the human operation row geometry must preserve its established positions')
assert.deepEqual(
  layoutPolicy.clampTableHudOverlayPosition({ x: 999, y: 999 }, operationRow.size, standardLayout.bounds),
  { x: 385, y: 296 },
  'dragged operations must remain inside the safe viewport',
)
assert.equal(layoutPolicy.resolveTableHudBounds({ width: 960, height: 540 }).scale, 0.78, 'small viewports must preserve the legibility floor')
const narrowLayout = layoutPolicy.resolveTableHudFrameLayout({
  viewport: { width: 700, height: 540 },
  backSize: { width: 60, height: 60 },
  roundSize: { width: 272, height: 84 },
  seatSize: { width: 280, height: 100 },
  suitSize: { width: 480, height: 68 },
  toolbarSize: { width: 540, height: 70 },
})
closeTo(narrowLayout.bottom.suitBar.x, narrowLayout.bottom.toolbar.x, 'narrow viewports must split bottom tools onto one shared lane')
assert.ok(narrowLayout.bottom.suitBar.y > narrowLayout.bottom.toolbar.y, 'the straight-flush group must occupy the upper split row')

for (const control of ['TableBack', 'MatchSummary', 'CircularTurnTimer', 'StraightFlushSuitBar', 'LockHand', 'ArrangeHand', 'QuickChat']) {
  assert.equal(hudSources.includes(`'${control}'`) || hudSources.includes(`\`${control}\``), true, `missing HUD control: ${control}`)
}
assert.match(layoutPolicySource, /TABLE_HUD_SEAT_PLACES: readonly TableHudSeatPlace\[\] = \['bottom', 'right', 'top', 'left'\]/)
for (const stateField of ['matchLabel', 'levelLabel', 'turnVisible', 'turnSeconds', 'turnDurationSeconds', 'turnPlace', 'counterExpanded', 'cardCounts', 'availableSuits', 'lockAction']) {
  assert.match(hudSources, new RegExp(`${stateField}:`), `missing authoritative HUD state: ${stateField}`)
}
assert.doesNotMatch(source, /roundNumber|totalRounds|multiplier: number|points: number|scoreLabel|teamScore|formatScore/, 'HUD must not invent match scores or player economy fields')
assert.match(source, /private readonly seats = new TableHudSeatViewGroup\(\)/, 'the HUD facade must delegate seat ownership to one lifecycle component')
assert.match(source, /private readonly turnTimer = new TableHudTurnTimerView\(\)/, 'the HUD facade must delegate timer ownership to one lifecycle component')
for (const lifecycleCall of ['mount(root)', 'render(this.state.seats)', 'layout(layout.seats)', 'setDefaultAvatarFrame(frame)']) {
  assert.equal(source.includes(`this.seats.${lifecycleCall}`), true, `the HUD facade must route seat ${lifecycleCall} through the extracted owner`)
}
assert.match(source, /public dispose \(\): void \{[\s\S]*this\.seats\.dispose\(\)/, 'the HUD lifecycle must dispose its owned seat group')
assert.match(source, /public dispose \(\): void \{[\s\S]*this\.turnTimer\.dispose\(\)/, 'the HUD lifecycle must dispose its owned timer view')
assert.match(turnTimerViewSource, /export class TableHudTurnTimerView[\s\S]*public mount[\s\S]*public render[\s\S]*public setArtwork[\s\S]*public dispose/, 'the timer view must own its complete presentation lifecycle')
assert.match(seatGroupSource, /new Node\(`Seat-\$\{place\}`\)/, 'all four seat panels must share the same generated structure')
for (const callback of ['onBack', 'onCounterVisibilityChange', 'onSuitSelect', 'onHandLockAction', 'onArrange', 'onChat']) {
  assert.match(source, new RegExp(`${callback}\\?\\.`), `HUD action must be emitted: ${callback}`)
}
for (const label of ['本局打', '我方 2级 · 对方 2级', '记牌器', '同花顺', '锁牌', '取消', '确认', '解锁', '一键理牌', '复原', '快捷语']) {
  assert.equal(hudSources.includes(label), true, `HUD must render ${label}`)
}
assert.doesNotMatch(source, /比分|PlayerPoints|TimerCaption|turnCaption/, 'the table must show levels only and the chicken timer must show seconds only')

assert.match(source, /from 'cc'/)
assert.doesNotMatch(source, /GameScene|GameManager|HandController|ScreenAdapter/, 'the HUD must remain independent from scene and game authorities')
assert.doesNotMatch(source, /resources\.|Texture2D|loadGameAsset/, 'the HUD must receive presentation assets from the scene instead of loading them itself')
assert.doesNotMatch(source, /@ccclass|extends Component/, 'mounting must not require an authored scene component')
assert.doesNotMatch(source, /BlockInputEvents|stopPropagation|propagationStopped/, 'the HUD root must not swallow table input')
assert.match(turnTimerViewSource, /remaining = Math\.max\(0, finiteOr\(this\.state\.turnSeconds, 0\)\)/, '40/60-second room timers must not be clamped to the progress duration')
assert.match(turnTimerViewSource, /progressRemaining = clamp\(remaining, 0, duration\)/, 'only the visual progress ratio may be clamped')
assert.match(presenterSource, /TABLE_TIMER_ART_ASSET = 'ui\/table\/chicken-timer-frame\/texture'/)
assert.match(presenterSource, /this\.tableHud\?\.setTimerArtwork\(artwork\)/, 'the presenter must inject the loaded timer artwork into the asset-free HUD')
assert.match(presenterSource, /DEFAULT_AVATAR_ART_ASSET = 'ui\/common\/default-avatar\/texture'/)
assert.match(presenterSource, /this\.tableHud\?\.setDefaultAvatarFrame\(frame\)/, 'the presenter must inject the supplied default avatar into every table seat')
assert.match(turnClock, /roomSettings\?\.turnSeconds \?\? DEFAULT_TURN_SECONDS/, 'friend-room timer duration must follow the authoritative room setting')
assert.equal(fs.existsSync(timerArtPath), true, 'the transparent chicken timer artwork must exist')
assert.equal(fs.existsSync(`${timerArtPath}.meta`), true, 'the chicken timer artwork must have Cocos metadata')
const timerMeta = JSON.parse(fs.readFileSync(`${timerArtPath}.meta`, 'utf8'))
assert.equal(timerMeta.userData.hasAlpha, true, 'the timer checkerboard must be removed to a real alpha channel')

assert.equal(fs.existsSync(avatarArtPath), true, 'the supplied default avatar artwork must exist')
assert.equal(fs.existsSync(`${avatarArtPath}.meta`), true, 'the default avatar artwork must have Cocos metadata')
const seatConstruction = seatGroupSource.slice(seatGroupSource.indexOf('private createSeat'), seatGroupSource.indexOf('private renderViews'))
assert.match(seatConstruction, /new Node\('DefaultAvatar'\)[\s\S]*addComponent\(Sprite\)/, 'table seats must reserve a real image sprite for the avatar')
assert.doesNotMatch(seatConstruction, /AvatarText|createLabel\([^\n]*Avatar/, 'table seats must not substitute letters or player names for a missing avatar image')
const seatRendering = seatGroupSource.slice(seatGroupSource.indexOf('private renderViews'))
assert.match(seatRendering, /view\.avatarSprite\.spriteFrame = this\.defaultAvatarFrame[\s\S]*active = Boolean\(this\.defaultAvatarFrame\)/)
assert.doesNotMatch(seatRendering, /drawPanel\(view\.graphics|roundRect\(-95, -35, 190, 70/, 'seat details must not sit inside one large outer panel')

assert.match(layoutPolicySource, /TABLE_HUD_TURN_OPERATION_ANCHORS[\s\S]*bottom: Object\.freeze\(\{ x: 0, y: -82 \}\)[\s\S]*right: Object\.freeze\(\{ x: 300, y: 0 \}\)[\s\S]*top: Object\.freeze\(\{ x: 0, y: 218 \}\)[\s\S]*left: Object\.freeze\(\{ x: -300, y: 0 \}\)/, 'the turn timer must use the same four operation-area anchors as played cards')
assert.match(source, /humanTurnTimer[\s\S]*desiredParent = humanTurnTimer \? this\.operationOverlay : this\.root/, 'the human timer must join the draggable operation row only on the human turn')
assert.match(source, /clampTableHudOverlayPosition\([\s\S]*TABLE_HUD_TURN_OPERATION_ANCHORS\[this\.state\.turnPlace\][\s\S]*\{ width: 112, height: 112 \}/, 'other players timers must remain independently clamped at their operation anchors')
assert.match(source, /this\.place\(timerNode, timerPosition\.x, timerPosition\.y, bounds\.scale, 80\)/, 'every seat timer must use the same scale as the human timer')
assert.doesNotMatch(source, /NON_HUMAN_TIMER_SCALE/, 'other seats must not apply a separate timer scale')
assert.match(layoutPolicySource, /id: 'seat-top', x: -220, y: TABLE_HUD_TURN_OPERATION_ANCHORS\.top\.y/, 'the opposite seat must sit fully left of the top operation area')
assert.match(scene, /new Vec3\(-220, 218, 0\)/, 'the legacy seat origin used for card flights must agree with the opposite HUD seat')
assert.match(turnClock, /private turnPlace[\s\S]*PLAYER_PLACES\[\(PLAYER_ORDER\.indexOf\(activePlayerId\) - PLAYER_ORDER\.indexOf\(humanId\) \+ 4\) % 4\]/, 'the active player must be projected into the viewer-relative operation place')
assert.match(turnClock, /const turnVisible = multiplayer[\s\S]*: Boolean\(this\.dependencies\.label\.node\.active\) \|\| \(snapshot\.phase === 'playing' && !snapshot\.actionPending\)/, 'local AI turns must keep the timer visible at their operation area')
assert.match(turnClock, /turnSeconds: turnVisible \? \(this\.dependencies\.label\.node\.active \? this\.remainingSeconds : this\.durationSeconds\(\)\) : 0/, 'non-human local turns use the configured duration while hidden recovery clocks expose no invented seconds')
assert.match(playArea, /relativePlaces = \[new Vec3\(0, -82, 0\), new Vec3\(300, 0, 0\), new Vec3\(0, 218, 0\), new Vec3\(-300, 0, 0\)\]/, 'the opposite player play area must move into the top table lane')

assert.doesNotMatch(layoutPolicySource, /id: 'turn-timer'/, 'the floating timer must not participate in lower seat collision resolution')
assert.match(source, /new Node\('FloatingOperationGroup'\)/, 'timer and operation buttons need one draggable top-layer group')
assert.doesNotMatch(source, /OperationDragHandle|operationDragHandle|handleWidth/, 'the obsolete standalone operation drag icon must not be created or laid out')
assert.match(source, /bindDragHandle\(this\.turnTimer\.node, 'operations',[\s\S]*this\.turnTimer\.node\?\.parent === this\.operationOverlay/, 'dragging the chicken timer itself must move the entire operation group')
assert.match(source, /private bindDragHandle[\s\S]*EventType\.TOUCH_MOVE[\s\S]*event\.getUIDelta\(\)[\s\S]*this\.layout\(this\.viewport\)/, 'dragging must persist and reclamp the overlay position')
assert.match(layoutPolicySource, /clampTableHudOverlayPosition[\s\S]*bounds\.left[\s\S]*bounds\.right[\s\S]*bounds\.bottom[\s\S]*bounds\.top/, 'floating groups must stay inside the current safe bounds')
assert.match(source, /this\.overlayPositions\.operations \?\? TABLE_HUD_TURN_OPERATION_ANCHORS\.bottom/, 'the draggable turn-action row must default to the human operation area')
assert.match(source, /toolbar\.parent = parent/, 'lock, arrange and chat tools must remain outside the draggable turn-action row')
assert.match(layoutPolicySource, /const toolbarX = laneRight - toolbarSize\.width \* singleRowScale \/ 2[\s\S]*const suitX = toolbarX - toolbarSize\.width \* singleRowScale \/ 2 - TABLE_HUD_BOTTOM_GROUP_GAP \* singleRowScale - suitSize\.width \* singleRowScale \/ 2/, 'the straight-flush group must sit immediately beside the lock toolbar instead of anchoring to the far left')
assert.match(source, /this\.turnActionNodes\.forEach\(node => \{ node\.parent = this\.operationOverlay \}\)/, 'authoritative action buttons must be reparented without replacing their callbacks')
assert.match(source, /visibleActions = this\.turnActionNodes\.filter\(node => node\.isValid && node\.active\)/, 'the row must include only currently valid action buttons')
assert.match(source, /this\.place\(timerNode, row\.timerX, 0, 1, 2\)/, 'the human timer must occupy the first slot of the shared turn-action row')
assert.match(source, /Tween\.stopAllByTarget\(node\)[\s\S]*this\.place\(node, row\.actionXs\[index\], 0, 1, 3\)/, 'HUD positioning must cancel stale fallback tweens before laying out action buttons')
assert.match(scene, /turnActionNodes: \[this\.hintButton, this\.passButton, this\.playButton\]/, 'the scene must supply the fixed 提示/不要/出牌 controls in display order')
assert.match(presenterSource, /hud\.setTurnActionNodes\(options\.turnActionNodes\)/, 'the presenter must attach the supplied controls to the HUD operation row')
assert.match(scene, /makeButton\('PassButton', '不要', -185, 112, 54, 28\)/, '不要 must use the same 28px type setting as 出牌')
assert.match(scene, /makeButton\('HintButton', '提示', -62, 112, 54, 28\)/, '提示 must use the same 28px type setting as 出牌')
assert.match(scene, /makeButton\('PlayButton', '出牌', 70, 128, 58, 28\)/, '出牌 must remain the most prominent table action')
assert.doesNotMatch(scene, /resetButton|ResetButton|'重置'/, 'the table reset control and all of its visibility logic must be retired')
assert.doesNotMatch(scene, /selectedCardIds\.length && this\.resetButton|playValidation\.canPlay && this\.playButton/, 'selected cards and play diagnosis must not resize the action row')
assert.match(tableMatchCoordinator, /visible\.forEach[\s\S]*node\.active = true[\s\S]*if \(hud\.mounted\) return[\s\S]*tween\(node\)/, 'fallback action tweens must not fight the HUD-owned row')

assert.match(foundationSource, /availableSuits: readonly TableGameHudSuit\[\]/, 'the HUD state must receive the authoritative straight-flush suit candidates')
assert.match(foundationSource, /normalizeAvailableSuits[\s\S]*SUITS\.filter\(suit => requested\.has\(suit\)\)/, 'available suits must be normalized in stable display order')
const suitConstruction = source.slice(source.indexOf('private createSuitBar'), source.indexOf('private createToolbar'))
assert.match(suitConstruction, /this\.suitBarGraphics = bar\.addComponent\(Graphics\)/, 'all suits must share one graphics surface')
assert.doesNotMatch(suitConstruction, /this\.createButton\(/, 'suits must not be rendered as four separately framed buttons')
assert.match(foundationSource, /export type SuitButtonView = \{[\s\S]*sprite: import\('cc'\)\.Sprite/, 'suit controls must own packaged artwork sprites rather than font glyphs')
assert.match(suitConstruction, /new Node\('SuitArtwork'\)[\s\S]*addComponent\(Sprite\)[\s\S]*sprite\.sizeMode = Sprite\.SizeMode\.CUSTOM[\s\S]*this\.suitButtons\.set\(suit, \{ node, sprite \}\)/, 'every straight-flush suit must render through a custom-sized Sprite')
assert.match(suitConstruction, /if \(!this\.isSuitAvailable\(suit\)\) return[\s\S]*this\.actions\.onSuitSelect\?\.\(selected\)/, 'unavailable suits must never emit a selection action')
const counterConstruction = source.slice(source.indexOf('private createCounter'), source.indexOf('private createSuitBar'))
assert.match(counterConstruction, /new Node\(`CounterSuit-\$\{suit\}`\)[\s\S]*addComponent\(Sprite\)[\s\S]*sprite\.sizeMode = Sprite\.SizeMode\.CUSTOM[\s\S]*this\.counterSuitSprites\.set\(suit, sprite\)/, 'the restored card counter must reuse the same four packaged suit sprites')
assert.match(source, /public setSuitFrames \(frames: Readonly<Partial<Record<TableGameHudSuit, SpriteFrame>>>\): void \{[\s\S]*buttonSprite\.spriteFrame = frame[\s\S]*counterSprite\.spriteFrame = frame[\s\S]*this\.renderSuitButtons\(\)[\s\S]*this\.renderCounter\(\)/, 'one injected frame set must update both the suit bar and card counter')
assert.doesNotMatch(hudSources, /[♠♥♣♦]/, 'the HUD must not fall back to device-dependent suit glyphs')
const suitRendering = dynamicRendererSource.slice(dynamicRendererSource.indexOf('export const renderTableHudSuits'))
assert.match(suitRendering, /roundRect\(-82, -23, 244, 46, 12\)/, 'the four suits must sit inside one common rounded frame')
assert.doesNotMatch(suitRendering, /drawButtonSurface|roundRect\([^,\n]+,[^,\n]+,\s*(?:44|48)\s*,/, 'suit rendering must not draw an individual box per glyph')
assert.match(suitRendering, /available \? new Color\(255, 255, 255, 255\) : new Color\(105, 105, 105, 120\)/, 'unavailable suits must use a low-saturation, low-brightness filter')
assert.match(suitRendering, /underlineHalfWidth[\s\S]*underlineY[\s\S]*graphics\.moveTo\(x - underlineHalfWidth, underlineY\)[\s\S]*graphics\.lineTo/, 'available suits need a saturated underline cue')
assert.match(suitRendering, /if \(selected\)[\s\S]*graphics\.circle\(x, 1, pressed \? \(expandedMetrics \? 20 : 17\) : \(expandedMetrics \? 22 : 19\)\)/, 'the selected suit needs a stronger halo cue')
assert.match(presenterSource, /this\.requestSuitArtwork\(generation\)/, 'the presenter must request packaged suit artwork while mounting the HUD')
assert.match(presenterSource, /private requestSuitArtwork \(generation: number\): void[\s\S]*requestClassicCardFrame\(`shape_\$\{suit\}_s`\)[\s\S]*this\.tableHud\?\.setSuitFrames\(frames\)/, 'the presenter must load each compact card-suit frame once and inject it into the asset-free HUD')
assert.match(replay, /import \{ CardView \} from '\.\/CardView'[\s\S]*new Node\(`ReplayCard-\$\{index\}`\)[\s\S]*addComponent\(CardView\)[\s\S]*cardView\.bind\(replayCardPresentation\(card, index\)\)/, 'replay cards must reuse the packaged CardView renderer')
assert.doesNotMatch(replay, /suitGlyph|[♠♥♣♦]/, 'replay cards must not reintroduce host-font suit glyphs')
assert.match(source, /const labels = \{ start: '锁牌', cancel: '取消', commit: '确认', unlock: '解锁' \}/, 'the lock button must render the authoritative draft action')
assert.match(source, /this\.actions\.onHandLockAction\?\.\(\)/, 'the HUD must emit intent without maintaining an optimistic lock boolean')
assert.doesNotMatch(source, /this\.update\(\{ handLocked:/, 'the HUD must not own a second lock state')
assert.match(grouping, /canCreateLockedGroup[\s\S]*diagnosePlay\(cards, null, ruleProfile\)\.canPlay/, 'locking must reuse one authoritative legal-combination diagnosis')
assert.match(source, /this\.arrangeButton\.label\.string = this\.state\.arrangeRestoreAvailable \? '复原' : '一键理牌'/, 'one-key arrangement must expose a direct restore toggle')
const toolbarConstruction = source.slice(source.indexOf('private createToolbar'), source.indexOf('private createButton'))
assert.match(toolbarConstruction, /configureTransform\(toolbar, BASE_TOOLBAR_WIDTH, 56\)/, 'the taller tool labels need a 56px toolbar container')
assert.match(toolbarConstruction, /createButton\(toolbar, 'LockHand', '锁牌', -150, 116, 50, 24\)/, 'lock and restore text must keep its enlarged 24px treatment')
assert.match(toolbarConstruction, /createButton\(toolbar, 'ArrangeHand', '一键理牌', 0, 164, 50, 26\)/, 'arrange and restore text must keep its enlarged 26px treatment')
assert.match(toolbarConstruction, /createButton\(toolbar, 'QuickChat', '快捷语', 150, 116, 50, 24\)/, 'quick chat must align visually with the arrangement tools at 24px')
assert.match(workspace, /const baseline = this\.grouping\.getSnapshot\(\)[\s\S]*this\.grouping\.arrange[\s\S]*this\.grouping\.autoGroup[\s\S]*mode: 'smart-arranged', baseline/, 'the first click must checkpoint and enter explicit smart arrangement')
assert.match(workspace, /this\.arrangementState\.mode === 'smart-arranged'[\s\S]*restoreSnapshot\(this\.arrangementState\.baseline\)[\s\S]*mode: 'point-stacked'/, 'the second click must leave smart arrangement and restore the point-stacked state')
assert.doesNotMatch(scene, /['"](?:TableHomeButton|ChatButton|ArrangeButton)['"]|toggleArrangePanel/, 'HUD-replaced fallback buttons and their hidden panel must stay retired')

const passPresentation = playArea.slice(playArea.indexOf("if (action.type === 'Pass')"), playArea.indexOf('const spacing = resolvePlayedCardSpacing'))
assert.match(passPresentation, /text\.string = '不要'/)
assert.match(passPresentation, /delay\(0\.72\)\.to\(0\.32, \{ opacity: 0 \}\)\.call/, 'the pass prompt must begin its terminal fade within the current action presentation')
assert.match(passPresentation, /expiredPassKeys\.add\(key\)[\s\S]*actionNodes\.delete\(id\)[\s\S]*destroyNode\(root\)/, 'the pass prompt must be destroyed and prevented from reappearing after its short lifetime')
assert.match(playArea, /if \(lastValidPlay === null\) this\.visibleActionStart = actions\.length/, 'starting a new trick must immediately retire previous action text')
assert.match(playArea, /public clearPresentation \(\): void[\s\S]*actionNodes\.forEach\(node => this\.destroyNode\(node\)\)/, 'round/table teardown must clear every transient action node')

process.stdout.write('table game HUD regression checks passed (active counter, straight-flush availability, shared suit frame, equal turn timers)\n')
