// Audit-only: actual presenters/policies/models; synthetic nodes, no HTTP/GPU/write.
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const app = path.resolve(__dirname, '../../../../work/guandan-cocos')
const src = p => path.join(app, 'assets/scripts', p)
const { loadTs } = require(path.join(app, 'tests/support/load-typescript-module.cjs'))
const model = loadTs(src('network/LobbyModels.ts'), {
  './DuplicateRoomModel': loadTs(src('network/DuplicateRoomModel.ts')),
})
// Reuse only the fully-read test's class/compiler setup, not its assertions or async flows.
// Replace its historical default-settings fixture with the CURRENT model default.
const testFile = path.join(app, 'tests/friend-room-settings-presenter-regression.cjs')
let prefix = fs.readFileSync(testFile, 'utf8').split('const pages = []')[0]
assert.ok(prefix.includes('const defaultSettings = Object.freeze({'))
prefix = prefix.replace(/const defaultSettings = Object.freeze\(\{[\s\S]*?\}\)/,
  'const defaultSettings = Object.freeze(' + JSON.stringify(model.DEFAULT_FRIEND_ROOM_SETTINGS) + ')')
const h = new Function('require', '__dirname', prefix + '\nreturn {cc, MockNode, MockRuntimeUiFactory, compile, policy, FriendRoomSettingsPresenter, numberModalModule, formUiModule, uiInstances}')(createRequire(testFile), path.dirname(testFile))
const {cc, MockNode: N, MockRuntimeUiFactory: UI} = h
cc.Label = {HorizontalAlign:{LEFT:'left'}, VerticalAlign:{TOP:'top'}}
N.prototype.removeFromParent = function () { this.parent = null }
N.prototype.addChild = function (node) { node.parent = this }
N.prototype.getComponentInChildren = function () { return this.label || (this.label={string:this.text}) }
const modes=['rounds','upgrade','rotating','duplicate']
const modeLabels=['定局玩法','传统升级','转蛋','复式']
const screen = (width=1280,height=720,left=0,right=0) => {
  const viewport={width,height,halfWidth:width/2,halfHeight:height/2,safeLeft:left,safeRight:right,safeTop:0,safeBottom:0}
  return {viewport,safeSize:()=>({x:viewport.width-viewport.safeLeft-viewport.safeRight,y:viewport.height}),
    safeLeftX:m=>-viewport.width/2+viewport.safeLeft+m,safeRightX:m=>viewport.width/2-viewport.safeRight-m,
    safeTopY:m=>viewport.height/2-m,safeBottomY:m=>-viewport.height/2+m}
}
const walk = root => [root,...root.children.flatMap(walk)]
const buttons = root => walk(root).filter(n=>n.text && n.size && n.handlers)
const click = n => { assert.ok(n); n.emit('touch-end') }
const policy=h.policy
const normalized = loadTs(src('core/generated/lib/matchFormat.ts'))
let choices=0, generations=0, modalCases=0, rulesCases=0
for(const [w,hgt,l,r] of [[1280,720,0,0],[1565,720,32,24],[960,720,0,0],[1280,589,40,40]]) {
  let created=[],joins=[],session=[]
  const router={current:null,currentRoot:null,open(id){this.current=id;this.currentRoot?.destroy();this.currentRoot=new N(id);return {parent:this.currentRoot}}}
  const p=new h.FriendRoomSettingsPresenter({router,screen:screen(w,hgt,l,r),backgroundArt:'synthetic',
    createRoom:v=>created.push(v),joinRoom:v=>joins.push(v),updateSessionSettings:v=>session.push(v),goBack:()=>{router.current='menu'}})
  const find=t=>buttons(router.currentRoot).find(n=>n.text===t)
  p.show()
  assert.equal(p.settings.turnSeconds,20)
  for(let m=0;m<4;m++) {
    click(find(modeLabels[m]))
    assert.equal(p.settings.format,modes[m])
    // All visible schema options must round-trip and yield a valid core rule DTO.
    for(const tab of ['rules','experience']) {
      click(find(tab==='rules'?'基础规则':'体验设置'))
      for(const row of policy.friendRoomChoiceRows(p.settings,tab)) {
        for(const option of row.options) {
          const next=policy.updateFriendRoomChoice(p.settings,row.id,option)
          assert.doesNotThrow(()=>normalized.normalizeRoomFormat(next))
          assert.equal(policy.friendRoomChoiceRows(next,tab).find(x=>x.id===row.id).selected,option)
          choices++
        }
      }
      const scroll=p.scroll; scroll.offset={y:75}; p.show()
      assert.equal(p.scroll.getScrollOffset().y,75,'choice rerender restores offset')
      const old=find('创建房间'); p.show(); click(old); assert.equal(created.length,0)
      generations++
    }
    click(find('创建房间')); assert.equal(created.pop().format,modes[m])
    click(find('基础规则'))
    if(m!==1) {
      click(find('固定级牌'))
      for(let i=0;i<13;i++) {
        p.setSettings(policy.updateFriendRoomLevel(p.settings,i))
        assert.equal(p.settings.levelRank,normalized.MATCH_LEVELS[i])
        assert.ok(walk(router.currentRoot).some(n=>n.text===String(normalized.MATCH_LEVELS[i])))
      }
    }
  }
  const old=find('创建房间'); p.hide();click(old);assert.equal(created.length,0)
  p.show();assert.equal(p.settings.format,'duplicate')
  p.dispose();p.show();assert.equal(p.disposed,true)
}
for(const inputText of ['000000','012345','999999',' 123456 ', '', '12345','1234567','12345x','１２３４５６','123\n456','123456.token']) {
  const parent=new N('NumberParent'), joined=[],sc=screen()
  h.numberModalModule.showFriendRoomNumberModal(parent,sc,x=>joined.push(x))
  h.numberModalModule.showFriendRoomNumberModal(parent,sc,()=>assert.fail('duplicate modal'))
  assert.equal(parent.children.length,1)
  const panel=walk(parent).find(n=>n.name==='RoomNumberPanel'), input=walk(panel).find(n=>n.input)?.input
  input.string=inputText
  const join=buttons(panel).find(n=>n.text==='加入')
  click(join);input.node.emit('editing-return');click(join)
  assert.equal(joined.length,/^\d{6}$/.test(inputText.trim())?1:0)
  if(joined.length)assert.equal(joined[0],inputText.trim())
  else {
    input.string='123456';input.node.emit('text-changed')
    click(buttons(panel).find(n=>n.text==='取消'));click(join);assert.equal(joined.length,0)
  }
  modalCases++
}
const variant=loadTs(src('core/generated/lib/variantRules.ts'),{'./matchFormat':normalized})
const content=loadTs(src('scenes/front-pages/FriendRoomRuleContent.ts'),{'../../core/generated/lib/variantRules':variant})
const rules=loadTs(src('scenes/front-pages/FriendRoomRulesModal.ts'),{
  cc,'../../ui/RuntimeUiFactory':{RuntimeUiFactory:UI},'./FriendRoomFormUi':h.formUiModule,'./FriendRoomRuleContent':content,
})
for(const [w,height] of [[1280,720],[1565,720],[960,720],[1280,589]]) {
  const parent=new N('RulesParent'),sc=screen(w,height)
  rules.showFriendRoomRulesModal(parent,sc,'rounds')
  rules.showFriendRoomRulesModal(parent,sc,'duplicate')
  assert.equal(parent.children.length,1)
  const panel=walk(parent).find(n=>n.name==='RulesPanel')
  for(let i=0;i<4;i++) {
    click(buttons(panel).find(n=>n.text===modeLabels[i]))
    assert.equal(walk(panel).filter(n=>n.name==='RulesBody').length,1)
    const c=walk(panel).find(n=>n.name==='FriendSettingsScrollContent')
    assert.ok(c.components.get(cc.UITransform).contentSize.height>0)
    const expected=content.friendRuleSections(modes[i]).flatMap(s=>s.rows||[])
    const rows=walk(c).filter(n=>n.name==='RulesScoreRow')
    if(modes[i]==='duplicate')assert.equal(expected.length,3)
    if(modes[i]==='rotating')assert.equal(expected.length,6)
    for(const n of walk(c).filter(n=>n.name==='OutlinedLabel')){
      const end=-n.position.y+(n.style.height||0)/2
      assert.ok(end<=c.components.get(cc.UITransform).contentSize.height,'content container accounts for lowest text row')
    }
    assert.equal(rows.length,modes[i]==='duplicate'?4:modes[i]==='rotating'?8:0)
    rulesCases++
  }
  const stale=buttons(panel).find(n=>n.text==='复式')
  click(buttons(panel).find(n=>n.text==='关闭'));click(stale);assert.equal(parent.children.length,0)
}
const duplicateView=loadTs(src('scenes/front-pages/DuplicateRoomWaitingView.ts'),{
  cc,'../../ui/RuntimeUiFactory':{RuntimeUiFactory:UI},'./FriendRoomRulesModal':rules,
  '../../services/DefaultProfileFrames':{defaultProfileAsset:()=>undefined},
})
const dupModel=loadTs(src('network/DuplicateRoomModel.ts'))
const summary=(mySeat='p1')=>({
  phase:'playing',mySeat,watching:null,round:2,configuredRounds:4,scores:{red:3,blue:1},ready:false,canStart:false,
  tables:{A:'settled',B:'playing'},history:[{round:1,red:3,blue:1}],
  slots:Array.from({length:8},(_,i)=>({seat:'p'+(i+1),table:i<4?'A':'B',direction:['南','东','北','西'][i%4],
    team:(i<4?i%2===0:i%2!==0)?'red':'blue',name:'合成'+i,occupied:true,ready:false,bot:false,online:true,host:i===0})),
})
let normalizations=0
for(const id of [null,...Array.from({length:8},(_,i)=>'p'+(i+1))]) {
  const v=summary(id),out=dupModel.normalizeDuplicateRoom(v)
  assert.ok(out);assert.notEqual(out,v);out.slots[0].name='changed';assert.notEqual(v.slots[0].name,'changed');normalizations++
}
for(const mutate of [
  d=>d.slots.pop(),d=>d.slots[7].seat='p1',d=>d.scores.red=-1,d=>d.configuredRounds=33,d=>d.mySeat='p9',
  d=>d.watching='C',d=>d.slots[0].occupied='yes',d=>d.tables.A='tribute',d=>d.history[0].red=7,
]) {const d=summary();mutate(d);assert.equal(dupModel.normalizeDuplicateRoom(d),null);normalizations++}
const status=loadTs(src('scenes/DuplicateTableStatusView.ts'),{
  cc,'../ui/RuntimeUiFactory':{RuntimeUiFactory:UI},'./front-pages/DuplicateRoomWaitingView':duplicateView,
})
const resizeResults=[]
for(const mySeat of ['p1','p3',null]) {
  const sc=screen(1565,720),parent=new N('TableHudRoot'),calls=[],snap={duplicate:summary(mySeat)}
  status.renderDuplicateTableStatus(parent,sc,{sendRoomIntent:(...v)=>calls.push(v)},snap)
  const root=parent.getChildByName('DuplicateTableStatus'),b=buttons(root)[0],oldX=b.position.x
  sc.viewport.width=960;sc.viewport.halfWidth=480
  status.renderDuplicateTableStatus(parent,sc,{sendRoomIntent:()=>{}},{duplicate:structuredClone(snap.duplicate)})
  assert.equal(parent.getChildByName('DuplicateTableStatus'),root)
  assert.equal(b.position.x,oldX)
  assert.ok(b.position.x-b.size.width/2>480,'button is fully beyond the new right edge')
  snap.duplicate.ready=true // changing relevant snapshot makes the existing cache rebuild
  status.renderDuplicateTableStatus(parent,sc,{sendRoomIntent:()=>{}},snap)
  const corrected=buttons(parent.getChildByName('DuplicateTableStatus'))[0]
  assert.equal(corrected.position.x,sc.safeRightX(140))
  resizeResults.push({mySeat,staleX:oldX,expectedX:corrected.position.x})
}
const presentation=loadTs(src('scenes/DuplicateTablePresentation.ts'))
const tablePresentation=loadTs(src('scenes/TableSnapshotPresenter.ts'))
const {TableHudPresenter}=loadTs(src('scenes/TableHudPresenter.ts'),{
  cc:{},'../ui/TableTributeInfoView':{tributeInfoText:()=>''},
  '../game/PublicStraightFlushPossibility':{publicStraightFlushPossibleSuits:()=>[]},'../services/GameAssetLoader':{},
  '../ui/ClassicCardFrameStore':{},'../ui/TableGameHud':{TABLE_GAME_HUD_COUNTER_RANKS:['2','3','4','5','6','7','8','9','10','J','Q','K','A','小王','大王']},
  './TableSnapshotPresenter':tablePresentation,'./DuplicateTablePresentation':presentation,
  '../services/DefaultProfileFrames':{defaultProfileFrame:()=>null},
})
const scoreResults=[]
for(const format of ['duplicate','rotating']) for(const visibility of ['hidden','live']) {
  const config=policy.updateFriendRoomChoice(policy.changeFriendRoomFormat(policy.createDefaultFriendRoomSettings(),format),'score-visibility',visibility==='hidden'?'结算显示':'实时显示')
  assert.equal(config.scoreVisibility,visibility)
  const ids=['p1','p2','p3','p4'],d=summary()
  d.tables.A='playing'
  const lobby={roomId:'123456',roomRole:'player',lobbyReadyRequired:true,roomSettings:config,members:ids,duplicate:format==='duplicate'?d:null}
  let rendered
  const presenter=new TableHudPresenter({lobbySnapshot:()=>lobby,isMultiplayer:()=>true,turnClock:()=>null})
  presenter.tableHud={render:v=>{rendered=v}}
  const state={turnOrder:ids,players:Object.fromEntries(ids.map((id,i)=>[id,{name:id,hand:[{rank:2,suit:['heart','club','spade','diamond'][i]}],team:i%2?'teamB':'teamA'}])),
    finishedPlayers:[],currentLevel:2,currentTurn:'p1',playArea:[],ruleProfile:{allowA2345Straight:true},
    matchFormat:{kind:format==='duplicate'?'independent':'rotating',levelMode:'fixed',rotatingScoring:3},playerScores:{p1:3}}
  presenter.render({state,phase:'playing',teamLevels:{teamA:2,teamB:2}},'p1',{availableSuits:[],selectedSuit:null})
  assert.equal(/红 3 : 蓝 1/.test(rendered.levelLabel),format==='duplicate')
  if(format==='rotating')assert.equal(rendered.levelLabel.includes('我的积分'),visibility==='live')
  scoreResults.push({format,visibility,label:rendered.levelLabel})
}
console.log(JSON.stringify({choices,generations,modalCases,rulesCases,normalizations,resizeResults,scoreResults},null,2))
