const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTs } = require('./support/load-typescript-module.cjs')
const root = path.resolve(__dirname, '../assets/scripts')
const load = (file, imports) => loadTs(path.join(root, file), imports)
const layoutPolicy = load('ui/LobbyLayoutPolicy.ts')
const policy = load('ui/LobbyServicePolicy.ts', { './LobbyLayoutPolicy': layoutPolicy, './WechatCapsuleLayout': load('ui/WechatCapsuleLayout.ts') })
const { openLobbyService } = load('scenes/front-pages/LobbyServiceActions.ts')
const { LOBBY_SERVICES, lobbyServiceRects } = policy
assert.equal(LOBBY_SERVICES.length, 7)
assert.equal(new Set(LOBBY_SERVICES.map(s => s.id)).size, 7)
assert.ok(!LOBBY_SERVICES.some(s => /shop|商城|更多|设置/.test(s.id + s.label)))
assert.ok(LOBBY_SERVICES.every(s => !('pending' in s)))
assert.equal(LOBBY_SERVICES[4].x - LOBBY_SERVICES[3].x, 60)
const overlap = (a, b) => Math.abs(a.x - b.x) < (a.width + b.width) / 2 && Math.abs(a.y - b.y) < (a.height + b.height) / 2
for (const [width, height] of [[740, 360], [874, 402], [1280, 720], [1600, 720]]) {
  const layout = layoutPolicy.resolveLobbyLayout({ width, height, left: -width/2, right: width/2, top: height/2, bottom: -height/2 })
  const capsule = { left: width/2 - 220, right: width/2, top: height/2, bottom: height/2 - 90 }
  for (const exclusion of [undefined, capsule]) {
    const entries = lobbyServiceRects(layout, exclusion)
    const dock = [layout.shop, ...entries.filter(entry => entry.row === 'bottom')]
    const bottom = layout.point(0, layoutPolicy.LOBBY_BOTTOM_DOCK.bottom).y
    dock.forEach((entry, index) => {
      assert.ok(Math.abs(entry.y - entry.height/2 - bottom) < 1e-8, 'all dock hitboxes share a lower edge')
      const fontSize = index === 0 ? layoutPolicy.LOBBY_DESIGN.shopFontSize : 12
      const labelBottom = entry.y + layoutPolicy.lobbyDockLabelY(entry.height/layout.scale, fontSize)*layout.scale - (fontSize+4)*layout.scale/2
      assert.ok(Math.abs(labelBottom-layout.point(0, layoutPolicy.LOBBY_BOTTOM_DOCK.labelBottom).y) < 1e-8, 'shop and service label bottoms align')
      if (index) assert.ok(Math.abs(entry.x-entry.width/2-(dock[index-1].x+dock[index-1].width/2)-8*layout.scale)<1e-8, 'compact 8px gap')
    })
    entries.forEach((a, i) => {
      assert.ok(a.width >= 44 && a.height >= 44)
      for (const b of entries.slice(i+1)) assert.ok(!overlap(a, b), `${a.id}/${b.id}`)
      for (const key of ['classic', 'friend', 'tournament', 'quick', 'account', 'shop']) assert.ok(!overlap(a, layout[key]), `${a.id}/${key}`)
      assert.ok(a.x-a.width/2 >= -width/2 && a.x+a.width/2 <= width/2)
      assert.ok(a.y-a.height/2 >= -height/2 && a.y+a.height/2 <= height/2)
      if (exclusion) assert.ok(!overlap(a, {x:(capsule.left+capsule.right)/2,y:(capsule.top+capsule.bottom)/2,width:capsule.right-capsule.left,height:capsule.top-capsule.bottom}))
    })
  }
}
async function testActions() {
const { HttpLobbyServiceGateway } = load('services/platform/lobbyServiceGateway.ts', {
  './validation': { requireRecord: value=>{if(!value || typeof value!=='object')throw Error('bad');return value}, malformedResponse: text=>Error(text),
    positiveInteger:value=>{assert.ok(Number.isInteger(value)&&value>0);return value}, nonNegativeInteger:value=>{assert.ok(Number.isInteger(value)&&value>=0);return value} },
})
let response={id:'membership',status:'closed',title:'服务端会员通知',detail:'服务端动态内容',version:1,updatedAt:0}, requestedPath
const gateway=new HttpLobbyServiceGateway({requestPublic:async path=>{requestedPath=path;return response}})
assert.deepEqual(await gateway.getNotice('membership'),response)
assert.equal(requestedPath,'/api/v1/lobby/services/membership')
for (const bad of [null,{}, {title:'',detail:''}, {title:'正常',detail:42}, {title:'x'.repeat(41),detail:''}]) {
  response=bad
  await assert.rejects(gateway.getNotice('messages'))
}
const calls = [], notices = [], shares = []
let context = 1
const actions = {showTasks:()=>calls.push('tasks'),showRecords:()=>calls.push('records'),showRanking:()=>calls.push('ranking'),showMessages:()=>calls.push('messages'),showFeedback:()=>calls.push('feedback'),showNotice:(...args)=>notices.push(args),context:()=>context,
  loadNotice:async id=>({id,status:'closed',title:`服务端-${id}`,detail:'服务端说明',version:1,updatedAt:0})}
for (const id of ['tasks', 'records', 'ranking']) await openLobbyService(id, actions)
assert.deepEqual(calls, ['tasks', 'records', 'ranking'])
for (const id of ['messages', 'feedback', 'membership']) await openLobbyService(id, actions)
assert.deepEqual(notices, ['messages','feedback','membership'].map(id=>[`服务端-${id}`,'服务端说明']))
actions.loadNotice=async id=>({id,status:'open',title:`服务端-${id}`,detail:'服务端说明',version:2,updatedAt:0})
for (const id of ['messages','feedback','membership']) await openLobbyService(id,actions)
assert.deepEqual(calls,['tasks','records','ranking','messages','feedback'],'only open implemented features route to pages')
assert.deepEqual(notices.at(-1),['服务端-membership','服务端说明'],'membership stays notice-only even with an invalid server open state')
actions.loadNotice=async id=>({id,status:'maintenance',title:'维护中',detail:'请稍后',version:3,updatedAt:0})
await openLobbyService('feedback',actions)
assert.deepEqual(notices.at(-1),['维护中','请稍后'])
await openLobbyService('share', actions, {})
assert.match(notices.at(-1)[0], /微信小游戏/)
await openLobbyService('share', actions, {shareAppMessage:options=>shares.push(options)})
assert.equal(shares.length, 1)
assert.equal(shares[0].query, '', 'lobby share cannot leak a room invitation or signed ticket')
assert.equal(shares[0].imageUrl, 'friend-room-share.jpg')
assert.ok(!notices.some(n => /分享成功/.test(n[0])), 'opening a share sheet does not confirm delivery')
await openLobbyService('share', actions, {shareAppMessage:()=>{throw Error('bridge unavailable')}})
assert.match(notices.at(-1)[0], /暂时无法/)
let resolveNotice, requests=0
actions.loadNotice=()=>{requests++;return new Promise(resolve=>{resolveNotice=resolve})}
const count=notices.length
const pending=openLobbyService('membership',actions)
await openLobbyService('membership',actions)
assert.equal(requests,1,'rapid taps are coalesced')
context++
resolveNotice({title:'stale',detail:''})
await pending
assert.equal(notices.length,count,'late response after navigation is ignored')
actions.loadNotice=async()=>{throw Error('网络不可用')}
await openLobbyService('messages',actions)
assert.deepEqual(notices.at(-1),['暂时无法获取服务信息','网络不可用'])
context=null
await openLobbyService('messages',actions)
assert.equal(notices.length,count+1)
}

class Node {
  constructor(name) {this.name=name;this.children=[]}
  set parent(p) {p.children.push(this)}
  setPosition(p) {this.position=p}
  addComponent(Type) {return new Type()}
}
class UITransform {setContentSize(){}}
class Color {constructor(...rgba){this.rgba=rgba}}
class Vec3 {constructor(x,y,z){Object.assign(this,{x,y,z})}}
const rendered = [], labels = [], badges = [], labelStyles = []
class RuntimeUiFactory {
  constructor(parent){this.parent=parent}
  panel(name){const node=new Node(name);badges.push(node);return node}
  makeInteractive(node, action){rendered.push({node,action})}
}
const { renderLobbyServices } = load('ui/LobbyServiceView.ts', {
  cc:{Node,UITransform,Color,Vec3}, './RuntimeUiFactory':{RuntimeUiFactory},
  './LobbyLayoutPolicy':layoutPolicy,
  './LobbyMenuView':{lobbyLabel:(_ui,text,_x,_y,_size,_width,_scale,_parent,color,outline)=>{
    labels.push(text); const label={text,color,outline}; labelStyles.push(label); return label
  }}, './LobbyServicePolicy':policy,
  './LobbyServiceIcons':{drawLobbyServiceIcon(){}},
})
const parent = new Node('root'), selected=[]
renderLobbyServices(new RuntimeUiFactory(parent),layoutPolicy.resolveLobbyLayout({width:874,height:402,left:-437,right:437,top:201,bottom:-201}),id=>selected.push(id))
assert.equal(rendered.length, 7); assert.equal(badges.length, 0)
for (const entry of rendered) entry.action()
assert.deepEqual(selected, LOBBY_SERVICES.map(s=>s.id))
assert.equal(labels.filter(s=>s==='未开放').length,0)
for (const label of labelStyles.filter(l=>l.text!=='未开放')) {
  assert.deepEqual(label.color.rgba, [35,72,92], 'service text uses approved #23485C')
  assert.equal(label.outline, .45, 'no heavy dark text outline')
  assert.deepEqual(label.outlineColor.rgba, [255,249,232,140])
}
for (const label of labelStyles.filter(l=>l.text==='未开放')) assert.deepEqual(label.color.rgba,[73,94,104])
// Official sprites replace the retired hand-drawn Graphics renderer.
const artwork = []
const { drawLobbyServiceIcon } = load('ui/LobbyServiceIcons.ts', {
  './LobbyMenuView': { lobbyArtwork: (...args) => artwork.push(args) },
})
const iconSource = fs.readFileSync(path.join(root, 'ui/LobbyServiceIcons.ts'), 'utf8')
assert.doesNotMatch(iconSource, /\bGraphics\b|polygon\(|lineTo\(/)
for (const service of LOBBY_SERVICES) {
  drawLobbyServiceIcon(parent, service.id, 2)
  const [owner, name, asset, rect] = artwork.at(-1)
  assert.equal(owner, parent)
  assert.equal(name, 'ServiceIcon')
  assert.equal(asset, `ui/lobby-services/${service.id}/texture`)
  assert.deepEqual(rect, { x:0, y:16, width:72, height:72 })
  const file = path.join(__dirname, '../assets/game-assets/ui/lobby-services', service.id + '.png')
  const png = fs.readFileSync(file)
  assert.equal(png.subarray(1,4).toString(), 'PNG')
  assert.equal(png.readUInt32BE(16), 128)
  assert.equal(png.readUInt32BE(20), 128)
  const meta = JSON.parse(fs.readFileSync(file + '.meta', 'utf8'))
  assert.equal(meta.userData.hasAlpha, true)
  assert.equal(meta.subMetas['6c48a'].importer, 'texture')
}
assert.match(fs.readFileSync(path.join(__dirname, '../third_party/assets/phosphor-lobby/LICENSE'), 'utf8'), /MIT License/)
testActions().then(()=>console.log('Lobby services: compact geometry, no badges, server notices, stale/duplicate requests and live routing passed')).catch(error=>{console.error(error);process.exitCode=1})
