const assert = require('node:assert/strict')
const { makeClock, OptionalAudioAssetCache, isMissingAudioAsset, ActionVoiceGate, makeAudioHarness } = require('./support/audio-controller-harness.cjs')
const timeout = () => Object.assign(new Error('asset timeout'), { code: 'ASSET_LOAD_TIMEOUT' })
const missing = () => Object.assign(new Error('missing file'), { code: 'ENOENT' })

for (const error of [timeout(), new Error('network disconnected'), new Error('unknown'), Object.assign(new Error('cancelled'), { code: 'ASSET_LOAD_CANCELLED' })]) {
  assert.equal(isMissingAudioAsset(error), false)
}
for (const error of [missing(), new Error('HTTP 404'), new Error("Bundle game-assets doesn't contain voices/optional"), null]) assert.equal(isMissingAudioAsset(error), true)

// Real cache, deterministic time: coalesced requests, bounded retries, recoverable cooldown.
{
  const time = makeClock(), calls = [], results = []
  const cache = new OptionalAudioAssetCache((key, cb) => { calls.push({ key, cb }); return () => {} }, time)
  cache.get('a', clip => results.push(clip)); cache.get('a', clip => results.push(clip))
  assert.equal(calls.length, 1)
  calls[0].cb(timeout(), null); time.advance(499); assert.equal(calls.length, 1)
  time.advance(1); assert.equal(calls.length, 2)
  calls[0].cb(null, { obsolete: true }); assert.equal(cache.peek('a'), undefined, 'duplicate old attempt cannot win')
  calls[1].cb(new Error('temporary network failure'), null); time.advance(1500)
  calls[2].cb(timeout(), null); assert.deepEqual(results, [null, null])
  cache.get('a', clip => results.push(clip)); assert.equal(calls.length, 3, 'cooldown prevents request storms')
  time.advance(5000); cache.get('a', clip => results.push(clip)); assert.equal(calls.length, 4)
  const clip = {}; calls[3].cb(null, clip); assert.equal(cache.peek('a'), clip)
  cache.get('a', value => assert.equal(value, clip)); assert.equal(calls.length, 4)
  cache.get('missing', value => assert.equal(value, null)); calls[4].cb(missing(), null)
  time.advance(60000); cache.get('missing', value => assert.equal(value, null)); assert.equal(calls.length, 5)
  cache.dispose(); assert.equal(cache.peek('a'), undefined)
}
// Synchronous failure/cache-hit callbacks must not overwrite the retry timer's cancellation.
{
  const time = makeClock(); let attempts = 0, callbacks = 0
  const cache = new OptionalAudioAssetCache((key, cb) => { attempts++; cb(timeout(), null); return () => {} }, time)
  cache.get('a', () => callbacks++); assert.equal(time.timerCount(), 1)
  cache.dispose(); time.advance(10000)
  assert.equal(attempts, 1); assert.equal(callbacks, 0); assert.equal(time.timerCount(), 0)
  const sync = new OptionalAudioAssetCache((key, cb) => { cb(null, key); return () => assert.fail('completed loads need no cancel') }, time)
  sync.get('cached', clip => assert.equal(clip, 'cached')); sync.dispose()
}
// Latest semantic action wins even if its voice is absent; gates do not depend on Cocos.
{
  const time = makeClock(), gate = new ActionVoiceGate(time.now)
  const a = gate.begin(), b = gate.begin(); assert.equal(a(), false); assert.equal(b(), true)
  time.advance(1801); assert.equal(b(), false)
  const c = gate.begin(); gate.invalidate(); assert.equal(c(), false)
}
// Actual controller: cold load responses arrive B -> A, only B announces.
{
  const h = makeAudioHarness()
  h.controller.playActionVoice({ voiceKeys: ['niuma/a'] })
  h.controller.playActionVoice({ voiceKeys: ['niuma/b'] })
  const a = {}, b = {}; h.pendingLoads[1].callback(null, b); h.pendingLoads[0].callback(null, a)
  assert.deepEqual(h.played, [b])
  h.controller.playActionVoice({ voiceKeys: ['niuma/c'] }); const c = h.pendingLoads.at(-1)
  h.controller.playActionVoice({ type: 'NoCuratedVoice' }); c.callback(null, {})
  assert.deepEqual(h.played, [b], 'a silent newer action must also invalidate earlier speech')
}
// Pass and play are one announcement lane; missing primary still allows an on-time fallback.
{
  const h = makeAudioHarness()
  h.controller.playActionVoice({ voiceKeys: ['niuma/a'] }); const a = h.pendingLoads.at(-1)
  h.controller.playPass(); const pass = h.pendingLoads.at(-1)
  a.callback(null, {}); const passClip = {}; pass.callback(null, passClip)
  assert.deepEqual(h.played, [passClip])
  h.controller.playActionVoice({ voiceKeys: ['niuma/absent', 'niuma/fallback'] })
  h.pendingLoads.at(-1).callback(missing(), null)
  assert.equal(h.pendingLoads.at(-1).assetPath, 'audio/voices/niuma/fallback')
  const fallback = {}; h.pendingLoads.at(-1).callback(null, fallback)
  assert.deepEqual(h.played, [passClip, fallback])
}
// A timeout can warm the cache after retry, but must not announce an old turn seconds later.
{
  const h = makeAudioHarness()
  h.controller.playActionVoice({ voiceKeys: ['niuma/retry'] }); h.pendingLoads[0].callback(timeout(), null)
  h.time.advance(2000); const clip = {}; h.pendingLoads[1].callback(null, clip)
  assert.deepEqual(h.played, [])
  h.controller.playActionVoice({ voiceKeys: ['niuma/retry'] }); assert.deepEqual(h.played, [clip])
}
// BGM recovers without another settings event; effect mute does not silence music.
{
  const h = makeAudioHarness()
  h.controller.applySettings(); h.pendingLoads[0].callback(timeout(), null)
  h.time.advance(500); const music = {}; h.pendingLoads[1].callback(null, music)
  assert.equal(h.controller.bgmSource.clip, music); assert.equal(h.controller.bgmSource.playCount, 1)
  h.controller.session.snapshot.settings.soundEnabled = false; h.controller.applySettings()
  assert.equal(h.controller.bgmSource.playing, true)
  h.controller.onDestroy()
}
// Old mode's late success does not replace new BGM, or play after BGM was turned off.
{
  const h = makeAudioHarness()
  h.controller.applySettings(); h.controller.setBgmMode('battle')
  const battle = {}; h.pendingLoads[1].callback(null, battle); h.pendingLoads[0].callback(null, {})
  assert.equal(h.controller.bgmSource.clip, battle); assert.equal(h.controller.bgmSource.playCount, 1)
  h.controller.onDestroy()
  const muted = makeAudioHarness(); muted.controller.applySettings()
  muted.controller.session.snapshot.settings.bgmEnabled = false; muted.controller.applySettings()
  muted.pendingLoads[0].callback(null, {}); assert.equal(muted.controller.bgmSource.playCount, 0)
}
// Component destruction (node stays alive) cancels pending callbacks and scheduled retries.
for (const retrying of [false, true]) {
  const h = makeAudioHarness()
  h.controller.applySettings(); h.controller.playActionVoice({ voiceKeys: ['niuma/pending'] })
  if (retrying) h.pendingLoads[0].callback(timeout(), null)
  h.controller.onDestroy()
  assert.equal(h.controller.node.isValid, true)
  for (const request of h.pendingLoads) request.callback(null, {}) // transport deliberately ignores cancel
  h.time.advance(10000)
  assert.equal(h.controller.bgmSource.playCount, 0); assert.equal(h.controller.bgmSource.clip, null)
  assert.deepEqual(h.played, []); assert.equal(h.controller.assets.peek('audio/music/niuma/table_theme'), undefined)
  assert.equal(h.pendingLoads.length, 2); assert.equal(h.time.timerCount(), 0)
  assert.equal(h.pendingLoads[1].cancelled, true)
  h.controller.setBgmMode('battle'); h.controller.applySettings(); h.controller.playPass()
  assert.equal(h.pendingLoads.length, 2, 'disposed public methods cannot resurrect playback')
}
console.log('audio recovery, semantic ordering and owner-disposal regression checks passed')
