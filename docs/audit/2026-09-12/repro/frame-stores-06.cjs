// Actual source stores with explicit synthetic rendering, loader and image ports.
const assert = require('node:assert/strict')
const path = require('node:path')
const root = path.resolve(__dirname, '../../../..'), base = path.join(root, 'work/guandan-cocos')
const { loadTs } = require(path.join(base, 'tests/support/load-typescript-module.cjs'))
const file = name => path.join(base, 'assets/scripts', name + '.ts')
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
class Texture2D {}
class SpriteFrame {}
class ImageAsset { constructor (image) { this.image = image } }
const pending = []
const resolver = loadTs(file('ui/CardSkinResolver'))
const cc = { Texture2D, SpriteFrame, ImageAsset }
const store = loadTs(file('ui/ClassicCardFrameStore'), { cc, './CardSkinResolver': resolver,
  '../services/GameAssetLoader': { loadGameAssetAsync: asset => new Promise((resolve, reject) => pending.push({ asset, resolve, reject })) } })
;(async () => {
  const first = store.requestClassicCardFrame('bg_front')
  assert.equal(first, store.requestClassicCardFrame('bg_front'))
  assert.equal(pending.length, 1)
  pending[0].reject(new Error('synthetic failure')); assert.equal(await first, null)
  const next = store.requestClassicCardFrame('bg_front'); assert.notEqual(first, next)
  const texture = new Texture2D(); pending[1].resolve(texture)
  const frame = await next; assert.equal(frame.texture, texture)
  assert.equal(await store.requestClassicCardFrame('bg_front'), frame)
  const plan = resolver.resolveClassicCardPlan({ suit: 'heart', rank: 'A', isRed: true })
  assert.equal(store.getCachedClassicCardFrames(plan), null)
  const singleFace = store.requestClassicCardFrames(plan)
  const preload = store.preloadAllClassicCardFrames()
  const requestedAssets = pending.slice(1).map(r => r.asset)
  assert.equal(new Set(requestedAssets).size, 37)
  assert.equal(requestedAssets.length, 37)
  pending.slice(2).forEach(p => p.resolve(new Texture2D()))
  assert.ok(await singleFace); assert.equal(await preload, true)
  assert.equal(store.getCachedClassicCardFrames(plan).size, resolver.classicCardAssetNames(plan).length)
  const before = pending.length
  assert.equal(await store.preloadClassicCardFrames([plan, plan]), true)
  assert.equal(pending.length, before)
  const geometry = loadTs(file('ui/ClassicCardGeometry'))
  assert.ok(Object.isFrozen(geometry.CLASSIC_CARD_LAYER_GEOMETRY))
  for (const value of Object.values(geometry.CLASSIC_CARD_LAYER_GEOMETRY)) { assert.ok(Object.isFrozen(value)); assert.ok(value.width > 0 && value.height > 0) }

  const oldImage = global.Image, oldSetTimeout = global.setTimeout, oldClearTimeout = global.clearTimeout
  const images = [], timers = new Map(), locals = []
  let timerId = 0, proxyCalls = 0
  global.setTimeout = (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id }
  global.clearTimeout = id => timers.delete(id)
  global.Image = class {
    constructor () { this.width = 64; this.height = 64; images.push(this) }
    set src (value) { this.source = value }
  }
  try {
    class Node { constructor () { this.isValid = true; this.components = [] } setPosition () {} addComponent (T) { const c = new T(); this.components.push(c); return c } }
    class Sprite {}; Sprite.SizeMode = { CUSTOM: 1 }
    class UITransform { setContentSize () {} }
    const avatars = loadTs(file('ui/ProfileAvatar'), { cc: { ...cc, Node, Sprite, UITransform, Vec3: class {} },
      '../services/DefaultProfileCatalog': { DEFAULT_PROFILE_CATALOG: [{ avatarUrl: 'synthetic:bundled', asset: 'profiles/synthetic/texture' }] },
      '../services/GameAssetLoader': { loadGameAsset: (asset, T, complete) => { locals.push(asset); queueMicrotask(() => complete(null, new T())) } },
    })
    const auth = { getAvatarImage: async () => { proxyCalls++; return 'data:image/jpeg;base64,synthetic' } }
    await avatars.profileAvatarFrame({ id: 'local', avatarUrl: 'synthetic:bundled' }, auth)
    await avatars.profileAvatarFrame({ id: 'unknown', avatarUrl: 'asset:unexpected/path' }, auth)
    assert.deepEqual(locals, ['profiles/synthetic/texture', 'ui/common/default-avatar/texture'])
    assert.equal(proxyCalls, 0)
    const profile = { id: 'synthetic-person', avatarUrl: 'https://synthetic.invalid/avatar' }
    const a = avatars.profileAvatarFrame(profile, auth), b = avatars.profileAvatarFrame(profile, auth)
    assert.equal(a, b); await flush(); assert.equal(proxyCalls, 1)
    images.at(-1).onerror(); assert.equal(await a, null)
    const retry = avatars.profileAvatarFrame(profile, auth); await flush(); assert.equal(proxyCalls, 2)
    images.at(-1).onload(); const remoteFrame = await retry; assert.ok(remoteFrame instanceof SpriteFrame)
    assert.equal(await avatars.profileAvatarFrame(profile, auth), remoteFrame)
    const big = avatars.profileAvatarFrame({ ...profile, id: 'too-big' }, auth); await flush()
    images.at(-1).width = 1025; images.at(-1).onload(); assert.equal(await big, null)
    const timeout = avatars.profileAvatarFrame({ ...profile, id: 'timeout' }, auth); await flush()
    const [id, deadline] = [...timers.entries()].at(-1); assert.equal(deadline.delay, 8000); timers.delete(id); deadline.callback()
    assert.equal(await timeout, null); assert.equal(images.at(-1).onload, null)
    const mounted = avatars.mountProfileAvatar(new Node(), { ...profile, id: 'destroyed' }, auth, 0, 0, 64)
    mounted.isValid = false; await flush(); images.at(-1).onload(); await flush()
    assert.equal(mounted.components.find(c => c instanceof Sprite).spriteFrame, undefined)
    assert.equal(timers.size, 0)
    console.log(JSON.stringify({ sharedCardAssets: 37, sameRequestDeduplicated: true, failedCardRequestRetry: true,
      completeFaceAndPreload: true, geometryFrozen: true, bundledAndUnknownAssetFallback: true,
      profileProxyDedupAndRetry: true, oversizedImageRejected: true, imageTimeoutSettled: true, destroyedAvatarNotAssigned: true,
      limitation: 'Synthetic Image/Texture/Sprite/Bundle; no decode, pixels, GPU allocation or network verification.' }))
  } finally { global.Image = oldImage; global.setTimeout = oldSetTimeout; global.clearTimeout = oldClearTimeout }
})().catch(error => { console.error(error); process.exitCode = 1 })
