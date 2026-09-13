const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { loadTs } = require('./support/load-typescript-module.cjs')
const { makeAudioHarness } = require('./support/audio-controller-harness.cjs')
const audioRoot = path.resolve(__dirname, '../assets/scripts/audio')
const engine = process.env.COCOS_ENGINE_ROOT || '/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/resources/3d/engine/cocos'
if (!fs.existsSync(path.join(engine, 'audio/audio-source.ts'))) {
  if (process.argv.includes('--require-engine') || process.env.REQUIRE_COCOS_ENGINE === '1') throw Error('Cocos engine required: set COCOS_ENGINE_ROOT to the installed 3.8.8 cocos source directory')
  console.log('SKIP audio-engine-cancellation: installed Cocos engine unavailable; engine cancellation was NOT verified (use --require-engine in Creator validation)')
  process.exit(0)
}

// Load the complete installed AudioSource unchanged. Only its PAL audio backend,
// scene graph, decorators and manager are ports; no sound, network or GPU is used.
const engineHarness = () => {
  const pending = [], playing = new Set(), sources = []
  class Component {}
  class Node {
    constructor (name) { this.name = name; this.isValid = true; this.handlers = new Map(); this.children = [] }
    set parent (owner) { this.owner = owner; owner.children.push(this) }
    get parent () { return this.owner }
    addComponent (Type) { const source = new Type(); source.node = this; sources.push(source); return source }
    once (type, callback) { this.handlers.set(type, callback) }
    emit (type, ...args) { const callback = this.handlers.get(type); this.handlers.delete(type); callback?.(...args) }
    destroy () { this.isValid = false; this.handlers.clear(); if (this.owner) this.owner.children = this.owner.children.filter(node => node !== this) }
  }
  const AudioState = { INIT: 0, PLAYING: 1, STOPPED: 2 }
  const makePlayer = () => ({ state: AudioState.INIT, plays: 0, stops: 0, destroys: 0, duration: 2,
    play () { this.plays++; this.state = AudioState.PLAYING; return Promise.resolve() },
    stop () { this.stops++; this.state = AudioState.STOPPED; return Promise.resolve() },
    destroy () { this.destroys++; this.state = AudioState.STOPPED },
    onEnded (callback) { this.ended = callback }, offEnded () { this.ended = null },
    onInterruptionBegin () {}, onInterruptionEnd () {}, offInterruptionBegin () {}, offInterruptionEnd () {} })
  const AudioPlayer = { maxAudioChannel: 32,
    load: (url, options) => new Promise((resolve, reject) => pending.push({ url, options, resolve, reject })),
    loadOneShotAudio: () => assert.fail('cancellable cues must not use the independent one-shot backend') }
  const decorate = () => () => {}
  const { AudioSource } = loadTs(path.join(engine, 'audio/audio-source.ts'), {
    'pal/audio': { AudioPlayer },
    'cc.decorator': { ccclass: () => value => value, help: decorate, menu: decorate, tooltip: decorate, type: decorate, range: decorate, serializable: () => {} },
    '../../pal/audio/type': { AudioState }, '../scene-graph/component': { Component },
    '../core': { clamp: (n, min, max) => Math.min(max, Math.max(min, n)), warn: () => {} },
    './audio-clip': { AudioClip: class {} }, '../scene-graph': { Node },
    './audio-manager': { audioManager: { discardOnePlayingIfNeeded () {}, addPlaying: player => playing.add(player), removePlaying: player => playing.delete(player) } },
  })
  const { TransientAudioChannels } = loadTs(path.join(audioRoot, 'TransientAudioChannels.ts'), { cc: { AudioSource, Node } })
  const owner = new Node('audio-owner')
  const channels = new TransientAudioChannels(() => owner)
  return { pending, playing, sources, owner, channels, makePlayer }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
const clip = { _nativeAsset: { url: 'synthetic://voice' }, loadMode: 0 }
const boundaries = {
  tableHidden: controller => controller.cancelTransientPlayback(),
  mute: controller => { controller.session.snapshot.settings.soundEnabled = false; controller.applySettings() },
  destroy: controller => controller.onDestroy(),
}
;(async () => {
  let cases = 0
  for (const [name, boundary] of Object.entries(boundaries)) for (const stage of ['application-pending', 'engine-pending', 'playing']) {
    const h = makeAudioHarness(), e = engineHarness()
    h.controller.effects = e.channels
    // Keep an already-playing BGM on its independent source.
    const bgm = h.controller.bgmSource
    h.controller.assets.get('audio/music/niuma/table_theme', () => {})
    h.pendingLoads[0].callback(null, {})
    h.controller.applySettings()
    assert.equal(bgm.playing, true)
    h.controller.playActionVoice({ type: 'Plate' })
    const asset = h.pendingLoads.at(-1), player = e.makePlayer()
    if (stage !== 'application-pending') { asset.callback(null, clip); assert.equal(e.pending.length, 1) }
    if (stage === 'playing') { e.pending[0].resolve(player); await flush(); assert.equal(player.plays, 1); assert.equal(player.volume, .92) }
    boundary(h.controller)
    if (stage === 'application-pending') { asset.callback(null, clip); await flush(); assert.equal(e.pending.length, 0) }
    if (stage === 'engine-pending') { e.pending[0].resolve(player); await flush(); assert.equal(player.plays, 0); assert.equal(player.destroys, 1) }
    if (stage === 'playing') { await flush(); assert.equal(player.stops, 1); assert.equal(player.destroys, 1) }
    assert.equal(e.playing.size, 0)
    assert.equal(e.owner.children.length, 0)
    assert.equal(bgm.playing, name !== 'destroy', 'transient mute/exit does not stop BGM')
    h.controller.onDestroy(); cases++
  }
  // Independent layers stay audible together and release themselves on ENDED.
  {
    const e = engineHarness(), a = e.makePlayer(), b = e.makePlayer()
    e.channels.play(clip, .7); e.channels.play({ ...clip }, .4)
    e.pending[0].resolve(a); e.pending[1].resolve(b); await flush()
    assert.equal(e.playing.size, 2); assert.equal(a.volume, .7); assert.equal(b.volume, .4)
    a.ended(); assert.equal(e.playing.size, 1); assert.equal(e.owner.children.length, 1)
    b.ended(); assert.equal(e.playing.size, 0); assert.equal(e.owner.children.length, 0)
  }
  // Replaying the same AudioClip after cancellation must not adopt the old load.
  {
    const e = engineHarness(), old = e.makePlayer(), next = e.makePlayer()
    e.channels.play(clip, 1); e.channels.stopAll(); e.channels.play(clip, 1)
    e.pending[1].resolve(next); e.pending[0].resolve(old); await flush()
    assert.equal(old.plays, 0); assert.equal(old.destroys, 1); assert.equal(next.plays, 1)
    e.channels.stopAll(); e.channels.stopAll(); assert.equal(next.stops, 1)
    assert.equal(e.playing.size, 0)
  }
  console.log(`AUDIO-15-001: ${cases} controller cancellation boundaries plus layered playback/end cleanup/same-clip generations passed with real Cocos AudioSource`)
})().catch(error => { console.error(error); process.exitCode = 1 })
