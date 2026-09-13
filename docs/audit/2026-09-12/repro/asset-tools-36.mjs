// Audit-only: generators execute with captured writes; no network or product changes.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
import { deflateSync, inflateSync } from 'node:zlib'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..')
const cocos=resolve(root,'work/guandan-cocos')
const sha=b=>createHash('sha256').update(b).digest('hex')
const text=p=>fs.readFileSync(p,'utf8')
const run=(path,context)=>vm.runInNewContext(text(path).replace(/^import .*$/gm,'').replaceAll('import.meta.url',JSON.stringify(pathToFileURL(path).href)),context,{filename:path,timeout:10000})
const writes=[],directories=[]
run(resolve(cocos,'scripts/generate-lobby-glint.mjs'),{
  Buffer, URL, fileURLToPath, deflateSync, console:{log(){}},
  mkdirSync:(p,o)=>directories.push([p,o]),
  writeFileSync:(p,data)=>writes.push({path:p,data:Buffer.from(data)}),
})
assert.equal(writes.length,1);assert.equal(directories.length,1)
assert.equal(writes[0].path,resolve(cocos,'assets/game-assets/effects/lobby-v1/button-glint.png'))
const png=writes[0].data
assert.deepEqual(png.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]))
const chunks=[]
// Independent CRC implementation uses a table, not the source generator's bitwise loop per byte.
const table=Array.from({length:256},(_,v)=>{for(let k=0;k<8;k++)v=v&1?0xedb88320^(v>>>1):v>>>1;return v>>>0})
const crc=b=>{let v=0xffffffff;for(const byte of b)v=(v>>>8)^table[(v^byte)&255];return(v^0xffffffff)>>>0}
for(let i=8;i<png.length;){
  const length=png.readUInt32BE(i),kind=png.subarray(i+4,i+8).toString()
  const body=png.subarray(i+4,i+8+length)
  assert.equal(crc(body),png.readUInt32BE(i+8+length))
  chunks.push({kind,data:png.subarray(i+8,i+8+length)});i+=length+12
  assert.ok(i<=png.length)
}
assert.deepEqual(chunks.map(x=>x.kind),['IHDR','IDAT','IEND'])
const header=chunks[0].data
assert.equal(header.readUInt32BE(0),384);assert.equal(header.readUInt32BE(4),96)
assert.equal(header[8],8);assert.equal(header[9],6)
const raw=inflateSync(chunks[1].data), stride=384*4+1
assert.equal(raw.length,stride*96)
const frameMax=Array(16).fill(0)
for(let y=0;y<96;y++){
  assert.equal(raw[y*stride],0)
  for(let x=0;x<384;x++){
    const f=Math.floor(y/48)*8+Math.floor(x/48)
    frameMax[f]=Math.max(frameMax[f],raw[y*stride+1+x*4+3])
  }
}
assert.equal(frameMax[0],0);assert.equal(frameMax[15],0)
assert.ok(frameMax.slice(1,15).every(x=>x>0))
// sin() floating-point rounding can differ by one alpha unit in mirrored frames.
assert.ok(frameMax.every((value,index)=>Math.abs(value-frameMax[15-index])<=1))
const existing=fs.readFileSync(writes[0].path)
assert.deepEqual(png,existing)
const glint={size:[384,96],frames:16,bytes:png.length,sha256:sha(png),sourceMatchesExisting:true,chunkCrcChecks:3,frameAlphaMax:frameMax,productWrites:0}

const server=resolve(root,'work/guandan-windows-source/server/data/default-profiles')
const catalog=JSON.parse(text(resolve(server,'catalog.json')))
assert.equal(catalog.version,1)
assert.equal(catalog.profiles.length,24)
assert.equal(catalog.failures.length,26)
const ids=new Set(),names=new Set()
for(const p of catalog.profiles){
  assert.match(p.id,/^\d{3}$/);assert.match(p.file,/^\d{3}\.(jpg|png|gif)$/)
  assert.equal(p.file.slice(0,3),p.id)
  assert.equal(p.avatarUrl,'profile:'+p.id)
  assert.ok(p.displayName&&[...p.displayName].length<=24)
  assert.ok(!ids.has(p.id));ids.add(p.id);names.add(p.displayName)
  assert.deepEqual(fs.readFileSync(resolve(server,p.file)),fs.readFileSync(resolve(cocos,'assets/game-assets/ui/profiles',p.file)))
}
assert.deepEqual([...ids].map(Number).concat(catalog.failures).sort((a,b)=>a-b),Array.from({length:50},(_,i)=>i+1))
const copied=[],catalogWrites=[]
run(resolve(cocos,'scripts/sync-default-profiles.mjs'),{
  URL,console:{log(){}},mkdirSync(){},
  readFileSync:(p,encoding)=>{assert.equal(fileURLToPath(p),resolve(server,'catalog.json'));return fs.readFileSync(p,encoding)},
  copyFileSync:(s,d)=>copied.push([fileURLToPath(s),fileURLToPath(d)]),
  writeFileSync:(p,data)=>catalogWrites.push([fileURLToPath(p),data]),
})
assert.equal(copied.length,24);assert.equal(catalogWrites.length,1)
for(const [s,d] of copied){
  assert.equal(dirname(s),server)
  assert.equal(dirname(d),resolve(cocos,'assets/game-assets/ui/profiles'))
}
assert.equal(catalogWrites[0][0],resolve(cocos,'assets/scripts/services/DefaultProfileCatalog.ts'))
assert.equal(catalogWrites[0][1],text(catalogWrites[0][0]))
const profiles={successfulPairs:24,failedOrNotFetchedIndices:26,uniqueIds:ids.size,uniqueNames:names.size,completeIndexPartition:true,serverClientPixelFileHashesMatch:24,generatedTsMatchesActual:true,newQueries:0}
console.log(JSON.stringify({glint,profiles,scope:'read-only catalog; generator final writes captured in memory; no avatar fetching'},null,2))
