import React, { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { socket, connectSocket } from '../lib/socket';
import { motion, AnimatePresence } from 'framer-motion';
import { Wifi, Search, UserPlus, Play, ArrowLeft } from 'lucide-react';
import { toSyncedGameState, type JoinedRoomPayload } from '../lib/multiplayerSync';

interface NetworkRoom {
  roomId: string;
  hostName: string;
  playerCount: number;
}

export const Lobby: React.FC = () => {
  const { setGameState, roomId, myPlayerId } = useGameStore();
  const [inputRoom, setInputRoom] = useState('');
  const [error, setError] = useState('');
  const [inRoom, setInRoom] = useState(false);
  const [roomPlayers, setRoomPlayers] = useState<string[]>([]);
  const [availableNetworks, setAvailableNetworks] = useState<NetworkRoom[]>([]);
  const [isScanning, setIsScanning] = useState(true);
  const [isSocketReady, setIsSocketReady] = useState(socket.connected);

  const showError = (message: string) => {
    setError(message);
    setTimeout(() => setError(''), 3000);
  };

  useEffect(() => {
    connectSocket();

    socket.on('connect', () => {
      setIsSocketReady(true);
    });

    socket.on('disconnect', () => {
      setIsSocketReady(false);
    });

    socket.on('connect_error', () => {
      setIsSocketReady(false);
      showError('联机服务未连接，请先启动 server/index.js');
    });

    socket.on('roomListUpdate', (list: NetworkRoom[]) => {
      setAvailableNetworks(list);
    });

    socket.on('roomCreated', (id) => {
      setGameState({ roomId: id, myPlayerId: 'p1', isMultiplayer: true, status: 'lobby' });
      setInRoom(true);
      setRoomPlayers(['p1']);
    });

    socket.on('joinedRoom', (payload: JoinedRoomPayload) => {
      setGameState({ ...payload.state, isMultiplayer: true, status: 'lobby', roomId: payload.roomId, myPlayerId: payload.myPlayerId });
      setInRoom(true);
      const members = payload.memberPlayerIds && payload.memberPlayerIds.length > 0
        ? payload.memberPlayerIds
        : Array.from({ length: payload.playerCount }, (_, i) => `p${i + 1}`);
      setRoomPlayers(members);
    });

    socket.on('playerJoined', () => {
      setRoomPlayers(prev => {
        const nextPlayers = [...prev, `p${prev.length + 1}`];
        return nextPlayers;
      });
    });

    socket.on('roomInfoUpdate', (info: { roomId: string; playerCount: number; memberPlayerIds?: Array<'p1' | 'p2' | 'p3' | 'p4'> }) => {
      const members = info.memberPlayerIds && info.memberPlayerIds.length > 0
        ? info.memberPlayerIds
        : Array.from({ length: info.playerCount }, (_, i) => `p${i + 1}`);
      setRoomPlayers(members);
    });

    socket.on('error', (msg) => {
      showError(msg);
    });

    // 模拟雷达扫描动画的停止
    const timer = setInterval(() => {
      setIsScanning(prev => !prev);
    }, 4000);

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('connect_error');
      socket.off('roomListUpdate');
      socket.off('roomCreated');
      socket.off('joinedRoom');
      socket.off('playerJoined');
      socket.off('roomInfoUpdate');
      socket.off('error');
      clearInterval(timer);
    };
  }, [setGameState]);

  useEffect(() => {
    const { myPlayerId: currentMyId, roomId: currentRoomId } = useGameStore.getState();
    if (!inRoom) return;
    if (currentMyId !== 'p1') return;
    if (!currentRoomId) return;
    if (roomPlayers.length === 4) {
      const newState = { status: 'grouping' as const };
      setGameState(newState);
    }
  }, [inRoom, roomPlayers.length, setGameState]);

  const leaveLobby = (backToMenu: boolean) => {
    const { roomId: currentRoomId } = useGameStore.getState();
    if (currentRoomId) {
      socket.emit('leaveRoom', currentRoomId);
    }
    setInRoom(false);
    setRoomPlayers([]);
    setGameState({
      status: backToMenu ? 'menu' : 'lobby',
      isMultiplayer: !backToMenu,
      roomId: null,
      myPlayerId: 'p1',
    });
  };

  const createRoom = () => {
    if (!socket.connected) {
      connectSocket();
      showError('正在连接联机服务，请稍后再试');
      return;
    }
    const id = Math.floor(100000 + Math.random() * 900000).toString();
    const state = useGameStore.getState();
    socket.emit('createRoom', id, state.players['p1'].name, toSyncedGameState(state));
  };

  const joinRoom = (targetId: string) => {
    if (!socket.connected) {
      connectSocket();
      showError('正在连接联机服务，请稍后再试');
      return;
    }
    if (targetId.length === 6) {
      socket.emit('joinRoom', targetId);
    }
  };

  const startGame = () => {
    if (myPlayerId === 'p1') {
      const newState = { status: 'grouping' as const };
      setGameState(newState);
    }
  };

  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen bg-luxury-obsidian text-luxury-ivory font-outfit overflow-hidden">
      {/* 动态雷达背景 */}
      <div className="absolute inset-0 flex items-center justify-center opacity-20 pointer-events-none">
        <motion.div 
          className="absolute w-[800px] h-[800px] border border-luxury-gold/30 rounded-full"
          animate={{ scale: [1, 1.5], opacity: [0.8, 0] }}
          transition={{ repeat: Infinity, duration: 4, ease: "linear" }}
        />
        <motion.div 
          className="absolute w-[600px] h-[600px] border border-luxury-gold/50 rounded-full"
          animate={{ scale: [1, 1.5], opacity: [0.8, 0] }}
          transition={{ repeat: Infinity, duration: 4, delay: 1.3, ease: "linear" }}
        />
        <motion.div 
          className="absolute w-[400px] h-[400px] border border-luxury-gold/80 rounded-full"
          animate={{ scale: [1, 1.5], opacity: [0.8, 0] }}
          transition={{ repeat: Infinity, duration: 4, delay: 2.6, ease: "linear" }}
        />
      </div>

      <div className="z-10 w-full max-w-2xl px-6">
        {!inRoom ? (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-panel p-8 rounded-2xl border border-luxury-gold/30 shadow-2xl"
          >
            <div className="flex justify-between items-center mb-8 border-b border-white/10 pb-6">
              <div>
                <h1 className="text-3xl font-cinzel font-bold text-luxury-goldLight tracking-widest flex items-center gap-3">
                  <Wifi className="text-luxury-gold" size={28} />
                  局域网对战
                </h1>
                <p className="text-white/50 text-sm mt-2 tracking-wider">连接同一个网络，即可发现彼此</p>
                <p className={`text-xs mt-2 ${isSocketReady ? 'text-emerald-400' : 'text-red-400'}`}>
                  {isSocketReady ? '联机服务已连接' : '联机服务未连接'}
                </p>
              </div>
              <button 
                onClick={() => leaveLobby(true)}
                className="p-2 rounded-full hover:bg-white/10 transition-colors text-white/50 hover:text-white"
                title="返回主菜单"
              >
                <ArrowLeft size={24} />
              </button>
            </div>

            {/* 创建游戏 */}
            <div className="mb-10">
              <button 
                onClick={createRoom} 
                className="relative group w-full py-4 bg-gradient-to-r from-luxury-goldDark to-luxury-gold text-luxury-obsidian rounded-xl overflow-hidden shadow-gold-glow transition-all hover:scale-[1.02]"
              >
                <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                <span className="relative z-10 flex items-center justify-center gap-3 font-black tracking-widest text-lg">
                  <Wifi size={20} />
                  发射游戏网络 (建房)
                </span>
              </button>
            </div>

            {/* 发现网络 */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white/80 tracking-widest flex items-center gap-2">
                  <Search size={18} className={isScanning ? 'animate-pulse text-luxury-gold' : 'text-white/50'} />
                  附近的游戏网络
                </h3>
                {isScanning && <span className="text-luxury-gold text-xs animate-pulse">正在扫描...</span>}
              </div>

              <div className="space-y-3 min-h-[200px] max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                <AnimatePresence>
                  {availableNetworks.length === 0 ? (
                    <motion.div 
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                      className="flex flex-col items-center justify-center h-32 text-white/30 border border-dashed border-white/10 rounded-xl"
                    >
                      <Wifi size={32} className="mb-2 opacity-50" />
                      <p className="text-sm">暂未发现附近的对局</p>
                    </motion.div>
                  ) : (
                    availableNetworks.map(net => (
                      <motion.div 
                        key={net.roomId}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        className="flex items-center justify-between p-4 bg-black/40 border border-white/10 rounded-xl hover:border-luxury-gold/50 hover:bg-white/5 transition-all group"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-full bg-luxury-slate border border-luxury-gold/30 flex items-center justify-center font-cinzel text-luxury-gold">
                            {net.hostName.charAt(0)}
                          </div>
                          <div>
                            <div className="font-bold text-white/90">{net.hostName} 的牌局</div>
                            <div className="text-xs text-white/40 mt-1">网络 ID: {net.roomId}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-sm text-white/50 flex items-center gap-1">
                            <UserPlus size={14} />
                            {net.playerCount}/4
                          </div>
                          <button 
                            onClick={() => joinRoom(net.roomId)}
                            disabled={net.playerCount >= 4}
                            className="px-5 py-2 bg-luxury-slate border border-luxury-gold text-luxury-goldLight rounded-lg hover:bg-luxury-gold hover:text-luxury-obsidian transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-bold tracking-wider"
                          >
                            加入
                          </button>
                        </div>
                      </motion.div>
                    ))
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* 手动加入 fallback */}
            <div className="mt-8 pt-6 border-t border-white/10 flex items-center gap-3">
              <input 
                type="text" 
                maxLength={6}
                value={inputRoom}
                onChange={e => setInputRoom(e.target.value.replace(/\D/g, ''))}
                className="flex-1 px-4 py-3 bg-black/50 border border-white/10 rounded-xl outline-none text-white focus:border-luxury-gold/50 transition-colors font-mono tracking-widest placeholder:tracking-normal" 
                placeholder="或直接输入 6 位网络 ID 加入..." 
              />
              <button 
                onClick={() => joinRoom(inputRoom)}
                disabled={inputRoom.length !== 6}
                className="px-6 py-3 bg-white/10 border border-white/20 rounded-xl text-white/80 hover:bg-white/20 disabled:opacity-50 transition-colors font-bold tracking-widest whitespace-nowrap"
              >
                连接
              </button>
            </div>
            {error && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-400 text-sm mt-3 text-center">
                {error}
              </motion.p>
            )}
          </motion.div>
        ) : (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-panel p-10 rounded-2xl border border-luxury-gold shadow-[0_0_50px_rgba(212,175,55,0.2)] text-center"
          >
            <div className="flex justify-end mb-2">
              <button
                onClick={() => leaveLobby(true)}
                className="p-2 rounded-full hover:bg-white/10 transition-colors text-white/50 hover:text-white"
                title="离开房间"
              >
                <ArrowLeft size={22} />
              </button>
            </div>
            <div className="w-24 h-24 mx-auto bg-luxury-slate rounded-full border-4 border-luxury-gold flex items-center justify-center mb-6 shadow-inner relative">
              <Wifi size={40} className="text-luxury-gold animate-pulse" />
              <div className="absolute -inset-2 border-2 border-luxury-gold/30 rounded-full animate-ping" />
            </div>
            
            <h2 className="text-3xl font-cinzel font-bold text-luxury-goldLight mb-2 tracking-widest">
              网络已建立
            </h2>
            <p className="text-white/50 mb-8">邀请使用同一个 WiFi 的好友加入对局</p>

            <div className="inline-block bg-black/60 border border-white/10 rounded-xl p-4 mb-10">
              <div className="text-xs text-white/40 tracking-widest uppercase mb-1">网络 ID (房间号)</div>
              <div className="text-4xl font-mono font-bold text-white tracking-[0.2em]">{roomId}</div>
            </div>

            <div className="grid grid-cols-4 gap-4 mb-10">
              {[0, 1, 2, 3].map((index) => {
                const isJoined = index < roomPlayers.length;
                const isMe = index === 0 && myPlayerId === 'p1';
                return (
                  <div key={index} className={`aspect-square rounded-xl flex flex-col items-center justify-center border ${isJoined ? 'bg-luxury-slate/80 border-luxury-gold/50' : 'bg-black/30 border-white/10 border-dashed'}`}>
                    {isJoined ? (
                      <>
                        <div className="w-10 h-10 rounded-full bg-luxury-gold/20 flex items-center justify-center mb-2">
                          <span className="font-cinzel font-bold text-luxury-goldLight text-lg">P{index + 1}</span>
                        </div>
                        <span className="text-xs text-white/70">{isMe ? '房主 (我)' : '已连接'}</span>
                      </>
                    ) : (
                      <span className="text-white/30 text-sm">等待加入...</span>
                    )}
                  </div>
                );
              })}
            </div>

            {myPlayerId === 'p1' ? (
              <button 
                onClick={startGame}
                disabled={roomPlayers.length < 4}
                className="w-full py-4 bg-luxury-gold text-luxury-obsidian rounded-xl font-black tracking-widest text-lg hover:bg-luxury-goldLight transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Play size={20} />
                {roomPlayers.length < 4 ? '等待全员就绪' : '开启牌局'}
              </button>
            ) : (
              <div className="w-full py-4 bg-luxury-slate/50 border border-white/10 rounded-xl text-white/50 font-bold tracking-widest flex items-center justify-center gap-2">
                <span className="animate-pulse">等待房主开始...</span>
              </div>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
};
