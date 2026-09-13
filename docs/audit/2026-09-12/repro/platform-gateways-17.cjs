// Audit-only; actual client/service modules, in-memory HTTP and platform store.
// No server listener, production identity, file persistence, build or source mutation.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const root = path.resolve(__dirname, '../../../..')
const app = path.join(root, 'work/guandan-cocos')
const { loadTs } = require(path.join(app, 'tests/support/load-typescript-module.cjs'))
const { loadTypeScript } = require(path.join(app, 'tests/support/typescript.cjs'))
const ts = loadTypeScript(), cache = new Map()
function source(relative) {
  const file = path.resolve(app, relative)
  if (cache.has(file)) return cache.get(file)
  const module = { exports: {} }; cache.set(file, module.exports)
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: file,
  }).outputText
  new Function('exports','require',compiled)(module.exports, request => {
    assert.ok(request.startsWith('.'), 'no external runtime module: ' + request)
    const target = path.resolve(path.dirname(file), request)
    return source(path.relative(app, fs.existsSync(target + '.ts') ? target + '.ts' : path.join(target, 'index.ts')))
  })
  return module.exports
}
const { createHttpGateways, PlatformApiClient, PlatformApiError, XhrTransport } = source('assets/scripts/services/PlatformApi.ts')
const form = source('assets/scripts/scenes/front-pages/FriendRoomSettingsPolicy.ts')
const ok = data => ({ status: 200, body: { ok: true, data } })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const flush = async () => { for (let i=0;i<30;i++) await Promise.resolve() }
const ranks=['2','3','4','5','6','7','8','9','10','J','Q','K','A','小王','大王']
const { TableHudPresenter } = loadTs(path.join(app,'assets/scripts/scenes/TableHudPresenter.ts'), {
  cc: {}, '../ui/TableTributeInfoView': { tributeInfoText: () => '' },
  '../game/PublicStraightFlushPossibility': { publicStraightFlushPossibleSuits: () => [] },
  '../services/GameAssetLoader': {}, '../ui/ClassicCardFrameStore': {},
  '../ui/TableGameHud': { TABLE_GAME_HUD_COUNTER_RANKS: ranks },
  './TableSnapshotPresenter': { projectTableViewer: () => ({ viewerLevel: 2, opponentLevel: 2 }), projectTableSeatStatus: () => '', projectTableModeLabel: () => null },
  './DuplicateTablePresentation': { duplicateTableLabel: () => null },
  '../services/DefaultProfileFrames': { defaultProfileFrame: () => null },
})
function hudCounter(settings) {
  const ids=['p1','p2','p3','p4']
  const lobby={roomId:'123456',roomRole:'player',lobbyReadyRequired:true,roomSettings:settings,members:ids}
  const presenter=new TableHudPresenter({ lobbySnapshot:()=>lobby,isMultiplayer:()=>true,turnClock:()=>null })
  let rendered
  // Inject only the rendering port. Product render and publicCardCounts run unchanged.
  presenter.tableHud={render:value=>{rendered=value}}
  const state={turnOrder:ids,players:Object.fromEntries(ids.map((id,i)=>[id,{name:id,hand:[{rank:2,suit:['heart','club','spade','diamond'][i]}],team:i%2?'teamB':'teamA'}])),
    finishedPlayers:[],currentLevel:2,currentTurn:'p1',playArea:[],ruleProfile:{allowA2345Straight:true}}
  presenter.render({state,phase:'playing',teamLevels:{teamA:2,teamB:2}},'p1',{availableSuits:[],selectedSuit:null})
  return rendered.counterEnabled
}
async function main() {
  const { FriendRoomService } = await import(pathToFileURL(path.join(root,'work/guandan-windows-source/server/platform/friend-room-service.js')))
  const { MemoryPlatformStore, createEmptyPlatformState } = await import(pathToFileURL(path.join(root,'work/guandan-windows-source/server/platform/storage.js')))
  let now=Date.now()
  const realNow=Date.now
  Date.now=()=>now
  function fixture() {
    const initial=createEmptyPlatformState(); initial.users.audit={id:'audit'}
    const store=new MemoryPlatformStore(initial); let sequence=0, invites=0, tokens=0
    const tickets={issue:claims=>({gameEndpoint:'wss://game.invalid/weapp',gameTicket:'audit-token-'+(++tokens),expiresAt:now+60000,claims:{...claims,jti:'audit-jti-'+tokens,exp:Math.floor(now/1000)+60}})}
    const rooms=new FriendRoomService({store,gameTickets:tickets,now:()=>now,createId:()=>String(++sequence),
      createRoomId:()=>String(120000+sequence),createInviteCode:()=>String(++invites).padStart(24,'A'),createEntryAttemptId:()=>assert.fail('request supplies ID')})
    const requests=[]; let loseNext=false
    const transport={request:async request=>{
      const url=new URL(request.url); assert.equal(url.origin,'https://platform.invalid')
      requests.push(structuredClone(request))
      try {
        assert.equal(url.pathname,'/api/v1/friend-rooms/create')
        const entry=await rooms.create('audit',request.body)
        if(loseNext){loseNext=false;throw new Error('synthetic response lost after commit')}
        return ok({entry})
      } catch(error) {
        if(error.status) return {status:error.status,body:{ok:false,error:{code:error.code,message:error.message,retryable:false}}}
        throw error
      }
    }}
    const gateways=createHttpGateways({baseUrl:'https://platform.invalid',deviceId:'audit',accessToken:'synthetic',gameEndpointPolicy:'secure-only'},transport)
    return {store,rooms,requests,gateways,lose:()=>{loseNext=true}}
  }
  const counters=[], collisions=[]
  try {
    for(const format of ['rounds','upgrade','rotating','duplicate'])for(const enabled of [false,true]){
      const f=fixture(), draft=form.updateFriendRoomChoice(form.changeFriendRoomFormat(form.createDefaultFriendRoomSettings(),format),'counter',enabled?'开启':'关闭')
      assert.equal(draft.counterEnabled,enabled)
      const entry=await f.gateways.friendRooms.create(draft)
      const stored=await f.store.read(s=>s.matches[entry.matchId].roomSettings)
      assert.equal(Object.hasOwn(f.requests[0].body.roomSettings,'counterEnabled'),false)
      assert.equal(Object.hasOwn(stored,'counterEnabled'),false)
      assert.equal(Object.hasOwn(entry.roomSettings,'counterEnabled'),false)
      assert.equal(hudCounter(entry.roomSettings),true)
      assert.equal(hudCounter(draft),enabled,'direct configured-HUD control')
      counters.push({format,requested:enabled,submitted:'omitted',stored:'omitted',hudEnabled:true})
    }
    const changes=[
      ['rounds','deal-mode','不洗牌','dealMode'],
      ['upgrade','upgrade-target','过6','upgradeTarget'],
      ['rotating','team-rotation','顺时针轮换','teamRotation'],
      ['rotating','rotating-scoring','6分制','rotatingScoring'],
    ]
    for(const [format,choice,label,field] of changes){
      const f=fixture(), base=form.changeFriendRoomFormat(form.createDefaultFriendRoomSettings(),format)
      f.lose()
      await assert.rejects(f.gateways.friendRooms.create(base),e=>e.code==='TRANSPORT_ERROR'&&e.retryable)
      const oldId=f.requests[0].body.entryAttemptId
      now+=30*60*1000+1 // Actual default unstarted friend-room lease expires.
      const changed=form.updateFriendRoomChoice(base,choice,label)
      assert.notEqual(changed[field],base[field])
      await assert.rejects(f.gateways.friendRooms.create(changed),e=>e.code==='IDEMPOTENCY_CONFLICT')
      assert.equal(f.requests[1].body.entryAttemptId,oldId)
      // Definite conflict clears client attempt: the next explicit click can succeed.
      const recovered=await f.gateways.friendRooms.create(changed)
      assert.notEqual(f.requests[2].body.entryAttemptId,oldId)
      assert.equal(recovered.roomSettings[field],changed[field])
      collisions.push({field,unnecessaryConflict:true,thirdAttemptRecovered:true})
    }
    const f=fixture(), base=form.createDefaultFriendRoomSettings()
    f.lose(); await assert.rejects(f.gateways.friendRooms.create(base),e=>e.retryable)
    const same=await f.gateways.friendRooms.create(base)
    assert.equal(f.requests[0].body.entryAttemptId,f.requests[1].body.entryAttemptId)
    assert.equal(await f.store.read(s=>Object.keys(s.matches).length),1)
    assert.equal(same.roomId,'120000')
  } finally { Date.now=realNow }
  // Authentication retry reuses exact POST intent and idempotency key under 24 late 401s.
  let loginCalls=0, clearCalls=0, token='old'
  const releases=Array.from({length:24},deferred), sends=[]
  const client=new PlatformApiClient({request:async input=>{
    sends.push(structuredClone(input))
    if(input.url.endsWith('/api/v1/auth/dev-login')){loginCalls++;return ok({accessToken:'fresh'})}
    const index=Number(new URL(input.url).searchParams.get('i'))
    if(input.headers.Authorization==='Bearer old')return releases[index].promise
    return ok({index})
  }},{baseUrl:'https://platform.invalid',deviceId:'audit',allowDevelopmentLogin:true,credentialStore:{getAccessToken:()=>token,setAccessToken:v=>{token=v},clearAccessToken:()=>{token=null;clearCalls++}}})
  const calls=releases.map((_,i)=>client.request('/api/v1/action?i='+i,'POST',{marker:i},{'Idempotency-Key':'same-intent-'+i}))
  await flush()
  for(const i of [...releases.keys()].reverse()){releases[i].resolve({status:401,body:{error:{code:'EXPIRED',message:'expired'}}});await flush()}
  const results=await Promise.all(calls);assert.equal(results.length,24);assert.equal(loginCalls,1);assert.equal(clearCalls,1)
  for(let i=0;i<24;i++){const pair=sends.filter(x=>x.body?.marker===i);assert.equal(pair.length,2);assert.deepEqual(pair[0].body,pair[1].body);assert.equal(pair[0].headers['Idempotency-Key'],pair[1].headers['Idempotency-Key'])}
  // Real XhrTransport callbacks over an injected XHR, no network.
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'XMLHttpRequest'),xhrCalls=[]
  class FakeXhr {
    open(method,url,async){this.method=method;this.url=url;this.async=async;xhrCalls.push(this)}
    setRequestHeader(k,v){(this.headers??={})[k]=v}
    send(body){this.body=body}
  }
  Object.defineProperty(globalThis,'XMLHttpRequest',{configurable:true,value:FakeXhr})
  try {
    const transport=new XhrTransport()
    for(const stage of ['json','text','empty','network','timeout']){
      const pending=transport.request({method:'POST',url:'https://platform.invalid/a',headers:{Test:'value'},body:{test:1},timeoutMs:1234})
      const x=xhrCalls.at(-1);assert.equal(x.timeout,1234);assert.equal(x.body,'{"test":1}')
      if(stage==='network'||stage==='timeout'){const rejected=assert.rejects(pending,e=>e instanceof PlatformApiError&&e.retryable&&e.code===(stage==='network'?'NETWORK_ERROR':'REQUEST_TIMEOUT'));x[stage==='network'?'onerror':'ontimeout']();await rejected}
      else{x.status=200;x.responseText=stage==='json'?'{"data":1}':stage==='text'?'not json':'';x.onload();assert.deepEqual(await pending,{status:200,body:stage==='json'?{data:1}:stage==='text'?'not json':null})}
    }
  } finally { if(descriptor)Object.defineProperty(globalThis,'XMLHttpRequest',descriptor);else delete globalThis.XMLHttpRequest }
  console.log(JSON.stringify({counterCases:counters,settingIdentityCases:collisions,sameSettingsRetryControl:true,concurrent401PostCases:24,loginCalls,clearCalls,xhrCases:5,
    boundary:'in-memory HTTP/service/store/HUD ports; no real auth, signature, Cocos rendering or WeChat request'},null,2))
}
main().catch(e=>{console.error(e);process.exitCode=1})
