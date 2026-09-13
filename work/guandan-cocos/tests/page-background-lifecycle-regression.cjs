// Regression: actual page controllers/model/reducer; synthetic ports, no network or GPU.
'use strict'
const assert = require('node:assert/strict')
const path = require('node:path')
const app = path.resolve(__dirname, '..')
const { loadTs } = require(path.join(app, 'tests/support/load-typescript-module.cjs'))
const src = p => path.join(app, 'assets/scripts', p)
const model = loadTs(src('scenes/front-pages/TournamentCenterModel.ts'))
const replay = loadTs(src('replay/ReplayTimeline.ts'))
const viewpoints = loadTs(src('ui/ReplayViewpoint.ts'))
const flush = async () => { for (let i=0;i<30;i++) await Promise.resolve() }
const defer = () => { let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject} }
const cup = {id:'audit-cup',name:'合成赛事',entryPoints:0,enrolled:false,queueId:'lingshui_16_cup',status:'open',format:'fixed16-latin-3',capacity:16,roundsTotal:3}
const initial = {tournament:cup,phase:'check-in',capacity:16,checkedInCount:0,roundNumber:0,roundsTotal:3,tablesTotal:4,tablesSettled:0,cutoffRank:8,viewerEntry:{enrolled:false,checkedIn:false,rosterLocked:false},assignment:null}
function tournamentFixture() {
  let current=structuredClone(initial), lists=0, writes=0, entered=0, last,actions
  const pending=[],timers=[],calls=[],router={current:null,open(id){this.current=id;return {}}}
  const {TournamentCenterController}=loadTs(src('scenes/front-pages/TournamentCenterController.ts'),{
    './TournamentCenterModel':model,
    './TournamentCenterView':{renderTournamentCenter:(_ui,_vp,v,a)=>{last=structuredClone(v);actions=a;calls.push(last)}},
  })
  const controller=new TournamentCenterController({
    router,screen:{viewport:{width:1280,height:589}},isDisposed:()=>false,
    scheduleOnce:(cb,delay)=>{assert.equal(delay,1);timers.push(cb)},
    showMenu:()=>{router.current='menu'},setTableVisible:()=>{},enter:()=>{entered++;router.current='matching'},
    gateways:{configured:true,tournaments:{
      listTournaments:()=>{lists++;return pending.length?pending.shift():Promise.resolve([cup])},
      getState:async()=>structuredClone(current),
      getStandings:async()=>({tournament:cup,standings:[],provisional:true,cutoffRank:8,viewerStanding:null}),
      enroll:async()=>{writes++;current.viewerEntry.enrolled=true},
      checkIn:async()=>{writes++;current.viewerEntry.checkedIn=true},
      withdraw:async()=>{writes++;current.viewerEntry.enrolled=false},
    }},
  })
  return {controller,router,pending,timers,calls,set current(v){current=v},
    get last(){return last},get actions(){return actions},get writes(){return writes},get lists(){return lists},get entered(){return entered}}
}
async function tournaments() {
  let cases=0
  for(const staleOutcome of ['resolve','reject']) {
    const h=tournamentFixture(),old=defer()
    h.pending.push(old.promise);h.controller.open();await flush()
    h.controller.suspend();h.router.current='menu'
    h.current={...structuredClone(initial),phase:'finished'}
    h.controller.open();await flush()
    assert.equal(h.last.state.phase,'finished')
    const renders=h.calls.length
    if(staleOutcome==='resolve')old.resolve([cup]);else old.reject(new Error('stale'))
    await flush()
    assert.equal(h.calls.length,renders);assert.equal(h.last.error,'')
    assert.equal(h.lists,2);assert.equal(h.writes,0)
    assert.equal(h.timers.length,1,'only current generation schedules next poll')
    h.controller.destroy();h.timers.splice(0).forEach(cb=>cb());await flush()
    assert.equal(h.lists,2);cases++
  }
  for(const locked of [false,true]) {
    const h=tournamentFixture()
    h.current={...structuredClone(initial),viewerEntry:{enrolled:true,checkedIn:true,rosterLocked:false}}
    h.controller.open();await flush()
    const poll=defer();h.pending.push(poll.promise);h.timers.shift()();await flush()
    h.actions.withdraw();h.actions.withdraw()
    assert.equal(h.writes,0,'tap waits for authoritative poll')
    if(locked)h.current={...structuredClone(initial),phase:'round-active',viewerEntry:{enrolled:true,checkedIn:true,rosterLocked:true}}
    poll.resolve([cup]);await flush()
    assert.equal(h.writes,locked?0:1);h.controller.destroy();cases++
  }
  const h=tournamentFixture()
  h.controller.open();await flush()
  for(let i=0;i<30;i++){h.timers.shift()();await flush()}
  assert.equal(h.lists,31);assert.equal(h.calls.length,3,'unchanged polls do not recreate UI')
  h.controller.destroy();cases++
  return {controllerCases:cases,unchangedPolls:30}
}
function timelineProperties() {
  let seed=314159, comparisons=0
  const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
  const shuffle=a=>{const b=[...a];for(let i=b.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[b[i],b[j]]=[b[j],b[i]]}return b}
  for(let trial=0;trial<80;trial++){
    const events=[]
    for(let round=1;round<=3;round++){
      events.push({sequence:events.length+1,at:events.length*100,type:'round-start',roundSequence:round})
      for(let n=0;n<20;n++)events.push({sequence:events.length+1,at:events.length*100,type:n%3?'play':'pass',roundSequence:round,playerId:'p'+(n%4+1),
        ...(n%3?{cards:[{rank:String(2+n%9),suit:'club'}],playType:'Single',automatic:n%2===0}:{automatic:false})})
      events.push({sequence:events.length+1,at:events.length*100,type:'round-end',roundSequence:round,ranking:['p1','p3','p2','p4'],winnerTeam:'teamA',isGameWon:round===3})
    }
    const input=shuffle([...events,...events.filter((_,i)=>i%3===0)])
    const frozen=JSON.stringify(input),full=new replay.ReplayTimeline(input),live=new replay.ReplayTimeline([])
    for(const batch of [input.slice(0,20),input.slice(20,55),input.slice(55)])live.merge(batch)
    assert.equal(JSON.stringify(input),frozen)
    assert.equal(live.eventCount,events.length)
    for(let i=0;i<events.length;i++){
      full.seek(i);live.seek(i)
      assert.deepEqual(live.state,full.state)
      assert.deepEqual(full.state,replay.reduceReplayState(input,i))
      assert.ok(Object.isFrozen(full.state));assert.ok(Object.isFrozen(full.state.seatActions))
      assert.equal('hand' in full.state,false);comparisons++
    }
    const saved=full.state
    input.find(e=>e.cards).cards[0].rank='mutated'
    assert.equal(saved.tableCards[0]?.rank==='mutated',false)
    assert.equal(full.seek(NaN),true);assert.equal(full.cursor,0)
    full.seekRatio(Infinity);assert.equal(full.cursor,0)
  }
  return {trials:80,cursorComparisons:comparisons}
}
class Vec3 {constructor(x,y,z){Object.assign(this,{x,y,z})}}
class Node {
  static EventType={TOUCH_END:'touch-end'}
  handlers={};setPosition(v){this.position=v}on(type,cb){this.handlers[type]=cb}
}
async function replayPage() {
  const {ReplayPageDomain}=loadTs(src('scenes/front-pages/ReplayPageDomain.ts'),{
    cc:{Node,Vec3},'../../replay/ReplayTimeline':replay,'../../ui/ReplayViewpoint':viewpoints,
    '../../ui/ReplayBoardView':{renderReplayBoard:()=>{}},
  })
  let token=0,ui,count=0
  const timers=[],pending=[],router={current:null,open(route){
    this.current=route;count++;ui={buttons:[],menuLabel:()=>{},
      button(_name,text){const n=new Node();n.text=text;this.buttons.push(n);return n}}
    return ui
  }}
  const detail={id:'audit-replay',roomId:'audit-room',participants:{},viewerSeat:null,winnerTeam:'teamA',ranking:['p1','p3','p2','p4'],
    events:Array.from({length:6},(_,i)=>({sequence:i+1,at:i*100,type:i?'pass':'game-start',roundSequence:1,...(i?{playerId:'p2',automatic:false}:{})}))}
  const domain=new ReplayPageDomain({router,gateways:{configured:true,replays:{get:()=>pending.length?pending.shift():Promise.resolve(detail),list:async()=>[]}},
    isDisposed:()=>false,issuePageRequest:()=>++token,currentPageRequest:()=>token,
    scheduleOnce:(cb,delay)=>{assert.equal(delay,.8);timers.push(cb)},showNotice:()=>{},showPlayerCenter:()=>{token++;router.current='player-center'}})
  const click=text=>{const n=ui.buttons.find(n=>n.text===text);assert.ok(n,text);n.handlers['touch-end']()}
  domain.showReplayDetail('audit-replay');await flush()
  click('播放');assert.equal(domain.activeReplayTimeline.isPlaying,true)
  const prior=domain.activeReplayTimeline.cursor
  domain.handleApplicationHide()
  timers.splice(0).forEach(cb=>cb());await flush()
  assert.equal(domain.activeReplayTimeline.isPlaying,false);assert.equal(domain.activeReplayTimeline.cursor,prior)
  assert.ok(ui.buttons.some(n=>n.text==='播放'),'background pause updates the button immediately')
  click('播放')
  assert.equal(domain.activeReplayTimeline.isPlaying,true,'explicit play resumes the paused timeline')
  domain.reflow();assert.ok(ui.buttons.some(n=>n.text==='暂停'))
  click('暂停');assert.equal(domain.activeReplayTimeline.isPlaying,false)
  assert.ok(ui.buttons.some(n=>n.text==='播放'),'normal pause correctly rerenders label')
  click('下一条');const current=domain.activeReplayTimeline.cursor
  timers.splice(0).forEach(cb=>cb());await flush();assert.equal(domain.activeReplayTimeline.cursor,current)
  const old=defer();pending.push(old.promise);domain.showReplayDetail('old')
  domain.showReplayList();await flush();const before=count
  old.resolve(detail);await flush();assert.equal(router.current,'replay-list');assert.equal(count,before)
  domain.destroy();timers.splice(0).forEach(cb=>cb());await flush()
  return {backgroundPauseLabelCorrect:true,normalPauseControl:true,seekCancelsOldTimer:true,lateDetailNoRouteSteal:true}
}
async function main(){
  console.log(JSON.stringify({tournaments:await tournaments(),timeline:timelineProperties(),replayPage:await replayPage(),
    boundary:'actual page logic and timeline; render/network/timers inert; no real app foreground event or GPU'},null,2))
}
main().catch(error=>{console.error(error);process.exitCode=1})
