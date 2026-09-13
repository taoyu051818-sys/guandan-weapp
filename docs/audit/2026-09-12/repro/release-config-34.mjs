// Audit-only: synthetic/in-memory probes; never execute deployment or contact production.
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const read = p => readFileSync(resolve(root, p), 'utf8')
const json = p => JSON.parse(read(p))
const cocos = 'work/guandan-cocos'
const server = 'work/guandan-windows-source'
const { resetProfiles } = await import(pathToFileURL(resolve(root, server, 'ops/guangzhou/reset-existing-profiles.mjs')))
const { loadPlatformConfig, loadGameSecurityConfig } = await import(pathToFileURL(resolve(root, server, 'server/platform/config.js')))
const results = {}
// Imports are replaced only for the top-level hard-coded /srv writer, not business code.
const initializer = read(cocos + '/ops/guangzhou/initialize-production-env.mjs').replace(/^import .+\n/gm, '')
let written, generated = 0, writes = 0
const memoryFs = {
  existsSync: p => { assert.equal(p, '/srv/guandan/shared/production.env'); return Boolean(written) },
  writeFileSync: (p, body, options) => {
    assert.equal(p, '/srv/guandan/shared/production.env')
    assert.equal(options.flag, 'wx'); assert.equal(options.mode, 0o600)
    written = body; writes++
  },
  randomBytes: n => { assert.equal(n, 32); return Buffer.alloc(n, ++generated) },
  console: { log() {} },
}
runInNewContext('(()=>{' + initializer + '})()', memoryFs)
const initialBody = written
runInNewContext('(()=>{' + initializer + '})()', memoryFs)
assert.equal(written, initialBody); assert.equal(writes, 1); assert.equal(generated, 4)
const env = Object.fromEntries(written.trim().split('\n').map(s => [s.slice(0,s.indexOf('=')), s.slice(s.indexOf('=')+1)]))
assert.throws(() => loadPlatformConfig(env), /WX_APPID/)
env.WX_APPID = 'synthetic-app'; env.WX_SECRET = 'synthetic-wechat-secret'
const platform = loadPlatformConfig(env), game = loadGameSecurityConfig(env)
assert.equal(platform.port,33103); assert.equal(game.wsPort,33102)
assert.equal(platform.enableDevLogin,false); assert.equal(game.ticketRequired,true)
assert.equal(game.turnTimeoutMs,20000); assert.equal(platform.storeMode,'json-single-instance')
assert.match(read(cocos + '/ops/guangzhou/guandan-platform.service'), /EnvironmentFile=\/srv\/guandan\/shared\/wechat.env/)
results.environment = { writes, independentSyntheticKeys: generated, secondRunPreserved: true, realConfigAcceptedWithSeparateWechatEnv: true }
// No actual profile library or accounts are read.
const profiles = [{ id:'a', displayName:'合成甲', avatarUrl:'profile:001' }, { id:'b', displayName:'合成乙', avatarUrl:'profile:002' }]
const original = { users: Object.fromEntries(Array.from({length:50}, (_, i) => [
  'usr_'+i, { id:'usr_'+i, externalId:'synthetic-'+i, displayName:'旧合成', avatarUrl:'old',
    updatedAt:1, profileCustomizedAt:2, avatarImageData:'synthetic', points:i, ledger:['unchanged'] }
])), matches: { fixture: { score:42 } } }
original.users.bot = { id:'bot', isBot:true, displayName:'机器人' }
original.users.system = { id:'system', system:true, displayName:'系统' }
const saved = structuredClone(original)
const pure = resetProfiles(original,profiles,123)
assert.deepEqual(original,saved); assert.equal(pure.changed,50); assert.equal(pure.skipped,2)
for (let i=0;i<50;i++) {
  const u=pure.state.users['usr_'+i]
  assert.equal(u.points,i); assert.deepEqual(u.ledger,['unchanged']); assert.equal(u.updatedAt,123)
  assert.ok(!Object.hasOwn(u,'avatarImageData')); assert.ok(!Object.hasOwn(u,'profileCustomizedAt'))
}
assert.throws(() => resetProfiles({users:{ bad:{id:'bad'} }}, profiles), /Unrecognized/)
assert.throws(() => resetProfiles(saved, []), /paired profile/)
const temporary = mkdtempSync(join(tmpdir(),'guandan-audit34-'))
const data = join(temporary,'synthetic.json'), catalog = join(temporary,'catalog.json'), backup = join(temporary,'backup')
const cli = (...args) => spawnSync(process.execPath,[resolve(root,server,'ops/guangzhou/reset-existing-profiles.mjs'),...args], {
  cwd:temporary,encoding:'utf8',timeout:10000,env:{PATH:process.env.PATH,TMPDIR:temporary}
})
try {
  const body = JSON.stringify(saved)
  writeFileSync(data,body,{mode:0o600,flag:'wx'})
  writeFileSync(catalog,JSON.stringify({profiles}),{mode:0o600,flag:'wx'})
  assert.equal(cli('--dry-run',data,catalog).status,0); assert.equal(readFileSync(data,'utf8'),body)
  assert.equal(cli('--apply',data,catalog,backup).status,0)
  assert.equal(readFileSync(join(backup,'platform.before.json'),'utf8'),body)
  assert.equal(statSync(data).mode&0o777,0o600)
  assert.equal(statSync(backup).mode&0o777,0o700)
  const manifest=JSON.parse(readFileSync(join(backup,'manifest.json'),'utf8'))
  assert.equal(manifest.sourceSha256,createHash('sha256').update(body).digest('hex')); assert.equal(manifest.changed,50)
  const after=readFileSync(data,'utf8')
  assert.notEqual(cli('--apply',data,catalog,backup).status,0)
  assert.equal(readFileSync(data,'utf8'),after)
  assert.ok(!readdirSync(temporary).some(f=>f.includes('.profile-reset-')))
  results.profileReset = { syntheticUsers:50, skipped:2, dryRunUnchanged:true, backupVerified:true, reusedBackupRejected:true, originalPureInputUnchanged:true }
} finally {
  assert.equal(dirname(temporary),resolve(tmpdir())); assert.ok(temporary.split('/').at(-1).startsWith('guandan-audit34-'))
  rmSync(temporary,{recursive:true,force:true})
}
const locks = []
for (const dir of ['shared-core',cocos,server]) {
  const lock=JSON.parse(execFileSync('ruby',['-ryaml','-rjson','-e','puts JSON.generate(YAML.load_file(ARGV[0]))',resolve(root,dir,'pnpm-lock.yaml')],{encoding:'utf8',timeout:10000}))
  const pkg=json(dir+'/package.json'), importer=lock.importers['.']
  assert.equal(String(lock.lockfileVersion),'9.0')
  for(const type of ['dependencies','devDependencies','optionalDependencies']) {
    assert.deepEqual(Object.keys(importer[type]||{}).sort(),Object.keys(pkg[type]||{}).sort())
    for(const [name, entry] of Object.entries(importer[type]||{})) {
      assert.equal(entry.specifier,pkg[type][name]); assert.ok(lock.snapshots[name+'@'+entry.version])
    }
  }
  let edges=0
  for(const [key,item] of Object.entries(lock.packages||{})) {
    assert.match(item.resolution.integrity,/^sha512-[A-Za-z0-9+/]{86}==$/)
    assert.ok(Object.keys(lock.snapshots).some(k=>k.split('(')[0]===key))
  }
  for(const [key,snapshot] of Object.entries(lock.snapshots||{})) {
    assert.ok(lock.packages[key.split('(')[0]])
    for(const type of ['dependencies','optionalDependencies']) for(const [name,version] of Object.entries(snapshot[type]||{})) {
      assert.ok(lock.snapshots[name+'@'+version],name+'@'+version); edges++
    }
  }
  locks.push({dir,packages:Object.keys(lock.packages||{}).length,snapshots:Object.keys(lock.snapshots||{}).length,edges,manifestSpecifiersMatched:true})
}
results.locks=locks
// Only bash parsing and inputs rejected before any filesystem/service command.
for(const file of ['activate-server-variants.sh','activate-table-polish.sh']) {
  const path=resolve(root,cocos,'ops/guangzhou',file)
  assert.equal(spawnSync('bash',['-n',path],{timeout:5000}).status,0)
  for(const args of [['../invalid','a'.repeat(64)],['20260912-audit','invalid']]) {
    const result=spawnSync('bash',[path,...args],{timeout:5000,env:{PATH:'/usr/bin:/bin'}})
    assert.notEqual(result.status,0); assert.equal(result.error,undefined)
  }
}
results.shell={parseChecks:2,earlyInvalidArgumentChecks:4,activationExecuted:false}
// Entire verifier body executes with synthetic fetch/WS/HTTPS ports; no native network.
const verifier=read(cocos+'/ops/guangzhou/verify-deployment.mjs').replace(/^import .+\n/gm,'')
async function verifyWith(statusOverride, wsType='error', originStatus=403) {
  const calls=[], logs=[], timers=new Set()
  class Socket {
    handlers=new Map()
    constructor(url) { calls.push(['ws',url]); queueMicrotask(()=>this.handlers.get('open')?.()) }
    addEventListener(type,fn) {this.handlers.set(type,fn)}
    send(body) {const command=JSON.parse(body); calls.push(['command',command]); queueMicrotask(()=>this.handlers.get('message')?.({data:JSON.stringify({type:wsType,code:'UNSUPPORTED'})}))}
    close() {}
  }
  const syntheticHttps={request(url,options,callback) {
    calls.push(['https',url,options.headers.Origin])
    const request=new EventEmitter()
    request.setTimeout=()=>{}; request.destroy=()=>{}
    request.end=()=>queueMicrotask(()=>callback({statusCode:originStatus,resume(){}}))
    return request
  }}
  const ctx={assert,https:syntheticHttps,WebSocket:Socket,queueMicrotask,AbortSignal,
    console:{log:s=>logs.push(s)},
    setTimeout:(fn,ms)=>{const t=setTimeout(fn,ms);timers.add(t);return t},
    clearTimeout:t=>{clearTimeout(t);timers.delete(t)},
    fetch:async(url,options)=>{
      calls.push(['fetch',url,options.method])
      const expected=url.endsWith('/health')?200:url.endsWith('/profile')?401:url.endsWith('/dev-login')?403:200
      return {status:statusOverride??expected,arrayBuffer:async()=>new ArrayBuffer(0)}
    }}
  try {await runInNewContext('(async()=>{'+verifier+'})()',ctx); return {calls,logs}}
  finally {for(const t of timers)clearTimeout(t)}
}
const verification=await verifyWith()
assert.equal(verification.calls.filter(c=>c[0]==='fetch').length,4)
assert.equal(verification.calls.filter(c=>c[0]==='https').length,1)
assert.equal(verification.logs.length,7)
await assert.rejects(verifyWith(500)); await assert.rejects(verifyWith(undefined,'ok')); await assert.rejects(verifyWith(undefined,'error',101))
const require=createRequire(import.meta.url)
const ts=require(resolve(root,'shared-core/node_modules/typescript'))
const protocol=ts.transpileModule(read('shared-core/src/protocol.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText
const exports={}
runInNewContext(protocol,{exports})
assert.equal(exports.validateCommandRequestId('deploymentHealthProbe','deployment-health'),null)
assert.ok(exports.validateCommandRequestId('play','deployment-health'))
results.transportProbe={syntheticPass:true,threeFailureControls:true,unknownCommandNotSubjectToMutationRequestId:true,actualNetworkCalls:0,limit:'Asserts generic error, not error code, request correlation, real login or gameplay'}
console.log(JSON.stringify(results,null,2))
