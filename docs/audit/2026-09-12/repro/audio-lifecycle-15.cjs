// Audit-only: actual controller/cache and exact installed-engine methods;
// synthetic audio backends. No audible playback, network, build or product writes.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '../../../..')
const support = path.join(root, 'work/guandan-cocos/tests/support')
const { loadTypeScript } = require(path.join(support, 'typescript.cjs'))
const { loadTs } = require(path.join(support, 'load-typescript-module.cjs'))
const { makeAudioHarness, makeClock, OptionalAudioAssetCache, ActionVoiceGate } = require(path.join(support, 'audio-controller-harness.cjs'))
const ts = loadTypeScript()
const engineFile = process.env.AUDIT_COCOS_AUDIO_SOURCE || '/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/resources/3d/engine/cocos/audio/audio-source.ts'
const engineText = fs.readFileSync(engineFile, 'utf8')
const engineSha256 = crypto.createHash('sha256').update(engineText).digest('hex')
const ast = ts.createSourceFile(engineFile, engineText, ts.ScriptTarget.Latest, true)
const declaration = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'AudioSource')
assert.ok(declaration)
const methodNames = ['stop', 'playOneShot']
const methods = methodNames.map(name => {
  const method = declaration.members.find(n => ts.isMethodDeclaration(n) && n.name.getText(ast) === name)
  assert.ok(method, `installed engine missing ${name}`)
  return { name, line: ast.getLineAndCharacterOfPosition(method.getStart(ast)).line + 1, source: method.getText(ast) }
})
// No method bodies are rewritten: extract and transpile them, supply only their
// documented surrounding fields and AudioPlayer/audioManager backend ports.
const compiled = ts.transpileModule(`class EngineAudioSource { ${methods.map(m => m.source).join('\n')} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true,
})
assert.equal((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0)
function engineHarness () {
  const loads = [], playing = new Set()
  const AudioPlayer = { loadOneShotAudio: (url, volume, options) => new Promise(resolve => loads.push({ url, volume, options, resolve })) }
  const audioManager = { discardOnePlayingIfNeeded () {}, addPlaying: p => playing.add(p), removePlaying: p => playing.delete(p) }
  const EngineAudioSource = new Function('AudioPlayer', 'audioManager', 'AudioOperationType', compiled.outputText + '\nreturn EngineAudioSource')(AudioPlayer, audioManager, { STOP: 'stop' })
  const source = new EngineAudioSource()
  Object.assign(source, { node: { isValid: true }, clip: null, _player: null, _isLoaded: false, _volume: 1, _operationsBeforeLoading: [] })
  const shot = { plays: 0, stops: 0, play () { this.plays++ }, stop () { this.stops++; this.onEnd?.() }, onEnd: null }
  return { source, loads, playing, shot }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve() }
const clip = { _nativeAsset: { url: 'audit-only://steel-plate' }, loadMode: 0 }
const boundaries = {
  tableHidden: c => c.cancelTransientPlayback(),
  mute: c => { c.session.snapshot.settings.soundEnabled = false; c.applySettings() },
  destroy: c => c.onDestroy(),
}
;(async () => {
  let boundaryCases = 0, assetStageControls = 0, normalControls = 0
  for (const boundary of Object.values(boundaries)) for (const stage of ['engine-pending', 'already-playing']) {
    const h = makeAudioHarness(), e = engineHarness(); h.controller.effectSource = e.source
    h.controller.session.snapshot.settings.bgmEnabled = false
    h.controller.playActionVoice({ type: 'Plate' })
    assert.equal(h.pendingLoads.length, 1)
    h.pendingLoads[0].callback(null, clip)
    assert.equal(e.loads.length, 1)
    assert.equal(e.loads[0].volume, .92)
    if (stage === 'already-playing') { e.loads[0].resolve(e.shot); await flush(); assert.equal(e.shot.plays, 1) }
    boundary(h.controller)
    if (stage === 'engine-pending') { assert.equal(e.shot.plays, 0); e.loads[0].resolve(e.shot); await flush() }
    assert.equal(e.shot.plays, 1, 'engine pending promise starts even after owner cancellation')
    assert.equal(e.shot.stops, 0, 'AudioSource.stop never owns this one-shot player')
    assert.equal(e.playing.has(e.shot), true)
    assert.equal(e.source._player, null)
    e.shot.onEnd(); assert.equal(e.playing.size, 0, 'natural ending still releases manager tracking')
    h.controller.onDestroy(); boundaryCases++
  }
  // Controls distinguish the real application asset-generation guard from the
  // subsequent engine async phase, and ordinary clip.stop from oneShot behavior.
  for (const boundary of Object.values(boundaries)) {
    const h = makeAudioHarness(), e = engineHarness(); h.controller.effectSource = e.source
    h.controller.session.snapshot.settings.bgmEnabled = false
    h.controller.playActionVoice({ type: 'Plate' }); boundary(h.controller)
    h.pendingLoads[0].callback(null, clip); await flush()
    assert.equal(e.loads.length, 0); h.controller.onDestroy(); assetStageControls++
  }
  {
    const e = engineHarness(); let stopped = 0
    e.source._player = { stop: async () => { stopped++ } }; e.playing.add(e.source._player)
    e.source.stop(); await flush(); assert.equal(stopped, 1); assert.equal(e.playing.size, 0); normalControls++
  }
  {
    const h = makeAudioHarness(), e = engineHarness(); h.controller.effectSource = e.source
    h.controller.playActionVoice({ type: 'Plate' }); h.pendingLoads[0].callback(null, clip)
    e.loads[0].resolve(e.shot); await flush(); assert.equal(e.shot.plays, 1)
    e.shot.onEnd(); h.controller.onDestroy(); normalControls++
  }
  let cacheCases = 0
  for (const synchronous of [false, true]) for (const failTimes of [0, 1, 2, 3]) {
    const clock = makeClock(), pending = [], received = []; let attempts = 0, cancels = 0
    const value = { fixture: true }
    const cache = new OptionalAudioAssetCache((key, done) => {
      const i = attempts++
      const complete = () => done(i < failTimes ? new Error('temporary network failure') : null, i < failTimes ? null : value)
      if (synchronous) complete(); else pending.push(complete)
      return () => { cancels++; done(Object.assign(new Error('cancelled'), { code: 'ASSET_LOAD_CANCELLED' }), null) }
    }, clock)
    for (let i = 0; i < 20; i++) cache.get('one', v => received.push(v))
    if (!synchronous) pending.shift()()
    clock.advance(500)
    if (!synchronous && pending.length) pending.shift()()
    clock.advance(1500)
    if (!synchronous && pending.length) pending.shift()()
    assert.equal(attempts, Math.min(failTimes + 1, 3)); assert.equal(received.length, 20)
    assert.ok(received.every(v => v === (failTimes < 3 ? value : null)))
    if (failTimes === 3) {
      clock.advance(4999); cache.get('one', v => assert.equal(v, null)); assert.equal(attempts, 3)
      clock.advance(1); cache.get('one', v => assert.equal(v, value)); assert.equal(attempts, 4)
      if (!synchronous) pending.shift()()
    }
    cache.dispose(); assert.equal(cancels, 0); assert.equal(clock.timerCount(), 0); cacheCases++
  }
  for (const afterRetry of [false, true]) {
    const clock = makeClock(); let calls = 0, completed = 0, done
    const cache = new OptionalAudioAssetCache((key, cb) => { calls++; done = cb; return () => cb(Object.assign(new Error('cancelled'), { code: 'ASSET_LOAD_CANCELLED' }), null) }, clock)
    cache.get('cancel', () => completed++)
    if (afterRetry) done(new Error('temporary'), null)
    cache.dispose(); done(null, valueOrNull()); clock.advance(100000)
    assert.equal(calls, 1); assert.equal(completed, 0); assert.equal(clock.timerCount(), 0); cacheCases++
  }
  function valueOrNull () { return { late: true } }
  const time = makeClock(), gate = new ActionVoiceGate(time.now), first = gate.begin()
  time.advance(1800); assert.equal(first(), true); time.advance(1); assert.equal(first(), false)
  const second = gate.begin(), third = gate.begin(); assert.equal(second(), false); assert.equal(third(), true)
  gate.invalidate(); assert.equal(third(), false)
  const profiles = loadTs(path.join(root, 'work/guandan-cocos/assets/scripts/audio/AudioProfiles.ts'))
  for (const event of profiles.AUDIO_EVENTS) {
    const profile = profiles.resolveAudioProfile(event)
    assert.equal(profile.event, event); assert.ok(Object.isFrozen(profile)); assert.ok(Object.isFrozen(profile.assetKeys))
  }
  for (const remaining of [-1, 6, 1.5, NaN, Infinity]) assert.equal(profiles.resolveCountdownProfile(remaining), null)
  for (const remaining of [0, 1, 2, 3, 4, 5]) assert.ok(profiles.resolveCountdownProfile(remaining))
  console.log(JSON.stringify({ engineFile, engineSha256, engineMethods: methods.map(({ name, line }) => ({ name, line })),
    finding: 'AUDIO-15-001', boundaryCases, assetStageControls, normalControls, cacheCases,
    scope: 'unmodified installed-engine methods + actual controller/cache; synthetic backend, no audible/device playback' }, null, 2))
})().catch(error => { console.error(error); process.exitCode = 1 })
