// Regression: actual lobby and identity presenter; renderer/network are isolated ports.
const assert = require('node:assert/strict')
const path = require('node:path')
const app = path.resolve(__dirname, '..')
const { loadTs } = require(path.join(app,'tests/support/load-typescript-module.cjs'))
const file = relative => path.join(app,'assets/scripts',relative)
class Color { constructor(...values){this.values=values} }
class Vec3 { constructor(x,y,z){Object.assign(this,{x,y,z})} }
class UITransform { setContentSize(width,height){Object.assign(this,{width,height})} }
class Node {
  static EventType={TOUCH_END:'touch-end'}
  isValid=true; active=true; nodes=[]; children=[]; components=new Map(); events={}
  constructor(name='node'){this.name=name}
  set parent(p){this._parent=p;p.nodes?.push(this);p.children?.push(this)}
  get parent(){return this._parent}
  setPosition(value){this.position=value}
  on(name,cb){this.events[name]=cb}
  addComponent(Type){const c=new Type();this.components.set(Type,c);return c}
  getComponent(Type){return this.components.get(Type)}
  pauseSystemEvents(){} resumeSystemEvents(){}
}
const cc={Color,Node,UITransform,Vec3,Label:{HorizontalAlign:{LEFT:0},Overflow:{SHRINK:2}},
  tween:()=>{const t={delay:()=>t,to:()=>t,start:()=>t};return t}}
const data=loadTs(file('services/DataSnapshot.ts'))
const {FrontPagePlayerState}=loadTs(file('scenes/front-pages/FrontPagePlayerState.ts'),{'../../services/DataSnapshot':data})
const {FrontPageWalletState}=loadTs(file('scenes/front-pages/FrontPageWalletState.ts'))
const layout=loadTs(file('ui/LobbyLayoutPolicy.ts'))
const modes=loadTs(file('core/generated/lib/classicModes.ts'))
const catalog=loadTs(file('scenes/front-pages/LobbyPageCatalog.ts'),{cc,'../../core/generated/lib/classicModes':modes})
const label=(ui,text,x,y,size,width,s,parent)=>ui.outlinedLabel(text,x,y,size*s,{width})
const {LobbyPlayerProfilePresenter}=loadTs(file('scenes/front-pages/LobbyPlayerProfilePresenter.ts'),{
  cc,'../../ui/LobbyMenuView':{lobbyLabel:label},'./LobbyPageCatalog':catalog,'../../ui/ProfileAvatar':{mountProfileAvatar:()=>{}},
})
class SettingsPresenter {
  constructor(deps){this.deps=deps}
  show(){this.deps.router.open('friend-room-settings')}
  hide(){}dispose(){}
}
class EmptyFlow { snapshot={busy:null,entry:null};leave(){}destroy(){} }
class EmptyInvite {activate(){}dispose(){}}
const {LobbyPageDomain}=loadTs(file('scenes/front-pages/LobbyPageDomain.ts'),{
  cc,'../../ui/LobbyLayoutPolicy':layout,'../../ui/LobbyMenuView':{lobbyLabel:label,renderLobbyEntries:()=>{},renderLobbyShop:()=>{}},
  '../../ui/LobbyAmbientMotion':{attachLobbyAmbientMotion:()=>{}},'./FriendRoomSettingsPresenter':{FriendRoomSettingsPresenter:SettingsPresenter},
  './FriendRoomPlatformFlow':{FriendRoomPlatformFlow:EmptyFlow},'./FriendRoomWaitingPresenter':{FriendRoomWaitingPresenter:class{}},
  '../../services/WechatFriendInvite':{WechatFriendInvite:EmptyInvite},'./LobbyPlayerProfilePresenter':{LobbyPlayerProfilePresenter},
  './LobbyPageCatalog':catalog,'../../core/generated/lib/classicModes':modes,
})
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail});return {promise,resolve,reject}}
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve()}
function fixture(){
  const dashboard=deferred(),wallet=deferred(),timers=[]
  let pageToken=0,disposed=false,requests=0,currentUi,rendered=0
  const player=new FrontPagePlayerState(true,null),walletState=new FrontPageWalletState(true)
  const router={current:null,open(route){
    this.current=route;rendered++
    const parent=new Node('ui'),labels=[]
    const node=name=>{const n=new Node(name);n.parent=parent;n.addComponent(UITransform);return n}
    currentUi={parent,labels,panel:name=>node(name),button:name=>node(name),image:()=>{},imageCard:name=>node(name),
      outlinedLabel:(string,x,y,size,style)=>{const l={string,node:node('label'),...style};labels.push(l);return l}}
    return currentUi
  }}
  const session={snapshot:{status:'menu',settings:{effectQuality:'off'}},leaveToMenu(){this.snapshot.status='menu'}}
  const dependencies={router,session,lobby:{snapshot:{recoveryAvailable:false}},screen:{
    safeSize:()=>({x:1280,y:720}),safeLeftX:m=>-640+m,safeRightX:m=>640-m,safeTopY:m=>360-m,safeBottomY:m=>-360+m},
    gateways:{configured:true,auth:{},friendRooms:{},playerCenter:{getDashboard:()=>{requests++;return dashboard.promise}},wallet:{getWallet:()=>wallet.promise}},
    player,wallet:walletState,isDisposed:()=>disposed,issuePageRequest:()=>++pageToken,currentPageRequest:()=>pageToken,
    invalidateMatchAttempt:()=>{},closeModal:()=>{},setTableVisible:()=>{},setFriendRoomWaitingVisible:()=>{},
    scheduleOnce:(cb,delay)=>{assert.equal(delay,0);timers.push(cb)},getLobbyEndpoint:()=>'',showNotice:()=>{},showCompetition:()=>{},
    showPlayerCenter:()=>{},editProfile:()=>{},showShop:()=>{},beginMatch:()=>{},profileLoaded:()=>{},
  }
  const domain=new LobbyPageDomain(dependencies)
  return {domain,router,player,walletState,dashboard,wallet,timers,
    get requests(){return requests},get rendered(){return rendered},get labels(){return currentUi.labels.map(l=>l.string)},
    destroy(){disposed=true;domain.destroy()},
  }
}
const confirmed={user:{id:'audit',accountId:'12345678',displayName:'已同步用户',avatarUrl:'',comprehensiveScore:1234,profileSource:'generated'}}
async function settle(h,order){
  const steps={dashboard:()=>h.dashboard.resolve(confirmed),wallet:()=>h.wallet.resolve({points:5200,diamonds:0})}
  for(const item of order){steps[item]();await flush()}
}
async function main(){
  const cases=[]
  for(const route of ['settings','classic'])for(const order of [['dashboard','wallet'],['wallet','dashboard']]){
    const h=fixture();h.domain.showMenu();assert.ok(h.labels.includes('账号同步中'))
    if(route==='settings')h.domain.showFriendRoomSettings();else h.domain.showClassicRooms()
    h.domain.showMenu();const before=h.rendered
    assert.equal(h.requests,1,'pending old load suppresses new load')
    await settle(h,order)
    assert.equal(h.router.current,'menu');assert.equal(h.player.dashboard.user.displayName,'已同步用户')
    assert.equal(h.walletState.fresh,true);assert.equal(h.walletState.value.points,5200)
    assert.equal(h.rendered,before+1,'the current menu subscribes to the in-flight dashboard')
    assert.ok(h.labels.includes('已同步用户'));assert.ok(h.labels.includes('5200'))
    h.timers.splice(0).forEach(cb=>cb());await flush()
    assert.ok(h.labels.includes('已同步用户'),'scheduled invite activation preserves the refreshed identity')
    h.domain.reflow()
    assert.ok(h.labels.includes('已同步用户'));assert.ok(h.labels.includes('5200'))
    cases.push({route,order,storedFresh:true,visibleFresh:true,manualReflowRecovers:true});h.destroy()
  }
  const direct=fixture();direct.domain.showMenu();await settle(direct,['wallet','dashboard'])
  assert.ok(direct.labels.includes('已同步用户'));assert.ok(direct.labels.includes('5200'));direct.destroy()
  const departed=fixture();departed.domain.showMenu();departed.domain.showFriendRoomSettings()
  await settle(departed,['dashboard','wallet']);assert.equal(departed.router.current,'friend-room-settings');departed.destroy()
  for (const failedPart of ['dashboard','wallet','both']) {
    const h=fixture();h.domain.showMenu();h.domain.showClassicRooms();h.domain.showMenu()
    const before=h.rendered
    if(failedPart==='wallet')h.dashboard.resolve(confirmed);else h.dashboard.reject(new Error('offline'))
    if(failedPart==='dashboard')h.wallet.resolve({points:5200,diamonds:0});else h.wallet.reject(new Error('offline'))
    await flush()
    assert.equal(h.rendered,before+1,'failure also reflows the subscribing menu')
    assert.equal(h.player.loading,false);assert.ok(!h.labels.includes('账号同步中'))
    assert.equal(h.walletState.fresh,failedPart==='dashboard');h.destroy()
  }
  const destroyed=fixture();destroyed.domain.showMenu();destroyed.destroy();const before=destroyed.rendered
  await settle(destroyed,['wallet','dashboard']);assert.equal(destroyed.rendered,before,'destroyed menu cannot repaint')
  console.log(JSON.stringify({cases,normalMenuControl:true,noRouteStealControl:true,
    failureCases:3,destroyedOwnerControl:true,
    boundary:'actual domain renderMenu and profile/state classes; renderer/network/invite/native hosts inert, no external calls or GPU'},null,2))
}
main().catch(e=>{console.error(e);process.exitCode=1})
