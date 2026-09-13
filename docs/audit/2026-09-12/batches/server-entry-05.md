# 服务端完整入口与开局审计：server-entry-05

日期：2026-09-12。审阅者：audit_server_authority。仓库 `/Users/mac/Documents/Codex/2026-08-02/wo-yi`，HEAD `1d58999dc6e5455b049e1643660bbba3deee1406`。

本批完整审阅4文件共1418行。子审查在最终报告阶段中断；根线程已重新完整读四文件、独立复跑下述探针并完成收尾。范围、SHA-256、逐文件notes见 [JSON](server-entry-05.json)。只写本批审计材料，不修改业务、原五处dirty或线上。

## SE-05-001 / P2：开局失败的全局回执回滚影响另一房已成功操作

`weapp-game-start-coordinator.js:168` 在最终开局保存前复制全局 `acceptedActions`；保存失败时 `:185-186` 清空全局Map并恢复旧快照。`weapp-ws.js:672-676` 正常按房间并行，A房开局保存等待期间，B房的准备操作可登记回执并排入成功保存，随后收到确认。A的失败回滚却将B在旧快照后增加的回执一并删除。

完整探针使用当前真实入口函数及scheduler/gateway/router/lobby/coordinator/acceptedStore/runtimePersistence，仅存储、发布和平台响应注入内存端口。按真实顺序保存队列的第3次（最终开局提交）注入一次失败。B准备成功保存并收到actionAccepted后，live回执消失；B先取消准备，再送相同请求ID的原准备动作，状态又变为ready。原调用正确经过身份/请求校验，lobby无state，不使用对局版本门禁。网关依赖被删除的Map回执识别重复，不能阻止这次重新执行。

根线程独立复跑退出0，输出 `otherRoomReceivedAcceptance=true`、`otherRoomReceiptErased=true`、`readyAfterSameRequestReplay=true`、6次保存调用。错误日志 `synthetic third save fails` 为有意注入，并非未处理测试失败。只证实准备状态重复改变，未证明积分、终局或其他业务重复，也不宣称线上已发生。

建议：回滚只处理本次开局拥有且代次/对象仍匹配的回执或预留项，不能恢复全局历史Map覆盖其他房间；给跨房并发加故障回归。这个问题不依赖Q-04-C01的入队房间键改变，不与其合并或重复计数。

完整入口另核对了公开观战事件、配置/依赖注入、连接清理、关闭记录、按房调度、平台副作用及停机。Q-04-C01与CN-02-C01仍未有独立业务错误复现，保留待验证；已有SL/SP/SD问题仅关联，不新增计数。

既有 `node --test work/guandan-windows-source/server/weapp-game-start-coordinator.test.mjs` 根线程执行1项通过。该测试的保存失败覆盖claim标记，不覆盖finalize跨房全局回滚；其正常顺序通过不能排除本条。

以下探针不执行服务器模块顶层、不读取真实配置/快照，无网络或真实存储写入。共享核心dist为服务器实际依赖，本批没有重建。

## 跨房间开局回滚探针

cwd 为仓库根：

```sh
node --input-type=module <<'NODE'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createWeAppOperationScheduler, GLOBAL_OPERATION_KEY, operationKeyForCommand } from './work/guandan-windows-source/server/weapp-operation-scheduler.js'
import { createWeAppGameStartCoordinator } from './work/guandan-windows-source/server/weapp-game-start-coordinator.js'
import { createCommandGateway } from './work/guandan-windows-source/server/weapp-command-gateway.js'
import { createCommandRouter } from './work/guandan-windows-source/server/weapp-command-router.js'
import { createLobbyCommandHandler, LOBBY_COMMAND_TYPES } from './work/guandan-windows-source/server/weapp-lobby-command-handler.js'
import { createAcceptedActionStore } from './work/guandan-windows-source/server/weapp-accepted-action-store.js'
import { createRuntimePersistence } from './work/guandan-windows-source/server/weapp-runtime-persistence.js'
import { createRoomMetadata } from './work/guandan-windows-source/server/weapp-room-metadata.js'
import { createRoomOpeningState } from './work/guandan-windows-source/server/match-format-policy.js'
const require = createRequire(import.meta.url), { getRuleProfile } = require('./shared-core/dist')
const { validateCommandRequestId, validateExpectedVersion } = require('./shared-core/dist/protocol')
const ids = ['p1','p2','p3','p4'], rooms = new Map(), connections = new Map(), timers = new Set(), snapshots = []
const noop = () => {}, scheduleTimeout = fn => { const t = { fn, unref(){} }; timers.add(t); return t }, cancelTimeout = t => timers.delete(t)
const operationScheduler = createWeAppOperationScheduler(), acceptedStore = createAcceptedActionStore({ maxEntries: 512 }), acceptedActions = acceptedStore.entries
const metadata = createRoomMetadata({ playerIds: ids, createResumeToken: () => 'audit-placeholder', createBotSeed: () => 1,
 entryKindForClaims: () => 'friend', entryDeadlineForClaims: c => c.roomExpiresAt })
for (const roomId of ['915051','915052']) {
 const room = metadata.createRoomRecord({ roomId, ticketClaims: { roomKind:'friend', matchId:`audit-${roomId}`, roomExpiresAt:Date.now()+600000 } })
 for (const id of ids) { const c = { id:`${roomId}-${id}`, roomId, acceptingCommands:true, pendingCommands:0, acceptedCacheKeys:new Map(), socket:{destroyed:false}, packets:[] }; connections.set(c.id,c); room.seats[id]=c.id; room.resumeTokens[id]=`token-${c.id}`; room.lobbyReady[id]=roomId==='915051' }
 rooms.set(roomId, room)
}
const a=rooms.get('915051'), b=rooms.get('915052'), ca=connections.get(a.seats.p1), cb=connections.get(b.seats.p1)
const send=(c,type,payload)=>c.packets.push({type,...structuredClone(payload)})
const playerIn=(r,cid)=>ids.find(id=>r.seats[id]===cid)||null, isFriendRoom=r=>r.entryKind==='friend', isMatchRoom=()=>false
let writes=0, writeTail=Promise.resolve(), rejectWrite, announceBlocked
const blocked = new Promise(r=>announceBlocked=r), failure = new Promise((_,r)=>rejectWrite=r)
const roomStateStore={configured:true, save(snapshot){ const copy=structuredClone(snapshot); const ordinal=++writes; const op=writeTail.then(async()=>{ if(ordinal===3){announceBlocked();await failure} snapshots.push(copy) }); writeTail=op.catch(noop); return op }}
const persistence=createRuntimePersistence({roomStateStore,acceptedActions,persistedRuntimeSnapshot:()=>({rooms:[...rooms.values()],acceptedActions:[...acceptedActions]}),debounceMs:20,isShuttingDown:()=>false,setTimeout:scheduleTimeout,clearTimeout:cancelTimeout})
const commitRuntimeState=async()=>{persistence.persistRuntimeState();await persistence.flushRuntimeState({throwOnError:true})}
const enqueueServerOperation=(fn,label,roomId)=>roomId?operationScheduler.enqueue(`room:${roomId}`,fn,label):operationScheduler.enqueueGlobal(fn,label)
const common={ids,playerIds:ids,rooms,connections,acceptedActions,isFriendRoom,isMatchRoom,playerIn,
 seatHasLiveConnection:(r,id)=>Boolean(connections.get(r.seats[id])?.acceptingCommands),seatIsOccupied:(r,id)=>Boolean(connections.get(r.seats[id])?.acceptingCommands),
 ensureLobbyMetadata:metadata.ensureLobbyMetadata,commitRuntimeState,persistRuntimeState:persistence.persistRuntimeState,
 initializeRoomMatch:r=>{r.state=createRoomOpeningState(r,getRuleProfile('classic'),()=>0.4,metadata.isBotPlayer);r.gameVersion=r.state.revision},
 spectatorEventReporter:{claimStart:async()=>({accepted:true})},armMatchDuration:noop,armTurnDeadline:noop,publishState:noop,publishRoomMembers:noop,publishLobbyReady:noop,
 rememberAccepted:acceptedStore.remember,send,enqueueServerOperation,closeRoomWithoutAck:async()=>{throw Error('unexpected close')}}
const coordinator=createWeAppGameStartCoordinator({...common,emptyRoomTimeoutMs:60000,isShuttingDown:()=>false,scheduleTimeout,cancelTimeout})
const lobby=createLobbyCommandHandler({...common,prepareGameStartClaim:coordinator.prepare,publishGameStartPending:coordinator.publishPending,persistClaimedGameStart:coordinator.persistClaimedStart,
 isTerminalGameStartClaimError:coordinator.isTerminalClaimError,abandonUnclaimedGameStart:coordinator.abandon,scheduleGameStartClaim:coordinator.scheduleClaim,finalizeClaimedGameStart:coordinator.finalizeClaimedStart})
const handleCommand=createCommandGateway({...common,idempotentActionTypes:new Set(LOBBY_COMMAND_TYPES),actionCacheKey:(r,c,id)=>r?`${r.resumeTokens[playerIn(r,c.id)]}:${id}`:null,
 actionFingerprint:(type,p)=>JSON.stringify([type,p]),validateCommandRequestId,validateExpectedVersion,
 scheduleGameStartClaim:coordinator.scheduleClaim,reserveAccepted:acceptedStore.reserve,releaseAccepted:acceptedStore.release,stagePendingSideEffects:noop,
 publishCurrentRoom:noop,router:createCommandRouter([{types:LOBBY_COMMAND_TYPES,handle:lobby}])})
const root=readFileSync('work/guandan-windows-source/server/weapp-ws.js','utf8')
const source=root.slice(root.indexOf('const enqueueCommand ='),root.indexOf('\nconst rejectInvalidProtocolMessage ='))
const dependencies={shuttingDown:false,consumeCommandBudget:()=>true,send,COMMAND_RATE_WINDOW_MS:1000,MAX_PENDING_COMMANDS:64,duplicateRooms:{owns:()=>false},handleCommand,
 operationKeyForCommand,rooms,ENTRY_COMMAND_TYPES:['createRoom','joinRoom','rejoinRoom'],GLOBAL_OPERATION_KEY,operationScheduler}
const enqueueCommand=new Function(...Object.keys(dependencies),`${source}; return enqueueCommand`)(...Object.values(dependencies))
const command=(c,type,requestId)=>enqueueCommand(c,{type,requestId,payload:{roomId:c.roomId,expectedVersion:0}})
try {
 const start=command(ca,'startGame',1);await blocked
 const ready=command(cb,'setLobbyReady',2)
 for(let i=0;i<20&&!acceptedActions.has(`${b.resumeTokens.p1}:2`);i++) await new Promise(setImmediate)
 assert.equal(b.lobbyReady.p1,true);assert.equal(acceptedActions.has(`${b.resumeTokens.p1}:2`),true)
 rejectWrite(Error('synthetic third save fails'));await Promise.all([start,ready])
 assert.ok(cb.packets.some(p=>p.type==='actionAccepted'&&p.requestId===2))
 assert.equal(acceptedActions.has(`${b.resumeTokens.p1}:2`),false)
 assert.ok(snapshots.some(s=>s.acceptedActions.some(([k])=>k===`${b.resumeTokens.p1}:2`)))
 await command(cb,'cancelLobbyReady',3);assert.equal(b.lobbyReady.p1,false)
 await command(cb,'setLobbyReady',2);assert.equal(b.lobbyReady.p1,true)
 console.log(JSON.stringify({otherRoomReceivedAcceptance:true,otherRoomReceiptErased:true,readyAfterCancel:false,readyAfterSameRequestReplay:b.lobbyReady.p1,startReply:ca.packets.at(-1)?.type,writes},null,2))
} finally {coordinator.dispose();persistence.cancelPendingTimer()}
NODE
```
