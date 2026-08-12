const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const { compilerPath, loadTypeScript } = require('./support/typescript.cjs')
const effectHandlePath = path.join(projectRoot, 'assets/scripts/effects/EffectHandle.ts')
const effectRendererPath = path.join(projectRoot, 'assets/scripts/effects/EffectRenderer.ts')
const effectRenderContextPath = path.join(projectRoot, 'assets/scripts/effects/EffectRenderContext.ts')
const rendererRegistryPath = path.join(projectRoot, 'assets/scripts/effects/EffectRendererRegistry.ts')
const assetCatalogPath = path.join(projectRoot, 'assets/scripts/effects/EffectAssetCatalog.ts')
const effectRecipesPath = path.join(projectRoot, 'assets/scripts/effects/EffectRecipes.ts')
const bombRendererPath = path.join(projectRoot, 'assets/scripts/effects/BombEffectRenderer.ts')
const sixBombRendererPath = path.join(projectRoot, 'assets/scripts/effects/SixBombRenderer.ts')
const retiredRendererPaths = [
  path.join(projectRoot, 'assets/scripts/effects/SignaturePatternEffectRenderer.ts'),
  path.join(projectRoot, 'assets/scripts/effects/CardPatternEffectRenderer.ts'),
  path.join(projectRoot, 'assets/scripts/effects/FlowEffectRenderer.ts'),
]
const flowEffectTypesPath = path.join(projectRoot, 'assets/scripts/effects/FlowEffectTypes.ts')
const effectControllerPath = path.join(projectRoot, 'assets/scripts/effects/EffectController.ts')
const effectPlaybackPath = path.join(projectRoot, 'assets/scripts/effects/EffectPlaybackCoordinator.ts')
const actionPresentationPath = path.join(projectRoot, 'assets/scripts/effects/EffectActionPresentationCoordinator.ts')
const cardBlastReactionPath = path.join(projectRoot, 'assets/scripts/effects/CardBlastReaction.ts')
const archivedPlayVisualsPath = path.join(projectRoot, 'assets/scripts/effects/ArchivedPlayVisuals.ts')
const cardFlightPath = path.join(projectRoot, 'assets/scripts/effects/CardFlightController.ts')
const playAreaControllerPath = path.join(projectRoot, 'assets/scripts/ui/PlayAreaController.ts')
const handControllerPath = path.join(projectRoot, 'assets/scripts/ui/HandController.ts')
const gameScenePath = path.join(projectRoot, 'assets/scripts/scenes/GameScene.ts')
const effectNodePoolPath = path.join(projectRoot, 'assets/scripts/effects/EffectNodePool.ts')
const vfxCardSnapshotPath = path.join(projectRoot, 'assets/scripts/effects/VfxCardSnapshot.ts')
const classicCardFrameStorePath = path.join(projectRoot, 'assets/scripts/ui/ClassicCardFrameStore.ts')
const transientPoolPath = path.join(projectRoot, 'assets/scripts/effects/TransientEffectNodePool.ts')
const networkPolicyPath = path.join(projectRoot, 'assets/scripts/effects/NetworkEffectSyncPolicy.ts')
const legacyManifestPath = path.join(projectRoot, 'third_party/legacy-effects/manifest.json')
const legacyVerifierPath = path.join(projectRoot, 'scripts/verify-legacy-effect-assets.mjs')

assert.equal(fs.existsSync(compilerPath), true, 'Cocos Creator TypeScript compiler is required')
const ts = loadTypeScript()
const read = filePath => fs.readFileSync(filePath, 'utf8')

function loadPureTs (filePath, dependencies = {}) {
  const result = ts.transpileModule(read(filePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
    fileName: filePath,
    reportDiagnostics: true,
  })
  const errors = (result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
  assert.deepEqual(errors, [], `failed to transpile ${filePath}`)
  const module = { exports: {} }
  const localRequire = request => {
    if (Object.prototype.hasOwnProperty.call(dependencies, request)) return dependencies[request]
    throw new Error(`unexpected runtime dependency ${request} in ${filePath}`)
  }
  new Function('exports', 'module', 'require', '__filename', '__dirname', result.outputText)(module.exports, module, localRequire, filePath, path.dirname(filePath))
  return module.exports
}

function effectProfile (key) {
  return {
    key,
    level: key === 'bomb-large' ? 3 : 2,
    label: key,
    durationMs: 600,
    flightMs: 300,
    shake: 'medium',
    sound: 'bomb',
    haptic: 'medium',
    dimTable: key === 'bomb-large',
    color: [255, 139, 61],
  }
}

function renderContext (key, quality = 'full', services = {}) {
  return {
    profile: effectProfile(key),
    quality,
    roots: {},
    assets: {},
    nodePool: {},
    legacyCoordinates: {},
    services,
  }
}

async function verifyHandles (handles) {
  const { EffectHandle, CompositeEffectHandle } = handles
  const cleanupOrder = []
  const handle = new EffectHandle(reason => cleanupOrder.push(`first:${reason}`))
  handle.addCleanup(reason => cleanupOrder.push(`second:${reason}`))
  handle.addCleanup(() => { throw new Error('one broken cleanup must not stop the others') })
  const finishEvents = []
  handle.onFinish(reason => finishEvents.push(reason))

  assert.equal(handle.isActive, true)
  assert.equal(handle.finishReason, null)
  handle.cancel('recovery')
  handle.cancel('destroyed')
  assert.equal(handle.isActive, false)
  assert.equal(handle.finishReason, 'recovery', 'the first terminal reason must win')
  assert.equal(await handle.finished, 'recovery')
  assert.deepEqual(cleanupOrder, ['second:recovery', 'first:recovery'], 'cleanup must unwind once in reverse registration order')
  assert.deepEqual(finishEvents, ['recovery'])

  let lateCleanup = ''
  handle.addCleanup(reason => { lateCleanup = reason })
  assert.equal(lateCleanup, 'recovery', 'cleanup registered after completion must run immediately')

  const completed = EffectHandle.completed()
  assert.equal(completed.isActive, false)
  assert.equal(completed.finishReason, 'completed')
  assert.equal(await completed.finished, 'completed')

  const removedChild = new EffectHandle()
  const retainedChild = new EffectHandle()
  const composite = new CompositeEffectHandle([removedChild, retainedChild])
  assert.equal(composite.childCount, 2)
  assert.equal(composite.remove(removedChild), true)
  composite.cancel('replaced')
  assert.equal(removedChild.isActive, true, 'a detached child must not be cancelled by its former parent')
  assert.equal(retainedChild.finishReason, 'replaced', 'parent cancellation must cascade')
  assert.equal(composite.finishReason, 'replaced')
  removedChild.cancel('skipped')

  const first = new EffectHandle()
  const second = new EffectHandle()
  const clearable = new CompositeEffectHandle([first, second])
  clearable.clear('destroyed')
  assert.equal(clearable.isActive, true, 'clearing children must not finish the reusable composite')
  assert.equal(clearable.childCount, 0)
  assert.equal(first.finishReason, 'destroyed')
  assert.equal(second.finishReason, 'destroyed')
  clearable.complete()
}

async function verifyRegistry (handles, registryModule) {
  const { EffectHandle } = handles
  const { EffectRendererRegistry } = registryModule
  const registry = new EffectRendererRegistry()
  const rendered = []
  let disposed = 0
  let prepared = 0
  const renderer = {
    prepare: async context => { prepared += 1; return context.profile.key !== 'not-ready' },
    render: context => {
      rendered.push(context.profile.key)
      return new EffectHandle()
    },
    dispose: () => { disposed += 1 },
  }

  const unregister = registry.register(['bomb-small', 'bomb-medium', 'bomb-large', 'bomb-small'], renderer)
  assert.equal(registry.size, 3, 'one renderer may own all ordinary bomb variants without duplicate keys')
  assert.equal(registry.resolve(' bomb-small '), renderer)
  assert.throws(() => registry.register('bomb-small', { render: () => new EffectHandle() }), /already registered/)
  assert.equal(await registry.prepare(renderContext('bomb-small')), true)
  assert.equal(prepared, 1, 'preflight preparation must stay owned by the renderer registry')

  const small = registry.render(renderContext('bomb-small'))
  const large = registry.render(renderContext('bomb-large'))
  assert.deepEqual(rendered, ['bomb-small', 'bomb-large'])
  assert.equal(registry.activeCount, 2)
  small.complete()
  await small.finished
  assert.equal(registry.activeCount, 1, 'completed handles must leave the active set')

  registry.cancelAll('recovery')
  assert.equal(registry.activeCount, 0)
  assert.equal(large.finishReason, 'recovery', 'recovery must cancel every active renderer through one owner')

  const renderCountBeforeOff = rendered.length
  const off = registry.render(renderContext('bomb-medium', 'off'))
  assert.equal(off.finishReason, 'quality-off')
  assert.equal(rendered.length, renderCountBeforeOff, 'visual-off must not enter a renderer')

  const missing = registry.render(renderContext('not-registered'))
  assert.equal(missing.finishReason, 'unavailable')
  const unsupportedRenderer = { supports: () => false, render: () => { throw new Error('must not render') } }
  registry.register('unsupported', unsupportedRenderer)
  assert.equal(registry.render(renderContext('unsupported')).finishReason, 'unavailable')

  const reported = []
  registry.register('throws', { render: () => { throw new Error('renderer failed') } })
  const failed = registry.render(renderContext('throws', 'full', { reportError: (key, error) => reported.push([key, error.message]) }))
  assert.equal(failed.finishReason, 'failed')
  assert.deepEqual(reported, [['throws', 'renderer failed']])

  registry.setFallback(renderer)
  for (const rejectedKey of ['pair', 'straight-flush', 'king-bomb', 'wildcard', 'flow:victory']) {
    assert.throws(() => registry.register(rejectedKey, renderer), /not commercially approved/, `${rejectedKey} must be rejected even without an allowlist`)
    assert.equal(registry.resolve(rejectedKey), null, 'fallback must never revive a permanently rejected effect')
    assert.equal(await registry.prepare(renderContext(rejectedKey)), false)
    assert.equal(registry.render(renderContext(rejectedKey)).finishReason, 'unavailable')
  }

  registry.clear('destroyed')
  assert.equal(registry.size, 0)
  assert.equal(registry.activeCount, 0)
  assert.equal(disposed, 1, 'a renderer registered under several keys must be disposed exactly once')
  unregister()

  const approved = ['bomb-small', 'bomb-medium', 'bomb-large', 'six-bomb']
  const restricted = new EffectRendererRegistry(approved)
  restricted.register(['bomb-small', 'bomb-medium', 'bomb-large'], renderer)
  restricted.register('six-bomb', renderer)
  restricted.setFallback(renderer)
  for (const rejectedKey of ['pair', 'straight-flush', 'king-bomb', 'wildcard', 'flow:victory']) {
    assert.throws(() => restricted.register(rejectedKey, renderer), /not commercially approved/, `${rejectedKey} must not re-enter the commercial registry`)
    assert.equal(restricted.resolve(rejectedKey), null, 'fallback must not bypass the commercial allowlist')
    assert.equal(await restricted.prepare(renderContext(rejectedKey)), false)
    assert.equal(restricted.render(renderContext(rejectedKey)).finishReason, 'unavailable')
  }
  assert.deepEqual(restricted.keys(), approved)
  restricted.clear('destroyed')
}

function verifyBombRecipes (recipes) {
  const keys = ['bomb-small', 'bomb-medium', 'bomb-large']
  const full = keys.map(key => recipes.resolveBombRecipe(key, 'full'))
  assert.equal(full.every(Boolean), true)
  assert.equal(full.every(Object.isFrozen), true, 'published recipes must be immutable')
  assert.equal(full[0].ringCount < full[1].ringCount && full[1].ringCount < full[2].ringCount, true)
  assert.equal(full[0].sparkCount < full[1].sparkCount && full[1].sparkCount < full[2].sparkCount, true)
  assert.equal(full[0].durationMs < full[1].durationMs && full[1].durationMs < full[2].durationMs, true)

  for (const key of keys) {
    const reduced = recipes.resolveBombRecipe(key, 'reduced')
    assert.ok(reduced)
    assert.equal(reduced.ringCount, 1)
    assert.equal(reduced.sparkCount <= 4, true)
    assert.equal(reduced.flameCount, 0)
    assert.equal(reduced.smokeCount, 0)
    assert.equal(reduced.flashAlpha, 0)
    assert.equal(reduced.durationMs <= 360, true)
    assert.equal(reduced.scale <= 0.9, true)
    assert.equal(recipes.resolveBombRecipe(key, 'off'), null, 'off mode must allocate no bomb recipe')
  }
}

function verifySixBombRecipe (recipes) {
  const full = recipes.resolveSixBombRecipe('full')
  assert.ok(full)
  assert.equal(Object.isFrozen(full), true)
  assert.equal(full.key, 'six-bomb')
  assert.equal(full.crackCount >= 8, true)
  assert.equal(full.shockwaveCount >= 2, true)
  assert.equal(full.sparkCount >= 12, true)
  assert.equal(full.flameCount > 0, true)
  assert.equal(full.smokeCount > 0, true)
  assert.equal(full.dimAlpha > 0, true)

  const reduced = recipes.resolveSixBombRecipe('reduced')
  assert.ok(reduced)
  assert.equal(Object.isFrozen(reduced), true)
  assert.equal(reduced.key, 'six-bomb', 'quality reduction must preserve semantic identity')
  assert.equal(reduced.crackCount <= 4, true)
  assert.equal(reduced.shockwaveCount, 1)
  assert.equal(reduced.sparkCount <= 4, true)
  assert.equal(reduced.flameCount, 0)
  assert.equal(reduced.smokeCount, 0)
  assert.equal(reduced.dimAlpha, 0)
  assert.equal(reduced.durationMs <= 420, true)
  assert.equal(recipes.resolveSixBombRecipe('off'), null)
  assert.equal(recipes.isSixBombEffectKey('six-bomb'), true)
  assert.equal(recipes.isSixBombEffectKey('bomb-medium'), false)
}

function verifyAssetCatalog (catalogModule) {
  const { DEFAULT_EFFECT_ASSET_MANIFEST, EffectAssetCatalog } = catalogModule
  assert.equal(Object.isFrozen(DEFAULT_EFFECT_ASSET_MANIFEST), true)
  assert.equal(new Set(DEFAULT_EFFECT_ASSET_MANIFEST.map(entry => entry.id)).size, DEFAULT_EFFECT_ASSET_MANIFEST.length)
  assert.equal(DEFAULT_EFFECT_ASSET_MANIFEST.every(entry => /^[a-f0-9]{64}$/.test(entry.sha256)), true)

  const catalog = new EffectAssetCatalog()
  assert.equal(catalog.size, DEFAULT_EFFECT_ASSET_MANIFEST.length)
  const bundled = catalog.get('common.impact-ring')
  assert.ok(bundled)
  assert.equal(Object.isFrozen(bundled), true)
  assert.equal(bundled.decision, 'allow')
  assert.equal(bundled.availability, 'bundled')
  assert.equal(catalog.resolve('common.impact-ring', 'full'), bundled)
  assert.equal(catalog.resolve('common.impact-ring', 'reduced'), bundled)
  assert.equal(catalog.resolve('common.impact-ring', 'off'), null)
  assert.equal(catalog.resolveRuntimePath('common.impact-ring', 'full'), 'effects/kenney/impact-ring/texture')
  assert.equal(catalog.verifyHash('common.impact-ring', ` ${bundled.sha256.toUpperCase()} `), true)
  assert.equal(catalog.verifyHash('common.impact-ring', '0'.repeat(64)), false)

  const bombBody = catalog.get('bomb.body')
  assert.ok(bombBody)
  assert.equal(bombBody.availability, 'bundled')
  assert.equal(bombBody.license.spdxId, 'CC0-1.0')
  assert.equal(catalog.resolveRuntimePath('bomb.body', 'full'), 'effects/bomb-v1/bomb-body/texture')
  assert.equal(catalog.verifyHash('bomb.body', '7ad5d3ecc4715e5bc9809b161b7707809631dc6769c56e5c77f20e951b29ebef'), true)
  assert.equal(DEFAULT_EFFECT_ASSET_MANIFEST.filter(entry => entry.id.startsWith('bomb.')).length, 6)
  DEFAULT_EFFECT_ASSET_MANIFEST.filter(entry => entry.availability === 'bundled').forEach(entry => {
    const assetPath = path.join(projectRoot, entry.source.path)
    assert.equal(fs.existsSync(assetPath), true, `Missing reviewed runtime asset: ${entry.id}`)
    const actualSha256 = crypto.createHash('sha256').update(fs.readFileSync(assetPath)).digest('hex')
    assert.equal(catalog.verifyHash(entry.id, actualSha256), true, `Reviewed runtime asset hash drifted: ${entry.id}`)
  })
  const removedPlaceholderAssets = [
    ['common.spark', 'spark.png'],
    ['common.flare', 'flare_01.png'],
    ['common.five-card-seal', 'magic_01.png'],
    ['common.eight-card-seal', 'magic_02.png'],
    ['common.royal-ring', 'magic_03.png'],
    ['common.star-flare', 'star_06.png'],
    ['common.heart-badge', 'symbol_01.png'],
    ['common.star-badge', 'symbol_02.png'],
    ['common.vertical-beam', 'trace_01.png'],
    ['common.vortex', 'twirl_02.png'],
    ['common.light-sweep', 'light-sweep.png'],
  ]
  for (const [id, file] of removedPlaceholderAssets) {
    assert.equal(catalog.get(id), null, `${id} must not remain in the runtime asset catalog`)
    assert.equal(fs.existsSync(path.join(projectRoot, 'assets/game-assets/effects/kenney', file)), false, `${file} must be physically removed from the game-assets bundle`)
  }

  const candidate = catalog.get('legacy.deal.clip')
  assert.ok(candidate)
  assert.equal(candidate.decision, 'allow', 'licensed behavior candidates may remain explicitly auditable')
  assert.equal(candidate.availability, 'migration-candidate')
  assert.equal(catalog.resolve('legacy.deal.clip', 'full'), candidate)
  assert.equal(catalog.resolveRuntimePath('legacy.deal.clip', 'full'), null, 'unreviewed candidates must never become runtime paths')

  const denied = catalog.listDenied()
  assert.equal(denied.length, 39, 'runtime audit inventory must mirror every denied legacy bitmap')
  const deniedPatternArt = denied.filter(entry => /^assets\/GuanDan\/Room\/Effect\/(Blast|Flush|Plane)\//.test(entry.source.path))
  assert.equal(deniedPatternArt.length, 15, 'all Blast, Flush and Plane source bitmaps must remain denied')
  assert.equal(denied.every(entry => entry.availability === 'rejected'), true)
  assert.equal(denied.every(entry => entry.allowedQualities.length === 0), true)
  assert.equal(denied.every(entry => catalog.resolve(entry.id, 'full') === null), true)
  assert.equal(denied.every(entry => catalog.resolveRuntimePath(entry.id, 'full') === null), true)

  const custom = {
    ...bundled,
    id: 'test.custom-ring',
    source: { ...bundled.source, path: 'test/custom-ring.png' },
  }
  catalog.register(custom)
  assert.equal(catalog.get(custom.id), custom)
  assert.throws(() => catalog.register(custom), /already registered/)
  assert.throws(() => catalog.register({ ...custom, id: 'test.bad-hash', sha256: 'bad' }), /Invalid SHA-256/)
  assert.throws(() => catalog.register({ ...custom, id: 'test.denied-quality', decision: 'deny' }), /Denied effect asset/)
  assert.throws(() => catalog.register({ ...custom, id: 'test.bundled-without-path', resourcePath: undefined }), /requires resourcePath/)
  catalog.clear()
  assert.equal(catalog.size, 0)
}

function verifyRecoveryPolicy (networkPolicy) {
  assert.equal(networkPolicy.decideActionEffectSync(null, 5), 'baseline', 'initial state must not replay historical effects')
  assert.equal(networkPolicy.decideActionEffectSync(5, 6), 'play-next')
  assert.equal(networkPolicy.decideActionEffectSync(6, 6), 'duplicate')
  assert.equal(networkPolicy.decideActionEffectSync(6, 8), 'recovery', 'a sequence gap must land silently')

  const baseline = networkPolicy.decideNetworkEffectSync(null, { roomId: 'room-1', version: 10, actionCount: 5 })
  assert.deepEqual(baseline.sync, { mode: 'recovery', reason: 'initial-snapshot' })
  const reconnected = networkPolicy.decideNetworkEffectSync(baseline.cursor, { roomId: 'room-1', version: 10, actionCount: 5, forceRecovery: 'reconnect' })
  assert.deepEqual(reconnected.sync, { mode: 'recovery', reason: 'reconnect' })
  const next = networkPolicy.decideNetworkEffectSync(reconnected.cursor, { roomId: 'room-1', version: 11, actionCount: 6 })
  assert.deepEqual(next.sync, { mode: 'incremental' }, 'the first action after recovery must play normally once')
}

function verifyLegacyManifest () {
  const manifest = JSON.parse(read(legacyManifestPath))
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.source.repository, 'https://github.com/niuma-wj/client-cocos.git')
  assert.equal(manifest.source.commit, 'f9d037feaef5a80867fd97c8dd39b9a7486fbeca')
  assert.equal(manifest.license.spdx, 'MIT')
  assert.equal(manifest.license.copiedPath, 'third_party/legacy-effects/LICENSE')
  assert.equal(manifest.runtimePolicy.allowedRequiresExplicitEntry, true)
  assert.equal(manifest.runtimePolicy.rejectedHashScan, true)
  assert.equal(manifest.runtimePolicy.copyUpstreamMeta, false)
  assert.equal(Array.isArray(manifest.entries), true)
  assert.equal(manifest.entries.length > 0, true)
  assert.equal(new Set(manifest.entries.map(entry => entry.id)).size, manifest.entries.length)
  for (const entry of manifest.entries) {
    assert.equal(entry.runtimeIncluded, false)
    assert.match(entry.sha256, /^[a-f0-9]{64}$/)
    assert.equal(entry.license, 'MIT')
    assert.equal(typeof entry.reason === 'string' && entry.reason.length > 0, true)
    assert.equal(entry.targetSha256, null, 'reference-only entries must not claim a runtime copy')
  }
  const allowed = manifest.entries.filter(entry => entry.status === 'allowed')
  assert.equal(allowed.length, 5, 'only independent timing/animation inputs may be approved for adaptation')
  assert.equal(allowed.every(entry => /^(adapt|extract)-/.test(entry.migrationMode)), true)
  assert.equal(allowed.every(entry => typeof entry.targetPath === 'string' && entry.targetPath.startsWith('assets/game-assets/effects/legacy/')), true)
  const rejected = manifest.entries.filter(entry => entry.status === 'rejected')
  assert.equal(rejected.every(entry => entry.targetPath === null), true)
  assert.equal(rejected.every(entry => entry.migrationMode === 'do-not-import'), true)
  const rejectedPatternArt = manifest.entries.filter(entry => /^assets\/GuanDan\/Room\/Effect\/(Blast|Flush|Plane)\//.test(entry.sourcePath))
  assert.equal(rejectedPatternArt.length, 15)
  assert.equal(rejectedPatternArt.every(entry => entry.status === 'rejected' && entry.runtimeIncluded === false), true)
  assert.equal(fs.existsSync(legacyVerifierPath), true, 'the compliance manifest needs a reproducible verifier')
}

async function main () {
  const sourcePaths = [effectHandlePath, effectRendererPath, effectRenderContextPath, rendererRegistryPath, assetCatalogPath, effectRecipesPath, bombRendererPath, sixBombRendererPath, flowEffectTypesPath, effectPlaybackPath, actionPresentationPath, cardBlastReactionPath, archivedPlayVisualsPath, playAreaControllerPath, handControllerPath, gameScenePath]
  for (const sourcePath of sourcePaths) {
    assert.equal(fs.existsSync(sourcePath), true, `missing migration source: ${sourcePath}`)
    assert.equal(fs.existsSync(`${sourcePath}.meta`), true, `missing Cocos metadata: ${sourcePath}.meta`)
  }
  retiredRendererPaths.forEach(sourcePath => {
    assert.equal(fs.existsSync(sourcePath), false, `non-commercial renderer must be physically uninstalled: ${sourcePath}`)
    assert.equal(fs.existsSync(`${sourcePath}.meta`), false, `uninstalled renderer metadata must not remain: ${sourcePath}.meta`)
  })
  assert.equal(fs.existsSync(legacyManifestPath), true, 'missing rejected legacy-asset manifest')

  const handleSource = read(effectHandlePath)
  const registrySource = read(rendererRegistryPath)
  const catalogSource = read(assetCatalogPath)
  const recipesSource = read(effectRecipesPath)
  const bombSource = read(bombRendererPath)
  const sixBombSource = read(sixBombRendererPath)
  const flowEffectTypesSource = read(flowEffectTypesPath)
  const controllerSource = read(effectControllerPath)
  const effectPlaybackSource = read(effectPlaybackPath)
  const actionPresentationSource = read(actionPresentationPath)
  const effectRenderContextSource = read(effectRenderContextPath)
  const cardBlastReactionSource = read(cardBlastReactionPath)
  const cardFlightSource = read(cardFlightPath)
  const playAreaControllerSource = read(playAreaControllerPath)
  const handControllerSource = read(handControllerPath)
  const gameSceneSource = read(gameScenePath)
  const effectNodePoolSource = read(effectNodePoolPath)
  const vfxCardSnapshotSource = read(vfxCardSnapshotPath)
  const classicCardFrameStoreSource = read(classicCardFrameStorePath)
  const archivedPlayVisualsSource = read(archivedPlayVisualsPath)
  const iteratorSensitiveSources = [effectHandlePath, rendererRegistryPath, assetCatalogPath, cardFlightPath, transientPoolPath, effectControllerPath].map(read)
  assert.doesNotMatch(handleSource, /from ['"]cc['"]/, 'effect lifetime ownership must stay pure and testable')
  assert.doesNotMatch(registrySource, /from ['"]cc['"]/, 'renderer dispatch must stay independent of Cocos nodes')
  assert.doesNotMatch(catalogSource, /from ['"]cc['"]/, 'asset policy must stay independent of Cocos loading')
  assert.match(recipesSource, /'bomb-small'/)
  assert.match(recipesSource, /'bomb-medium'/)
  assert.match(recipesSource, /'bomb-large'/)
  assert.match(recipesSource, /'six-bomb'/)
  assert.match(bombSource, /isBombEffectKey\(context\.profile\.key\)/)
  assert.match(bombSource, /resolveBombRecipe\(context\.profile\.key, context\.quality\)/)
  assert.match(bombSource, /resolveEffectStyle\(context\.profile\.key, context\.profile\.level, context\.quality\)/, 'bombs must use the shared island-night art direction')
  assert.match(bombSource, /context\.sourceWorldPositions\?\.\[0\]/, 'bomb projectile must begin at the acting seat')
  assert.match(bombSource, /context\.targetWorldPosition/, 'bomb projectile must land at the real play target')
  assert.match(bombSource, /quadraticPoint\(/, 'bomb projectile must follow a true quadratic Bezier')
  assert.match(bombSource, /\.update\(seconds,/, 'bomb flight must sample its Bezier continuously')
  assert.match(bombSource, /context\.nodePool\.acquire\(/, 'bomb trails and particles must use the bounded transient pool')
  assert.match(bombSource, /context\.services\?\.playSound\?\.\(context\.profile\.sound\)/, 'bomb sound must fire at renderer-owned impact')
  assert.match(bombSource, /'bomb\.body'[\s\S]*'bomb\.trail'[\s\S]*'bomb\.hot-core'[\s\S]*'bomb\.spark-streak'[\s\S]*'bomb\.debris'/, 'the commercial bomb stack must declare its audited texture set')
  assert.doesNotMatch(bombSource, /\bGraphics\b|\.circle\(|\.ellipse\(|\.rect\(|\.roundRect\(|\.moveTo\(|\.lineTo\(|\.bezierCurveTo\(/, 'normal bombs must never fall back to code-drawn geometry')
  assert.doesNotMatch(bombSource, /createOutlinedEffectLabel|\bLabel\b/, 'normal bomb visuals must remain Sprite-only when no audited bitmap title exists')
  assert.doesNotMatch(bombSource, /common\.(?:flame|smoke|impact-ring|spark)/, 'every normal-bomb visual layer must come from the bomb-v1 bitmap pack')
  assert.match(bombSource, /await Promise\.all\(BOMB_ASSET_IDS\.map/, 'bomb assets must settle before the renderer decides which layers to start')
  assert.match(bombSource, /sprite\.spriteFrame = frame[\s\S]*sprite\.enabled = true[\s\S]*node\.active = true/, 'a pooled bomb node must receive its SpriteFrame before becoming visible')
  assert.match(bombSource, /const frame = frames\.get\('bomb\.body'\)[\s\S]*if \(!frame\)[\s\S]*No invisible projectile node is acquired/, 'a missing body texture must skip the projectile instead of activating a blank node')
  assert.doesNotMatch(bombSource, /GuanDan\/Room\/Effect|核爆炸|爆炸_BG|掼蛋飞机/, 'rejected legacy bitmaps must not leak into the renderer')
  assert.match(sixBombSource, /isSixBombEffectKey\(context\.profile\.key\)/)
  assert.match(sixBombSource, /resolveSixBombRecipe\(context\.quality\)/)
  assert.match(sixBombSource, /context\.nodePool\.acquire\(PARTICLE_POOL_KEY\)/, 'six-card particles must use the bounded transient pool')
  assert.match(sixBombSource, /node\.addComponent\(Sprite\)/, 'six-card impact layers must use bitmap sprites')
  assert.doesNotMatch(sixBombSource, /createVfxCardSnapshot|preloadVfxCardFrames|addCardFan/, 'six-card impact must react the landed cards instead of drawing a duplicate card group')
  assert.match(sixBombSource, /const frames = await this\.loadFrames\(context\)/, 'six-card impact preflight must wait only for its authored semantic layers')
  assert.doesNotMatch(sixBombSource, /\bGraphics\b|\.circle\(|\.ellipse\(|\.rect\(|\.roundRect\(|\.moveTo\(|\.lineTo\(|\.bezierCurveTo\(/, 'six-card bombs must not use code-drawn geometry')
  assert.doesNotMatch(sixBombSource, /addLavaCracks|LAVA_CRACK_PATHS/, 'six-card ground cracks stay disabled until an authored texture exists')
  assert.match(sixBombSource, /context\.services\?\.shake\?\.\(context\.profile\.shake\)/, 'six-card bomb must request cancellable table shake')
  assert.match(sixBombSource, /handle\.addCleanup\(reason =>/, 'renderer cancellation must also finish its shake handle')
  assert.match(sixBombSource, /new EffectHandle/, 'six-card bomb must own its cleanup lifetime')
  assert.doesNotMatch(sixBombSource, /BlockInputEvents|Button/, 'visual overlays must not intercept card input')
  assert.doesNotMatch(sixBombSource, /GuanDan\/Room\/Effect|核爆炸|爆炸_BG|掼蛋飞机/, 'six-card bomb must remain independent of rejected legacy bitmaps')
  assert.match(flowEffectTypesSource, /@deprecated 未达到商业化标准[\s\S]*resolveFlowEffectRecipe[\s\S]*=> null/, 'flow recipes must remain explicitly retired and non-runnable')
  assert.doesNotMatch(controllerSource, /CardPatternEffectRenderer|SignaturePatternEffectRenderer|FlowEffectRenderer|CARD_PATTERN_EFFECT_KEYS|FLOW_EFFECT_KEYS/, 'production dispatch must not import an unapproved renderer')
  assert.doesNotMatch(vfxCardSnapshotSource, /\bGraphics\b|\bLabel\b|CardView/, 'VFX card snapshots must remain Sprite-only')
  assert.match(vfxCardSnapshotSource, /resolveClassicCardPlan\(cardDisplay\(card\)\)/, 'VFX snapshots must share the approved classic-card resolver')
  assert.match(vfxCardSnapshotSource, /requestClassicCardFrames\(plan\)/, 'a VFX card must wait for its complete shared texture set')
  assert.doesNotMatch(vfxCardSnapshotSource, /loadGameAssetAsync|classicFrameCache|classicFrameRequests/, 'VFX cards must not own a second texture cache')
  assert.match(classicCardFrameStoreSource, /Promise\.all\(assets\.map/, 'the shared frame store must resolve every layer before returning a card face')
  assert.doesNotMatch(effectNodePoolSource, /CardView|\bGraphics\b|\bLabel\b/, 'the projectile pool must never reintroduce code-drawn cards')
  assert.match(effectRenderContextSource, /reactTableCards\?: \(request: CardBlastReactionRequest\) => EffectHandle \| null/, 'renderer services must expose one typed table-card reaction boundary')
  assert.match(cardBlastReactionSource, /export class CardBlastReaction[\s\S]*this\.cancel\('replaced'\)/, 'a new blast reaction must replace the previous owned reaction')
  assert.match(cardBlastReactionSource, /const unique = new Map<Node, CardBlastReactionTarget>\(\)[\s\S]*!unique\.has\(target\.node\)[\s\S]*const visible = Array\.from\(unique\.values\(\)\)/, 'blast targets must be de-duplicated by their dedicated transform node')
  assert.match(cardBlastReactionSource, /const commitIdentity[\s\S]*node\.setPosition\(Vec3\.ZERO\)[\s\S]*node\.setScale\(Vec3\.ONE\)[\s\S]*node\.setRotationFromEuler\(0, 0, 0\)/, 'reaction cleanup must restore the dedicated transform to identity')
  assert.match(cardBlastReactionSource, /new EffectHandle\(\(\) => \{ touched\.forEach\(resetReactionNode\) \}\)[\s\S]*if \(completed === visible\.length\) handle\.complete\(\)/, 'blast motion must own cleanup and complete only after every visible target returns')
  assert.match(handControllerSource, /public collectCardBlastTargets \(\): CardBlastReactionTarget\[\][\s\S]*getBombReactionRoot\(\)[\s\S]*key: `hand:\$\{cardId\}`/, 'the hand collector must expose only CardView reaction wrappers with stable keys')
  assert.match(playAreaControllerSource, /public collectCardBlastTargets \(\): CardBlastReactionTarget\[\][\s\S]*getBombReactionRoot\(\)[\s\S]*key: `play:\$\{actionIndex\}:\$\{cardId\}`/, 'the table collector must expose only landed CardView reaction wrappers with stable keys')
  assert.match(gameSceneSource, /\(\) => \(this\.hand\?\.collectCardBlastTargets\(\) \?\? \[\]\)\.concat\(this\.playArea\?\.collectCardBlastTargets\(\) \?\? \[\]\)/, 'the scene must resolve hand and table blast targets at impact time')
  assert.match(controllerSource, /private readonly cardBlastReaction = new CardBlastReaction\(\)[\s\S]*reactTableCards: request => this\.withQuality\(quality, \(\) => \{[\s\S]*const targets = this\.cardBlastTargets\?\.\(\) \?\? \[\][\s\S]*return this\.cardBlastReaction\.play\(targets, adjusted\)/, 'EffectController must bridge the renderer service to current scene-owned card targets')
  assert.match(controllerSource, /private cancelAll[\s\S]*this\.cardBlastReaction\.cancel\(reason\)/, 'unified effect cleanup must also restore active card reactions')
  assert.match(bombSource, /const strength = recipe\.key === 'bomb-small' \? 'light' : recipe\.key === 'bomb-medium' \? 'medium' : 'strong'[\s\S]*context\.services\?\.reactTableCards\?\.\(\{[\s\S]*strength,/, 'normal bomb sizes must drive matching table-card reaction strengths')
  assert.match(sixBombSource, /context\.services\?\.reactTableCards\?\.\(\{[\s\S]*strength: 'medium'/, 'the six-card bomb must react the landed card field at medium strength')
  ;[
    bombSource,
    sixBombSource,
    controllerSource,
    effectPlaybackSource,
    effectNodePoolSource,
    vfxCardSnapshotSource,
    read(path.join(projectRoot, 'assets/scripts/effects/EffectPrimitives.ts')),
  ].forEach(source => {
    assert.doesNotMatch(
      source,
      /\bGraphics\b|\.circle\(|\.ellipse\(|\.rect\(|\.roundRect\(|\.moveTo\(|\.lineTo\(|\.bezierCurveTo\(/,
      'the production VFX pipeline must stay asset-driven and reject code-drawn geometry',
    )
  })
  iteratorSensitiveSources.forEach(source => {
    assert.doesNotMatch(source, /\[\.\.\.this\.[A-Za-z]+(?:\.(?:keys|values|entries)\(\))?\]/, 'Cocos legacy transpilation cannot safely spread Set/Map iterators; use Array.from')
    assert.doesNotMatch(source, /\[\.\.\.new Set\(/, 'Cocos legacy transpilation cannot safely spread newly-created Set iterators; use Array.from')
  })
  const PlayType = {
    Single: 'Single', Pair: 'Pair', Triple: 'Triple', Straight: 'Straight', TripleWithPair: 'TripleWithPair',
    Tube: 'Tube', Plate: 'Plate', StraightFlush: 'StraightFlush', Bomb: 'Bomb', Rocket: 'Rocket', Pass: 'Pass',
  }
  const archived = loadPureTs(archivedPlayVisualsPath, { '../core/generated': { PlayType } })
  const handles = loadPureTs(effectHandlePath)
  const registry = loadPureTs(rendererRegistryPath, { './EffectHandle': handles, './ArchivedPlayVisuals': archived })
  const recipes = loadPureTs(effectRecipesPath)
  const assetCatalog = loadPureTs(assetCatalogPath)
  const networkPolicy = loadPureTs(networkPolicyPath)
  await verifyHandles(handles)
  await verifyRegistry(handles, registry)
  verifyBombRecipes(recipes)
  verifySixBombRecipe(recipes)
  verifyAssetCatalog(assetCatalog)
  verifyRecoveryPolicy(networkPolicy)
  verifyLegacyManifest()

  assert.match(controllerSource, /rendererRegistry|EffectRendererRegistry/, 'EffectController must delegate migrated effects to the registry')
  assert.deepEqual(archived.COMMERCIAL_BOMB_EFFECT_KEYS, ['bomb-small', 'bomb-medium', 'bomb-large', 'six-bomb'])
  assert.equal(Object.isFrozen(archived.COMMERCIAL_BOMB_EFFECT_KEYS), true)
  assert.equal(new Set(archived.COMMERCIAL_BOMB_EFFECT_KEYS).size, 4)
  assert.equal(archived.REJECTED_NON_COMMERCIAL_VFX.every(entry => entry.commercialStatus === 'rejected' && entry.runtimeAllowed === false), true)
  assert.equal(archived.REJECTED_NON_COMMERCIAL_VFX.every(entry => entry.reason.includes('未达到商业化标准') && entry.reason.includes('禁止运行时注册')), true)
  for (const key of ['pair', 'triple', 'triplewithpair', 'straight', 'tube', 'plate', 'straight-flush', 'king-bomb', 'wildcard', 'flow:victory']) {
    assert.equal(archived.isCommercialBombEffectKey(key), false, `${key} must remain outside the commercial allowlist`)
    assert.equal(archived.isRejectedNonCommercialEffectKey(key), true, `${key} needs a permanent rejection annotation`)
  }
  assert.equal(archived.REJECTED_NON_COMMERCIAL_VFX.some(entry => entry.playTypes.includes(PlayType.Bomb)), false, 'replacement Bomb visuals must remain live')
  assert.match(archivedPlayVisualsSource, /previousRenderer[\s\S]*commercialStatus: 'rejected'[\s\S]*runtimeAllowed: false/, 'the rejection inventory must remain machine-readable')
  assert.match(controllerSource, /register\(['"]six-bomb['"], sixBomb\)/, 'the dedicated renderer must own only its semantic key')
  assert.equal((controllerSource.match(/this\.renderers\.register\(/g) || []).length, 2, 'production must register only normal Bomb and six-Bomb renderers')
  assert.match(controllerSource, /new EffectRendererRegistry\(COMMERCIAL_BOMB_EFFECT_KEYS\)/, 'the production registry must enforce the commercial allowlist')
  assert.match(registrySource, /isRejectedNonCommercialEffectKey\(key\)/, 'every registry instance must reject the permanent non-commercial inventory')
  assert.match(controllerSource, /if \(!isCommercialBombEffectKey\(profile\.key\)\) return EffectHandle\.completed\('unavailable'\)/, 'non-Bomb impact dispatch needs a second runtime guard')
  assert.doesNotMatch(controllerSource, /isArchivedPlayVisual|MajorEffectTitle|addTextureBurst|common\.light-sweep|createOutlinedEffectLabel|straight-flush|king-bomb/, 'live dispatch must not retain retired visual branches')
  assert.match(effectPlaybackSource, /rendererOwnsBombFlight = isBombEffectKey\(profile\.key\)/, 'normal bombs must delegate flight timing to their renderer')
  assert.match(effectPlaybackSource, /!rendererOwnsBombFlight && profile\.sound/, 'non-bomb sound must wait for card impact')
  assert.match(effectPlaybackSource, /flightHandle = flight\.play\([\s\S]*?renderImpact,[\s\S]*?playEvent\.onCardArrive\?\.\(card, cardIndex\)/, 'non-bomb cards must bind impact and per-card reveal to the owned flight handle')
  assert.match(effectPlaybackSource, /cardFramesReady = await this\.dependencies\.withQuality\(effectQuality, \(\) => this\.dependencies\.preparePlayImpact\(profile, playEvent, wildcardUsed\)\)[\s\S]*flightHandle = flight\.play/, 'cold impact assets must settle before the visible projectile begins')
  assert.match(controllerSource, /this\.renderers\.prepare\(context\)/, 'impact preflight must delegate through the renderer contract')
  assert.match(effectPlaybackSource, /impactHandle = this\.dependencies\.renderPlayImpact\(profile, playEvent, wildcardUsed\)/, 'all non-bomb semantic layers must share one owned post-flight impact handle')
  assert.match(cardFlightSource, /quadraticPoint\(/)
  assert.match(cardFlightSource, /\.update\(seconds,/, 'ordinary card flight must share the continuous Bezier motion grammar')
  assert.match(cardFlightSource, /preloadVfxCardFrames\(cards\)[\s\S]*this\.pool\.acquireCard\(card\)/, 'a cold cache must finish all card art before the projectile is acquired')
  assert.match(cardFlightSource, /export const resolvePlayedCardSpacing = \(cardCount: number\): number =>[\s\S]*Math\.min\(42, 210 \/ Math\.max\(1, cardCount - 1\)\)/, 'flight and landed fans must share one reviewed spacing formula')
  assert.match(cardFlightSource, /const spread = resolvePlayedCardSpacing\(cards\.length\)/, 'the projectile endpoints must use the shared played-card spacing')
  assert.match(playAreaControllerSource, /import \{ resolvePlayedCardSpacing \} from '\.\.\/effects\/CardFlightController'[\s\S]*const spacing = resolvePlayedCardSpacing\(action\.cards\.length\)/, 'landed table cards must preserve the projectile fan positions without a handoff jump')
  assert.match(cardFlightSource, /cards\.forEach\(\(card, index\) => \{[\s\S]*?\.call\(\(\) => \{[\s\S]*?this\.pool\.releaseCard\(node\)\s*try \{ onCardArrive\?\.\(card, index\)/, 'every flight card must reveal its table counterpart only after that projectile is released')
  assert.match(cardFlightSource, /if \(completed === cards\.length\) \{[\s\S]*?try \{ onArrive\?\.\(\) \}[\s\S]*?finally \{ handle\.complete\(\) \}/, 'impact callbacks must complete the flight handle through finally even when presentation code throws')
  assert.equal((cardFlightSource.match(/onCardArrive\?\.\(card, index\)/g) || []).length, 1, 'the per-card arrival callback must have one deterministic call site inside the card loop')
  assert.doesNotMatch(cardFlightSource, /if \(!ready\) \{[\s\S]{0,100}onArrive/, 'a missing projectile must cancel instead of fabricating an arrival')
  assert.doesNotMatch(cardFlightSource, /\.catch\(\(\) => \{[\s\S]{0,100}onArrive/, 'a failed projectile must not trigger an impact')
  assert.match(actionPresentationSource, /export type PlayEffectPresentation = Readonly<\{[\s\S]*deferAction: \(action: PlayAction, actionIndex: number\) => string[\s\S]*beginAction: \(action: PlayAction, actionIndex: number, ticket: string\) => void[\s\S]*revealCard: \(action: PlayAction, actionIndex: number, cardId: string, ticket: string\) => void[\s\S]*revealAction: \(action: PlayAction, actionIndex: number, ticket: string\) => void[\s\S]*resetPresentation: \(actionCount: number\) => void/, 'presentation ownership must use opaque tickets from defer through begin, card arrival and finish')
  assert.match(playAreaControllerSource, /public deferAction \(action: PlayAction, actionIndex: number\): string[\s\S]*return ticket/, 'the table presentation must issue an opaque ticket for every deferred action')
  assert.match(playAreaControllerSource, /public beginAction \(action: PlayAction, actionIndex: number, ticket: string\): void[\s\S]*this\.presentedActionCount = Math\.max\(this\.presentedActionCount, actionIndex \+ 1\)[\s\S]*this\.renderPresentedActions\(\)/, 'the authoritative visible prefix must advance only when its flight actually begins')
  assert.match(playAreaControllerSource, /public revealCard \(action: PlayAction, actionIndex: number, cardId: string, ticket: string\): void[\s\S]*pending\.ticket !== ticket[\s\S]*node\.active = true/, 'each landed projectile must reveal only the card guarded by its current ticket')
  assert.match(playAreaControllerSource, /public revealAction \(action: PlayAction, actionIndex: number, ticket: string\): void[\s\S]*pending\.ticket !== ticket[\s\S]*this\.pendingCards\.delete\(actionIndex\)/, 'the final reveal must reject stale tickets before committing the action')
  assert.match(playAreaControllerSource, /public resetPresentation \(actionCount: number\): void[\s\S]*this\.presentationEpoch \+= 1[\s\S]*this\.pendingCards\.clear\(\)/, 'recovery must invalidate every outstanding presentation ticket')
  assert.match(playAreaControllerSource, /this\.authoritativeActions\.slice\(0, Math\.min\(this\.presentedActionCount, this\.authoritativeActions\.length\)\)/, 'table rendering must consume only the committed authoritative prefix')
  assert.match(playAreaControllerSource, /node\.active = pending\?\.key !== key \|\| !pending\.cardIds\.has\(card\.id\)/, 'pending authoritative cards must remain inactive until their matching projectile lands')
  assert.match(actionPresentationSource, /const ticket = activePresentation\?\.deferAction\(action, actionIndex\) \?\? null[\s\S]*onFlightStart: \(\) => \{ if \(ticket\) activePresentation\?\.beginAction\(action, actionIndex, ticket\) \}[\s\S]*onCardArrive: cardId => \{ if \(ticket\) activePresentation\?\.revealCard\(action, actionIndex, cardId, ticket\) \}[\s\S]*onFlightFinish: \(\) => \{ if \(ticket\) activePresentation\?\.revealAction\(action, actionIndex, ticket\) \}/, 'effect dispatch must carry one ticket through flight start, every card arrival and final recovery reveal')
  assert.doesNotMatch(controllerSource, /\bLandingPulse\b|\bshowLandingPulse\b/, 'the generic landing pulse must stay removed from the production pipeline')
  assert.match(effectPlaybackSource, /const flightReason = await flightHandle\.finished[\s\S]*if \(flightReason !== 'completed'\) \{ handle\.cancel\(flightReason\); return \}[\s\S]*const impactReason = impactHandle\?\.isActive \? await impactHandle\.finished[\s\S]*if \(impactReason && impactReason !== 'completed'\) handle\.cancel\(impactReason\)[\s\S]*else handle\.complete\(\)/, 'the outer play handle and visible queue must own the complete flight and impact lifetimes')
  assert.match(controllerSource, /private renderFlow[\s\S]*kind === 'victory'[\s\S]*kind === 'defeat'[\s\S]*EffectHandle\.completed\('unavailable'\)/, 'retired flow visuals must stay unavailable while semantic settlement audio survives')
  assert.match(effectPlaybackSource, /private enqueueVisibleEffect \(startEffect: \(\) => EffectHandle\)[\s\S]*const reason = child\.isActive \? await child\.finished[\s\S]*if \(reason === 'completed'\) handle\.complete\(\)/, 'authored card presentation barriers must retain the shared visible lane')
  assert.doesNotMatch(controllerSource, /allowArchivedVisuals|showSweep\(|PatternSweep/, 'EffectLab and live play must not retain a hidden path back to retired sweeps')
  assert.match(controllerSource, /(cancelAll|skipAll|clear)\(['"]recovery['"]\)/, 'recovery must use the unified renderer cleanup path')
  assert.match(controllerSource, /(cancelAll|skipAll|clear)\(['"]destroyed['"]\)/, 'scene destruction must use the unified renderer cleanup path')
  assert.match(controllerSource, /private cancelAll\s*\(/, 'the unified cleanup call sites must have one concrete implementation')
  assert.match(controllerSource, /private clearTransientNodes\s*\(/, 'transient labels and roots need one bounded cleanup implementation')
  assert.match(controllerSource, /private playShake\s*\(/, 'registered renderers need a cancellable shake service')
  assert.match(controllerSource, /private skipMajor\s*\([^)]*reason/, 'major cleanup must preserve recovery/destroy reasons')

  process.stdout.write('effect renderer migration regression checks passed\n')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
