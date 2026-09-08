/** Local mock flows only. No timers, network requests, login, or real room mutations. */
export function createLobbyFlows(status, getState) {
  const dialog = document.getElementById('flow-dialog'), body = document.getElementById('flow-body')
  const title = document.getElementById('flow-title')
  function show(name, content) { title.textContent=name; body.replaceChildren(); content(body); if (!dialog.open) dialog.showModal(); document.getElementById('flow-close').focus() }
  function p(parent,text) { const node=document.createElement('p');node.textContent=text;parent.append(node);return node }
  function button(parent,text,action,primary=false) { const b=document.createElement('button'); b.textContent=text;b.className=primary?'flow-primary':''; b.onclick=action;parent.append(b);return b }
  function matching() {
    show('匹配中',root=>{p(root,'随机级牌 · 单局对战');p(root,'这是交互预览，不会加入真实房间，也不会自动安排机器人。');button(root,'取消匹配',()=>dialog.close(),true)})
  }
  function friend() {
    show('好友房',root=>{p(root,'和朋友约一局，先选择创建或加入。');
      button(root,'创建房间',()=>show('创建好友房',r=>{p(r,'此处预览创建后的信息层级；完整房间规则仍由正式游戏提供。');p(r,'规则摘要 → 四人席位 → 邀请朋友 → 准备开始');button(r,'查看等待页',()=>show('等待朋友加入',wait=>{p(wait,'你（房主）  /  空位  /  空位  /  空位');p(wait,'未创建真实房间，无可分享房间号。');button(wait,'返回好友房',friend,true)}),true);button(r,'返回好友房',friend)}),true)
      button(root,'加入房间',()=>show('加入好友房',r=>{
        const label=document.createElement('label');label.textContent='房间号';const input=document.createElement('input');input.placeholder='输入房间号';input.inputMode='numeric';input.maxLength=12;label.append(input);r.append(label)
        const message=p(r,'预览不会检查服务器或提交加入请求。');message.setAttribute('role','status')
        button(r,'确认加入',()=>{message.textContent=input.value.trim()?'已填写房间号。此为布局预览，不会加入真实房间。':'请先输入房间号。';if(!input.value.trim())input.focus()},true);button(r,'返回好友房',friend)
      }))
    })
  }
  function open(id) {
    if (id==='classic') return show('经典掼蛋',r=>{p(r,'随机一个级数，打一局即可结算。');p(r,'不需要从 2 一直升级打到 A。');button(r,'开始匹配',matching,true)})
    if (id==='quick') return getState()==='resume'?show('继续牌局',r=>{p(r,'正式版会确认账号与房间状态，再返回牌桌。此预览不执行恢复请求。');button(r,'返回大厅',()=>dialog.close(),true)}):matching()
    if (id==='friend') return friend()
    const entries={
      tournament:['赛事筹备中','赛事入口暂作功能介绍，不提供报名、排名或奖励承诺。'],
      shop:['商城','保留日用品商城入口。本轮只模拟页面导航，不展示虚构价格、不提交购买。'],
      avatar:['个人资料','陵水玩家 · 示例账号 ID 12345678。头像、昵称与积分均为预览数据。'],
      identity:['个人资料','账号 ID 12345678 已从大厅收进这里，给顶部信息留出空间。'],
    }
    const entry=entries[id];if(entry)show(entry[0],r=>p(r,entry[1]));else status('该入口仅用于原版布局对照。')
  }
  document.getElementById('flow-close').onclick=()=>dialog.close()
  dialog.addEventListener('click',e=>{if(e.target===dialog){const box=dialog.getBoundingClientRect();if(e.clientX<box.left||e.clientX>box.right||e.clientY<box.top||e.clientY>box.bottom)dialog.close()}})
  return {open}
}
