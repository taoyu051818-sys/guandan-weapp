// Audit-only: image bytes, browser/WeChat/canvas/timers, Cocos hosts are synthetic.
'use strict'
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto')
const repo=path.resolve(__dirname,'../../../..'),app=path.join(repo,'work/guandan-cocos')
const {loadTs}=require(path.join(app,'tests/support/load-typescript-module.cjs'))
const ts=require(path.join(app,'tests/support/typescript.cjs')).loadTypeScript()
const src=p=>path.join(app,'assets/scripts',p)
const pickerJs=ts.transpileModule(fs.readFileSync(src('services/ProfileImagePicker.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve()}
async function imageCase(mode,kind,width=1200,height=800){
  let timerId=0,chosen=0,created=0,revoked=0,draw=null,consent=0
  const timers=new Map()
  const makeImage=()=>{if(kind==='image-throw')throw Error('image-throw');return {width:kind==='zero'?0:width,height:kind==='oversize'?40_000_001:height,
    set src(_source){if(kind==='timeout')return;if(kind==='decode-fail')this.onerror();else this.onload()}}}
  const canvas={getContext:()=>kind==='context-null'?null:{fillRect:()=>{},drawImage:(...args)=>{draw=args.slice(1)}},
    toDataURL:(mime,quality)=>{assert.equal(mime,'image/jpeg');assert.equal(quality,.75);if(kind==='encode-throw')throw Error('encode-throw');return kind==='wrong-mime'?'data:image/png;base64,AAAA':kind==='too-long'?'data:image/jpeg;base64,'+'A'.repeat(88000):'data:image/jpeg;base64,AAAA'}}
  const sandbox={exports:{},setTimeout:cb=>{const id=++timerId;timers.set(id,cb);return id},clearTimeout:id=>timers.delete(id)}
  if(mode==='wx')sandbox.wx={
    requirePrivacyAuthorize:({success,fail})=>{consent++;kind==='privacy-fail'?fail():success()},
    chooseImage:({count,sizeType,sourceType,success,fail})=>{chosen++;assert.equal(consent,1);assert.equal(count,1);assert.equal(String(sourceType),'album');assert.equal(String(sizeType),'compressed');
      if(kind==='cancel')fail({errMsg:'chooseImage:fail cancel'});else if(kind==='choose-fail')fail({errMsg:'permission'});else success({tempFilePaths:kind==='empty'?[]:['audit-source']})},
    createImage:makeImage,createCanvas:()=>canvas,
  }
  else {
    sandbox.URL={createObjectURL:()=>{created++;return 'blob:audit-source'},revokeObjectURL:url=>{assert.equal(url,'blob:audit-source');revoked++}}
    sandbox.Image=function(){return makeImage()}
    sandbox.document={createElement:type=>{
      if(type==='canvas')return canvas
      assert.equal(type,'input')
      const input={files:kind==='empty'?[]:[{size:kind==='file-too-big'?10*1024*1024+1:100}],click(){chosen++;kind==='cancel'?this.oncancel():this.onchange()}}
      return input
    }}
  }
  vm.runInNewContext(pickerJs,sandbox)
  const result=sandbox.exports.pickProfileImage().then(value=>({value}),error=>({error:String(error.message)}))
  await flush()
  if(kind==='timeout'){assert.equal(timers.size,1);const [id,cb]=timers.entries().next().value;timers.delete(id);cb();await flush()}
  const actual=await result
  if(['cancel','empty'].includes(kind))assert.equal(actual.value,null)
  else if(kind==='ok'){
    assert.equal(actual.value,'data:image/jpeg;base64,AAAA')
    const edge=Math.min(width,height)
    assert.deepEqual(draw,[(width-edge)/2,(height-edge)/2,edge,edge,0,0,256,256])
    assert.equal(canvas.width,256);assert.equal(canvas.height,256)
  } else assert.equal(typeof actual.error,'string',mode+'/'+kind)
  if(kind==='privacy-fail')assert.equal(chosen,0)
  if(mode==='web')assert.equal(revoked,created,'every created blob URL revoked on success/failure')
  assert.equal(timers.size,0)
}
function screenCases(){
  const capsule=loadTs(src('ui/WechatCapsuleLayout.ts'))
  let size,safe,handler,on=0,off=0
  class UITransform{setContentSize(size){this.size=size}}
  class EventTarget{events=[];emit(...v){this.events.push(v)}}
  class Vec2{constructor(x,y){Object.assign(this,{x,y})}}
  class Vec3{static ZERO={x:0,y:0,z:0}}
  class Size{constructor(width,height){Object.assign(this,{width,height})}}
  class Component{node={setPosition:v=>{this.position=v}};getComponent(){return this.transform}addComponent(Type){this.transform=new Type;return this.transform}}
  const cc={_decorator:{ccclass:()=>c=>c},Component,EventTarget,UITransform,Vec2,Vec3,Size,sys:{getSafeAreaRect:()=>safe},view:{
    getVisibleSize:()=>size,on:(event,fn,ctx)=>{assert.equal(event,'canvas-resize');assert.equal(handler,undefined);handler={fn,ctx};on++},
    off:(event,fn,ctx)=>{assert.equal(event,'canvas-resize');assert.equal(handler.fn,fn);assert.equal(handler.ctx,ctx);handler=undefined;off++}}}
  const {ScreenAdapter}=loadTs(src('ui/ScreenAdapter.ts'),{cc,'./WechatCapsuleLayout':capsule})
  const adapter=new ScreenAdapter()
  let count=0
  for(const [w,h]of [[874,402],[1280,720],[1560,720],[1920,1080]])for(const [l,r,b,t]of [[0,0,0,0],[40,40,0,0],[0,0,30,10],[55,15,18,7]]){
    size={width:w,height:h};safe={x:l,y:b,width:w-l-r,height:h-b-t}
    adapter.onEnable()
    assert.equal(adapter.viewport.safeLeft,l);assert.equal(adapter.viewport.safeRight,r)
    assert.equal(adapter.viewport.safeBottom,b);assert.equal(adapter.viewport.safeTop,t)
    assert.equal(adapter.safeLeftX(8),-w/2+l+8);assert.equal(adapter.safeRightX(8),w/2-r-8)
    assert.equal(adapter.safeTopY(8),h/2-t-8);assert.equal(adapter.safeBottomY(8),-h/2+b+8)
    assert.equal(adapter.safeSize().x,w-l-r);assert.equal(adapter.safeSize().y,h-b-t)
    assert.equal(adapter.transform.size.width,w);assert.equal(adapter.transform.size.height,h)
    adapter.onDisable();count++
  }
  assert.equal(on,16);assert.equal(off,16);assert.equal(adapter.events.events.length,16)
  return count
}
function geometryCases(){
  const safe=loadTs(src('ui/SafeAreaLayout.ts')),frame=loadTs(src('ui/UiFrameStyle.ts')),metrics=loadTs(src('ui/TableButtonMetrics.ts'))
  let seed=271828,cases=0
  const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
  for(let i=0;i<500;i++){
    const width=100+rnd()*900
    const items=Array.from({length:1+i%7},(_,n)=>({id:'n'+n,preferredWidth:80+rnd()*180,minWidth:40,priority:n,canHide:n%2===0}))
    const copy=JSON.stringify(items),result=safe.resolveSafeHorizontalLane(-width/2,width/2,items,8)
    let right=-width/2
    for(const p of result.filter(p=>p.visible)){assert.ok(p.x-p.width/2>=right-1e-7);assert.ok(p.x+p.width/2<=width/2+1e-7);assert.ok(p.width>0);right=p.x+p.width/2}
    assert.equal(JSON.stringify(items),copy);cases++
    const rects=items.map((n,j)=>({id:n.id,x:(rnd()-.5)*600,y:(rnd()-.5)*300,width:80,height:50,priority:j,shiftAxis:j%2?'x':'y',shiftStep:10,maxShift:150,canHide:true}))
    const placements=safe.resolveSafePriorityRects({left:-400,right:400,top:240,bottom:-240},rects,6).filter(p=>p.visible)
    for(let a=0;a<placements.length;a++){
      const p=placements[a];assert.ok(p.x-p.width/2>=-400&&p.x+p.width/2<=400)
      assert.ok(p.y-p.height/2>=-240&&p.y+p.height/2<=240)
      for(let b=0;b<a;b++){const q=placements[b];assert.ok(Math.abs(p.x-q.x)>=(p.width+q.width)/2+6||Math.abs(p.y-q.y)>=(p.height+q.height)/2+6)}
    }
    for(const kind of Object.keys(frame.UI_FRAME_CORNERS)){const radius=frame.uiFrameRadius(width,1+i%80,kind,rnd()*2);assert.ok(Number.isFinite(radius)&&radius>=0&&radius<=Math.min(width,1+i%80)*.2)}
  }
  assert.equal(metrics.TABLE_BUTTON_HEIGHT,69.6)
  for(const text of ['出牌','提示','不要','准备下一局','再来一场','A123',''])for(const primary of [true,false])assert.ok(metrics.tableButtonWidth(text,primary)>0)
  const protectedPair=safe.resolveSafePriorityRects({left:0,right:50,bottom:0,top:50},[
    {id:'a',x:25,y:25,width:50,height:50,priority:2,canHide:false},
    {id:'b',x:25,y:25,width:50,height:50,priority:1,canHide:false}])
  assert.ok(protectedPair.every(p=>p.visible),'protected content can overlap; not forced to disappear')
  return {laneAndRectCases:cases,frameChecks:2500,protectedOverlapIntentional:true}
}
function catalogCheck(){
  const {DEFAULT_PROFILE_CATALOG:catalog}=loadTs(src('services/DefaultProfileCatalog.ts'))
  const sourceDir=path.join(repo,'work/guandan-windows-source/server/data/default-profiles')
  const data=JSON.parse(fs.readFileSync(path.join(sourceDir,'catalog.json'),'utf8'))
  assert.deepEqual(catalog,data.profiles.map(({displayName,avatarUrl,file})=>({displayName,avatarUrl,asset:'ui/profiles/'+file.replace(/\.[^.]+$/,'')+'/texture'})))
  assert.equal(new Set(catalog.map(p=>p.avatarUrl)).size,catalog.length)
  for(const p of data.profiles){
    assert.match(p.file,/^[0-9]{3}\.(jpg|png)$/)
    const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
    assert.equal(hash(path.join(sourceDir,p.file)),hash(path.join(app,'assets/game-assets/ui/profiles',p.file)))
  }
  return catalog.length
}
async function main(){
  let imageCases=0
  for(const mode of ['wx','web']){
    for(const kind of ['ok','cancel','empty','image-throw','timeout','decode-fail','zero','oversize','context-null','encode-throw','wrong-mime','too-long',...(mode==='wx'?['privacy-fail','choose-fail']:['file-too-big'])]){await imageCase(mode,kind);imageCases++}
    for(const [w,h]of [[800,1200],[256,256],[5000,8000]]){await imageCase(mode,'ok',w,h);imageCases++}
  }
  console.log(JSON.stringify({imageCases,screenCases:screenCases(),geometry:geometryCases(),catalogAssetsMatched:catalogCheck(),
    boundary:'all image/canvas/OS/native/timer hosts synthetic; only tracked bundled assets read for hashes; no album/network/render/license proof'},null,2))
}
main().catch(error=>{console.error(error);process.exitCode=1})

