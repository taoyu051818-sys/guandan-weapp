const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTs } = require('./support/load-typescript-module.cjs')
const root = path.resolve(__dirname,'../assets/scripts')
const load=(file,ports)=>loadTs(path.join(root,file),ports)
const model=load('scenes/front-pages/OperationsPageModel.ts')
const submission=load('services/FeedbackSubmission.ts')
let state, actions, renders=0, inputCloses=0
const { OperationsPageController }=load('scenes/front-pages/OperationsPageController.ts',{
  '../../services/FeedbackSubmission':submission,'./OperationsPageModel':model,
  './OperationsPageView':{renderOperationsPage(_ui,_viewport,value,callbacks){state={...value};actions=callbacks;renders++;return()=>inputCloses++}},
})
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve()}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}}
const message=id=>({id,kind:'announcement',title:'公告'+id,content:'完整内容'.repeat(500),createdAt:0,read:false})
const feedback={id:'f1',userId:'self',category:'bug',content:'反馈原文',status:'open',version:1,createdAt:0,updatedAt:0,replies:[{id:'r1',content:'回复正文'.repeat(500),createdAt:0}]}
const page=(items,number=1,total=items.length)=>({items,page:number,pageSize:4,total})
async function run(){
  const router={current:null,open(id){this.current=id;return{}}}, reads=[],lists=[],submits=[],markedRead=new Set()
  let listPending=null,readPending=null,submitPending=null,failRead=false,failSubmit=false,disposed=false
  const api={
    async listMessages(number,size){lists.push(number);assert.equal(size,4);return listPending??{...page([{...message('m'+number),read:markedRead.has('m'+number)}],number,5),unreadCount:5-markedRead.size}},
    async readMessage(id){reads.push(id);if(failRead)throw Error('断网');return readPending},
    async listFeedback(number,size){assert.equal(size,4);return page([feedback],number)},
    async submitFeedback(draft,key){submits.push({draft,key});if(failSubmit)throw Error('超时');return submitPending??{...feedback,...draft}},
  }
  const controller=new OperationsPageController({router,gateways:{configured:true,operations:api},screen:{viewport:{}},isDisposed:()=>disposed,setTableVisible(){},showMenu(){router.current='menu'}})
  controller.open('messages');assert.equal(state.loading,true);await flush()
  assert.equal(reads.length,0,'loading or listing messages does not mark read')
  assert.equal(router.current,'operations-messages')
  let pending=deferred();readPending=pending.promise
  actions.select('m1');assert.equal(state.selected.id,'m1');assert.equal(state.reading,true)
  assert.equal(state.selected.read,false,'read indicator awaits real server acknowledgement')
  assert.deepEqual(reads,['m1'])
  actions.retry();assert.equal(reads.length,1,'read retry is single-flight')
  actions.detailPage(1);assert.equal(state.detailPage,1)
  pending.resolve();await flush();readPending=null
  assert.equal(state.selected.read,true);assert.equal(state.messages.unreadCount,4)
  controller.open('messages');await flush();pending=deferred();readPending=pending.promise
  actions.select('m1');markedRead.add('m1');actions.back();await flush()
  assert.equal(state.messages.unreadCount,4,'refresh can observe a read before its original request returns')
  pending.resolve();await flush();readPending=null
  assert.equal(state.messages.unreadCount,4,'late acknowledgement cannot decrement a refreshed count twice')
  actions.page(1);await flush()
  assert.equal(state.messages.page,2);assert.equal(lists.at(-1),2)
  failRead=true;actions.select('m2');await flush()
  assert.equal(state.selected.read,false);assert.match(state.error,/已读状态未保存/)
  failRead=false;actions.retry();await flush();assert.equal(state.selected.read,true)
  actions.back();await flush()
  pending=deferred();listPending=pending.promise;actions.retry();const staleActions=actions
  actions.back();assert.equal(router.current,'menu');const count=renders
  pending.resolve({...page([message('stale')]),unreadCount:1});await flush()
  staleActions.select('stale');assert.equal(renders,count,'stale load and old controls never resurrect a page')
  listPending=null
  controller.open('feedback');await flush();actions.select('f1')
  assert.equal(state.selected.replies[0].id,'r1');assert.equal(state.selected.status,'open')
  actions.compose();actions.content('  复现过程  ');actions.category('suggestion')
  assert.equal(state.content,'  复现过程  ','category changes preserve EditBox draft')
  controller.reflow();assert.equal(state.content,'  复现过程  ')
  failSubmit=true;actions.submit();assert.equal(state.submitting,true);await flush()
  assert.equal(state.content,'  复现过程  ');assert.match(state.error,/重试不会重复提交/)
  failSubmit=false;pending=deferred();submitPending=pending.promise
  actions.submit();const submittingActions=actions;submittingActions.submit()
  assert.equal(submits.length,2,'double tap cannot issue another pending submission')
  assert.equal(submits[0].key,submits[1].key,'uncertain retry reuses idempotency key')
  assert.deepEqual(submits[1].draft,{category:'suggestion',content:'复现过程'})
  actions.back();await flush();actions.back();assert.equal(router.current,'menu')
  const left=renders;pending.resolve({...feedback,content:'复现过程'});await flush()
  assert.equal(renders,left,'late submit success never opens a detail after leaving')
  controller.open('feedback');await flush();actions.compose();assert.equal(state.content,'','acknowledged draft is not resubmitted after re-entry')
  actions.content('');assert.match(actions.validate(),/填写/);actions.submit();assert.match(state.error,/填写/)
  const noSubmit=submits.length;actions.content('x'.repeat(2001));actions.submit();assert.equal(submits.length,noSubmit)
  actions.content('保留草稿');controller.suspend();const hidden=renders;controller.reflow();assert.equal(renders,hidden)
  controller.resume();assert.equal(state.content,'保留草稿');assert.equal(state.composing,true)
  pending=deferred();submitPending=pending.promise;actions.submit();actions.back();await flush();actions.back()
  controller.open('feedback');await flush();actions.compose();assert.equal(state.submitting,true)
  pending.resolve({...feedback,content:'保留草稿'});await flush()
  assert.equal(state.submitting,false,'reopened composer is not trapped by a pending old submission')
  assert.equal(state.selected,null,'old submit completion cannot replace the reopened view')
  assert.equal(state.content,'')
  assert.ok(inputCloses>0,'native input is closed before destruction/reflow/background')
  controller.destroy();disposed=true;controller.open('messages');assert.equal(router.current,'operations-feedback')
  const long='长文🙂'.repeat(2000)
  const pages=model.operationsTextPages(long)
  assert.ok(pages.length>10);assert.equal(pages.join('').replace(/\n/g,''),long,'all long Unicode content is reachable without clipping')
  assert.ok(model.feedbackDetail(feedback).includes(feedback.replies[0].content))
  testView()
}

function testView(){
  const buttons=[],texts=[],forms=[]
  class Ui {
    constructor(){this.ui={formInput(name,placeholder,x,y,options){const listeners={};const edit={name,placeholder,options,isValid:true,textLabel:{},placeholderLabel:{},node:{on(name,fn){listeners[name]=fn}},blur(){edit.blurred=true}};forms.push(edit);return edit}}}
    text(name,value,x,y,w,h){const label={name,string:value,x,y,w,h};texts.push(label);return label}
    button(name,title,x,y,width,action,primary,disabled){buttons.push({name,title,x,y,width,action,primary,disabled})}
  }
  const {renderOperationsPage}=load('scenes/front-pages/OperationsPageView.ts',{
    cc:{EditBox:{InputMode:{ANY:0}},Label:{HorizontalAlign:{LEFT:0},VerticalAlign:{TOP:0},Overflow:{CLAMP:1}}},
    './OperationsPageModel':model,'./OperationsPageUi':{OperationsPageUi:Ui,operationsPalette:{}},
  })
  const close=renderOperationsPage({}, {}, {...state,mode:'feedback',composing:true,content:'native',submitting:true,error:''},actions)
  assert.equal(forms[0].options.maxLength,2000);assert.equal(forms[0].enabled,false)
  assert.equal(forms[0].textLabel.overflow,1,'long native drafts cannot paint over validation/buttons')
  assert.equal(buttons.find(item=>item.name==='FeedbackSubmit').disabled,true)
  assert.ok(texts.some(item=>item.name==='FeedbackContentLabel'&&item.string.includes('必填')))
  assert.match(texts.find(item=>item.name==='FeedbackFieldHint').string,/授权运营人员/,'privacy copy accurately discloses staff access')
  assert.doesNotMatch(texts.find(item=>item.name==='FeedbackFieldHint').string,/仅对本人可见/)
  close();assert.equal(forms[0].blurred,true)
  const source=fs.readFileSync(path.join(root,'scenes/front-pages/OperationsPageUi.ts'),'utf8')
  assert.match(source,/safeLeft/);assert.match(source,/safeBottom/);assert.match(source,/width, 80, 28/)
  assert.ok(80*Math.min(740/1240,360/600)>=44,'compact landscape controls retain a minimum touch target')
  assert.doesNotMatch(fs.readFileSync(path.join(root,'scenes/front-pages/OperationsPageView.ts'),'utf8'),/window\.|prompt\(|innerHTML/)
}
run().then(()=>console.log('Operations pages: detail-only reads, pagination, native inputs, retained drafts and stale lifecycle isolation passed')).catch(error=>{console.error(error);process.exitCode=1})
