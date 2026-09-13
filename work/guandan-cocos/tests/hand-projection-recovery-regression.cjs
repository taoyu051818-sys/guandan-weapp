// Actual hand model regression using synthetic cards, no network or product state.
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path')
const app = path.resolve(__dirname, '..'), root = path.resolve(app, '../..')
const ts = require(path.join(app, 'tests/support/typescript.cjs')).loadTypeScript()
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: file,
}).outputText, file)
const core = require(path.join(root, 'shared-core/src/index.ts'))
// Test current authoritative source with client modules, not a separately reimplemented rules oracle.
const generated = require.resolve(path.join(app, 'assets/scripts/core/generated/index.ts'))
require.cache[generated] = { id: generated, filename: generated, loaded: true, exports: core }
const game = name => require(path.join(app, 'assets/scripts/game', name + '.ts'))
const { HandWorkspace } = game('HandWorkspace')
const arrangement = game('HandArrangement')
const { createHandStackLayout, STACK_EXPOSURE_HEIGHT } = game('HandStackLayout')
const { projectHandRenderModel } = game('HandRenderProjector')
const { publicStraightFlushPossibleSuits } = game('PublicStraightFlushPossibility')
const { TeammateHandProjector } = game('TeammateHandProjector')
const { createSeededRandom } = require(path.join(root, 'shared-core/src/ai/random.ts'))
const profiles = ['classic', 'tournament'].map(core.getRuleProfile)
const suits = ['spade', 'heart', 'club', 'diamond']
const ids = ['p1', 'p2', 'p3', 'p4']
const sameMembers = (left, right) => assert.deepEqual([...left].sort(), [...right].sort())
const near = (a, b) => assert(Math.abs(a-b)<1e-8, a+' != '+b)
const pick = (deck, ranks, suit) => ranks.map(rank => {
  const found = deck.find(c => c.rank === rank && c.suit === suit)
  assert(found); return found
})
const syncOptions = (levelRank, ruleProfile, direction = 'desc', roundId = 1) =>
  ({ levelRank, ruleProfile, direction, roundId, autoSort: true })
const arrangeOptions = ruleProfile => ({ direction: 'desc', allowAceLowStraight: ruleProfile.allowA2345Straight })
const model = (workspace, hand, mode = 'play', selected = []) => projectHandRenderModel({
  hand, mode, playSelectedCardIds: selected, sortOrder: 'desc', interactive: mode !== 'blocked',
  grouping: workspace.snapshot, lockedCardIds: workspace.lockedCardIds,
  availableSuits: [], selectedSuit: null, lockDecision: { kind: 'unavailable', reason: 'empty-selection' },
  arrangeRestoreAvailable: workspace.canRestoreArrangement,
}, workspace.groupPresentation)

function arrangements () {
  let cases = 0, locks = 0, layouts = 0, legalSuggestions = 0, availability = 0
  let maxHostMilliseconds = 0
  for (const seed of [91001, 91002]) for (const level of core.MATCH_LEVELS) for (const dealing of ['random', 'no-shuffle']) {
    const hands = core.dealGameCards(level, dealing, createSeededRandom(seed + core.MATCH_LEVELS.indexOf(level)))
    for (const original of Object.values(hands)) for (const profile of profiles) for (const direction of ['asc', 'desc']) {
      const hand = Object.freeze(original.map(c => Object.freeze({...c})))
      const saved = JSON.stringify(hand), ws = new HandWorkspace(), opts = syncOptions(level, profile, direction)
      assert(ws.syncAuthoritativeHand(hand, opts))
      const baseline = ws.snapshot.displayCardIds
      assert(!ws.syncAuthoritativeHand([...hand].reverse(), opts), 'authority order only is not a semantic hand change')
      const start = performance.now()
      assert.equal(ws.toggleArrangement({...arrangeOptions(profile), direction}), 'arranged')
      maxHostMilliseconds = Math.max(maxHostMilliseconds, performance.now()-start)
      const snap = ws.snapshot
      sameMembers(snap.displayCardIds, hand.map(c=>c.id))
      const grouped = snap.groups.flatMap(g=>g.cardIds)
      assert.equal(new Set(grouped).size, grouped.length)
      for (const g of snap.groups.filter(g=>g.origin==='auto')) {
        const cards = hand.filter(c=>g.cardIds.includes(c.id)), info = core.getPlayInfo(cards, profile)
        assert(info)
        if (info.type===core.PlayType.Straight) assert.equal(new Set(cards.filter(c=>!c.isRedJoker).map(c=>c.suit)).size,1)
        legalSuggestions++
      }
      const available = ws.straightFlushAvailability({allowAceLowStraight:profile.allowA2345Straight})
      for (const item of available.filter(v=>v.available)) {
        const cards=hand.filter(c=>item.cardIds.includes(c.id))
        const info=core.getPlayInfo(cards,profile)
        assert(info && [core.PlayType.StraightFlush,core.PlayType.Straight].includes(info.type))
        assert(cards.filter(c=>!c.isRedJoker).every(c=>c.suit===item.suit))
        availability++
      }
      const rendered = model(ws,hand)
      const layout = createHandStackLayout(snap.displayCardIds, rendered.groups, 940)
      sameMembers(layout.slots.map(s=>s.cardId),hand.map(c=>c.id))
      const laneXs=[...new Set(layout.slots.map(s=>s.x))]
      near(Math.min(...laneXs)+Math.max(...laneXs),0)
      assert(layout.slots.every(s=>s.y===(s.stackSize-1-s.stackIndex)*s.stackStep))
      assert(layout.slots.filter(s=>s.stackSize>1).every(s=>s.stackStep===STACK_EXPOSURE_HEIGHT))
      // Zone/type metadata must not reserve horizontal spaces.
      assert.deepEqual(createHandStackLayout(snap.displayCardIds, rendered.groups.map(g=>({...g,zone:2})),940),layout)
      for (const width of [1,320,1200,NaN,Infinity]) {
        const sized=createHandStackLayout(snap.displayCardIds,rendered.groups,width)
        assert(sized.slots.every(s=>[s.x,s.y,s.stackStep,s.nextLaneSpacing].every(Number.isFinite)))
        sameMembers(sized.slots.map(s=>s.cardId),snap.displayCardIds); layouts++
      }
      assert.equal(ws.toggleArrangement({...arrangeOptions(profile),direction}),'restored')
      assert.deepEqual(ws.snapshot.displayCardIds,baseline)
      ws.toggleArrangement({...arrangeOptions(profile),direction})
      assert.deepEqual(ws.snapshot.displayCardIds,snap.displayCardIds)
      const candidate=ws.snapshot.groups.find(g=>g.cardIds.length>=2 && ws.getLockDecision(profile,g.cardIds).kind==='lock')
      if(candidate) {
        assert(ws.applySelectionLock(candidate.cardIds,profile))
        const locked=[...ws.lockedCardIds]
        for(const id of locked) sameMembers(ws.playSelectionForCard(id),locked)
        ws.toggleArrangement({...arrangeOptions(profile),direction})
        ws.toggleArrangement({...arrangeOptions(profile),direction})
        sameMembers(ws.lockedCardIds,locked)
        assert.equal(ws.getLockDecision(profile,locked.slice(0,-1)).kind,'unavailable')
        assert(ws.applySelectionLock(locked,profile)); assert.deepEqual(ws.lockedCardIds,[])
        locks++
      }
      assert.equal(JSON.stringify(hand),saved)
      ws.syncAuthoritativeHand(hand,{...opts,roundId:2})
      assert.equal(ws.canRestoreArrangement,false); assert.deepEqual(ws.lockedCardIds,[])
      ws.resetForTableExit(); cases++
    }
  }
  return {cases,locks,layouts,legalSuggestions,availability,maxHostMilliseconds,host:'Node only, not Cocos frame latency or phone latency'}
}

function aceLowOrdering () {
  const mismatches=[],controls=[]
  for (const suit of suits) for (const wild of [false,true]) {
    const deck=core.createDeck(9)
    let hand=pick(deck,['A',2,3,4,5],suit)
    if(wild)hand[2]=deck.find(c=>c.isRedJoker)
    // Tournament disables A2345 entirely. The control varies only bomb classification.
    for(const profile of [profiles[0], {...profiles[0], straightFlushAsBomb:false}]) for(const route of ['auto','lock']) {
      const ws=new HandWorkspace();ws.syncAuthoritativeHand(hand,syncOptions(9,profile))
      if(route==='auto')ws.toggleArrangement(arrangeOptions(profile))
      else assert(ws.applySelectionLock(hand.map(c=>c.id),profile))
      const info=core.resolvePlay(hand,profile);assert(info)
      const actual=ws.snapshot.groups[0].cardIds.map(id=>{
        const usage=info.wildcardUsages?.find(u=>u.cardId===id)
        const c=hand.find(c=>c.id===id);return usage?.representedValue ?? arrangement.getPhysicalRankValue(c)
      })
      const expected=[14,2,3,4,5]
      const legal=core.canPlay(hand,null,profile);assert(legal)
      sameMembers(ws.snapshot.groups[0].cardIds,hand.map(c=>c.id))
      if(profile.straightFlushAsBomb){
        assert.deepEqual(actual,expected)
        mismatches.push({suit,wild,route,type:info.type,maxValue:info.maxValue,actual,expected})
      }else{assert.deepEqual(actual,expected);controls.push({suit,wild,route})}
    }
  }
  return {correctBombClassCases:mismatches.length,controls:controls.length,example:mismatches[0],
    control:'Same physical A2345, allowA2345Straight=true, only straightFlushAsBomb=false; not the tournament preset'}
}

function publicCounter () {
  const sequences=Array.from({length:9},(_,i)=>[i+2,i+3,i+4,i+5,i+6])
    .map(s=>s.map(v=>({11:'J',12:'Q',13:'K',14:'A'}[v]??v)))
  sequences.push(['A',2,3,4,5])
  let cases=0,falsePositives=0,legalControls=0,wildcardRepairs=0,duplicateChecks=0
  let example=null
  const input=(deck,unseen,level)=>{
    const hidden=new Set(unseen.map(c=>c.id)),known=deck.filter(c=>!hidden.has(c.id))
    return {knownHand:known.slice(0,27),publicPlays:known.slice(27).map(c=>({cards:[c]})),
      otherHandSizes:[5,0,0],level,allowAceLowStraight:true}
  }
  for(const level of core.MATCH_LEVELS)for(const suit of suits)for(const sequence of sequences){
    const deck=core.createDeck(level),unseen=pick(deck,sequence,suit),data=input(deck,unseen,level)
    const inferred=publicStraightFlushPossibleSuits(data),info=core.getPlayInfo(unseen,profiles[0])
    const plainLevel=unseen.some(c=>c.isLevelCard&&!c.isRedJoker)
    if(plainLevel){
      assert.equal(info,null);assert(!inferred.includes(suit));falsePositives++
      example??={level,suit,unseen:unseen.map(c=>({rank:c.rank,isLevelCard:c.isLevelCard})),inferred,rule:info}
      const repaired=unseen.map(c=>c.isLevelCard?deck.find(w=>w.isRedJoker):c)
      assert.equal(core.getPlayInfo(repaired,profiles[0]).type,core.PlayType.StraightFlush)
      assert(publicStraightFlushPossibleSuits(input(deck,repaired,level)).includes(suit));wildcardRepairs++
    }else{assert.equal(info.type,core.PlayType.StraightFlush);assert(inferred.includes(suit));legalControls++}
    assert.deepEqual(publicStraightFlushPossibleSuits({...data,publicPlays:data.publicPlays.concat(data.publicPlays)}),inferred)
    assert.deepEqual(publicStraightFlushPossibleSuits({...data,otherHandSizes:[4,0,0]}),[])
    duplicateChecks++;cases++
  }
  return {cases,rejectedPlainLevelCases:falsePositives,legalControls,wildcardRepairs,duplicateChecks,example,
    scope:'Public upper-bound only. All five unseen cards assigned to one other player; no allocation uncertainty. No private opponent identities consumed.'}
}

async function privacy () {
  const {stateForViewer}=await import(path.join(root,'work/guandan-windows-source/server/game-session-projection.js'))
  let views=0,revocations=0,phaseGuards=0,changes=0
  const projector=new TeammateHandProjector(),deck=core.createDeck(9),savedHand=new Map()
  ids.forEach((id,i)=>savedHand.set(id,deck.slice(i*10,i*10+10)))
  for(let a=0;a<4;a++)for(let b=a+1;b<4;b++)for(const humanId of ids){
    const teamA=[ids[a],ids[b]],team=id=>teamA.includes(id)?'teamA':'teamB'
    const teammate=ids.find(id=>id!==humanId&&team(id)===team(humanId))
    const state={roundId:views+1,phase:'playing',currentLevel:9,ruleProfile:profiles[0],
      currentTurn:teammate,finishedPlayers:[humanId],turnOrder:ids,
      players:Object.fromEntries(ids.map(id=>[id,{id,team:team(id),hand:id===humanId?[]:savedHand.get(id)}]))}
    const before=JSON.stringify(state),projected=stateForViewer(state,humanId)
    const output=projector.project({state:projected,phase:'playing'},humanId,'desc')
    assert(output.view.available);assert.equal(output.view.playerId,teammate)
    assert(!output.hand.interactive);assert.equal(output.hand.interactionMode,'blocked')
    assert.deepEqual(output.hand.playSelectedCardIds,[]);assert.deepEqual(output.hand.availableSuits,[])
    sameMembers(output.hand.hand.map(c=>c.id),state.players[teammate].hand.map(c=>c.id))
    ids.filter(id=>team(id)!==team(humanId)).forEach(id=>{
      assert(projected.players[id].hand.every(c=>Object.keys(c).join()==='id' && c.id.startsWith('hidden-')))
    })
    assert.deepEqual(projector.project({state:projected,phase:'playing'},humanId,'desc'),output)
    const hidden=structuredClone(projected)
    hidden.players[teammate].hand=hidden.players[teammate].hand.map((_,i)=>({id:'hidden-'+teammate+'-'+i}))
    const revoked=projector.project({state:hidden,phase:'playing'},humanId,'desc')
    assert(!revoked.view.available);assert.deepEqual(revoked.hand.hand,[]);revocations++
    assert(projector.project({state:projected,phase:'playing'},humanId,'asc').view.available);changes++
    for(const phase of ['tribute','settlement']){
      assert.equal(projector.project({state:stateForViewer({...state,phase},humanId),phase},humanId,'desc'),null);phaseGuards++
    }
    assert.equal(projector.project({state:{...projected,finishedPlayers:[]},phase:'playing'},humanId,'desc'),null)
    assert.equal(projector.project({state:{...projected,finishedPlayers:[humanId,teammate]},phase:'playing'},humanId,'desc'),null)
    assert.equal(JSON.stringify(state),before);views++
  }
  projector.reset()
  return {dynamicTeamViewerCombinations:views,revocations,phaseGuards,changes,serverProjection:'actual stateForViewer; no sockets, WeChat or real user data'}
}

async function main(){
  const result={arrangements:arrangements(),aceLowOrdering:aceLowOrdering(),publicCounter:publicCounter(),privacy:await privacy()}
  console.log(JSON.stringify(result,null,2))
}
main().catch(error=>{console.error(error);process.exitCode=1})
