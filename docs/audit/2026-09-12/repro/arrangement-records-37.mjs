// Audit-only reconciliation of all four historical arrangement data files.
// No retired benchmark, build, product write or production request is invoked.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..')
const read=name=>JSON.parse(fs.readFileSync(resolve(root,'docs',name),'utf8'))
const close=(a,b,tag)=>assert.ok(Math.abs(a-b)<=1e-8,tag+': '+a+' != '+b)
const finiteTree=(value,at='root')=>{
  if(typeof value==='number')assert.ok(Number.isFinite(value)&&value>=0,at)
  else if(value&&typeof value==='object')for(const [key,v]of Object.entries(value))finiteTree(v,at+'.'+key)
}
const quantile=(values,p)=>{
  const sorted=[...values].sort((a,b)=>a-b)
  return sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]
}
const aggregate=(values,record,tag)=>{
  for(const key of ['p50','p95','max'])close(record[key],quantile(values,{p50:.5,p95:.95,max:1}[key]),tag+'.'+key)
  if('total'in record)close(record.total,values.reduce((s,v)=>s+v,0),tag+'.total')
}
const ordered=record=>{
  assert.ok(record.p50>=0&&record.p50<=record.p95&&record.p95<=record.max)
}
const results={}

const latency=read('ARRANGEMENT_LATENCY_20260910.json');finiteTree(latency)
assert.equal(latency.policyHands,104)
assert.equal(latency.interactive.samples.length,latency.interactive.hands)
assert.equal(latency.interactive.hands,26)
assert.equal(new Set(latency.interactive.samples.map(r=>r.mode+':'+r.level)).size,26)
for(const mode of ['random','no-shuffle']){
  const group=latency.byMode[mode]
  assert.equal(group.hands,52);ordered(group.oldMs);ordered(group.newMs)
  close(group.cpuReduction,1-group.newMs.total/group.oldMs.total,mode+'.cpuReduction')
}
for(const metric of ['submitMs','tapMs','cachedTapMs','maxCallbackMs','callbacks','frameCpuMs']){
  aggregate(latency.interactive.samples.map(r=>r[metric]),latency.interactive[metric],'interactive.'+metric)
}
for(const sample of latency.interactive.samples){
  assert.ok(sample.callbacks>=1&&Number.isInteger(sample.callbacks))
  assert.ok(sample.maxCallbackMs<=sample.frameCpuMs+1e-8)
}
results.latency={fullSamples:26,recomputedStatistics:24,cpuRatios:2,
  currentScope:'historical manual-frame queue on Node, not phone latency',
  unverifiableFromJsonAlone:['104 hands identical physical partitions/scores: no raw hands/partitions included',
    'byMode old/new timing percentiles and meanGroups: no per-hand observations included']}

const snapshot=read('HAND_LAYOUT_SNAPSHOT_TIMING_20260910.json');finiteTree(snapshot)
assert.equal(snapshot.samples,13);assert.equal(snapshot.rows.length,13)
assert.equal(new Set(snapshot.rows.map(r=>r.level)).size,13)
const metrics=['warmWallMs','cpuMs','callbacks','maxCallbackMs','clickAndProjectionMs','restoreMs','repeatedMs']
for(const label of ['current','previousGap']){
  for(const metric of metrics)aggregate(snapshot.rows.map(r=>r[label][metric]),snapshot[label][metric],label+'.'+metric)
  for(const row of snapshot.rows){
    const x=row[label]
    assert.ok(x.warmWallMs>=x.cpuMs-1e-8&&x.cpuMs>=x.maxCallbackMs-1e-8)
    assert.ok(Number.isInteger(x.callbacks)&&x.callbacks>0)
  }
}
results.snapshot={fullLevelRows:13,comparedModes:2,recomputedStatistics:42,
  p95EqualsMaxForThirteenSamples:true,currentScope:'Node real timers, excludes Cocos/native input',
  currentMeasuredMaxCallbackMs:snapshot.current.maxCallbackMs.max,
  fourMsIsHardLimit:false}

const arrangement=read('HAND_ARRANGEMENT_BENCHMARK_20260910.json');finiteTree(arrangement)
assert.notEqual(arrangement.trainSeed,arrangement.holdoutSeed)
assert.deepEqual(Object.keys(arrangement.weights).sort(),
 ['single','splitPair','splitTriple','splitBomb','wildOrdinary','wildControl','control'].sort())
const eligible=(candidate,baseline,maxLoss)=>{
  const saved=baseline.turns-candidate.turns
  return saved>0&&baseline.controls-candidate.controls<=maxLoss*saved+1e-8
    && candidate.ordinaryWildcards-baseline.ordinaryWildcards<=.5*saved+1e-8
    && candidate.splitBombs<=baseline.splitBombs+.02+1e-8
    && candidate.singles<=baseline.singles+1e-8
}
const reselected=Object.entries(arrangement.train).filter(([name,row])=>name!=='legacy'&&eligible(row,arrangement.train.legacy,.07))
  .sort(([,a],[,b])=>a.turns-b.turns||a.singles-b.singles).map(([name])=>name)
assert.deepEqual(reselected,arrangement.eligible);assert.equal(reselected[0],arrangement.selected)
for(const [stage,count]of [['train',120],['holdout',240]])for(const row of Object.values(arrangement[stage])){
  assert.equal(row.hands,count)
  assert.ok(row.exactRate>=0&&row.exactRate<=1)
  close(row.exactRate*row.hands,Math.round(row.exactRate*row.hands),'exact count')
  ordered({p50:row.p50Ms,p95:row.p95Ms,max:row.maxMs})
  for(const key of ['turns','singles','splitPairs','splitBombs','ordinaryWildcards','controlWildcards']){
    close(row[key]*row.hands,Math.round(row[key]*row.hands),stage+'.'+key+' count')
  }
}
assert.equal(eligible(arrangement.holdout[arrangement.selected],arrangement.holdout.legacy,.10),arrangement.validationPassed)
results.arrangement={trainCandidates:Object.keys(arrangement.train).length-1,trainingHandsPerCandidate:120,holdoutHandsPerCandidate:240,
  selected:reselected[0],selectionRecomputed:true,holdoutConstraintsPass:true,
  currentScope:'retired structural planner; not current auto-arrange or player win rate',
  unverifiableFromJsonAlone:['raw hand identities/partitions and individual timing samples not included',
    'seed fields describe intended independence, not proof of original execution history']}

const deal=read('NO_SHUFFLE_VALIDATION_20260910.json');finiteTree(deal)
assert.equal(deal.tablesPerPolicy,260);assert.equal(deal.levels.length,13)
for(const label of ['previous','current']){
  const r=deal[label]
  assert.equal(r.hands,1040)
  const expanded=Object.entries(r.distribution).flatMap(([value,n])=>{
    assert.ok(Number.isInteger(n)&&n>=0);return Array(n).fill(+value)
  })
  assert.equal(expanded.length,r.hands)
  close(expanded.reduce((a,b)=>a+b,0)/r.hands,r.groups,label+'.groups')
  close(quantile(expanded,.9),r.p90Groups,label+'.p90')
  close(quantile(expanded,.95),r.p95Groups,label+'.p95')
  close(Object.values(r.typesPerHand).reduce((a,b)=>a+b,0),r.groups,label+'.types/groups')
  close(r.typesPerHand.Single,r.singles,label+'.singles')
  for(const [kind,expectedCount,expectedHands]of [['bySeat',4,260],['byLevel',13,80]]){
    const rows=Object.values(r[kind])
    assert.equal(rows.length,expectedCount);assert.ok(rows.every(x=>x.hands===expectedHands))
    assert.equal(rows.reduce((s,x)=>s+x.hands,0),r.hands)
    for(const field of ['groups','singles'])close(rows.reduce((s,x)=>s+x[field]*x.hands,0)/r.hands,r[field],label+'.'+kind+'.'+field)
  }
  ordered(r.planMs);ordered(r.dealMs)
}
const range=(n,a,b)=>n>=a&&n<=b,c=deal.current
const checks={
 meanAroundSix:range(c.groups,5.7,6.3),
 fewerSingles:c.singles<=1.5&&c.singles<=deal.previous.singles*.6,
 perSeat:Object.values(c.bySeat).every(r=>range(r.groups,5.7,6.3)),
 seatSpread:Math.max(...Object.values(c.bySeat).map(r=>r.groups))-Math.min(...Object.values(c.bySeat).map(r=>r.groups))<=.35,
 perLevel:Object.values(c.byLevel).every(r=>range(r.groups,5.3,6.7)),
 tail:c.p95Groups<=8,
 notExactlySixForEveryone:c.distribution['6']!==c.hands,
}
assert.deepEqual(checks,deal.checks);assert.equal(Object.values(checks).every(Boolean),deal.passed)
results.noShuffle={policies:2,handsPerPolicy:1040,groupHistogramsReconciled:true,
  weightedSeatAndLevelTotalsReconciled:true,recomputedAcceptanceChecks:7,
  handsOverEight:Object.entries(c.distribution).filter(([n])=>+n>8).reduce((sum,[,n])=>sum+n,0),
  currentScope:'historical production planner counted ordinary straights; six-hand guarantee no longer applicable',
  unverifiableFromJsonAlone:['per-hand cards/legality and exactRate search cutoff logs omitted',
    'timing percentiles cannot be reconstructed from aggregates alone']}
assert.equal(results.noShuffle.handsOverEight,50)
console.log(JSON.stringify({results,productWrites:0,retiredBenchmarkInvoked:false,networkRequests:0},null,2))
