// Read-only resource/metadata/vendor boundary verification. No build, execution of vendor tools, or network.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..')
const base='work/guandan-cocos', assets=base+'/assets/', bundle=assets+'game-assets/'
const read=p=>fs.readFileSync(path.resolve(root,p)), json=p=>JSON.parse(read(p)), exists=p=>fs.existsSync(path.resolve(root,p))
const sha=b=>createHash('sha256').update(b).digest('hex')
const manifest=json('docs/audit/2026-09-12/manifest.json')
const selected=manifest.files.filter(f=>['resource-boundary','asset-metadata-boundary','third-party-boundary'].includes(f.category)&&!f.path.endsWith('.docx'))
const counts=a=>Object.fromEntries([...new Set(a)].sort().map(v=>[v,a.filter(x=>x===v).length]))
for(const f of selected){assert.equal(sha(read(f.path)),f.sha256,f.path);assert.equal(read(f.path).length,f.bytes,f.path)}
const metas=manifest.files.filter(f=>f.category==='asset-metadata-boundary')
const uuids=new Map(), subUuids=new Map(), activeUuids=new Set(), sourcePairs=[], metaImporter=[], activeMetas=[], outside=[]
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
for(const f of metas){
 const m=json(f.path), src=f.path.slice(0,-5), active=f.path.startsWith(assets)
 assert.ok(uuid.test(m.uuid),f.path);assert.ok(exists(src),src)
 assert.equal(fs.statSync(path.resolve(root,src)).isDirectory(),m.importer==='directory',src)
 if(active){assert.ok(!activeUuids.has(m.uuid),'duplicate active uuid '+f.path);activeUuids.add(m.uuid)}
 if(!uuids.has(m.uuid))uuids.set(m.uuid,[]);uuids.get(m.uuid).push(f.path)
 assert.ok(m.ver&&m.importer&&typeof m.imported==='boolean',f.path)
 const localSubs=new Set()
 const inspect=(node,parent)=>{
  for(const [key,sub] of Object.entries(node.subMetas??{})){
   assert.equal(sub.uuid,parent+'@'+key,f.path);assert.equal(sub.id,key,f.path)
   assert.ok(!localSubs.has(sub.uuid),'duplicate local subUuid '+f.path);localSubs.add(sub.uuid)
   if(!subUuids.has(sub.uuid))subUuids.set(sub.uuid,[]);subUuids.get(sub.uuid).push(f.path)
   if(sub.userData?.imageUuidOrDatabaseUri)assert.equal(sub.userData.imageUuidOrDatabaseUri,m.uuid,f.path)
   inspect(sub,sub.uuid)
  }
 }
 inspect(m,m.uuid)
 if(m.userData?.redirect)assert.ok(localSubs.has(m.userData.redirect),f.path)
 metaImporter.push(m.importer)
 if(active){activeMetas.push({path:f.path,source:src,...m});sourcePairs.push(src)}else outside.push(f.path)
}
const activeFiles=manifest.files.filter(f=>f.path.startsWith(assets)&&!f.path.endsWith('.meta'))
for(const f of activeFiles)assert.ok(sourcePairs.includes(f.path),'asset missing meta '+f.path)
assert.equal(activeFiles.length,activeMetas.filter(m=>m.importer!=='directory').length)
const archiveSnapshots=selected.filter(f=>f.path.endsWith('.meta.snapshot'))
for(const f of archiveSnapshots){const m=json(f.path);assert.ok(uuid.test(m.uuid),f.path)}
const runtimeFiles=manifest.files.filter(f=>f.path.startsWith(bundle)&&!f.path.endsWith('.meta'))
const runtimeHash=new Map(runtimeFiles.map(f=>[f.sha256,f.path]))
const audioResults=[]
for(const name of ['gameabc2-audio/manifest.json','niuma-client-cocos-audio.json','niuma-client-cocos-bgm.json','tts-steel-plate.json']){
 const m=json(base+'/third_party/licenses/'+name)
 for(const a of m.assets??[m.asset]){
  const p=base+'/'+m.runtimeDirectory+'/'+a.file
  assert.equal(read(p).length,a.bytes,p);assert.equal(sha(read(p)),a.sha256,p)
 }
 for(const a of m.archived??[]){
  const p=base+'/'+m.archiveDirectory+'/'+a.file
  assert.equal(read(p).length,a.bytes,p);assert.equal(sha(read(p)),a.sha256,p)
  assert.ok(!runtimeHash.has(a.sha256),'archived audio returned '+p)
 }
 audioResults.push({manifest:name,runtime:(m.assets??[m.asset]).length,archived:m.archived?.length??0})
}
const male=json(base+'/third_party/licenses/niuma-client-cocos-male-audio.json')
assert.equal(male.runtimeAllowed,false);assert.ok(!exists(base+'/'+male.runtimeDirectory))
for(const a of male.assets)assert.ok(!runtimeHash.has(a.sha256),'male audio returned '+a.key)
const kenney=selected.filter(f=>f.path.startsWith(base+'/third_party/assets/kenney-particle-pack/'))
const kenneyRuntime=runtimeFiles.filter(f=>f.path.startsWith(bundle+'effects/kenney/')&&f.path.endsWith('.png'))
const sourceMatches=kenneyRuntime.map(f=>{
 const matches=kenney.filter(s=>s.sha256===f.sha256).map(s=>s.path)
 assert.ok(matches.length,f.path);return {path:f.path,matches}
})
assert.equal(sha(read(bundle+'effects/kenney/LICENSE.txt')),sha(read(base+'/third_party/assets/kenney-particle-pack/License.txt')))
const mitCopies=[base+'/third_party/licenses/NiuMa-client-cocos-MIT.txt',bundle+'cards/classic/LICENSE-NiuMa-MIT.txt',base+'/third_party/legacy-effects/LICENSE']
for(const p of mitCopies){const s=read(p).toString();assert.match(s,/MIT License/);assert.match(s,/Copyright \(c\) 2025 NiuMa/);assert.match(s,/permission notice shall be included/)}
for(const p of [base+'/third_party/tools/rfxgen/LICENSE',base+'/third_party/tools/rfxgen-bin/rfxgen_v5.0_macos/LICENSE']){
 const s=read(p).toString();assert.match(s,/zlib License/);assert.match(s,/notice may not be removed/)
}
assert.match(read(bundle+'effects/bomb-v1/LICENSE.txt').toString(),/CC0/)
function walk(rel){
 return fs.readdirSync(path.resolve(root,rel),{withFileTypes:true}).flatMap(e=>{
  const p=rel+'/'+e.name;assert.ok(!e.isSymbolicLink(),'unexpected symlink '+p)
  return e.isDirectory()?walk(p):[p]
 })
}
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function compressUuid(id){
 const [main,...suffix]=id.split('@'), hex=main.replaceAll('-','')
 let out=hex.slice(0,2)
 for(let i=2;i<32;i+=3){let n=parseInt(hex.slice(i,i+3),16);out+=alphabet[n>>6]+alphabet[n&63]}
 return out+(suffix.length?'@'+suffix.join('@'):'')
}
const builds=[]
for(const plat of ['wechatgame','web-desktop']){
 const buildRoot=base+'/build/'+plat
 const buildFiles=walk(buildRoot)
 const cpath=buildFiles.find(p=>/\/game-assets\/config(?:\.[^.]+)?\.json$/.test(p))
 assert.ok(cpath,plat);const c=json(cpath)
 const entries=Object.entries(c.paths)
 const missingPaths=[],mismatchedUuid=[]
 for(const m of activeMetas.filter(m=>m.source.startsWith(bundle)&&m.importer!=='directory'&&m.importer!=='typescript')){
  const logical=m.source.slice(bundle.length).replace(/\.[^.]+$/,'')
  const expected=m.importer==='image'?[{p:logical,id:m.uuid,type:'cc.ImageAsset'},{p:logical+'/texture',id:m.userData.redirect,type:'cc.Texture2D'}]:[{p:logical,id:m.uuid,type:m.importer==='text'?'cc.TextAsset':'cc.AudioClip'}]
  for(const e of expected){
   const matches=entries.filter(([,value])=>value[0]===e.p&&c.types[value[1]]===e.type)
   if(!matches.length)missingPaths.push(e.p)
   for(const [index] of matches)if(c.uuids[+index]!==compressUuid(e.id)&&c.uuids[+index]!==e.id)mismatchedUuid.push(e.p)
  }
 }
 assert.deepEqual(missingPaths,[]);assert.deepEqual(mismatchedUuid,[])
 const builtHashes=new Map()
 for(const p of buildFiles){const h=sha(read(p));if(!builtHashes.has(h))builtHashes.set(h,[]);builtHashes.get(h).push(p)}
 const retired=male.assets.map(a=>a.sha256)
 retired.push(sha(read('asset-library/retired-audio/quick-chat/chat_nice_play.ogg')),sha(read(base+'/asset-library/retired-audio/level-card/wildcard.wav')))
 for(const h of retired)assert.ok(!builtHashes.has(h),'retired blob in '+plat)
 const byteCopies=runtimeFiles.filter(f=>builtHashes.has(f.sha256))
 const unmatched=runtimeFiles.filter(f=>!builtHashes.has(f.sha256)).map(f=>f.path)
 const vendorUnwanted=selected.filter(f=>/\/third_party\/tools\//.test(f.path)&&builtHashes.has(f.sha256))
 assert.deepEqual(vendorUnwanted,[])
 const audio=runtimeFiles.filter(f=>/\.(?:mp3|wav|ogg)$/.test(f.path))
 assert.ok(audio.every(f=>builtHashes.has(f.sha256)),'audio changed/missing '+plat)
 builds.push({platform:plat,files:buildFiles.length,bytes:buildFiles.reduce((sum,p)=>sum+read(p).length,0),configPath:cpath,configHash:sha(read(cpath)),bundleLogicalRecords:entries.length,sourcePairChecks:runtimeFiles.length,nativeByteCopies:byteCopies.length,nonNativeOrTransformed:unmatched,audioByteCopies:audio.length,retiredAudioAbsent:retired.length,vendorToolsAbsent:true})
}
const doc=read(base+'/THIRD_PARTY.md').toString()
assert.ok(/25 reachable clips/.test(doc));assert.ok(/selected in settings/.test(doc));assert.ok(/39 play\/pass MP3/.test(doc))
assert.ok(!exists(base+'/scripts/import-niuma-male-audio.mjs'))
const result={
 pass:true,boundaryFiles:counts(selected.map(f=>f.category)),metadata:{total:metas.length,active:activeMetas.length,outside,importers:counts(metaImporter),uniqueTopLevelUuids:uuids.size,uniqueActiveTopLevelUuids:activeUuids.size,archiveActiveUuidOverlap:[...uuids].filter(([,paths])=>paths.length>1),uniqueSubUuids:subUuids.size,activeFileMetaPairs:activeFiles.length,archiveMetaSnapshots:archiveSnapshots.length},
 audioResults,maleRetiredHashes:male.assets.length,kenneyRuntime:sourceMatches,builds,
 documentationDrift:{path:base+'/THIRD_PARTY.md',staleRuntimeCount:25,actualLicensedRuntime:audioResults[0].runtime,staleArchiveCount:2,actualLicensedArchive:audioResults[0].archived,retiredMaleDescribedAsSelectable:true,missingDocumentedMaleImporter:true},
 limits:['Hash/format/boundary checks do not review every pixel, prove rights for imported media, guarantee vendor tool safety, or prove current builds contain every current source change.','Vendor tool source is inventoried and excluded from runtime; it is not line-by-line audited.','Historical DOCX is deferred to document-boundary review.']
}
console.log(JSON.stringify(result,null,2))
