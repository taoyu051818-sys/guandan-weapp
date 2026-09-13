// Audit-only: execute current source without dist/build, and mutate nine source
// statements in memory to verify selected original test bodies detect regressions.
// This is not a general mutation score or replacement for the real Vitest run.
'use strict'
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),util=require('node:util')
const repo=path.resolve(__dirname,'../../../..'),coreRoot=path.join(repo,'shared-core')
const ts=require(path.join(repo,'work/guandan-cocos/tests/support/typescript.cjs')).loadTypeScript()
const cases=[
  {id:'SF_STRENGTH',file:'src/lib/rules.ts',from:'maxValue: 5500 + straightInfo.maxValue',to:'maxValue: 4500 + straightInfo.maxValue',
    test:'tests/rules-regression.cjs',select:null},
  {id:'WILD_JOKER',file:'src/lib/rules.ts',from:'Array.from({ length: 14 }, (_, index) => index + 2)',to:'Array.from({ length: 16 }, (_, index) => index + 2)',
    test:'tests/rules.test.ts',select:'rejects joker substitution at level 9 in rules and move generation'},
  {id:'LOCK_FILTER',file:'src/hints/handHintPolicy.ts',from:'const candidates = moves.filter(cards => !calculateDamage(cards, request).splitsLockedGroup)',to:'const candidates = moves',
    test:'tests/hand-hint-policy.test.ts',select:'never splits a locked group even when no intact legal move exists'},
  {id:'RNG_RESTORE',file:'src/ai/random.ts',from:'state = checkpoint.state >>> 0;',to:'state = 0;',
    test:'tests/ai-random.test.ts',select:'restores a serialized generator checkpoint'},
  {id:'OPENING_BOMB',file:'src/ai/team/policy.ts',from:'if (firstLead && bomb) priority = 20;',to:'if (firstLead && bomb) priority = 80;',
    test:'tests/ai-team-policy.test.ts',select:'retains opening bombs and never reads hidden faces (seed 0)'},
  {id:'HIDDEN_FACE',file:'src/ai/decisionRunner.ts',from:'count: player.hand.length',to:'count: (player.hand[0], player.hand.length)',
    test:'tests/ai-team-policy.test.ts',select:'retains opening bombs and never reads hidden faces (seed 0)'},
  {id:'COLD_RESTORE',file:'src/ai/engine.ts',from:'clear(); resetMetrics(); resetTrace();',to:'resetMetrics(); resetTrace();',
    test:'tests/ai-engine.test.ts',select:'restores serialized RNG and public journal with cold caches'},
  {id:'STALE_TRIBUTE',file:'src/lib/engine.ts',from:"if (command.expectedRevision !== state.revision) return 'STALE_REVISION'",
    to:"if (false && command.expectedRevision !== state.revision) return 'STALE_REVISION'",
    test:'tests/tribute-settlement.test.ts',select:'selects a required tribute card without accepting another player or a stale revision'},
  {id:'PRIVATE_TRIBUTE',file:'src/lib/tribute.ts',from:"[{ type: 'TRIBUTE_CARD_SELECTED', playerId: command.playerId }]",
    to:"[{ type: 'TRIBUTE_CARD_SELECTED', playerId: command.playerId, cardId: command.cardId }]",
    test:'tests/tribute-settlement.test.ts',select:'keeps double-tribute choices private and transfers only after both players select'},
]
const nestedMatch=(a,b)=>b&&typeof b==='object'
  ? Object.keys(b).every(k=>nestedMatch(a?.[k],b[k])) : Object.is(a,b)
function run(test,select=null,mutant=null){
  const cache=new Map(),registered=[],logs=[];let replacements=0,assertions=0,nativeAssertions=0,executed=0
  const testAssert=new Proxy(assert,{apply(target,self,args){nativeAssertions++;return Reflect.apply(target,self,args)},get(target,key){
    const value=Reflect.get(target,key)
    return ['ok','equal','deepEqual','notEqual','throws'].includes(key)&&typeof value==='function'
      ? (...args)=>{nativeAssertions++;return value(...args)}:value
  }})
  const expect=(actual,message)=>matchers(actual,false,message)
  function matchers(actual,neg,message){
    const check=(ok,expected,name)=>{assertions++;assert.ok(neg?!ok:ok,
      (message||'')+' '+(neg?'not.':'')+name+' expected='+util.inspect(expected,{depth:2})+' actual='+util.inspect(actual,{depth:2}))}
    const o={
      toBe:b=>check(Object.is(actual,b),b,'toBe'),
      toEqual:b=>check(util.isDeepStrictEqual(actual,b),b,'toEqual'),
      toHaveLength:b=>check(actual?.length===b,b,'toHaveLength'),
      toBeNull:()=>check(actual===null,null,'toBeNull'),
      toBeUndefined:()=>check(actual===undefined,undefined,'toBeUndefined'),
      toBeDefined:()=>check(actual!==undefined,'defined','toBeDefined'),
      toMatchObject:b=>check(nestedMatch(actual,b),b,'toMatchObject'),
      toBeLessThan:b=>check(actual<b,b,'toBeLessThan'),
      toBeLessThanOrEqual:b=>check(actual<=b,b,'toBeLessThanOrEqual'),
      toBeGreaterThan:b=>check(actual>b,b,'toBeGreaterThan'),
      toBeGreaterThanOrEqual:b=>check(actual>=b,b,'toBeGreaterThanOrEqual'),
      toContain:b=>check(actual.includes(b),b,'toContain'),
      toThrow:b=>{let e;try{actual()}catch(err){e=err}check(!!e&&(b===undefined||(b instanceof RegExp?b.test(String(e)):String(e).includes(b))),b,'toThrow')},
    }
    Object.defineProperty(o,'not',{get:()=>matchers(actual,!neg,message)});return o
  }
  const it=(title,fn)=>registered.push({title,fn})
  it.each=rows=>(format,fn)=>rows.forEach(row=>{const args=Array.isArray(row)?row:[row];it(util.format(format,...args),()=>fn(...args))})
  const vitest={describe:(_title,fn)=>fn(),it,expect,vi:{spyOn:()=>{throw Error('Unimplemented spy port must not execute in selected tests')}}}
  function resolve(base,spec){
    if(spec==='../dist')return path.join(coreRoot,'src/index.ts')
    const p=path.resolve(path.dirname(base),spec)
    const found=[p,p+'.ts',p+'.cjs',path.join(p,'index.ts')].find(f=>fs.existsSync(f)&&fs.statSync(f).isFile())
    assert.ok(found,'unresolved '+spec)
    assert.ok(found.startsWith(coreRoot+path.sep),'outside audit scope '+found);return found
  }
  function load(file){
    if(cache.has(file))return cache.get(file).exports
    const mod={exports:{}};cache.set(file,mod)
    let code=fs.readFileSync(file,'utf8')
    if(mutant&&file===path.join(coreRoot,mutant.file)){
      assert.equal(code.split(mutant.from).length,2,'mutant requires exactly one source target')
      code=code.replace(mutant.from,mutant.to);replacements++
    }
    if(file.endsWith('.ts')){
      const out=ts.transpileModule(code,{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},reportDiagnostics:true})
      assert.equal((out.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0)
      code=out.outputText
    }
    const req=spec=>{
      if(spec==='vitest')return vitest
      if(spec==='node:assert/strict')return testAssert
      assert.ok(spec.startsWith('.'),'unexpected import '+spec)
      return load(resolve(file,spec))
    }
    new Function('module','exports','require','__filename','__dirname','console',code)(mod,mod.exports,req,file,path.dirname(file),{log:(...v)=>logs.push(util.format(...v))})
    return mod.exports
  }
  let error=null
  try{
    load(path.join(coreRoot,test))
    if(select!==null){const chosen=registered.filter(x=>x.title===select);assert.equal(chosen.length,1,'exact original test selection: '+select);chosen[0].fn();executed++}
    else executed++
  }catch(e){error={name:e.name,message:e.message.slice(0,700)}}
  return {test,select,executed,assertions,nativeAssertions,replacements,error,logs,sourceModules:cache.size}
}
const smoke=['tests/rules-regression.cjs','tests/tribute-regression.cjs','tests/round-smoke.cjs'].map(f=>run(f))
for(const r of smoke)assert.equal(r.error,null,JSON.stringify(r))
const mutations=cases.map(c=>{
  const baseline=run(c.test,c.select);assert.equal(baseline.error,null,c.id+' baseline: '+JSON.stringify(baseline))
  const changed=run(c.test,c.select,c)
  assert.equal(changed.replacements,1,c.id+' not loaded')
  assert.ok(changed.error,c.id+' not detected')
  assert.ok(changed.error.name==='AssertionError'||(c.id==='HIDDEN_FACE'&&changed.error.message.startsWith('hidden hand access:')),c.id+' setup failure '+JSON.stringify(changed))
  return {id:c.id,source:c.file,test:c.test,selectedOriginalBody:c.select,baselineAssertions:baseline.assertions+baseline.nativeAssertions,
    mutationDetected:true,signal:changed.error,baselineSourceModules:baseline.sourceModules}
})
console.log(JSON.stringify({sourceSmoke:smoke,mutationCases:mutations.length,detected:mutations.filter(x=>x.mutationDetected).length,mutations,
  scope:'13 original files / 96 tests separately passed real Vitest; this probe reuses selected unmodified test bodies with exact minimal assertion adapter. Nine source mutations exist in memory only. No mutation coverage or optimal strategy claim.'},null,2))
