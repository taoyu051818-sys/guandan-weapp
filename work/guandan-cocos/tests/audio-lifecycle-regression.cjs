const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTypeScript } = require('./support/typescript.cjs')

const projectRoot = path.resolve(__dirname, '..')
const sourcePath = path.join(projectRoot, 'assets/scripts/audio/CocosAudioController.ts')
const scenePath = path.join(projectRoot, 'assets/scripts/scenes/GameScene.ts')
const ts = loadTypeScript()
const { loadTs } = require('./support/load-typescript-module.cjs')
const pendingLoads = []

class Component {}
class AudioClip {}
class AudioSource {}
class Node {}

const result = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2019,
    experimentalDecorators: true,
  },
  fileName: sourcePath,
  reportDiagnostics: true,
})
const errors = (result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
assert.deepEqual(errors, [], 'CocosAudioController must transpile')

const moduleRecord = { exports: {} }
const localRequire = request => {
  if (request === 'cc') return {
    _decorator: {
      ccclass: () => target => target,
      property: () => () => {},
    },
    AudioClip,
    AudioSource,
    Component,
    Node,
  }
  if (request === '../session/GameSession') return { GameSession: class GameSession {} }
  if (request === '../services/GameAssetLoader') return {
    loadGameAsset: (assetPath, assetType, callback) => { pendingLoads.push({ assetPath, assetType, callback }); return () => {} },
  }
  if (request === './OptionalAudioAssetCache' || request === './ActionVoiceGate') return loadTs(path.resolve(path.dirname(sourcePath), `${request}.ts`))
  if (request === './AudioProfiles') return {
    RETIRED_AUDIO_ROUTES: { wildcard: { runtimeAllowed: false } },
    resolveAudioEvent: () => null,
    resolveAudioProfile: event => ({ event, assetKeys: [event], volumeScale: 1, cooldownMs: 0 }),
    resolveCountdownProfile: () => null,
  }
  if (request === './PlayVoiceProfiles') return { resolvePlayVoiceProfile: action => action.type === 'Plate' ? { assetKeys: ['tts/steel_plate'], volumeScale: .92 } : null }
  throw new Error(`unexpected runtime dependency ${request}`)
}
new Function('exports', 'module', 'require', '__filename', '__dirname', result.outputText)(
  moduleRecord.exports,
  moduleRecord,
  localRequire,
  sourcePath,
  path.dirname(sourcePath),
)
const { CocosAudioController } = moduleRecord.exports

const makeController = () => {
  const scheduled = []
  const events = []
  const played = []
  let stopCount = 0
  const controller = new CocosAudioController()
  controller.node = { isValid: true }
  controller.session = {
    snapshot: {
      settings: { soundEnabled: true, volume: 1, voicePack: 'female', bgmEnabled: true, bgmVolume: 0.3 },
    },
  }
  controller.effectSource = {
    node: { isValid: true },
    stop: () => { stopCount += 1 },
    playOneShot: clip => played.push(clip),
  }
  controller.scheduleOnce = (callback, seconds) => scheduled.push({ callback, seconds })
  controller.playEvent = event => events.push(event)
  return { controller, events, played, scheduled, stopCount: () => stopCount }
}

const rounds = makeController()
const retired = makeController()
const loadCount = pendingLoads.length
retired.controller.playVoice('wildcard')
retired.controller.playEffect('wildcard')
assert.equal(pendingLoads.length, loadCount, 'neither direct voice nor legacy playback may load the retired level cue')
const steel = makeController()
steel.controller.playActionVoice({type:'Plate'})
assert.equal(pendingLoads.at(-1).assetPath, 'audio/voices/tts/steel_plate')
const steelClip = new AudioClip()
pendingLoads.at(-1).callback(null, steelClip)
assert.deepEqual(steel.played, [steelClip], 'steel-plate announcement must reach the dedicated audio source once')
rounds.controller.session.snapshot.settings.voicePack = 'male'
assert.deepEqual(rounds.controller.selectHumanVoiceKeys(['niuma-male/bomb', 'licensed/pass', 'niuma/bomb']), ['niuma/bomb'], 'stale Male settings and unclassified speech must not restore Male playback')
assert.deepEqual(rounds.controller.selectHumanVoiceKeys(['niuma-male/pass_1']), [], 'removed Male voices must degrade to silence')
rounds.controller.playRoundStart()
const firstDeal = rounds.scheduled.at(-1)
rounds.controller.playRoundStart()
const secondDeal = rounds.scheduled.at(-1)
assert.equal(firstDeal.seconds, 0.45)
firstDeal.callback()
secondDeal.callback()
assert.deepEqual(rounds.events, ['game-start', 'game-start', 'deal'], 'a newer round must invalidate the older delayed deal cue')

rounds.controller.playRoundStart()
const leavingDeal = rounds.scheduled.at(-1)
rounds.controller.cancelTransientPlayback()
leavingDeal.callback()
assert.equal(rounds.events.at(-1), 'game-start', 'leaving the table must invalidate its delayed deal cue')
assert.equal(rounds.stopCount() >= 4, true, 'round and table boundaries must stop the transient source')

const lateLoad = makeController()
lateLoad.controller.playFirstAvailable(['late-voice'], 1)
const load = pendingLoads.at(-1)
assert.equal(load.assetPath, 'audio/voices/late-voice')
lateLoad.controller.cancelTransientPlayback()
load.callback(null, new AudioClip())
assert.deepEqual(lateLoad.played, [], 'an optional clip resolved after the session boundary must stay silent')

const sceneSource = fs.readFileSync(scenePath, 'utf8')
assert.match(sceneSource, /if \(!visible\) this\.audio\?\.cancelTransientPlayback\(\)/, 'leaving the table must advance the audio generation')

process.stdout.write('audio lifecycle regression checks passed\n')
