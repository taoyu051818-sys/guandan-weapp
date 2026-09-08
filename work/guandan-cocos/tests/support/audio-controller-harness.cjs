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
  const time = makeClock(), pendingLoads = []
  class AudioClip {}
  class AudioSource {
    constructor () { this.node = { isValid: true }; this.clip = null; this.playing = false; this.playCount = 0; this.stopCount = 0; this.played = [] }
    stop () { this.stopCount++; this.playing = false }
    play () { this.playCount++; this.playing = true }
    playOneShot (clip) { this.played.push(clip) }
  }
  const dependencies = {
    cc: { _decorator: { ccclass: () => target => target, property: () => () => {} }, AudioClip, AudioSource,
      Component: class {}, Node: class { addComponent () { return new AudioSource() } } },
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
  controller.node = { isValid: true }
  controller.session = { snapshot: { settings: { soundEnabled: true, volume: 1, voicePack: 'female', bgmEnabled: true, bgmVolume: .3 } }, events: { on () {}, off () {} } }
  controller.effectSource = new AudioSource()
  controller.bgmSource = new AudioSource()
  controller.scheduleOnce = (callback, seconds) => { scheduled.push({ callback, seconds }) }
  return { controller, pendingLoads, scheduled, played: controller.effectSource.played, time, AudioClip }
}

module.exports = { makeClock, OptionalAudioAssetCache, isMissingAudioAsset, ActionVoiceGate, makeAudioHarness }
