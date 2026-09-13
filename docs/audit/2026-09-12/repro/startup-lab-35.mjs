// Audit-only: real first-screen script against memory GL/clock; lab HTTP on an owned loopback port.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..')
const cocos=path.join(root,'work/guandan-cocos'), lab=path.join(cocos,'tools/lobby-layout-lab')
const read=p=>fs.readFileSync(p,'utf8')
const ts=createRequire(import.meta.url)(path.join(cocos,'tests/support/typescript.cjs')).loadTypeScript()
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()}
const result={firstScreen:[],lab:null,scene:null}
const firstSource=read(path.join(cocos,'build-templates/wechatgame/first-screen.js'))
function screen({width=1748,height=804,background='ok',offscreen=true,webgl=true}={}) {
  let seq=0;const frames=new Map(),resources=new Map(),touch=new Set(),mouse=new Set(),modals=[]
  const created={Buffer:0,Texture:0,Program:0,Shader:0},deleted={...created}
  const draws=[]
  const gl=new Proxy({}, {get(_t,key){
    if(/^create(Buffer|Texture|Program|Shader)$/.test(key))return ()=>{const kind=key.slice(6),o={kind,id:++seq};created[kind]++;resources.set(o,kind);return o}
    if(/^delete(Buffer|Texture|Program|Shader)$/.test(key))return o=>{if(o){assert.equal(resources.get(o),key.slice(6));deleted[key.slice(6)]++;resources.delete(o)}}
    if(key==='getProgramParameter'||key==='getShaderParameter')return ()=>true
    if(key==='getUniformLocation'||key==='getAttribLocation')return ()=>0
    if(/^[A-Z_0-9]+$/.test(key))return 1
    if(key==='drawArrays')return ()=>draws.push(1)
    return ()=>{}
  }})
  const canvas={width,height,getContext:()=>webgl?gl:null,
    addEventListener:(type,fn)=>{assert.equal(type,'mouseup');mouse.add(fn)},
    removeEventListener:(_type,fn)=>mouse.delete(fn)}
  const canvas2d={getContext:()=>new Proxy({},{get:()=>()=>{}})}
  const wx={onTouchEnd:fn=>touch.add(fn),offTouchEnd:fn=>touch.delete(fn),
    showModal:options=>modals.push(options),...(offscreen?{createOffscreenCanvas:()=>canvas2d}:{})}
  class Image {width=1200;height=700;set src(value){assert.equal(value,'background.jpg');if(background!=='pending')queueMicrotask(()=>background==='ok'?this.onload():this.onerror(new Error('synthetic-image-failure')))}}
  const exports={},ctx={module:{exports},window:{canvas,devicePixelRatio:2},canvas,wx,Image,Float32Array,Uint8Array,Promise,
    requestAnimationFrame:fn=>{const id=++seq;frames.set(id,fn);return id},
    cancelAnimationFrame:id=>frames.delete(id),console:{log(){},warn(){},error(){}}}
  runInNewContext(firstSource,ctx)
  const api=ctx.module.exports
  const step=async()=>{const tasks=[...frames.values()];frames.clear();for(const fn of tasks)fn();await flush()}
  const settle=async promise=>{
    let done=false,err;Promise.resolve(promise).then(()=>done=true,e=>{done=true;err=e})
    for(let i=0;i<20&&!done;i++){await flush();await step()}
    assert.ok(done,'synthetic deadline exceeded');if(err)throw err
  }
  return {api,step,settle,frames,resources,touch,mouse,created,deleted,modals,draws}
}
for(const [width,height] of [[874,402],[1748,804],[2560,1440]])for(const background of ['ok','error']) {
  const s=screen({width,height,background})
  await s.settle(s.api.start('false','true','false'))
  for(const p of [.2,.4,.6])await s.settle(s.api.setProgress(p))
  assert.equal(s.frames.size,1);assert.ok(s.resources.size>0)
  await s.settle(s.api.end());await s.settle(s.api.end())
  assert.equal(s.frames.size,0);assert.equal(s.resources.size,0);assert.deepEqual(s.created,s.deleted)
  result.firstScreen.push({width,height,background,stagedProgressAndCleanup:true})
}
for(const offscreen of [true,false]) {
  const s=screen({offscreen});await s.settle(s.api.start('false','true','false'))
  let attempts=0,release
  const action=()=>{attempts++;return new Promise(resolve=>release=resolve)}
  await s.api.showFailure('合成故障',action);assert.equal(s.frames.size,0)
  assert.equal(s.touch.size,1);assert.equal(s.mouse.size,1)
  if(!offscreen){assert.equal(s.modals.length,1);assert.equal(s.modals[0].showCancel,false)}
  const click=[...s.touch][0];click();click();await flush();assert.equal(attempts,1)
  assert.equal(s.touch.size,0);assert.equal(s.mouse.size,0)
  release();await flush()
  s.api.clearFailure();await s.settle(s.api.end())
  assert.equal(s.resources.size,0);assert.equal(s.frames.size,0)
  result.firstScreen.push({offscreen,oneRetryPerPendingAction:true,allResourcesAndListenersReleased:true})
}
{
  const s=screen();await s.settle(s.api.start('false','true','false'))
  let attempts=0
  const action=()=>{attempts++;if(attempts===1)throw Error('synthetic-retry-failure')}
  await s.api.showFailure('合成故障',action)
  ;[...s.touch][0]();await flush();assert.equal(attempts,1);assert.equal(s.touch.size,1)
  ;[...s.touch][0]();await flush();assert.equal(attempts,2);assert.equal(s.touch.size,0)
  s.api.clearFailure();await s.settle(s.api.end());assert.equal(s.resources.size,0)
  result.firstScreen.push({retryRejectedThenSuccess:true})
}
{
  const s=screen({webgl:false,offscreen:false})
  await assert.rejects(s.api.start('false','true','false'),/WebGL is unavailable/)
  await s.api.showFailure('合成WebGL故障',()=>{})
  assert.equal(s.modals.length,1);await s.api.end();assert.equal(s.touch.size,0)
  result.firstScreen.push({webglUnavailableModal:true})
}
// Public helper has a single afterTick slot. Test and record its limitation, not a live concurrency claim.
{
  const s=screen();await s.settle(s.api.start('false','true','false'))
  let first=false,second=false
  s.api.setProgress(.2).then(()=>first=true);s.api.setProgress(.4).then(()=>second=true)
  await s.step();assert.equal(first,false);assert.equal(second,true)
  await s.settle(s.api.end());assert.equal(s.resources.size,0)
  result.progressConcurrency={singlePendingResolverObserved:true,currentGameTemplateSerializesCalls:true}
}
const scene=JSON.parse(read(path.join(cocos,'assets/scenes/Game.scene')))
let refs=0
function walk(value){if(!value||typeof value!=='object')return;if(Object.hasOwn(value,'__id__')){assert.ok(Number.isInteger(value.__id__)&&value.__id__>=0&&value.__id__<scene.length);refs++}for(const v of Object.values(value))walk(v)}
scene.forEach(walk)
for(let i=0;i<scene.length;i++)for(const child of scene[i]._children||[])assert.equal(scene[child.__id__]._parent.__id__,i)
const rootComponent=scene.find(v=>v.__type__==='c91f07oiUVFCJgkcmQdO11Z')
assert.ok(rootComponent);assert.equal(rootComponent.platformAllowDevelopmentLogin,false)
assert.equal(rootComponent.platformAllowInsecureEndpoint,false);assert.equal(rootComponent.platformAllowInsecureGameEndpoint,false)
const imageMeta=JSON.parse(read(path.join(cocos,'assets/startup/resource-loading-lingshui-v1.jpg.meta')))
assert.equal(rootComponent.startupTexture.__uuid__,imageMeta.subMetas['6c48a'].uuid)
assert.equal(scene[1]._id,JSON.parse(read(path.join(cocos,'assets/scenes/Game.scene.meta'))).uuid)
result.scene={objects:scene.length,references:refs,parentLinks:true,startupTextureLinked:true,developmentOverridesDisabled:true}
let owned
const listenReady=new Promise((resolve,reject)=>{
  const virtualHttp={createServer:handler=>{
    owned=http.createServer(handler);owned.once('error',reject)
    return {listen(_port,host,callback){assert.equal(host,'127.0.0.1');owned.listen(0,host,()=>{callback();resolve()})}}
  }}
  const source=read(path.join(lab,'server.mjs')).replace(/^import .+\n/gm,'').replaceAll('import.meta.url',JSON.stringify(pathToFileURL(path.join(lab,'server.mjs')).href))
  runInNewContext(source,{http:virtualHttp,readFile,path,fileURLToPath,createRequire,URL,process:{env:{LOBBY_LAB_PORT:'0'}},console:{log(){},error(){}}})
})
try {
  await listenReady
  const port=owned.address().port
  const request=(requestPath,method='GET')=>new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,path:requestPath,method,agent:false},res=>{
      const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}))
    });req.on('error',reject);req.setTimeout(5000,()=>req.destroy(Error('audit request timed out')));req.end()
  })
  const routes=['/','/app.js','/style.css','/candidate02.js','/flows.js',...['background','classic','friend','tournament','shop','coin','avatar'].map(x=>'/assets/'+x),...['LobbyLayoutPolicy','SafeAreaLayout','TableLayoutOverlapAudit','UiFrameStyle'].map(x=>'/shared/'+x+'.js')]
  for(const route of routes)for(const method of ['GET','HEAD']){
    const r=await request(route,method);assert.equal(r.status,200,route)
    assert.match(r.headers['content-security-policy'],/connect-src 'none'/)
    assert.equal(r.headers['cache-control'],'no-store');assert.equal(r.headers['x-content-type-options'],'nosniff')
    assert.equal(r.body.length===0,method==='HEAD')
    if(route==='/shared/LobbyLayoutPolicy.js'&&method==='GET')assert.equal(r.body.toString(),ts.transpileModule(read(path.join(lab,'baseline-layout.ts')),{compilerOptions:{module:ts.ModuleKind.ES2020,target:ts.ScriptTarget.ES2020}}).outputText)
  }
  for(const route of ['/package.json','/.env','/../package.json','/%2e%2e/package.json','/assets/../../package.json','/assets/__proto__','/shared/..%2fGameScene.js','/api/v1/profile'])assert.equal((await request(route)).status,404,route)
  assert.equal((await request('/','POST')).status,405)
  result.lab={allowedGetAndHead:routes.length*2,disallowedPaths:8,postRejected:true,cspBlocksGameConnections:true,loopbackOnly:true}
}finally{if(owned){owned.closeAllConnections();await new Promise(resolve=>owned.close(resolve))}}
console.log(JSON.stringify(result,null,2))
