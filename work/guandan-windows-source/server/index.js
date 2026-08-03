import { Server } from "socket.io";
import { createServer } from "http";
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { canPlay, getPlayInfo, PlayType } = require('../../../shared-core/dist');

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: { origin: "*" }
});

// roomId -> { hostName: string, seats: { p1..p4 }, state: any, version: number }
const rooms = new Map();

const playerIds = ['p1', 'p2', 'p3', 'p4'];
const nonHostPlayerIds = ['p2', 'p3', 'p4'];
const ROOM_ID_PATTERN = /^\d{6}$/;
const HOST_REJOIN_GRACE_MS = 15000;
const hostGraceTimers = new Map();

const getCardIds = (cards = []) => new Set(cards.map(card => card.id));

const createSeats = (hostSocketId) => ({
  p1: hostSocketId,
  p2: null,
  p3: null,
  p4: null,
});

const getAliveSocketId = (room, playerId) => {
  const socketId = room?.seats?.[playerId] || null;
  if (!socketId) return null;
  return io.sockets.sockets.has(socketId) ? socketId : null;
};

const getConnectedPlayerIds = (room) =>
  playerIds.filter((playerId) => getAliveSocketId(room, playerId));

const getPlayerCount = (room) => getConnectedPlayerIds(room).length;

const findPlayerIdBySocket = (room, socketId) =>
  playerIds.find((playerId) => room?.seats?.[playerId] === socketId) || null;

const isSeatJoinable = (room, playerId) => {
  const socketId = room?.seats?.[playerId] || null;
  if (!socketId) return true;
  return !io.sockets.sockets.has(socketId);
};

const buildJoinPayload = (roomId, room, myPlayerId) => ({
  state: room.state,
  roomId,
  myPlayerId,
  playerCount: getPlayerCount(room),
  memberPlayerIds: getConnectedPlayerIds(room),
  version: room.version || 0,
});

const clearHostGraceTimer = (roomId) => {
  const timer = hostGraceTimers.get(roomId);
  if (timer) {
    clearTimeout(timer);
    hostGraceTimers.delete(roomId);
  }
};

const scheduleHostRoomExpiry = (roomId) => {
  clearHostGraceTimer(roomId);
  const timer = setTimeout(() => {
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.seats.p1) return;
    io.to(roomId).emit("hostLeft");
    rooms.delete(roomId);
    hostGraceTimers.delete(roomId);
    broadcastRoomList();
  }, HOST_REJOIN_GRACE_MS);
  hostGraceTimers.set(roomId, timer);
};

const validateStateTransition = (prevState, nextState) => {
  if (!prevState || !nextState) return { ok: true };
  if (prevState.status !== 'playing' || nextState.status !== 'playing') return { ok: true };
  if (!Array.isArray(prevState.playArea) || !Array.isArray(nextState.playArea)) return { ok: true };

  // 只在“新增一次操作”场景执行严格校验，其余状态变化沿用兼容策略
  if (nextState.playArea.length !== prevState.playArea.length + 1) {
    return { ok: true };
  }

  const action = nextState.playArea[nextState.playArea.length - 1];
  if (!action || !action.playerId || !playerIds.includes(action.playerId)) {
    return { ok: false, reason: '非法出牌动作: playerId 无效' };
  }

  if (action.playerId !== prevState.currentTurn) {
    return { ok: false, reason: '非法出牌动作: 未轮到该玩家' };
  }

  const prevPlayer = prevState.players?.[action.playerId];
  const nextPlayer = nextState.players?.[action.playerId];
  if (!prevPlayer || !nextPlayer) {
    return { ok: false, reason: '非法状态: 玩家信息缺失' };
  }

  if (action.type === 'Pass') {
    if (!Array.isArray(action.cards) || action.cards.length !== 0) {
      return { ok: false, reason: '非法 pass: pass 不应携带牌' };
    }
    if (!prevState.lastValidPlay) {
      return { ok: false, reason: '非法 pass: 首发回合不能 pass' };
    }
    // pass 不应改变手牌数量
    if ((prevPlayer.hand || []).length !== (nextPlayer.hand || []).length) {
      return { ok: false, reason: '非法 pass: 手牌不应变化' };
    }
    return { ok: true };
  }

  if (!Array.isArray(action.cards) || action.cards.length === 0) {
    return { ok: false, reason: '非法出牌动作: 牌组为空' };
  }

  const prevHandIds = getCardIds(prevPlayer.hand || []);
  const nextHandIds = getCardIds(nextPlayer.hand || []);
  const actionCardIds = action.cards.map(card => card.id);
  const actionUnique = new Set(actionCardIds);

  if (actionUnique.size !== actionCardIds.length) {
    return { ok: false, reason: '非法出牌动作: 重复牌' };
  }

  for (const cardId of actionCardIds) {
    if (!prevHandIds.has(cardId)) {
      return { ok: false, reason: '非法出牌动作: 出了不属于自己的牌' };
    }
    if (nextHandIds.has(cardId)) {
      return { ok: false, reason: '非法出牌动作: 出牌后仍保留原牌' };
    }
  }

  const expectedLength = (prevPlayer.hand || []).length - action.cards.length;
  if ((nextPlayer.hand || []).length !== expectedLength) {
    return { ok: false, reason: '非法出牌动作: 手牌数量不一致' };
  }

  const playInfo = getPlayInfo(action.cards);
  if (!playInfo) {
    return { ok: false, reason: '非法出牌动作: 牌型不合法' };
  }
  if (playInfo.type !== action.type) {
    return { ok: false, reason: '非法出牌动作: 牌型类型与客户端声明不一致' };
  }

  const lastValidPlay = prevState.lastValidPlay;
  if (lastValidPlay && lastValidPlay.type !== PlayType.Pass) {
    if (!canPlay(action.cards, lastValidPlay)) {
      return { ok: false, reason: '非法出牌动作: 未满足压牌规则' };
    }
  }

  if (!nextState.lastValidPlay || nextState.lastValidPlay.playerId !== action.playerId) {
    return { ok: false, reason: '非法状态: lastValidPlay 未正确更新' };
  }

  return { ok: true };
};

const broadcastRoomList = () => {
  const roomList = [];
  for (const [roomId, room] of rooms.entries()) {
    if (!getAliveSocketId(room, 'p1')) continue;
    roomList.push({
      roomId,
      hostName: room.hostName || '神秘大师',
      playerCount: getPlayerCount(room),
    });
  }
  io.emit("roomListUpdate", roomList);
};

const broadcastRoomInfo = (roomId) => {
  const room = rooms.get(roomId);
  if (!room) return;
  io.to(roomId).emit("roomInfoUpdate", {
    roomId,
    hostName: room.hostName || '神秘大师',
    playerCount: getPlayerCount(room),
    memberPlayerIds: getConnectedPlayerIds(room),
  });
};

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);
  
  // 新连接的玩家立即收到当前可用的房间网络列表
  const initialRoomList = [];
  for (const [roomId, room] of rooms.entries()) {
    if (!getAliveSocketId(room, 'p1')) continue;
    initialRoomList.push({
      roomId,
      hostName: room.hostName || '神秘大师',
      playerCount: getPlayerCount(room),
    });
  }
  socket.emit("roomListUpdate", initialRoomList);

  socket.on("createRoom", (roomId, hostName, initialState) => {
    if (!ROOM_ID_PATTERN.test(roomId)) {
      socket.emit("error", "房间号必须是 6 位数字");
      return;
    }
    if (rooms.has(roomId)) {
      socket.emit("error", "房间号已存在，请重试");
      return;
    }
    rooms.set(roomId, { hostName, seats: createSeats(socket.id), state: initialState, version: 0 });
    socket.join(roomId);
    socket.emit("roomCreated", roomId);
    console.log(`Room created: ${roomId} by ${hostName}`);
    broadcastRoomList();
    broadcastRoomInfo(roomId);
  });

  socket.on("joinRoom", (roomId) => {
    const room = rooms.get(roomId);
    if (!ROOM_ID_PATTERN.test(roomId)) {
      socket.emit("error", "房间号格式错误");
      return;
    }
    if (!room) {
      socket.emit("error", "该游戏网络已满或不存在");
      return;
    }

    if (!getAliveSocketId(room, 'p1')) {
      socket.emit("error", "房主离线，房间暂不可加入");
      return;
    }

    const alreadyInRoomAs = findPlayerIdBySocket(room, socket.id);
    if (alreadyInRoomAs) {
      socket.join(roomId);
      socket.emit("joinedRoom", buildJoinPayload(roomId, room, alreadyInRoomAs));
      return;
    }

    const joinableSeat = nonHostPlayerIds.find((playerId) => isSeatJoinable(room, playerId));
    if (!joinableSeat) {
      socket.emit("error", "该游戏网络已满或不存在");
      return;
    }

    room.seats[joinableSeat] = socket.id;
    socket.join(roomId);
    socket.emit("joinedRoom", buildJoinPayload(roomId, room, joinableSeat));
    const hostSocketId = getAliveSocketId(room, 'p1');
    if (hostSocketId) {
      io.to(hostSocketId).emit("playerJoined", { playerId: joinableSeat });
    }
    console.log(`Player ${socket.id} joined ${roomId} as ${joinableSeat}`);
    broadcastRoomList();
    broadcastRoomInfo(roomId);
  });

  socket.on("rejoinRoom", (roomId, myPlayerId) => {
    const room = rooms.get(roomId);
    if (!room || !playerIds.includes(myPlayerId)) {
      socket.emit("error", "重连失败：房间或席位无效");
      return;
    }

    const seatSocketId = room.seats[myPlayerId];
    if (seatSocketId && seatSocketId !== socket.id && io.sockets.sockets.has(seatSocketId)) {
      socket.emit("error", "重连失败：席位已被占用");
      return;
    }

    room.seats[myPlayerId] = socket.id;
    if (myPlayerId === 'p1') {
      clearHostGraceTimer(roomId);
    }
    socket.join(roomId);
    socket.emit("rejoinedRoom", buildJoinPayload(roomId, room, myPlayerId));
    broadcastRoomList();
    broadcastRoomInfo(roomId);
  });

  socket.on("leaveRoom", (roomId) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const playerId = findPlayerIdBySocket(room, socket.id);
    if (!playerId) return;

    socket.leave(roomId);

    if (playerId === 'p1') {
      clearHostGraceTimer(roomId);
      io.to(roomId).emit("hostLeft");
      rooms.delete(roomId);
      broadcastRoomList();
      return;
    }

    room.seats[playerId] = null;
    const hostSocketId = getAliveSocketId(room, 'p1');
    if (hostSocketId) {
      io.to(hostSocketId).emit("playerLeft", { playerId });
    }
    broadcastRoomInfo(roomId);
    broadcastRoomList();
  });

  socket.on("updateState", (roomId, payload) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const senderPlayerId = findPlayerIdBySocket(room, socket.id);
    if (!senderPlayerId) return;

    const isPacket = payload && typeof payload === 'object' && 'state' in payload && 'version' in payload;
    const nextState = isPacket ? payload.state : payload;
    const incomingVersion = isPacket ? Number(payload.version) : null;

    const validation = validateStateTransition(room.state, nextState);
    if (!validation.ok) {
      socket.emit("error", validation.reason || "非法状态更新");
      return;
    }

    if (incomingVersion !== null) {
      if (!Number.isFinite(incomingVersion)) {
        socket.emit("error", "非法同步版本号");
        return;
      }
      if (incomingVersion <= (room.version || 0)) {
        socket.emit("error", "状态版本过旧，已拒绝回滚");
        return;
      }
      room.version = incomingVersion;
    } else {
      room.version = (room.version || 0) + 1;
    }

    room.state = nextState;
    socket.to(roomId).emit("stateUpdated", { state: nextState, version: room.version });
  });

  socket.on("disconnect", () => {
    let changed = false;
    for (const [roomId, room] of rooms.entries()) {
      const playerId = findPlayerIdBySocket(room, socket.id);
      if (!playerId) continue;

      if (playerId === 'p1') {
        room.seats.p1 = null;
        io.to(roomId).emit("hostPendingReconnect", { timeoutMs: HOST_REJOIN_GRACE_MS });
        scheduleHostRoomExpiry(roomId);
        broadcastRoomInfo(roomId);
        changed = true;
      } else {
        room.seats[playerId] = null;
        const hostSocketId = getAliveSocketId(room, 'p1');
        if (hostSocketId) {
          io.to(hostSocketId).emit("playerLeft", { playerId });
        }
        changed = true;
        broadcastRoomInfo(roomId);
      }
    }
    if (changed) {
      broadcastRoomList();
    }
    console.log("Player disconnected:", socket.id);
  });
});

const PORT = 3001;
httpServer.listen(PORT, () => {
  console.log(`Guandan Multiplayer Server running on port ${PORT}`);
});
