// Audit-only. Current modules + synthetic credentials/callbacks. No network or product writes.
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')
const root = path.resolve(__dirname, '../../../..')
const app = path.join(root, 'work/guandan-cocos')
const { loadTs } = require(path.join(app, 'tests/support/load-typescript-module.cjs'))
const profiles = loadTs(path.join(app, 'assets/scripts/services/WechatProfileResult.ts'))
const { readAuthorizedWechatProfile, WechatProfileSync } = loadTs(path.join(app, 'assets/scripts/services/WechatProfileSync.ts'), {
  './WechatProfileResult': profiles,
})
const { mountWechatProfileButton } = loadTs(path.join(app, 'assets/scripts/services/WechatProfileProvider.ts'), {
  './WechatProfileResult': profiles, '../ui/UiFrameStyle': { uiFrameRadius: () => 6 },
})
const { ProfileSaveCoordinator } = loadTs(path.join(app, 'assets/scripts/services/ProfileSaveCoordinator.ts'))
const ranking = loadTs(path.join(app, 'assets/scripts/services/WechatFriendRanking.ts'))
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b }); return { promise, resolve, reject } }
const flush = async () => { for (let i=0;i<30;i++) await Promise.resolve() }
const raw = { nickName: '合成授权用户', avatarUrl: 'https://wx.qlogo.cn/mmopen/audit/132' }
const publicProfile = { displayName: raw.nickName, avatarUrl: raw.avatarUrl }
const counts = {}
async function main () {
  const server = relative => import(pathToFileURL(path.join(root, 'work/guandan-windows-source/server', relative)))
  const c = await server('platform/crypto.js'), { normalizeFriendRoomSettings } = await server('friend-room-settings.js')
  const { WxCodeVerifier } = await server('platform/wx-auth.js')
  const accessSecret = 'audit-access-only-not-real-key-00000000000000'
  const ticketSecret = 'audit-ticket-only-not-real-key-00000000000000'
  const resultSecret = 'audit-result-only-not-real-key-00000000000000'
  const spectatorSecret = 'audit-spectator-only-not-real-key-00000000000'
  let clock = 1_700_000_000_000
  const issuer = new c.GameTicketService({ secret:ticketSecret, now:()=>clock, gameEndpoint:'wss://game.invalid/weapp' })
  const verifier = new c.GameTicketVerifier({ secret:ticketSecret, required:true, now:()=>clock })
  const access = new c.AccessTokenService({ secret:accessSecret, now:()=>clock, ttlMs:90000 })
  const accessToken = access.issue('audit-user').accessToken
  assert.equal(access.verify(accessToken).sub,'audit-user')
  assert.throws(()=>verifier.inspect(accessToken),/签名/)
  counts.validTickets=0; counts.ticketRejections=0
  const rejected = fn => { assert.throws(fn); counts.ticketRejections++ }
  let last
  for (const format of ['match','rounds','upgrade','rotating','duplicate']) {
    const seats = format==='duplicate'?9:format==='match'?4:5
    for(let i=1;i<=seats;i++) {
      const observer=i===seats && format!=='match'
      const friend=format!=='match'
      const issued=issuer.issue({userId:'audit-'+format+'-'+i,matchId:'audit-match',roomId:'123456',
        seat:observer?'observer':'p'+i,roomKind:friend?'friend':'match',
        ...(friend?{hostUserId:'audit-host',roomExpiresAt:clock+1800000,roomSettings:normalizeFriendRoomSettings({format,spectator:'live',counterEnabled:false},{strict:true})}:{matchMode:'classic_50'})})
      const claims=verifier.inspect(issued.gameTicket,{roomId:'123456',seat:issued.claims.seat})
      assert.equal(claims.sub,issued.claims.sub)
      if(friend)assert.equal(claims.roomSettings.counterEnabled,false)
      rejected(()=>verifier.inspect(issued.gameTicket,{roomId:'999999'}))
      rejected(()=>verifier.inspect(issued.gameTicket,{seat:'not-seat'}))
      verifier.consume(claims)
      claims.sub='mutated-caller-object'
      assert.equal(verifier.inspectWithConsumptionStatus(issued.gameTicket).claims.sub,issued.claims.sub)
      rejected(()=>verifier.inspect(issued.gameTicket))
      const changed=c.signCompactToken({...issued.claims,sub:'different-bound-user'},ticketSecret)
      rejected(()=>verifier.inspectWithConsumptionStatus(changed))
      counts.validTickets++;last=issued
    }
  }
  // Real signed tokens, corrupted externally; no secret or token is printed.
  for (let i=0;i<last.gameTicket.length;i++) {
    if(last.gameTicket[i]==='.')continue
    const corrupted=last.gameTicket.slice(0,i)+(last.gameTicket[i]==='A'?'B':'A')+last.gameTicket.slice(i+1)
    rejected(()=>verifier.inspectWithConsumptionStatus(corrupted))
  }
  for(const patch of [{kind:'access'},{aud:'wrong'},{seat:'p9'},{roomKind:'invalid'},{purpose:'invalid'},
    {entryAttemptId:'short'},{roomExpiresAt:clock+31*24*3600000},{roomExpiresAt:clock+1000},
    {roomSettings:{...last.claims.roomSettings,unknown:true}},{botUserIdsBySeat:{p2:'bot_a'}},
    {roomSettings:{...last.claims.roomSettings,spectator:'off'}},{exp:Math.floor(clock/1000)},{nbf:Math.floor(clock/1000)+1}]) {
    rejected(()=>verifier.inspectWithConsumptionStatus(c.signCompactToken({...last.claims,...patch},ticketSecret)))
  }
  const expiredLease = issuer.issue({userId:'audit-returning',matchId:'old',roomId:'123456',seat:'p1',roomKind:'friend',
    purpose:'rejoin',roomExpiresAt:clock-1000,roomSettings:normalizeFriendRoomSettings({format:'rounds'},{strict:true})})
  assert.equal(verifier.inspect(expiredLease.gameTicket).purpose,'rejoin')
  // Lease may be old on rejoin; token TTL still expires exactly.
  clock=expiredLease.claims.exp*1000
  rejected(()=>verifier.inspect(expiredLease.gameTicket))
  rejected(()=>access.verify(accessToken))
  counts.signatureCases=0
  for(const [sign,verify,secret,wrong] of [
    [c.gameResultSignature,c.verifyGameResultSignature,resultSecret,spectatorSecret],
    [c.spectatorEventSignature,c.verifySpectatorEventSignature,spectatorSecret,resultSecret]]) {
    const rawBody='{"eventId":"audit-only"}'
    for(const offset of [-300000,0,300000]) {
      const timestamp=String(clock+offset),signature=sign(rawBody,secret,timestamp)
      verify({rawBody,signature,timestamp,secret,now:clock});counts.signatureCases++
      assert.throws(()=>verify({rawBody:rawBody+' ',signature,timestamp,secret,now:clock}));counts.signatureCases++
      assert.throws(()=>verify({rawBody,signature,timestamp,secret:wrong,now:clock}));counts.signatureCases++
    }
    for(const offset of [-300001,300001]) {
      const timestamp=String(clock+offset),signature=sign(rawBody,secret,timestamp)
      assert.throws(()=>verify({rawBody,signature,timestamp,secret,now:clock}));counts.signatureCases++
    }
  }
  counts.wxVerifierCases=0
  for(const scenario of ['valid','bad-code','unconfigured','network','non-ok','bad-json','denied','no-id']) {
    let calls=0
    const v=new WxCodeVerifier({appId:'audit-app',secret:scenario==='unconfigured'?'':'audit-fake-secret',
      fetchImpl:async(url,options)=>{
        calls++;assert.equal(url.hostname,'api.weixin.qq.com');assert.ok(options.signal instanceof AbortSignal)
        if(scenario==='network')throw Error('private injected diagnostic')
        return {ok:scenario!=='non-ok',json:async()=>{
          if(scenario==='bad-json')throw Error('invalid JSON')
          return scenario==='denied'?{errcode:40029}:scenario==='no-id'?{}:{openid:'synthetic',session_key:'must-not-return',unionid:'must-not-return'}
        }}
      }})
    if(scenario==='valid')assert.deepEqual(await v.verify('audit-code'),{externalId:'wx:audit-app:synthetic'})
    else await assert.rejects(v.verify(scenario==='bad-code'?'':'audit-code'),e=>e.status>=400&&!e.message.includes('private injected'))
    if(['bad-code','unconfigured'].includes(scenario))assert.equal(calls,0)
    counts.wxVerifierCases++
  }
  const wxDescriptor=Object.getOwnPropertyDescriptor(globalThis,'wx')
  const setWx=api=>Object.defineProperty(globalThis,'wx',{configurable:true,value:api})
  try {
    counts.cancelledProfileReads=0
    for(const stage of ['privacy','scope','info'])for(const reason of ['cancel','disallow']) {
      let callback,allowed=true,saves=0
      const api={
        getPrivacySetting:cb=>stage==='privacy'?(callback=()=>cb.success({needAuthorization:false})):cb.success({needAuthorization:false}),
        getSetting:cb=>stage==='scope'?(callback=()=>cb.success({authSetting:{'scope.userInfo':true}})):cb.success({authSetting:{'scope.userInfo':true}}),
        getUserInfo:cb=>stage==='info'?(callback=()=>cb.success({userInfo:raw})):cb.success({userInfo:raw}),
        requirePrivacyAuthorize:()=>assert.fail('silent must not prompt'),
      }
      setWx(api)
      const sync=new WechatProfileSync({save:async()=>{saves++}},()=>allowed)
      const pending=sync.run({id:'audit',displayName:'old',avatarUrl:''})
      if(reason==='cancel')sync.cancel();else allowed=false
      callback();await pending;assert.equal(saves,0);counts.cancelledProfileReads++
    }
    let stale
    assert.equal(await readAuthorizedWechatProfile({getPrivacySetting:cb=>{stale=cb},getSetting:()=>assert.fail('late stage'),getUserInfo:()=>assert.fail('late stage')},1),null)
    stale.success({needAuthorization:false})
    counts.nativeControls=0
    for(const action of ['accept','dispose','deny-then-accept']) {
      let tap,destroyed=0,accepted=0,failed=0
      const control=mountWechatProfileButton({createUserInfoButton:()=>({
        onTap:cb=>{tap=cb},offTap:()=>{},destroy:()=>{destroyed++},hide:()=>{},show:()=>{},
      })},{left:0,top:0,width:200,height:40},profile=>{assert.deepEqual(profile,publicProfile);accepted++},()=>{failed++})
      if(action==='dispose')control()
      if(action==='deny-then-accept')tap({errMsg:'getUserInfo:fail auth deny'})
      tap({userInfo:raw});tap({userInfo:raw});control();control()
      assert.equal(accepted,action==='dispose'?0:1);assert.equal(destroyed,1)
      assert.equal(failed,action==='deny-then-accept'?1:0);counts.nativeControls++
    }
    const posts=[],displayed=[];let stored={id:'audit',displayName:'before'},active=0,maxActive=0
    const saves=new ProfileSaveCoordinator({
      getProfile:async()=>({...stored}),
      updateProfile:async change=>{active++;maxActive=Math.max(active,maxActive);await flush();posts.push(change);stored={...stored,...change};active--;return {...stored}},
    },profile=>displayed.push(profile))
    await Promise.all(Array.from({length:40},(_,i)=>saves.save({displayName:'name-'+i},'audit')))
    assert.equal(maxActive,1);assert.equal(posts.length,40);assert.deepEqual(displayed.map(p=>p.displayName),['name-39'])
    counts.orderedProfileSaves=40
    const cloudWrites=[];let hold
    setWx({getPrivacySetting:cb=>{hold=cb},getSetting:cb=>cb.success({authSetting:{'scope.WxFriendInteraction':true}}),
      setUserCloudStorage:cb=>{cloudWrites.push(cb.KVDataList);cb.success({})},
      requirePrivacyAuthorize:()=>assert.fail('silent must not prompt')})
    const scores=new ranking.WechatFriendScoreSync()
    const queued=Array.from({length:40},(_,i)=>scores.publish('audit',1000+i))
    await flush();scores.cancel();hold.success({needAuthorization:false});await Promise.all(queued)
    assert.equal(cloudWrites.length,0);counts.cancelledScoreWrites=40
    setWx({getPrivacySetting:cb=>cb.success({needAuthorization:false}),getSetting:cb=>cb.success({authSetting:{'scope.WxFriendInteraction':true}}),
      setUserCloudStorage:cb=>{cloudWrites.push(cb.KVDataList);cb.success({})}})
    await Promise.all(Array.from({length:40},()=>scores.publish('audit',1500)))
    assert.equal(cloudWrites.length,1);counts.sameScorePublishRequests=40
  } finally {
    if(wxDescriptor)Object.defineProperty(globalThis,'wx',wxDescriptor);else delete globalThis.wx
  }
  console.log(JSON.stringify({counts,boundary:'synthetic signing keys, time and native callbacks; no external WeChat, HTTP listener, user records, Cocos GPU or writes'},null,2))
}
main().catch(error=>{console.error(error);process.exitCode=1})
