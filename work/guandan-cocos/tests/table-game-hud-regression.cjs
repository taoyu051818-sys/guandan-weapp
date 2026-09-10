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
const tableMatchCoordinator = fs.readFileSync(tableMatchCoordinatorPath, 'utf8') + fs.readFileSync(path.join(projectRoot, 'assets/scripts/scenes/TablePhasePresenter.ts'), 'utf8')
const presenterSource = fs.readFileSync(presenterPath, 'utf8')
const turnClock = fs.readFileSync(turnClockPath, 'utf8') + fs.readFileSync(path.join(projectRoot, 'assets/scripts/scenes/TableTurnClockProjection.ts'), 'utf8')
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
const capsulePolicy = evaluateTypeScriptModule(path.join(projectRoot, 'assets/scripts/ui/WechatCapsuleLayout.ts'))
const layoutPolicy = evaluateTypeScriptModule(layoutPolicyPath, request => request === './SafeAreaLayout' ? safeArea : request === './WechatCapsuleLayout' ? capsulePolicy : require(request))
const closeTo = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.001, `${message}: expected ${expected}, received ${actual}`)

// Fresh layout, folding and delayed native capsule metrics must use the same anchor.
for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1280, height: 589, nativeCapsule: { left: 430, right: 625, top: 280, bottom: 218 } },
  { width: 1280, height: 589, safeLeft: 42, safeRight: 42, nativeCapsule: { left: 420, right: 620, top: 280, bottom: 204 } },
  { width: 900, height: 720, nativeCapsule: { left: 230, right: 448, top: 350, bottom: 280 } },
]) {
  const place = (height, drag) => layoutPolicy.resolveTableHudCounterPlacement(viewport, { width: 596, height }, 82, drag)
  const first = place(42)
  const opened = place(82)
  const folded = place(42)
  const scale = layoutPolicy.resolveTableHudBounds(viewport).scale
  if (viewport.width === 1280 && !viewport.nativeCapsule) closeTo(first.position.x, 242, 'preserve the reviewed horizontal anchor')
  assert.deepEqual(first, folded, 'first closed position must equal post-toggle position')
  closeTo(first.position.x, opened.position.x, 'opening must not change X')
  closeTo(first.position.y + 21 * scale, opened.position.y + 41 * scale, 'opening must preserve the top edge')
  assert.deepEqual(place(42, first.anchor), first, 'persisted anchor must be idempotent')
  const dragged = { x: -100, y: 50 }
  closeTo(place(42, dragged).position.x, place(82, dragged).position.x, 'dragged counter must not jump on toggle')
  assert.deepEqual(place(42, place(42, dragged).anchor), place(42, dragged), 'dragged anchor must remain stable')
}
assert.match(source, /if \(this\.overlayPositions\.counter\) this\.overlayPositions\.counter = counter\.anchor/, 'initial viewport coordinates must not be cached as a user drag')
assert.match(source, /EXPANDED_ROUND_WIDTH, EXPANDED_ROUND_HEIGHT\)/, 'two-line summary uses small corners, not a capsule')
assert.match(foundationSource, /EXPANDED_ROUND_WIDTH = 240/, 'summary removes excess horizontal space')

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
assert.match(presenterSource, /cardCounts: this\.publicCardCounts\(snapshot, teammate\?\.available \? teammate.playerId : humanId\)/, 'the presenter counts only the authorized displayed hand and public plays')
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
  toolbarSize: { width: 480, height: 70 },
})
assert.equal(standardLayout.bounds.scale, 1, 'the design viewport must preserve 1:1 HUD scale')
assert.deepEqual(standardLayout.seats.top, { x: -306, y: 188, scale: 1, visible: true }, 'the opposite seat column preserves the former portrait anchor and leaves room for central plays')
assert.equal(standardLayout.top.back.visible, true)
assert.equal(standardLayout.top.round.visible, true)
assert.ok(standardLayout.bottom.suitBar.x - 480 * standardLayout.bottom.suitBar.scale / 2 > standardLayout.seats.bottom.x + 100, 'straight-flush tools must reserve the local player information lane')
closeTo(standardLayout.bottom.toolbar.x + 480 * standardLayout.bottom.toolbar.scale / 2, standardLayout.bounds.right - 8, 'hand tools must anchor to the right safe edge')
closeTo(standardLayout.bottom.suitBar.y, standardLayout.bottom.toolbar.y, 'wide layouts keep both optional tool groups in one bottom control lane')

const operationRow = layoutPolicy.resolveTableHudOperationRow([112, 112, 128])
assert.deepEqual(operationRow, { size: { width: 616, height: 112 }, timerX: -252, actionXs: [-130, -8, 122] }, 'the buttons must be centred independently of the adjacent timer')
assert.deepEqual(layoutPolicy.resolveTableHudOperationRow([112]).actionXs, [0], 'a sole pass action must sit exactly at the centre')
assert.equal(operationRow.actionXs[0] - 56, -(operationRow.actionXs[2] + 64), 'left/right button bounds balance around zero')
assert.deepEqual(
  layoutPolicy.clampTableHudOverlayPosition({ x: 999, y: 999 }, operationRow.size, standardLayout.bounds),
  { x: 324, y: 296 },
  'dragged operations must remain inside the safe viewport',
)
assert.equal(layoutPolicy.resolveTableHudBounds({ width: 960, height: 540 }).scale, 0.78, 'small viewports must preserve the legibility floor')
const narrowLayout = layoutPolicy.resolveTableHudFrameLayout({
  viewport: { width: 700, height: 540 },
  backSize: { width: 60, height: 60 },
  roundSize: { width: 272, height: 84 },
  seatSize: { width: 280, height: 100 },
  suitSize: { width: 480, height: 68 },
  toolbarSize: { width: 480, height: 70 },
})
closeTo(narrowLayout.bottom.suitBar.x, narrowLayout.bottom.toolbar.x, 'narrow viewports must split bottom tools onto one shared lane')
assert.ok(narrowLayout.bottom.suitBar.y > narrowLayout.bottom.toolbar.y, 'the straight-flush group must occupy the upper split row')

for (const control of ['TableBack', 'MatchSummary', 'CircularTurnTimer', 'StraightFlushSuitBar', 'LockHand', 'ArrangeHand', 'TableTrustee']) {
  assert.equal(hudSources.includes(`'${control}'`) || hudSources.includes(`\`${control}\``), true, `missing HUD control: ${control}`)
}
assert.match(layoutPolicySource, /TABLE_HUD_SEAT_PLACES: readonly TableHudSeatPlace\[\] = \['bottom', 'right', 'top', 'left'\]/)
for (const stateField of ['matchLabel', 'levelLabel', 'turnVisible', 'turnSeconds', 'turnDurationSeconds', 'turnPlace', 'counterExpanded', 'cardCounts', 'availableSuits', 'lockDecision']) {
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
for (const callback of ['onBack', 'onCounterVisibilityChange', 'onSuitSelect', 'onHandLockAction', 'onArrange', 'onTrustee']) {
  assert.match(source, new RegExp(`${callback}\\?\\.`), `HUD action must be emitted: ${callback}`)
}
for (const label of ['本局打', '我方 2级 · 对方 2级', '记牌器', '同花顺', '锁牌', '恢复', '一键理牌', '复原', '托管']) {
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
assert.match(seatRendering, /place === 'bottom' \? this\.ownAvatarFrame \?\? seat\.avatarFrame \?\? this\.defaultAvatarFrame : seat\.avatarFrame \?\? this\.defaultAvatarFrame/)
assert.match(seatRendering, /active = Boolean\(view\.avatarSprite\.spriteFrame\)/)
assert.doesNotMatch(seatRendering, /drawPanel\(view\.graphics|roundRect\(-95, -35, 190, 70/, 'seat details must not sit inside one large outer panel')

assert.deepEqual(layoutPolicy.TABLE_HUD_TURN_OPERATION_ANCHORS, { bottom: { x: 0, y: 44 }, top: { x: 0, y: 218 } }, 'only human/top anchors stay fixed; sides must use the shared played-card policy')
assert.match(scene, /return TABLE_HUD_TURN_OPERATION_ANCHORS\.bottom\.y/, 'legacy and tribute actions must use the same anchor as the active HUD')
assert.match(source, /humanTurnTimer[\s\S]*desiredParent = humanTurnTimer \? this\.operationOverlay : this\.root/, 'the human timer must join the draggable operation row only on the human turn')
assert.match(source, /clampTableHudOverlayPosition\([\s\S]*turnTimerPosition\(this\.viewport, this\.state\.turnPlace\)[\s\S]*\{ width: 112, height: 112 \}/, 'other players timers share the played-area anchor and retain safe-area bounds')
assert.match(source, /this\.place\(timerNode, timerPosition\.x, timerPosition\.y, bounds\.scale, 80\)/, 'every seat timer must use the same scale as the human timer')
assert.doesNotMatch(source, /NON_HUMAN_TIMER_SCALE/, 'other seats must not apply a separate timer scale')
assert.ok(standardLayout.seats.top.x + 156 / 2 < -112 / 2, 'the compact opposite column must remain fully left of the top operation area')
assert.equal(standardLayout.seats.top.y + 30, 218, 'stacking the text must preserve the portrait height')
assert.match(fs.readFileSync(path.join(projectRoot, 'assets/scripts/scenes/TableSceneLayout.ts'), 'utf8'), /new Vec3\(-220, 218, 0\)/, 'the legacy seat origin used for card flights must agree with the opposite HUD seat')
// Deadline arithmetic, all viewpoints and room durations are exercised by table-turn-clock-controller-regression.
assert.doesNotMatch(turnClock, /actOnLocalTimeout/, 'no retired local AI timer remains')
assert.match(playArea, /playedCardPosition\(this\.viewport, place, count\)/, 'the played fan uses the tested safe-edge and bottom-alignment policy')

assert.doesNotMatch(layoutPolicySource, /id: 'turn-timer'/, 'the floating timer must not participate in lower seat collision resolution')
assert.match(source, /new Node\('FloatingOperationGroup'\)/, 'timer and operation buttons need one draggable top-layer group')
assert.doesNotMatch(source, /OperationDragHandle|operationDragHandle|handleWidth/, 'the obsolete standalone operation drag icon must not be created or laid out')
assert.match(source, /bindDragHandle\(this\.turnTimer\.node, 'operations',[\s\S]*this\.turnTimer\.node\?\.parent === this\.operationOverlay/, 'dragging the chicken timer itself must move the entire operation group')
assert.match(source, /private bindDragHandle[\s\S]*EventType\.TOUCH_MOVE[\s\S]*event\.getUIDelta\(\)[\s\S]*this\.layout\(this\.viewport\)/, 'dragging must persist and reclamp the overlay position')
assert.match(layoutPolicySource, /clampTableHudOverlayPosition[\s\S]*bounds\.left[\s\S]*bounds\.right[\s\S]*bounds\.bottom[\s\S]*bounds\.top/, 'floating groups must stay inside the current safe bounds')
assert.match(source, /this\.overlayPositions\.operations \?\? TABLE_HUD_TURN_OPERATION_ANCHORS\.bottom/, 'the draggable turn-action row must default to the human operation area')
assert.match(source, /toolbar\.parent = parent/, 'lock, arrange and chat tools must remain outside the draggable turn-action row')
assert.match(layoutPolicySource, /const suitX = laneLeft \+ suitSize\.width \* singleRowScale \/ 2[\s\S]*const toolbarX = bounds\.right - 8 - toolbarSize\.width \* singleRowScale \/ 2/, 'optional tools reserve the local player lane and keep hand tools at the right safe edge')
assert.match(source, /this\.turnActionNodes\.forEach\(node => \{ node\.parent = this\.operationOverlay \}\)/, 'authoritative action buttons must be reparented without replacing their callbacks')
assert.match(source, /visibleActions = this\.turnActionNodes\.filter\(node => node\.isValid && node\.active\)/, 'the row must include only currently valid action buttons')
assert.match(source, /this\.place\(timerNode, row\.timerX, 0, 1, 2\)/, 'the human timer must occupy the first slot of the shared turn-action row')
assert.match(source, /Tween\.stopAllByTarget\(node\)[\s\S]*this\.place\(node, row\.actionXs\[index\], 0, 1, 3\)/, 'HUD positioning must cancel stale fallback tweens before laying out action buttons')
assert.match(scene, /turnActionNodes: \[this\.hintButton, this\.passButton, this\.playButton\]/, 'the scene must supply the fixed 提示/不要/出牌 controls in display order')
assert.match(presenterSource, /hud\.setTurnActionNodes\(options\.turnActionNodes\)/, 'the presenter must attach the supplied controls to the HUD operation row')
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
assert.match(suitRendering, /input\.bar\) input\.bar\.active = true/, 'zero candidates must retain the complete suit bar')
assert.match(suitRendering, /drawUiFrame\(graphics, -82, -23, 244, 46, 'control'\)/, 'the four suits must sit inside one shared small-corner rectangular frame')
assert.doesNotMatch(suitRendering, /drawButtonSurface|roundRect\([^,\n]+,[^,\n]+,\s*(?:44|48)\s*,/, 'suit rendering must not draw an individual box per glyph')
assert.match(suitRendering, /renderSuitAvailability\(view\.sprite, suit, available\)/, 'all suits share the neutral disabled renderer')
assert.match(fs.readFileSync(path.join(projectRoot, 'assets/scripts/ui/TableHudSuitAvailability.ts'), 'utf8'), /new Color\(155, 162, 171\)/, 'disabled suits use a visible neutral gray, including originally black textures')
assert.match(suitRendering, /underlineHalfWidth[\s\S]*underlineY[\s\S]*graphics\.moveTo\(x - underlineHalfWidth, underlineY\)[\s\S]*graphics\.lineTo/, 'available suits need a saturated underline cue')
assert.match(suitRendering, /if \(selected\)[\s\S]*graphics\.circle\(x, 1, pressed \? \(expandedMetrics \? 20 : 17\) : \(expandedMetrics \? 22 : 19\)\)/, 'the selected suit needs a stronger halo cue')
assert.match(presenterSource, /this\.requestSuitArtwork\(generation\)/, 'the presenter must request packaged suit artwork while mounting the HUD')
assert.match(presenterSource, /private requestSuitArtwork \(generation: number\): void[\s\S]*requestClassicCardFrame\(`shape_\$\{suit\}_s`\)[\s\S]*this\.tableHud\?\.setSuitFrames\(frames\)/, 'the presenter must load each compact card-suit frame once and inject it into the asset-free HUD')
assert.match(replay, /import \{ CardView \} from '\.\/CardView'[\s\S]*new Node\(`ReplayCard-\$\{index\}`\)[\s\S]*addComponent\(CardView\)[\s\S]*cardView\.bind\(replayCardPresentation\(card, index\)\)/, 'replay cards must reuse the packaged CardView renderer')
assert.doesNotMatch(replay, /suitGlyph|[♠♥♣♦]/, 'replay cards must not reintroduce host-font suit glyphs')
assert.match(source, /this\.state\.lockDecision\.kind === 'unlock' \? '恢复' : '锁牌'/, 'the lock button consumes the shared decision instead of a duplicate action enum')
assert.match(source, /this\.actions\.onHandLockAction\?\.\(\)/, 'the HUD must emit intent without maintaining an optimistic lock boolean')
assert.doesNotMatch(source, /this\.update\(\{ handLocked:/, 'the HUD must not own a second lock state')
assert.match(grouping, /canCreateLockedGroup[\s\S]*diagnosePlay\(cards, null, ruleProfile\)\.canPlay/, 'locking must reuse one authoritative legal-combination diagnosis')
assert.match(source, /this\.arrangeButton\.label\.string = this\.state\.arrangeRestoreAvailable \? '复原' : '一键理牌'/, 'one-key arrangement must expose a direct restore toggle')
const toolbarConstruction = source.slice(source.indexOf('private createToolbar'), source.indexOf('private createButton'))
assert.match(toolbarConstruction, /configureTransform\(toolbar, BASE_TOOLBAR_WIDTH, 56\)/, 'the taller tool labels need a 56px toolbar container')
assert.match(toolbarConstruction, /createButton\(toolbar, 'LockHand', '锁牌', -150, 116, 50, 24\)/, 'lock and restore text must keep its enlarged 24px treatment')
assert.match(toolbarConstruction, /createButton\(toolbar, 'ArrangeHand', '一键理牌', 0, 164, 50, 26\)/, 'arrange and restore text must keep its enlarged 26px treatment')
assert.match(toolbarConstruction, /createButton\(toolbar, 'TableTrustee', '托管', 150, 116, 50, 24\)/, 'quick chat must align visually with the arrangement tools at 24px')
assert.match(presenterSource, /private counterExpanded = false/, 'the large card counter must start collapsed on compact landscape tables')
assert.match(workspace, /const baseline = this\.grouping\.getSnapshot\(\)[\s\S]*this\.grouping\.arrange[\s\S]*this\.grouping\.autoGroup[\s\S]*mode: 'smart-arranged', baseline/, 'the first click must checkpoint and enter explicit smart arrangement')
assert.match(workspace, /this\.arrangementState\.mode === 'smart-arranged'[\s\S]*restoreSnapshot\(this\.arrangementState\.baseline\)[\s\S]*mode: 'point-stacked'/, 'the second click must leave smart arrangement and restore the point-stacked state')
assert.doesNotMatch(scene, /['"](?:TableHomeButton|ChatButton|ArrangeButton)['"]|toggleArrangePanel/, 'HUD-replaced fallback buttons and their hidden panel must stay retired')

const passPresentation = playArea.slice(playArea.indexOf("if (action.type === 'Pass')"), playArea.indexOf('const spacing = resolvePlayedCardSpacing'))
assert.match(passPresentation, /text\.string = '不要'/)
assert.match(passPresentation, /delay\(0\.72\)\.to\(0\.32, \{ opacity: 0 \}\)\.call/, 'the pass prompt must begin its terminal fade within the current action presentation')
assert.match(passPresentation, /expiredPassKeys\.add\(key\)[\s\S]*actionNodes\.delete\(id\)[\s\S]*destroyNode\(root\)/, 'the pass prompt must be destroyed and prevented from reappearing after its short lifetime')
assert.match(playArea, /if \(lastValidPlay === null\) this\.visibleActionStart = actions\.length/, 'starting a new trick must immediately retire previous action text')
assert.match(playArea, /public clearPresentation \(\): void[\s\S]*actionNodes\.forEach\(node => this\.destroyNode\(node\)\)/, 'round/table teardown must clear every transient action node')

// Public possibility never receives opponents' card identities or values.
const { publicStraightFlushPossibleSuits } = evaluateTypeScriptModule(path.join(projectRoot, 'assets/scripts/game/PublicStraightFlushPossibility.ts'))
const suitsForTest = ['spade', 'heart', 'club', 'diamond']
const physicalRanks = [2, 3, 4, 5, 6, 7, 8, 9, 10, 'J', 'Q', 'K', 'A']
const physicalDeck = suitsForTest.flatMap(suit => physicalRanks.flatMap(rank => [0, 1].map(copy => ({ id: `${suit}-${rank}-${copy}`, suit, rank }))))
const possibilityInput = { knownHand: [], publicPlays: [], otherHandSizes: [27, 27, 27], level: 9, allowAceLowStraight: true }
assert.deepEqual(publicStraightFlushPossibleSuits(possibilityInput), suitsForTest)
assert.deepEqual(publicStraightFlushPossibleSuits({ ...possibilityInput, otherHandSizes: [4, 4, 0] }), [], 'no other seat can hold five cards')
const leaveUnknown = ids => ({ ...possibilityInput, publicPlays: [{ cards: physicalDeck.filter(c => !ids.includes(c.id)) }], otherHandSizes: [ids.length, 0, 0] })
const spadeFive = [2, 3, 4, 5, 6].map(rank => `spade-${rank}-0`)
assert.deepEqual(publicStraightFlushPossibleSuits(leaveUnknown(spadeFive)), ['spade'])
assert.deepEqual(publicStraightFlushPossibleSuits(leaveUnknown([...spadeFive.slice(0, 4), 'heart-9-0'])), ['spade'], 'one unseen wildcard can fill one gap')
assert.deepEqual(publicStraightFlushPossibleSuits(leaveUnknown([...spadeFive.slice(0, 3), 'heart-9-0', 'heart-9-1'])), ['spade'], 'two physical wildcard cards can fill two gaps')
assert.deepEqual(publicStraightFlushPossibleSuits(leaveUnknown([...spadeFive.slice(0, 2), 'heart-9-0', 'heart-9-1', 'club-K-0'])), [], 'two wildcards cannot fill three gaps')
const aceLowOnly = leaveUnknown(['A', 2, 3, 4, 5].map(rank => `club-${rank}-0`))
assert.deepEqual(publicStraightFlushPossibleSuits(aceLowOnly), ['club'])
assert.deepEqual(publicStraightFlushPossibleSuits({ ...aceLowOnly, allowAceLowStraight: false }), [])
const oneRemainingCopy = leaveUnknown(spadeFive)
assert.deepEqual(publicStraightFlushPossibleSuits({ ...oneRemainingCopy, publicPlays: [...oneRemainingCopy.publicPlays, ...oneRemainingCopy.publicPlays] }), ['spade'], 'duplicate public actions do not consume the second copy')
assert.deepEqual(publicStraightFlushPossibleSuits({ ...oneRemainingCopy, knownHand: [physicalDeck.find(c => c.id === 'spade-4-0')] }), [], 'own known cards cannot remain in other players potential straight flushes')
const heartLevelNatural = leaveUnknown([7, 8, 9, 10, 'J'].map(rank => `heart-${rank}-0`))
assert.deepEqual(publicStraightFlushPossibleSuits(heartLevelNatural), ['heart'], 'a heart level card can supply its natural rank exactly once')
assert.match(presenterSource, /counterPossibleSuits: publicStraightFlushPossibleSuits/, 'counter gets an independent public-information projection')
assert.doesNotMatch(presenterSource, /counterPossibleSuits: hand\.availableSuits/, 'counter must not mirror own hand availability')

const stubNode = () => ({ active: true, children: {}, getChildByName (name) { return this.children[name] }, setPosition () {}, setScale () {} })
class TestColor { constructor (r, g, b, a) { Object.assign(this, { r, g, b, a }) } }
class TestVec { constructor (x, y, z) { Object.assign(this, { x, y, z }) } }
class TestGraphics { moveTo () {} lineTo () {} close () {} fill () {} circle () {} bezierCurveTo () {} }
class TestNode {
  constructor (name) { this.name = name; Object.assign(this, stubNode()) }
  set parent (parent) { parent.children[this.name] = this }
  addComponent () { return new TestGraphics() }
}
const rendererDependency = request => {
  if (request === './TableButtonMetrics') return { TABLE_BUTTON_HEIGHT: 58 * 1.2 }
  if (request === './UiFrameStyle') return evaluateTypeScriptModule(path.join(projectRoot, 'assets/scripts/ui/UiFrameStyle.ts'), rendererDependency)
  if (request === './TableHudSuitAvailability') return evaluateTypeScriptModule(path.join(projectRoot, 'assets/scripts/ui/TableHudSuitAvailability.ts'), rendererDependency)
  if (request === 'cc') return { Color: TestColor, Vec3: TestVec, Graphics: TestGraphics, Node: TestNode }
  if (request === './TableGameHudFoundation') return {
    SUITS: suitsForTest, BASE_COUNTER_WIDTH: 596, BASE_COUNTER_OPEN_HEIGHT: 82, BASE_COUNTER_CLOSED_HEIGHT: 42,
    TABLE_GAME_HUD_COUNTER_RANKS: [], configureTransform () {}, drawTableHudPanel () {}, finiteOr: (v, f) => Number.isFinite(v) ? v : f,
    nodeContentSize: () => ({ width: 382, height: 54 }),
  }
  throw new Error(request)
}
const dynamic = evaluateTypeScriptModule(dynamicRendererPath, rendererDependency)
const graphics = { clear () {}, roundRect () {}, fill () {}, stroke () {}, moveTo () {}, lineTo () {}, circle () {} }
const suitViews = new Map(suitsForTest.map(suit => [suit, { node: stubNode(), sprite: { node: stubNode(), spriteFrame: {} } }]))
const emptyBar = stubNode()
dynamic.renderTableHudSuits({ bar: emptyBar, graphics, buttons: suitViews, availableSuits: [], selectedSuit: 'heart', pressedSuit: null })
assert.equal(emptyBar.active, true)
assert.ok([...suitViews.values()].every(v => v.node.active && !v.sprite.enabled && v.sprite.node.children.UnavailableSuit.active))
const counterSprites = new Map(suitsForTest.map(suit => [suit, { node: stubNode(), spriteFrame: {} }]))
const counterInput = { panel: stubNode(), graphics, title: { node: stubNode() }, toggleLabel: { node: stubNode() }, hitArea: stubNode(), cells: new Map(), suitSprites: counterSprites, state: { counterExpanded: true, cardCounts: {}, counterPossibleSuits: [] } }
dynamic.renderTableHudCounter(counterInput)
assert.equal(counterInput.panel.active, true)
assert.ok([...counterSprites.values()].every(s => s.node.active && !s.enabled && s.node.children.UnavailableSuit.active), 'zero possibility retains all four gray counter suits')
counterInput.state.counterPossibleSuits = ['club']
dynamic.renderTableHudCounter(counterInput)
assert.equal(counterSprites.get('club').enabled, true)
assert.equal(counterSprites.get('club').node.children.UnavailableSuit.active, false)
assert.equal(counterSprites.get('heart').enabled, false)
assert.ok([...suitViews.values()].every(v => !v.sprite.enabled), 'counter lighting is independent of the hand suit controls')
dynamic.renderTableHudSuits({ bar: emptyBar, graphics, buttons: suitViews, availableSuits: suitsForTest, selectedSuit: null, pressedSuit: null })
assert.ok([...suitViews.values()].every(v => v.sprite.enabled && !v.sprite.node.children.UnavailableSuit.active), 'available suits recover their original artwork')
dynamic.renderTableHudSuits({ bar: emptyBar, graphics, buttons: suitViews, availableSuits: [], selectedSuit: null, pressedSuit: null })
assert.ok([...suitViews.values()].every(v => Object.keys(v.sprite.node.children).length === 1 && v.sprite.node.children.UnavailableSuit.active), 'repeated state changes reuse the same disabled silhouette')

process.stdout.write('table game HUD regression checks passed (public possibilities, retained gray suits, active counter, equal turn timers)\n')

const metrics = evaluateTypeScriptModule(path.join(projectRoot, 'assets/scripts/ui/TableButtonMetrics.ts'))
closeTo(metrics.TABLE_BUTTON_HEIGHT, 58 * 1.2, 'unified height is 120%')
closeTo(metrics.tableButtonWidth('出牌', true), 128 * 1.2, 'play width is 120%')
closeTo(metrics.tableButtonWidth('不要'), 112 * 1.2, 'pass width is 120%')
assert.ok(metrics.tableButtonWidth('取消托管') > metrics.tableButtonWidth('托管'))
assert.match(dynamicRendererSource, /new Color\(220, 239, 255, 246\)/, 'suit indicator uses a pale blue surface')
assert.match(source, /new Color\(184, 222, 255\)/, 'straight-flush title uses light blue')
assert.match(layoutPolicySource, /suitX \+ rightShift/, 'suit bar moves right when the safe lane has room')
assert.doesNotMatch(source.slice(source.indexOf('public hitTestInteractiveScreenPoint'), source.indexOf('public setOwnAvatarFrame')), /this\.operationOverlay/, 'blank operation-row envelope must never block top stacked cards')
