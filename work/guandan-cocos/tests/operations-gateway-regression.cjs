const assert = require('node:assert/strict')
const path = require('node:path')
const { loadTs } = require('./support/load-typescript-module.cjs')
const root = path.resolve(__dirname, '../assets/scripts')
const cache = new Map()
function load(file) {
  if (!cache.has(file)) cache.set(file, loadTs(file, new Proxy({}, {
    has: (_target, key) => key.startsWith('.'), get: (_target, key) => load(path.resolve(path.dirname(file), key + '.ts')),
  })))
  return cache.get(file)
}
const { createHttpGateways } = load(path.join(root, 'services/platform/factory.ts'))
const { FeedbackSubmission } = load(path.join(root, 'services/FeedbackSubmission.ts'))
const { parseFeedback } = load(path.join(root, 'services/platform/operationsValidation.ts'))
const feedback = { id:'feedback1', userId:'player1', category:'bug', content:'游戏卡住', status:'open', version:1, createdAt:0, updatedAt:0, replies:[] }
const message = { id:'announcement:id/1', kind:'announcement', title:'新公告', content:'公告正文', createdAt:0, read:false }
const page = items => ({ items, page:1, pageSize:4, total:items.length })
const ok = data => ({ status:200, body:{ok:true,data,error:null} })

async function run() {
  const calls = []
  let notice = { id:'messages', status:'open', title:'消息中心', detail:'', version:1, updatedAt:0 }
  let messages = {...page([message]),unreadCount:1}, submitted = 0, failAfterCommit = false, unauthorized = false, failFeature = false
  const records = new Map()
  const api = createHttpGateways({baseUrl:'https://platform.example',deviceId:'test-operations',allowDevelopmentLogin:true}, {async request(input) {
    calls.push(input)
    const url = new URL(input.url)
    if (url.pathname === '/api/v1/auth/dev-login') return ok({accessToken:'test-player-token'})
    if (url.pathname.startsWith('/api/v1/lobby/services/')) {
      assert.equal(input.headers.Authorization, undefined, 'feature copy is public, not an admin session')
      if (failFeature) throw Error('network unavailable')
      return ok(notice)
    }
    assert.equal(input.headers.Authorization, 'Bearer test-player-token')
    if (url.pathname === '/api/v1/messages') { assert.equal(url.search,'?page=1&pageSize=4'); return ok(messages) }
    if (url.pathname.endsWith('/read')) return ok({read:true})
    if (url.pathname === '/api/v1/feedback' && input.method === 'GET') return ok(page([feedback]))
    if (url.pathname === '/api/v1/feedback' && input.method === 'POST') {
      if (unauthorized) { unauthorized=false; return {status:401,body:{ok:false,error:{code:'AUTH_EXPIRED',message:'expired'}}} }
      assert.deepEqual(Object.keys(input.body).sort(), ['category','content'], 'player never sends userId or admin fields')
      const key = input.headers['Idempotency-Key']
      if (!records.has(key)) { submitted++; records.set(key,{...feedback,content:input.body.content,category:input.body.category}) }
      if (failAfterCommit) {failAfterCommit=false;throw Error('response lost after commit')}
      return ok({feedback:records.get(key)})
    }
    throw Error('Unexpected route ' + input.url)
  }})
  assert.equal((await api.lobbyServices.getNotice('messages')).status,'open')
  assert.equal(calls.length,1,'feature gate does not trigger player login')
  notice = {...notice,status:'maintenance'}
  assert.equal((await api.lobbyServices.getNotice('messages')).status,'maintenance')
  for (const bad of [{...notice,status:'unknown'},{...notice,status:['open']},{...notice,id:'feedback'},{...notice,version:0},{...notice,updatedAt:-1}]) {
    const previous=notice;notice=bad;await assert.rejects(api.lobbyServices.getNotice('messages'));notice=previous
  }
  failFeature=true
  await assert.rejects(api.lobbyServices.getNotice('messages'),/network unavailable/)
  failFeature=false
  assert.equal((await api.operations.listMessages(1,4)).items[0].read,false)
  assert.equal(calls.filter(call=>call.url.endsWith('/read')).length,0,'list never marks messages read')
  await api.operations.readMessage(message.id)
  assert.equal(calls.at(-1).url,'https://platform.example/api/v1/messages/announcement%3Aid%2F1/read')
  assert.equal(calls.at(-1).method,'POST')
  assert.equal((await api.operations.listFeedback(1,4)).items[0].createdAt,0)
  for (const bad of [{...feedback,category:['bug']},{...feedback,status:['open']}]) assert.throws(()=>parseFeedback(bad),/反馈状态/)
  messages={...messages,items:[{...message,kind:'feedback',content:'回'.repeat(4020)}]}
  assert.equal((await api.operations.listMessages(1,4)).items[0].content.length,4020)
  messages={...messages,unreadCount:2}
  await assert.rejects(api.operations.listMessages(1,4),/未读/)
  for (const values of [[0,4],[1,51],[1.5,4]]) await assert.rejects(api.operations.listMessages(...values),/分页/)
  let key=0
  const draft = new FeedbackSubmission(()=>`feedback-key-${++key}`)
  await assert.rejects(draft.submit(api.operations),/填写/)
  draft.content='a'.repeat(2001);await assert.rejects(draft.submit(api.operations),/2000/)
  draft.content=' 游戏卡住 ';failAfterCommit=true
  await assert.rejects(draft.submit(api.operations),/response lost/)
  assert.equal(draft.content,' 游戏卡住 ','failed feedback retains the draft')
  assert.equal(draft.busy,false)
  unauthorized=true
  await draft.submit(api.operations)
  assert.equal(submitted,1,'lost response retry and auth refresh do not duplicate feedback')
  assert.equal(draft.content,'')
  const posts=calls.filter(call=>call.url.endsWith('/feedback')&&call.method==='POST')
  assert.equal(posts.length,3)
  assert.equal(new Set(posts.map(call=>call.headers['Idempotency-Key'])).size,1)
  draft.content='另一条建议';draft.category='suggestion';await draft.submit(api.operations)
  assert.equal(submitted,2,'a new successful draft gets a fresh key')
  const before=calls.length
  await assert.rejects(api.operations.submitFeedback({category:'bug',content:'a'.repeat(2001)},'valid-key'),/2000/)
  await assert.rejects(api.operations.submitFeedback({category:'bug',content:'valid'},'bad key'),/标识/)
  assert.equal(calls.length,before,'invalid drafts never issue transport calls')
}
run().then(()=>console.log('Operations gateways: genuine authenticated routes, strict availability, input bounds and replay-safe submission passed')).catch(error=>{console.error(error);process.exitCode=1})
