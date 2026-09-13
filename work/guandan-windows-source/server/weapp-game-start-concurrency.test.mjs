import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createWeAppOperationScheduler, GLOBAL_OPERATION_KEY, operationKeyForCommand } from './weapp-operation-scheduler.js'
import { createWeAppGameStartCoordinator } from './weapp-game-start-coordinator.js'
import { createCommandGateway } from './weapp-command-gateway.js'
import { createCommandRouter } from './weapp-command-router.js'
import { createLobbyCommandHandler, LOBBY_COMMAND_TYPES } from './weapp-lobby-command-handler.js'
import { createAcceptedActionStore } from './weapp-accepted-action-store.js'
import { createRuntimePersistence } from './weapp-runtime-persistence.js'
import { createRoomMetadata } from './weapp-room-metadata.js'
import { createRoomOpeningState } from './match-format-policy.js'
const require = createRequire(import.meta.url), { getRuleProfile } = require('../../../shared-core/dist')
const { validateCommandRequestId, validateExpectedVersion } = require('../../../shared-core/dist/protocol')
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
const root=readFileSync(new URL('./weapp-ws.js', import.meta.url),'utf8')
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
 assert.equal(acceptedActions.has(`${b.resumeTokens.p1}:2`),true)
 assert.ok(snapshots.some(s=>s.acceptedActions.some(([k])=>k===`${b.resumeTokens.p1}:2`)))
 await command(cb,'cancelLobbyReady',3);assert.equal(b.lobbyReady.p1,false)
 await command(cb,'setLobbyReady',2);assert.equal(b.lobbyReady.p1,false)
 console.log(JSON.stringify({otherRoomReceivedAcceptance:true,otherRoomReceiptPreserved:true,readyAfterCancel:false,readyAfterSameRequestReplay:b.lobbyReady.p1,startReply:ca.packets.at(-1)?.type,writes},null,2))
} finally {coordinator.dispose();persistence.cancelPendingTimer()}
