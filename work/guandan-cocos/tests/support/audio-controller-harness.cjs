const path = require('node:path')
const { loadTs } = require('./load-typescript-module.cjs')
const audioRoot = path.resolve(__dirname, '../../assets/scripts/audio')

const makeClock = () => {
  let now = 0
  const timers = new Set()
  return {
    now: () => now,
    later: (run, ms) => { const item = { at: now + ms, run }; timers.add(item); return () => timers.delete(item) },
    advance: ms => {
      const until = now + ms
      for (let count = 0; count < 100; count++) {
        const next = [...timers].filter(item => item.at <= until).sort((a, b) => a.at - b.at)[0]
        if (!next) { now = until; return }
        now = next.at; timers.delete(next); next.run()
      }
      throw new Error('unbounded timer loop')
    },
    timerCount: () => timers.size,
  }
}

const { OptionalAudioAssetCache, isMissingAudioAsset } = loadTs(path.join(audioRoot, 'OptionalAudioAssetCache.ts'))
const { ActionVoiceGate } = loadTs(path.join(audioRoot, 'ActionVoiceGate.ts'))
const makeAudioHarness = () => {
  const time = makeClock(), pendingLoads = [], played = []
  class AudioClip {}
  class AudioSource {
    static EventType = { ENDED: 'ended' }
    static maxAudioChannel = 32
    constructor () { this.node = { isValid: true }; this.clip = null; this.playing = false; this.playCount = 0; this.stopCount = 0; this.played = [] }
    stop () { this.stopCount++; this.playing = false }
    play () { this.playCount++; this.playing = true; if (this.node.name === 'TransientAudio') played.push(this.clip) }
    playOneShot (clip) { this.played.push(clip) }
  }
  class Node {
    constructor (name) { this.name = name; this.isValid = true; this.handlers = new Map() }
    addComponent () { const source = new AudioSource(); source.node = this; return source }
    once (type, callback) { this.handlers.set(type, callback) }
    destroy () { this.isValid = false; this.handlers.clear() }
  }
  const cc = { _decorator: { ccclass: () => target => target, property: () => () => {} }, AudioClip, AudioSource, Component: class {}, Node }
  const dependencies = {
    cc,
    './TransientAudioChannels': loadTs(path.join(audioRoot, 'TransientAudioChannels.ts'), { cc }),
    '../session/GameSession': { GameSession: class {} },
    '../services/GameAssetLoader': { loadGameAsset: (assetPath, assetType, callback) => {
      const load = { assetPath, assetType, callback, cancelled: false }; pendingLoads.push(load)
      return () => { load.cancelled = true; callback(Object.assign(new Error('cancelled'), { code: 'ASSET_LOAD_CANCELLED' }), null) }
    } },
    './OptionalAudioAssetCache': { OptionalAudioAssetCache: class extends OptionalAudioAssetCache { constructor (load) { super(load, time) } } },
    './ActionVoiceGate': { ActionVoiceGate: class extends ActionVoiceGate { constructor () { super(time.now) } } },
    './AudioProfiles': { RETIRED_AUDIO_ROUTES: { wildcard: {} }, resolveAudioEvent: () => null,
      resolveAudioProfile: event => ({ event, assetKeys: [event === 'pass' ? 'niuma/pass' : event], volumeScale: 1, cooldownMs: 0 }),
      resolveCountdownProfile: () => null },
    './PlayVoiceProfiles': { resolvePlayVoiceProfile: action => action.type === 'Plate'
      ? { assetKeys: ['tts/steel_plate'], volumeScale: .92 }
      : action.voiceKeys ? { assetKeys: action.voiceKeys, volumeScale: 1 } : null },
  }
  const { CocosAudioController } = loadTs(path.join(audioRoot, 'CocosAudioController.ts'), dependencies)
  const controller = new CocosAudioController(), scheduled = []
  controller.node = new Node('controller')
  controller.session = { snapshot: { settings: { soundEnabled: true, volume: 1, voicePack: 'female', bgmEnabled: true, bgmVolume: .3 } }, events: { on () {}, off () {} } }
  controller.bgmSource = new AudioSource()
  controller.scheduleOnce = (callback, seconds) => { scheduled.push({ callback, seconds }) }
  return { controller, pendingLoads, scheduled, played, time, AudioClip }
}

module.exports = { makeClock, OptionalAudioAssetCache, isMissingAudioAsset, ActionVoiceGate, makeAudioHarness }
