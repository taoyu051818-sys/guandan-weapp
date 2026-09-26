const assert = require('node:assert/strict')
const path = require('node:path')
const { loadTs } = require('./support/load-typescript-module.cjs')
const root = path.resolve(__dirname, '../assets/scripts')
const load = (p, deps) => loadTs(path.join(root, p), deps)
const cacheModule = load('services/LeasedAssetCache.ts')
const { LeasedAssetCache } = cacheModule
const { AssetBinding } = load('services/AssetBinding.ts')
const flush = async () => { for (let i=0;i<8;i++) await Promise.resolve() }

async function run () {
  const disposed = [], cache = new LeasedAssetCache(1, value => disposed.push(value))
  let requests=0
  const a=cache.acquire('a',async()=>{requests++;return 'a'}), a2=cache.acquire('a',async()=>{throw Error('duplicate')})
  assert.equal(await a.ready,'a');assert.equal(await a2.ready,'a');assert.equal(requests,1)
  a.release();a.release();assert.deepEqual(disposed,[])
  const b=cache.acquire('b',async()=>'b');await b.ready;b.release()
  const c=cache.acquire('c',async()=>'c');await c.ready;c.release()
  assert.deepEqual(disposed,['b'],'live a is pinned while the oldest idle entry is evicted')
  cache.clear();assert.deepEqual(disposed,['b','c'])
  a2.release();assert.deepEqual(disposed,['b','c','a'],'clear defers disposal until last consumer leaves')
  let resolveLate
  const late=cache.acquire('late',()=>new Promise(resolve=>{resolveLate=resolve}))
  await flush();late.release();cache.clear();resolveLate('late')
  assert.equal(await late.ready,null);assert.equal(disposed.filter(v=>v==='late').length,1)
  const fail=cache.acquire('fail',async()=>{throw Error('offline')});assert.equal(await fail.ready,null);fail.release()
  const retry=cache.acquire('fail',async()=>'retry');assert.equal(await retry.ready,'retry');retry.release();cache.clear()

  const render=[], released=[];let resolveOld
  const binding=new AssetBinding(value=>render.push(value))
  binding.update('old',()=>({ready:new Promise(r=>{resolveOld=r}),release:()=>released.push('old')}))
  binding.update('new',()=>({ready:Promise.resolve('new'),release:()=>{assert.equal(render.at(-1),null);released.push('new')}}))
  resolveOld('old');await flush();assert.equal(render.at(-1),'new');assert.deepEqual(released,['old'])
  binding.clear();assert.deepEqual(released,['old','new']);assert.equal(render.at(-1),null)

  const objects=[]
  class Owned { constructor(){this.destroyed=0;objects.push(this)} destroy(){this.destroyed++} }
  class SpriteFrame extends Owned {}
  class ImageAsset extends Owned {}
  class Texture2D extends Owned { refs=0;addRef(){this.refs++} decRef(){this.refs--} }
  const oldImage=global.Image
  global.Image=class {width=128;height=128;set src(value){queueMicrotask(()=>value.includes('bad')?this.onerror?.():this.onload?.())}}
  const texture=new Texture2D()
  const api=load('services/ProfileAvatarAssets.ts',{
    cc:{SpriteFrame,ImageAsset,Texture2D},'./LeasedAssetCache':cacheModule,
    './GameAssetLoader':{loadGameAssetAsync:async()=>texture},'./DefaultProfileCatalog':{DEFAULT_PROFILE_CATALOG:[]},
  })
  try {
    const auth={getAvatarImage:async()=>'data:image/jpeg;base64,test'}
    const local=api.acquireProfileAvatarFrame(null,auth), localFrame=await local.ready
    assert.equal(texture.refs,1);local.release();api.clearProfileAvatarCache()
    assert.equal(texture.refs,0);assert.equal(texture.destroyed,0);assert.equal(localFrame.destroyed,1)
    const active=api.acquireProfileAvatarFrame({id:'user',avatarUrl:'https://allowed/avatar'},auth)
    const frame=await active.ready;const remoteTexture=frame.texture, pixels=remoteTexture.image
    for(let i=0;i<12;i++) {const lease=api.acquireProfileAvatarFrame({id:'u'+i,avatarUrl:'data:image/jpeg;base64,'+i},auth);await lease.ready;lease.release()}
    assert.equal(frame.destroyed,0,'visible avatar survives LRU eviction')
    api.clearProfileAvatarCache();assert.equal(frame.destroyed,0)
    active.release();active.release()
    assert.equal(frame.destroyed,1);assert.equal(remoteTexture.destroyed,1);assert.equal(pixels.destroyed,1)
    const bad=api.acquireProfileAvatarFrame({id:'bad',avatarUrl:'data:image/jpeg;base64,bad'},auth)
    assert.equal(await bad.ready,null);bad.release();api.clearProfileAvatarCache()
    assert.ok(objects.every(o=>o===texture?o.destroyed===0:o.destroyed===1),'no owned frame, texture or pixels left behind')
  } finally {global.Image=oldImage}
  console.log('Avatar leases: shared load, idle eviction, live pinning, late/cancelled loads, retry, route races and image disposal passed')
}
run().catch(error=>{console.error(error);process.exitCode=1})
