// Audit-only controller/renderer integration. No network, asset downloads or GPU.
'use strict'
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const app = path.resolve(__dirname, '../../../../work/guandan-cocos')
const { loadTs } = require(path.join(app, 'tests/support/load-typescript-module.cjs'))
const src = p => path.join(app, 'assets/scripts', p)
const probe23 = fs.readFileSync(path.join(__dirname, 'effect-orchestration-23.cjs'), 'utf8')
const boundary = 'function playbackFixture () {'
assert.equal(probe23.split(boundary).length, 2)
const ports = new Function('require', '__dirname', probe23.slice(0, probe23.indexOf(boundary)) + '\nreturn {cc,manager,loadedEngine,warns,micro,deferred,action,event,handles,recipes,network,policy,archived,registryModule,profiles,resolver,EffectActionPresentationCoordinator,EffectPlaybackCoordinator,playedLayout}')(
  require, __dirname,
)
const { cc, manager, loadedEngine, warns, micro, deferred, action, handles, recipes, network, policy, archived, registryModule, profiles, resolver, EffectActionPresentationCoordinator, EffectPlaybackCoordinator, playedLayout } = ports
const { Node, Component, Vec3, UITransform, UIOpacity, Sprite, Tween } = cc
Node.prototype.setSiblingIndex = function (index) {
  if (!this.parent) return
  const siblings = this.parent.children.filter(n => n !== this); siblings.splice(index, 0, this); this.parent.children = siblings
}
Node.prototype.setRotationFromEuler = function (x, y, z) { this.eulerAngles = new Vec3(x, y, z); this.angle = z }
Node.prototype.angle = 0
Object.defineProperty(Node.prototype, 'eulerAngles', { get () { return this._euler ?? Vec3.ZERO }, set (v) { this._euler = v.clone() } })
UITransform.prototype.setAnchorPoint = function (x, y) { this.anchorPoint = { x, y } }
Vec3.add = (out, a, b) => { Object.assign(out, { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }); return out }
Vec3.subtract = (out, a, b) => { Object.assign(out, { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }); return out }
const design = loadTs(src('effects/EffectDesignSystem.ts'), { cc })
const primitives = loadTs(src('effects/EffectPrimitives.ts'), { cc, './EffectDesignSystem': design })
const catalog = loadTs(src('effects/EffectAssetCatalog.ts'))
const coordinates = loadTs(src('effects/LegacyCoordinateAdapter.ts'), { cc })
const reactions = loadTs(src('effects/CardBlastReaction.ts'), { cc, './EffectHandle': handles })
const transient = loadTs(src('effects/TransientEffectNodePool.ts'), { cc })
const rendererPorts = { cc, './EffectDesignSystem': design, './EffectHandle': handles, './EffectPrimitives': primitives, './EffectRecipes': recipes }
const bomb = loadTs(src('effects/BombEffectRenderer.ts'), rendererPorts)
const six = loadTs(src('effects/SixBombRenderer.ts'), rendererPorts)
const allNodes = root => [root, ...root.children.flatMap(allNodes)]

// Card art is a synthetic port here; actual ghost binding was exercised in batch 22.
class GhostPool {
  constructor () { this.live = new Set() }
  acquireCard (card) { const n = new Node(card.id); n.addComponent(UIOpacity); this.live.add(n); return n }
  releaseCard (n) { assert.ok(this.live.delete(n)); Tween.stopAllByTarget(n); n.destroy() }
  clear () { for (const n of Array.from(this.live)) this.releaseCard(n) }
}
const flight = loadTs(src('effects/CardFlightController.ts'), { cc, './EffectHandle': handles, './EffectNodePool': { EffectNodePool: GhostPool }, './VfxCardSnapshot': { preloadVfxCardFrames: async () => true }, '../ui/PlayedCardLayout': playedLayout() })

function fixture (options = {}) {
  manager.removeAllActions(); warns.length = 0
  const log = [], requests = [], waiting = [], busy = [], errors = []
  let time = 0, cold = options.cold ?? false, peakPooled = 0, peakNodes = 0
  const root = new Node('owner'), table = new Node('table'), flights = new Node('flights'), top = new Node('top')
  for (const n of [table, flights, top]) { n.parent = root; n.addComponent(UITransform).setContentSize(options.width ?? 1565, 720) }
  const assetIds = new Map(catalog.DEFAULT_EFFECT_ASSET_MANIFEST.filter(a => a.resourcePath).map(a => [a.resourcePath, a.id]))
  const cardWrappers = Array.from({ length: 4 }, (_, i) => {
    const layout = new Node(`layout-${i}`); layout.parent = root; layout.setPosition(new Vec3(i * 90 - 135, -160))
    const node = new Node(`reaction-${i}`); node.parent = layout; return { key: `synthetic:${i}`, node }
  })
  const loader = (p, _type, callback) => {
    assert.ok(assetIds.has(p), 'only audited effect assets may reach loader')
    const id = assetIds.get(p); requests.push(id)
    const complete = () => {
      if (options.rejectAll) callback(Error('synthetic load failure'), null)
      else if (options.missing?.includes(id)) callback(null, null)
      else callback(null, { syntheticTexture: id })
    }
    if (cold) waiting.push(complete); else complete()
    return () => {}
  }
  const { EffectController } = loadTs(src('effects/EffectController.ts'), {
    cc, '../services/GameAssetLoader': { loadGameAsset: loader }, './BombEffectRenderer': bomb,
    './ArchivedPlayVisuals': archived, './CardBlastReaction': reactions, './CardFlightController': flight,
    './EffectAssetCatalog': catalog, './EffectActionPresentationCoordinator': { EffectActionPresentationCoordinator },
    './EffectDesignSystem': design, './EffectHandle': handles, './EffectNodePool': { EffectNodePool: GhostPool },
    './EffectPlaybackCoordinator': { EffectPlaybackCoordinator }, './EffectPolicy': policy,
    './EffectProfileResolver': profiles, './EffectRecipes': recipes, './EffectRendererRegistry': registryModule,
    './LegacyCoordinateAdapter': coordinates, './SixBombRenderer': six, './TransientEffectNodePool': transient,
    './VfxCardSnapshot': { preloadVfxCardFrames: async () => true },
  })
  const controller = root.addComponent(EffectController)
  controller.setup(table, flights, top, sound => log.push({ type: 'sound', sound, time }), a => log.push({ type: 'voice', count: a.cards.length, time }), v => busy.push(v), () => cardWrappers)
  controller.configure(options.quality ?? 'full', false)
  let serial = 0
  const presentation = {
    deferAction: () => `ticket:${++serial}`, resetPresentation: count => log.push({ type: 'reset', count, time }),
    beginAction: () => log.push({ type: 'begin', time }), revealCard: (_a, _i, id) => log.push({ type: 'card', id, time }), revealAction: () => log.push({ type: 'finish', time }),
  }
  controller.syncActions([], 'p1', () => new Vec3(-300, 200), () => new Vec3(120, 80), presentation)
  const sync = actions => controller.syncActions(actions, 'p1', () => new Vec3(-300, 200), () => new Vec3(120, 80), presentation)
  const advance = async (seconds, hz = 120) => {
    for (let i = 0; i < Math.ceil(seconds * hz); i++) {
      time += 1 / hz; manager.update(1 / hz); await micro()
      peakPooled = Math.max(peakPooled, controller.transientPool.activeCount)
      peakNodes = Math.max(peakNodes, allNodes(top).length + allNodes(flights).length - 2)
      for (const n of allNodes(top)) {
        const sprite = n.getComponent(Sprite)
        if (sprite && n.activeInHierarchy && sprite.enabled !== false) assert.ok(sprite.spriteFrame, 'never activate a bitmap layer before frame binding')
      }
    }
  }
  const release = async () => { cold = false; waiting.splice(0).forEach(f => f()); await micro() }
  const assertClean = () => {
    assert.equal(controller.transientPool.activeCount, 0); assert.equal(controller.pool.live.size, 0)
    assert.equal(controller.playback.pendingPlayHandles.size, 0); assert.equal(top.children.length, 0); assert.equal(flights.children.length, 0)
    assert.deepEqual(table.position, Vec3.ZERO)
    for (const t of cardWrappers) { assert.deepEqual(t.node.position, Vec3.ZERO); assert.deepEqual(t.node.scale, Vec3.ONE); assert.equal(t.node.angle, 0) }
  }
  const destroy = () => { controller.onDestroy(); root.destroy(); manager.removeAllActions() }
  return { controller, root, table, flights, top, log, requests, busy, errors, sync, advance, release, assertClean, destroy, metrics: () => ({ peakPooled, peakNodes, time }) }
}

async function renderMatrix () {
  const rows = []
  for (const quality of ['full', 'reduced', 'off']) for (const count of [4, 5, 6, 7, 8, 10]) {
    const f = fixture({ quality }), a = action(`matrix-${count}`, count, 'Bomb')
    f.sync([a]); await micro(); await f.advance(2)
    assert.equal(f.log.filter(v => v.type === 'voice').length, 1)
    assert.equal(f.log.filter(v => v.type === 'sound' && v.sound === 'bomb').length, 1)
    assert.equal(f.log.filter(v => v.type === 'begin').length, 1); assert.equal(f.log.filter(v => v.type === 'finish').length, 1)
    assert.equal(f.log.filter(v => v.type === 'card').length, quality === 'off' || count !== 6 ? 0 : 6)
    const impact = f.log.find(v => v.type === 'sound')
    if (quality !== 'off') assert.ok(impact.time >= (quality === 'full' ? .29 : .23), 'impact sound must not precede its flight')
    f.assertClean(); assert.deepEqual(warns, [])
    const limit = design.EFFECT_QUALITY_BUDGETS[quality].globalNodeLimit
    assert.ok(f.metrics().peakNodes <= limit)
    rows.push({ quality, count, impactAt: impact.time, busy: f.busy, ...f.metrics() }); f.destroy()
  }
  return rows
}

async function cancelMatrix () {
  let count = 0
  for (const cards of [4, 6, 8]) for (const stage of ['cold', 'flight', 'impact']) for (const reason of ['skipped', 'recovery', 'destroyed', 'quality-off']) {
    const f = fixture({ cold: stage === 'cold' }), a = action('cancel', cards, 'Bomb')
    f.sync([a]); await micro()
    if (stage === 'flight') await f.advance(.12)
    if (stage === 'impact') await f.advance(.6)
    const before = f.log.slice()
    if (reason === 'destroyed') f.controller.onDestroy()
    else if (reason === 'recovery') f.controller.resetForRecovery(1)
    else if (reason === 'quality-off') f.controller.configure('off', false)
    else f.controller.skipAll()
    const after = f.log.slice(); await f.release(); await f.advance(3)
    assert.deepEqual(f.log, after, 'late asset/tween callbacks must not emit cancelled semantics')
    if (reason === 'recovery' || reason === 'destroyed') assert.equal(after.filter(v => v.type === 'finish').length, before.filter(v => v.type === 'finish').length)
    else assert.equal(after.filter(v => v.type === 'finish').length, 1)
    f.assertClean(); assert.deepEqual(warns, [])
    if (reason !== 'destroyed') {
      f.sync([a, action('next-pass', 0, 'Pass', 'p2')]); await micro(); await f.advance(.1)
      assert.equal(f.log.filter(v => v.type === 'voice').length, before.filter(v => v.type === 'voice').length + 1)
    }
    f.destroy(); count++
  }
  return count
}

async function missingAssets () {
  const rows = []
  const sixRequired = ['bomb.hot-core', 'bomb.spark-streak', 'common.impact-ring', 'bomb.noise', 'common.flame', 'common.smoke']
  const scenarios = [
    { count: 4, quality: 'full', missing: ['bomb.body'] },
    { count: 8, quality: 'full', rejectAll: true },
    ...sixRequired.map(id => ({ count: 6, quality: 'full', missing: [id] })),
    ...sixRequired.map(id => ({ count: 6, quality: 'reduced', missing: [id] })),
  ]
  for (const options of scenarios) {
    const f = fixture(options); f.sync([action('missing', options.count, 'Bomb')]); await micro(); await f.advance(2)
    assert.equal(f.log.filter(v => v.type === 'voice').length, 1); assert.equal(f.log.filter(v => v.type === 'sound').length, 1)
    assert.equal(f.log.filter(v => v.type === 'finish').length, 1)
    f.assertClean(); assert.deepEqual(warns, []); rows.push({ ...options, ...f.metrics() }); f.destroy()
  }
  return rows
}

async function frameOwnership () {
  const f = fixture({ cold: true }), entry = f.controller.assets.get('bomb.body')
  const a = f.controller.loadSpriteFrame(entry), b = f.controller.loadSpriteFrame(entry)
  assert.equal(a, b); assert.equal(f.requests.filter(id => id === 'bomb.body').length, 1)
  await f.release(); assert.equal(await a, await b); assert.equal(await f.controller.loadSpriteFrame(entry), await a)
  assert.equal(f.requests.filter(id => id === 'bomb.body').length, 1); f.destroy()
  // Failed loads are removed from the in-flight map, so they are retryable.
  const failed = fixture({ missing: ['bomb.body'] }), e = failed.controller.assets.get('bomb.body')
  assert.equal(await failed.controller.loadSpriteFrame(e), null); assert.equal(await failed.controller.loadSpriteFrame(e), null)
  assert.equal(failed.requests.filter(id => id === 'bomb.body').length, 2); failed.destroy()
  return 2
}

async function repeatedUse () {
  const f = fixture(), actions = []; const peaks = []
  for (let i = 0; i < 40; i++) {
    actions.push(action(`reuse-${i}`, [4, 6, 8, 10][i % 4], 'Bomb', `p${i % 4 + 1}`)); f.sync(actions)
    await micro(); await f.advance(1.6); f.assertClean(); peaks.push(f.controller.transientPool.pooledCount())
  }
  assert.equal(f.log.filter(v => v.type === 'voice').length, 40); assert.equal(f.log.filter(v => v.type === 'sound').length, 40)
  assert.equal(new Set(peaks.slice(8)).size, 1, 'bounded same-profile reuse must plateau')
  assert.deepEqual(warns, []); const report = { loops: 40, pooledSteady: peaks.at(-1), ...f.metrics() }; f.destroy(); return report
}

async function reactionAndCoordinates () {
  let reactionCases = 0, coordinateCases = 0
  for (const strength of ['light', 'medium', 'strong']) for (const cancel of [false, true]) {
    manager.removeAllActions(); const parent = new Node('layout'); parent.setPosition(new Vec3(125, -50)); parent.setScale(new Vec3(.8, .8, 1))
    const n = new Node('wrapper'); n.parent = parent; const dead = new Node('dead'); dead.destroy(); const hidden = new Node('hidden'); hidden.active = false
    const r = new reactions.CardBlastReaction(), h = r.play([{ key: 'a', node: n }, { key: 'duplicate', node: n }, { key: 'dead', node: dead }, { key: 'hidden', node: hidden }], { strength, impactWorldPosition: Vec3.ZERO })
    for (let i = 0; i < 12; i++) manager.update(1 / 120)
    assert.ok(n.position.y > 0); if (cancel) r.cancel('recovery')
    for (let i = 0; i < 120; i++) manager.update(1 / 120)
    await micro(); assert.equal(h.isActive, false); assert.deepEqual(n.position, Vec3.ZERO); assert.deepEqual(n.scale, Vec3.ONE)
    assert.deepEqual(parent.position, new Vec3(125, -50)); assert.deepEqual(parent.scale, new Vec3(.8, .8, 1)); parent.destroy(); reactionCases++
  }
  for (const origin of ['center', 'top-left']) for (const fit of ['contain', 'cover', 'stretch']) for (const width of [320, 874, 1280, 1920, 2412]) for (const height of [402, 720]) {
    const adapter = new coordinates.LegacyCoordinateAdapter({ origin, fit }), destination = { width, height }
    for (let i = 0; i < 10; i++) {
      const point = { x: i * 112 - 300, y: i * 67 - 220, z: i }, actual = adapter.unmapPoint(adapter.mapPoint(point, destination), destination)
      assert.ok(Math.abs(actual.x - point.x) < 1e-9 && Math.abs(actual.y - point.y) < 1e-9); assert.equal(actual.z, point.z); coordinateCases++
    }
  }
  return { reactionCases, coordinateCases }
}

function assetInventory () {
  const c = new catalog.EffectAssetCatalog(), paths = [], before = c.size
  for (const a of c.list()) {
    if (a.availability !== 'bundled') { assert.equal(c.resolveRuntimePath(a.id, 'full'), null); continue }
    assert.ok(a.source.path.startsWith('assets/game-assets/effects/'))
    const b = fs.readFileSync(path.join(app, a.source.path)), actual = crypto.createHash('sha256').update(b).digest('hex')
    assert.equal(c.verifyHash(a.id, actual), true); paths.push({ id: a.id, bytes: b.length, sha256: actual })
  }
  const prototype = c.list()[0]
  assert.throws(() => c.register([{ ...prototype, id: 'audit.first' }, { ...prototype, id: 'audit.second', sha256: 'bad' }]), /SHA-256/)
  assert.equal(c.size, before, 'invalid batch must not partially register')
  return { manifestEntries: c.size, bundled: paths, candidates: c.list().filter(a => a.availability === 'migration-candidate').length, denied: c.listDenied().length }
}

;(async () => {
  const report = { renderMatrix: await renderMatrix(), cancellationCases: await cancelMatrix(), missingAssets: await missingAssets(), frameOwnershipCases: await frameOwnership(), repeatedUse: await repeatedUse(), ...await reactionAndCoordinates(), assets: assetInventory(), engineSources: loadedEngine }
  assert.deepEqual(warns, []); manager.removeAllActions(); console.log(JSON.stringify(report, null, 2))
})().catch(error => { console.error(error); process.exitCode = 1 })
