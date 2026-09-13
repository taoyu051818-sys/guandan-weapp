// Audit only. Current TS orchestration + installed engine tween algorithms.
// Synthetic drawing, resource, sound and network ports; no product writes.
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const app = path.resolve(__dirname, '../../../../work/guandan-cocos')
const src = name => path.join(app, 'assets/scripts', name)
const { loadTs } = require(path.join(app, 'tests/support/load-typescript-module.cjs'))

// Reuse only batch 22's engine loader/port definitions, not its tests or output.
const engineProbe = fs.readFileSync(path.join(__dirname, 'animation-lifetime-22.cjs'), 'utf8')
const boundary = 'const {RuntimeUiFactory}=loadTs('
assert.equal(engineProbe.split(boundary).length, 2)
const prefix = engineProbe.slice(0, engineProbe.indexOf(boundary))
const { cc, manager, loadedEngine, warns } = new Function('require', '__dirname', prefix + '\nreturn {cc,manager,loadedEngine,warns}')(
  require, __dirname,
)
const { Node, Vec3, UITransform, Component, Tween } = cc
Vec3.prototype.add = function (v) { this.x += v.x; this.y += v.y; this.z += v.z; return this }
Node.prototype.getChildByName = function (name) { return this.children.find(child => child.name === name) || null }
Object.defineProperty(Node.prototype, 'activeInHierarchy', { get () { return this.active && this.isValid && (!this.parent || this.parent.activeInHierarchy) } })
Object.defineProperty(Node.prototype, 'worldPosition', { get () { return this.position.clone().add(this.parent?.worldPosition ?? Vec3.ZERO) } })
Component.prototype.getComponent = function (T) { return this.node.getComponent(T) }
UITransform.prototype.convertToNodeSpaceAR = function (p) { const origin = this.node.worldPosition; return new Vec3(p.x - origin.x, p.y - origin.y, p.z - origin.z) }
UITransform.prototype.convertToWorldSpaceAR = function (p) { return p.clone().add(this.node.worldPosition) }
const micro = async () => { for (let i = 0; i < 24; i++) await Promise.resolve() }
const step = (seconds, hz = 120) => { for (let i = 0; i < Math.ceil(seconds * hz); i++) manager.update(1 / hz) }
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const PlayType = Object.fromEntries(['Single', 'Pair', 'Triple', 'TripleWithPair', 'Straight', 'Tube', 'Plate', 'StraightFlush', 'Bomb', 'Rocket', 'Pass'].map(key => [key, key]))
const core = { PlayType }
const handles = loadTs(src('effects/EffectHandle.ts'))
const { EffectHandle } = handles
const recipes = loadTs(src('effects/EffectRecipes.ts'))
const network = loadTs(src('effects/NetworkEffectSyncPolicy.ts'))
const policy = loadTs(src('effects/EffectPolicy.ts'))
const archived = loadTs(src('effects/ArchivedPlayVisuals.ts'), { '../core/generated': core })
const registryModule = loadTs(src('effects/EffectRendererRegistry.ts'), { './EffectHandle': handles, './ArchivedPlayVisuals': archived })
const profiles = loadTs(src('effects/EffectProfileResolver.ts'), { '../core/generated': core })
const resolver = new profiles.EffectProfileResolver()
const { EffectActionPresentationCoordinator } = loadTs(src('effects/EffectActionPresentationCoordinator.ts'), { './NetworkEffectSyncPolicy': network })
const { EffectPlaybackCoordinator } = loadTs(src('effects/EffectPlaybackCoordinator.ts'), { '../core/generated': core, './EffectHandle': handles, './EffectRecipes': recipes })
const card = (id, value = 4) => Object.freeze({ id, rank: value, value, suit: 'heart' })
const action = (id, count = 1, type = PlayType.Single, playerId = 'p1') => Object.freeze({ playerId, type, cards: Object.freeze(Array.from({ length: count }, (_, i) => card(`${id}:${i}`))) })
const event = (a, hooks = {}) => ({ action: a, actionIndex: 0, humanId: 'p1', sourcePositions: [new Vec3(-200, 100)], targetWorldPosition: new Vec3(120, -70), ...hooks })
const hudLayout = loadTs(src('ui/TableHudLayoutPolicy.ts'), {
  './SafeAreaLayout': loadTs(src('ui/SafeAreaLayout.ts')),
  './WechatCapsuleLayout': loadTs(src('ui/WechatCapsuleLayout.ts')),
})
const playedLayout = () => loadTs(src('ui/PlayedCardLayout.ts'), { './TableHudLayoutPolicy': hudLayout })

function playbackFixture () {
  const log = [], preps = [], flights = [], impacts = [], errors = []
  let available = true, mode = 'pending', currentQuality = 'full'
  const playback = new EffectPlaybackCoordinator({
    isAvailable: () => available,
    withQuality: (quality, work) => { const old = currentQuality; currentQuality = quality; try { return work() } finally { currentQuality = old } },
    preparePlayImpact: (_p, e) => { const d = deferred(); preps.push({ ...d, e, quality: currentQuality }); return d.promise },
    getFlight: () => mode === 'no-flight' ? null : { play: (cards, _s, _t, _d, arrive, cardArrive) => {
      const handle = new EffectHandle(); flights.push({ handle, cards, arrive, cardArrive }); return handle
    } },
    renderPlayImpact: (_p, e) => {
      if (mode === 'throw-impact') throw Error('synthetic renderer failure')
      const handle = new EffectHandle(); impacts.push({ handle, e, quality: currentQuality }); return handle
    },
    prepareContext: () => Promise.resolve(true), renderContext: () => EffectHandle.completed(),
    playSound: sound => log.push(['sound', sound]), playActionVoice: a => log.push(['voice', a.cards[0]?.id ?? 'pass']),
    vibrate: kind => log.push(['haptic', kind]), reportError: (message, error) => errors.push([message, error?.message]),
  })
  return { playback, log, preps, flights, impacts, errors, setMode: next => { mode = next }, setAvailable: v => { available = v } }
}

async function cancellationMatrix () {
  let cases = 0
  const a = action('six', 6, PlayType.Bomb), profile = resolver.resolve(a, 'full')
  for (const stage of ['queued', 'preparing', 'flight', 'impact']) for (const reason of ['skipped', 'replaced', 'recovery', 'destroyed', 'quality-off', 'unavailable', 'failed']) {
    const f = playbackFixture(), calls = [], gate = deferred()
    let authoredFinish = 0
    if (stage === 'queued') { f.playback.waitForPresentation(gate.promise, () => authoredFinish++); await micro() }
    const h = f.playback.play(event(a, { onFlightStart: () => calls.push('begin'), onFlightFinish: () => calls.push('finish') }), 'full', profile)
    await micro()
    if (stage === 'flight' || stage === 'impact') { f.preps[0].resolve(true); await micro(); assert.equal(f.flights.length, 1) }
    if (stage === 'impact') { f.flights[0].arrive(); f.flights[0].handle.complete(); await micro(); assert.equal(f.impacts.length, 1) }
    const before = calls.slice(), voicesBefore = f.log.filter(v => v[0] === 'voice').length
    f.playback.cancelAll(reason)
    assert.equal(await h.finished, reason)
    if (reason === 'recovery' || reason === 'destroyed') assert.deepEqual(calls, before, 'recovery does not reveal old presentation')
    else assert.deepEqual(calls, ['begin', 'finish'], 'non-recovery cancellation commits semantic presentation exactly once')
    const after = calls.slice()
    f.preps.forEach(p => p.resolve(true)); gate.resolve(); await micro()
    f.flights.forEach(v => { v.arrive(); v.handle.complete() })
    f.impacts.forEach(v => v.handle.complete()); await micro()
    assert.deepEqual(calls, after)
    assert.equal(f.log.filter(v => v[0] === 'voice').length, voicesBefore)
    assert.equal(f.playback.pendingPlayHandles.size + f.playback.queuedVisibleHandles.size + f.playback.pendingPreparedHandles.size, 0)
    if (stage === 'queued') assert.equal(authoredFinish, 1)
    const fresh = f.playback.play(event(action('fresh')), 'off', resolver.resolve(action('fresh'), 'off')); await micro()
    assert.equal(await fresh.finished, 'completed', 'new generation must not wait for cancelled work')
    cases++
  }
  return cases
}

async function serializationAndFailures () {
  let cases = 0
  for (const quality of ['full', 'reduced']) {
    const f = playbackFixture(), callbacks = [], list = []
    const types = [[PlayType.Single, 1], [PlayType.Pass, 0], [PlayType.Bomb, 4], [PlayType.Bomb, 6], [PlayType.Rocket, 4]]
    for (let i = 0; i < 20; i++) {
      const [type, count] = types[i % types.length], a = action(`serial-${i}`, count, type)
      list.push(f.playback.play(event(a, { onFlightStart: () => callbacks.push(`b${i}`), onFlightFinish: () => callbacks.push(`f${i}`) }), quality, resolver.resolve(a, quality)))
    }
    for (let i = 0; i < list.length; i++) {
      await micro()
      // Resolve only the current preparation; no later action may enter the lane.
      const prep = f.preps.find(p => !p.used)
      if (prep) { prep.used = true; prep.resolve(true); await micro() }
      const fl = f.flights.find(p => !p.used)
      if (fl) { fl.used = true; fl.cards.forEach((c, n) => fl.cardArrive(c, n)); fl.arrive(); fl.handle.complete(); await micro() }
      const impact = f.impacts.find(p => !p.used)
      if (impact) { impact.used = true; impact.handle.complete(); await micro() }
      assert.equal(list[i].isActive, false)
      cases++
    }
    assert.deepEqual(callbacks, Array.from({ length: 20 }, (_, i) => [`b${i}`, `f${i}`]).flat())
    assert.equal(f.log.filter(v => v[0] === 'voice').length, 20)
    assert.equal(f.errors.length, 0)
    assert.ok(f.preps.every(p => p.quality === quality) && f.impacts.every(p => p.quality === quality))
  }
  for (const failure of ['not-ready', 'no-flight', 'prepare-reject', 'throw-impact', 'flight-cancel', 'impact-fail', 'unavailable']) {
    const f = playbackFixture(), calls = [], a = action('failure', 6, PlayType.Bomb)
    f.setMode(failure)
    if (failure === 'unavailable') f.setAvailable(false)
    const h = f.playback.play(event(a, { onFlightStart: () => calls.push('begin'), onFlightFinish: () => calls.push('finish') }), 'full', resolver.resolve(a, 'full'))
    await micro()
    if (failure === 'prepare-reject') f.preps[0].reject(Error('asset failure'))
    else f.preps[0]?.resolve(failure !== 'not-ready')
    await micro()
    if (f.flights.length) {
      if (failure === 'flight-cancel') f.flights[0].handle.cancel('failed')
      else { f.flights[0].arrive(); f.flights[0].handle.complete() }
    }
    await micro()
    f.impacts.forEach(p => failure === 'impact-fail' ? p.handle.cancel('failed') : p.handle.complete()); await micro()
    assert.equal(h.isActive, false)
    assert.deepEqual(calls, ['begin', 'finish'])
    f.setAvailable(true)
    const next = f.playback.play(event(action('after')), 'off', resolver.resolve(action('after'), 'off')); await micro()
    assert.equal(await next.finished, 'completed')
    cases++
  }
  return cases
}

function projectionFixture () {
  class CardView { bind (value) { this.value = value } }
  const layout = playedLayout()
  const { PlayAreaController } = loadTs(src('ui/PlayAreaController.ts'), {
    cc, '../effects/CardFlightController': { PLAYED_CARD_FINAL_SCALE: layout.PLAYED_CARD_SCALE, resolvePlayedCardSpacing: layout.playedCardSpacing },
    './CardPresentationMapper': loadTs(src('ui/CardPresentationMapper.ts')), './CardView': { CardView },
    './RuntimeUiFactory': { applyForegroundTextStyle: () => {} }, './PlayedCardLayout': layout,
  })
  const area = new Node('area').addComponent(PlayAreaController), coordinator = new EffectActionPresentationCoordinator(), requests = []
  const presentation = Object.fromEntries(['deferAction', 'beginAction', 'revealCard', 'revealAction', 'resetPresentation'].map(key => [key, area[key].bind(area)]))
  let recoveries = 0
  const sync = actions => {
    coordinator.syncActions(actions, 'p1', p => `fallback:${p}`, () => 'target', presentation, () => recoveries++, r => requests.push(r))
    area.render(actions)
  }
  return { area, coordinator, requests, sync, presentation, recoveries: () => recoveries }
}

function actionPresentation () {
  let cases = 0
  for (let count = 1; count <= 10; count++) {
    const f = projectionFixture(), a = action(`group-${count}`, count)
    f.sync([])
    f.coordinator.captureLocalOrigins(a.cards.slice(0, Math.ceil(count / 2)).map(c => ({ cardId: c.id, worldPosition: `origin:${c.id}` })))
    f.sync([]); f.sync([a]); assert.equal(f.requests.length, 1)
    const req = f.requests[0]; req.onFlightStart()
    const group = f.area.cardNodes.get(0); assert.equal(group.nodes.size, count)
    assert.equal(Array.from(group.nodes.values()).every(n => !n.active), true)
    a.cards.forEach((c, i) => {
      assert.equal(req.sourcePositions[i], i < Math.ceil(count / 2) ? `origin:${c.id}` : 'fallback:p1')
      req.onCardArrive(c.id); assert.equal(group.nodes.get(c.id).active, true)
    })
    req.onFlightFinish(); f.sync([a]); assert.equal(f.requests.length, 1); assert.equal(f.area.pendingCards.size, 0)
    const b = action('next', 2, PlayType.Pair, 'p2'); f.sync([a, b]); const stale = f.requests.at(-1)
    f.coordinator.resetForRecovery(2); f.area.render([a, b]); const epoch = f.area.presentationEpoch
    stale.onFlightStart(); stale.onCardArrive(b.cards[0].id); stale.onFlightFinish()
    assert.equal(f.area.pendingCards.size, 0); assert.equal(f.area.presentationEpoch, epoch)
    const c = action('gap', 1, PlayType.Single, 'p3'); f.sync([a, b, c, action('gap2')]); assert.equal(f.recoveries(), 1)
    assert.equal(f.area.presentedActionCount, 4)
    f.area.clearPresentation(); f.area.node.destroy(); manager.removeAllActions(); cases++
  }
  const unbound = new EffectActionPresentationCoordinator(); unbound.resetForRecovery(5)
  const resets = []
  unbound.syncActions(Array.from({ length: 5 }, (_, i) => action(`base-${i}`)), 'p1', () => '', () => '', { resetPresentation: count => resets.push(count) }, () => assert.fail(), () => assert.fail())
  assert.deepEqual(resets, [5]); cases++
  return cases
}

async function cardFlights () {
  let cases = 0
  for (const hz of [60, 120]) for (const count of [1, 2, 5, 8, 10]) {
    manager.removeAllActions()
    const root = new Node('flight'); root.setPosition(new Vec3(30, -20)); root.addComponent(UITransform)
    const acquired = [], released = [], final = [], arrivals = []
    const pool = { acquireCard: c => { const n = new Node(c.id); acquired.push(n); return n }, releaseCard: n => {
      final.push({ id: n.name, position: n.position.clone(), scale: n.scale.clone() }); released.push(n); Tween.stopAllByTarget(n); n.active = false
    } }
    const layout = playedLayout()
    const { CardFlightController } = loadTs(src('effects/CardFlightController.ts'), { cc, './EffectHandle': handles, './EffectNodePool': {}, './VfxCardSnapshot': { preloadVfxCardFrames: async () => true }, '../ui/PlayedCardLayout': layout })
    const controller = new CardFlightController(root, pool), a = action(`flight-${count}`, count), target = new Vec3(180, 100)
    let impact = 0
    const h = controller.play(a.cards, [new Vec3(-300, -220)], target, 260, () => { impact++; throw Error('impact callback boundary') }, (c, i) => { arrivals.push([c.id, i]); assert.equal(released.at(-1).name, c.id); throw Error('card callback boundary') })
    await micro(); assert.equal(controller.activeCount, count)
    step(.221, hz)
    assert.ok(Math.abs(acquired[0].scale.x - layout.PLAYED_CARD_SCALE) < 1e-6, 'first card shrinks before arrival')
    assert.ok(acquired[0].position.y !== target.y + 20, 'shrink completes while flight is still moving')
    step(1, hz); await micro()
    assert.equal(await h.finished, 'completed'); assert.equal(impact, 1); assert.equal(controller.activeCount, 0)
    assert.deepEqual(arrivals, a.cards.map((c, i) => [c.id, i])); assert.equal(new Set(released).size, count)
    for (let i = 0; i < count; i++) {
      assert.ok(Math.abs(final[i].position.x - (target.x - 30 + (i - (count - 1) / 2) * layout.playedCardSpacing(count) * layout.PLAYED_CARD_SCALE)) < 1e-7)
      assert.ok(Math.abs(final[i].position.y - 120) < 1e-7); assert.equal(final[i].scale.x, layout.PLAYED_CARD_SCALE)
    }
    root.destroy(); cases++
  }
  for (const stage of ['cold', 'flying', 'missing', 'reject', 'pool-failure']) {
    manager.removeAllActions(); const root = new Node('cancel'), prep = deferred(), acquired = [], released = []
    const layout = playedLayout()
    const { CardFlightController } = loadTs(src('effects/CardFlightController.ts'), { cc, './EffectHandle': handles, './EffectNodePool': {}, './VfxCardSnapshot': { preloadVfxCardFrames: () => prep.promise }, '../ui/PlayedCardLayout': layout })
    const pool = { acquireCard: c => { if (stage === 'pool-failure' && acquired.length === 2) throw Error('pool failure'); const n = new Node(c.id); acquired.push(n); return n }, releaseCard: n => { released.push(n); Tween.stopAllByTarget(n); n.active = false } }
    const controller = new CardFlightController(root, pool), h = controller.play(action('cancel', 5).cards, [], Vec3.ZERO, 300, () => assert.fail('cancelled impact'), () => assert.fail('cancelled reveal'))
    if (stage === 'cold') { controller.skipAll('recovery'); prep.resolve(true) }
    else if (stage === 'reject') prep.reject(Error('load failure'))
    else prep.resolve(stage !== 'missing')
    await micro(); if (stage === 'flying') { step(.1); controller.skipAll('recovery') }
    await micro(); step(2); await micro()
    assert.equal(h.isActive, false); assert.equal(controller.activeCount, 0); assert.equal(controller.handles.size, 0)
    assert.equal(new Set(released).size, acquired.length); assert.equal(released.length, acquired.length); root.destroy(); cases++
  }
  return cases
}

async function registryAndPrepared () {
  let cases = 0
  const { EffectRendererRegistry } = registryModule
  for (const restricted of [false, true]) {
    const r = new EffectRendererRegistry(restricted ? archived.COMMERCIAL_BOMB_EFFECT_KEYS : undefined)
    let renders = 0, disposal = 0
    const renderer = { prepare: async () => true, render: () => { renders++; return new EffectHandle() }, dispose: () => disposal++ }
    r.register(archived.COMMERCIAL_BOMB_EFFECT_KEYS, renderer); r.setFallback(renderer)
    for (const quality of ['full', 'reduced', 'off']) for (const key of archived.REJECTED_NON_COMMERCIAL_VFX.flatMap(e => e.effectKeys).map(k => k === 'flow:*' ? 'flow:victory' : k)) {
      const context = { quality, profile: { key } }
      assert.equal(await r.prepare(context), false); assert.equal(r.render(context).isActive, false)
      assert.equal(r.resolve(` ${key} `), null); cases++
    }
    assert.equal(renders, 0)
    assert.throws(() => r.register(['bomb-small', 'pair'], renderer), /not commercially/)
    assert.deepEqual(r.keys(), archived.COMMERCIAL_BOMB_EFFECT_KEYS)
    const active = r.render({ quality: 'full', profile: { key: 'bomb-small' } }); r.clear('destroyed')
    assert.equal(await active.finished, 'destroyed'); assert.equal(disposal, 1)
  }
  for (const outcome of ['ready', 'not-ready', 'reject', 'cancel']) {
    const ready = deferred(), child = new EffectHandle(), reports = [], f = playbackFixture()
    f.playback.dependencies.prepareContext = () => ready.promise
    f.playback.dependencies.renderContext = () => child
    const h = f.playback.renderPreparedContext({ profile: { key: 'bomb-small' }, services: { reportError: (...v) => reports.push(v) } })
    if (outcome === 'cancel') f.playback.cancelAll('recovery')
    outcome === 'reject' ? ready.reject(Error('prepare')) : ready.resolve(outcome !== 'not-ready')
    await micro()
    if (outcome === 'ready') { child.complete(); await micro() }
    assert.equal(h.isActive, false); assert.equal(f.playback.pendingPreparedHandles.size, 0)
    assert.equal(reports.length, outcome === 'reject' ? 1 : 0); cases++
  }
  return cases
}

function networkAndProfiles () {
  let observations = 0, profileCases = 0
  for (let count = 0; count < 13; count++) for (let delta = -2; delta <= 3; delta++) for (const versionDelta of [-1, 0, 1, 2]) {
    const previous = { roomId: 'synthetic', version: 10, actionCount: count }, next = { roomId: 'synthetic', version: 10 + versionDelta, actionCount: Math.max(0, count + delta) }
    const decision = network.decideNetworkEffectSync(previous, next)
    if (versionDelta <= 0) assert.equal(decision.kind, 'drop')
    else if (decision.sync.mode === 'incremental') assert.ok(versionDelta === 1 && next.actionCount >= count && next.actionCount <= count + 1)
    for (const reason of ['initial-snapshot', 'reconnect', 'round-reset']) assert.deepEqual(network.decideNetworkEffectSync(previous, { ...next, forceRecovery: reason }).sync, { mode: 'recovery', reason })
    observations += 4
  }
  for (const type of Object.values(PlayType)) for (const quality of ['full', 'reduced', 'off']) for (const length of [4, 5, 6, 7, 8, 10]) {
    const a = action('profile', type === PlayType.Pass ? 0 : length, type), p = resolver.resolve(a, quality)
    if (quality === 'off') assert.equal(p.key, 'none')
    else if (type === PlayType.Bomb) assert.equal(p.key, length <= 5 ? 'bomb-small' : length === 6 ? 'six-bomb' : length === 7 ? 'bomb-medium' : 'bomb-large')
    else assert.equal(p.key, type === PlayType.Pass ? 'pass' : 'play-normal')
    if (quality === 'reduced') assert.ok(p.flightMs <= 240 && p.durationMs <= 420 && p.level <= 1 && p.shake === 'none')
    if (type === PlayType.StraightFlush || type === PlayType.Rocket) assert.equal(p.sound, null, 'retired overlay does not reintroduce semantic SFX')
    profileCases++
  }
  for (const maxMajorEffectCount of [undefined, 0, 1, 2, -1]) {
    const p = policy.resolveEffectPolicy({ maxMajorEffectCount }); assert.equal(p.allowInputDuringEffect, true); assert.equal(p.maxMajorEffectCount, maxMajorEffectCount === 0 ? 0 : 1); assert.equal(Object.isFrozen(p), true)
  }
  return { observations, profileCases }
}

;(async () => {
  const report = { cancellationCases: await cancellationMatrix(), serializationFailureCases: await serializationAndFailures(), presentationCases: actionPresentation(), flightCases: await cardFlights(), registryPreparedCases: await registryAndPrepared(), ...networkAndProfiles(), engineSources: loadedEngine }
  assert.deepEqual(warns, [])
  manager.removeAllActions()
  console.log(JSON.stringify(report, null, 2))
})().catch(error => { console.error(error); process.exitCode = 1 })
