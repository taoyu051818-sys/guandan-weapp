// Real DefaultProfileFrames and GameAssetLoader, with a synthetic Cocos Bundle.
const assert = require('node:assert/strict')
const path = require('node:path')
const root = path.resolve(__dirname, '../../../..')
const base = path.join(root, 'work/guandan-cocos')
const { loadTs } = require(path.join(base, 'tests/support/load-typescript-module.cjs'))
const source = name => path.join(base, 'assets/scripts', name + '.ts')
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
class Texture2D {}
class SpriteFrame {}
let failed = true
const requests = []
const recoveredTexture = new Texture2D()
const bundle = { load (asset, Type, complete) {
  requests.push(asset)
  assert.equal(Type, Texture2D)
  complete(failed ? new Error('synthetic transient texture failure') : null, failed ? null : recoveredTexture)
} }
const cc = { Texture2D, SpriteFrame, assetManager: { getBundle: () => bundle } }
const loader = loadTs(source('services/GameAssetLoader'), { cc })
const catalog = { DEFAULT_PROFILE_CATALOG: [{ displayName: 'SyntheticBot', asset: 'profiles/synthetic/texture' }] }
const createFrames = () => loadTs(source('services/DefaultProfileFrames'), { cc, './DefaultProfileCatalog': catalog, './GameAssetLoader': loader })

;(async () => {
  const frames = createFrames()
  assert.equal(frames.defaultProfileFrame('SyntheticBot'), undefined)
  await flush()
  assert.equal(requests.length, 1)
  failed = false
  // Prove that the real lower-level adapter now successfully loads the same asset.
  assert.equal(await loader.loadGameAssetAsync('profiles/synthetic/texture', Texture2D), recoveredTexture)
  const requestsAfterRecoveryControl = requests.length
  for (let i = 0; i < 10; i++) { assert.equal(frames.defaultProfileFrame('SyntheticBot'), undefined); await flush() }
  assert.equal(requests.length, requestsAfterRecoveryControl)
  // A new module lifetime is a recovery control, not an existing UI reset API.
  const fresh = createFrames()
  assert.equal(fresh.defaultProfileFrame('SyntheticBot'), undefined)
  await flush()
  assert.equal(fresh.defaultProfileFrame('SyntheticBot').texture, recoveredTexture)
  const successRequests = requests.length
  for (let i = 0; i < 10; i++) assert.equal(fresh.defaultProfileFrame('SyntheticBot').texture, recoveredTexture)
  assert.equal(requests.length, successRequests)
  assert.equal(fresh.defaultProfileFrame('SyntheticUnknown'), undefined)
  console.log(JSON.stringify({ firstTextureFailure: true, lowerLoaderRecovered: true,
    repeatedDefaultFrameCalls: 10, retriesAfterRecovery: 0, frameStillMissing: true,
    newModuleLifetimeLoadsSuccessfully: true, successfulFrameReused: true,
    scope: 'bot default frame cache; generic seat fallback may remain visible, not whole-game loading failure' }))
})().catch(error => { console.error(error); process.exitCode = 1 })
