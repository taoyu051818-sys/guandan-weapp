import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PlayerId } from '../../types/game';
import { useGameStore } from '../../store/gameStore';
import { PlayingCard } from './PlayingCard';

interface PlayerAreaProps {
  playerId: PlayerId;
  position: 'top' | 'left' | 'right';
}

export const PlayerArea: React.FC<PlayerAreaProps> = ({ playerId, position }) => {
  const { players, currentTurn, gameMode, activeChats } = useGameStore();
  const player = players[playerId];
  const chat = activeChats?.[playerId];
  const isTurn = currentTurn === playerId;
  const isTeammate = playerId === 'p3';
  const isDoubleOpen = gameMode === 'double_open' && isTeammate;

  // 定位类 
  const positionClasses = {
    top: 'top-2 left-1/2 -translate-x-1/2 flex-row', // 对家置顶居中
    left: 'left-4 top-1/2 -translate-y-1/2 flex-col', // 上家恢复垂直居中
    right: 'right-4 top-1/2 -translate-y-1/2 flex-col' // 下家恢复垂直居中
  };
  const shellSizeClasses = 'gap-2 px-2 py-2';
  const avatarSizeClasses = 'w-11 h-11 text-[22px]';
  const infoSizeClasses = 'min-w-[94px]';
  const nameSizeClasses = 'text-base';
  const handMetaSizeClasses = 'text-[10px]';
  const handCountSizeClasses = 'text-xl';
  const teamTagSizeClasses = 'text-[9px] px-2 py-0.5';

  return (
    <motion.div
      className={`absolute flex items-center rounded-2xl glass-panel shadow-2xl ${shellSizeClasses} ${positionClasses[position]}`}
      animate={{
        scale: isTurn ? 1.05 : 1,
        borderColor: isTurn ? 'rgba(212, 175, 55, 0.6)' : 'rgba(255, 255, 255, 0.1)',
        boxShadow: isTurn ? '0 0 20px rgba(212, 175, 55, 0.3)' : '0 10px 30px -5px rgba(0, 0, 0, 0.5)',
      }}
    >
      {/* 头像 */}
      <div className="relative">
        <div className={`rounded-full bg-gradient-to-br from-luxury-slate to-luxury-obsidian flex items-center justify-center text-luxury-ivory font-cinzel font-bold shadow-inner border border-white/20 ${avatarSizeClasses}`}>
          {player.name.charAt(0)}
        </div>
        
        {/* 聊天气泡 */}
        <AnimatePresence>
          {chat && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: 10 }}
              className={`absolute z-50 px-4 py-2 bg-white text-gray-900 rounded-2xl shadow-xl text-sm font-bold whitespace-nowrap border-2 border-luxury-gold/50
                ${position === 'top' ? 'top-full mt-2 left-1/2 -translate-x-1/2' : 
                  position === 'left' ? 'left-full ml-4 top-1/2 -translate-y-1/2' : 
                  'right-full mr-4 top-1/2 -translate-y-1/2'}`}
            >
              {chat.message}
              {/* 气泡小尾巴 */}
              <div className={`absolute w-3 h-3 bg-white border-luxury-gold/50
                ${position === 'top' ? 'top-[-7px] left-1/2 -translate-x-1/2 border-t-2 border-l-2 rotate-45' : 
                  position === 'left' ? 'left-[-7px] top-1/2 -translate-y-1/2 border-b-2 border-l-2 rotate-45' : 
                  'right-[-7px] top-1/2 -translate-y-1/2 border-t-2 border-r-2 rotate-45'}`} 
              />
            </motion.div>
          )}
        </AnimatePresence>
        {isTurn && (
          <motion.div
            className="absolute -inset-1 border border-luxury-gold rounded-full"
            animate={{ scale: [1, 1.15, 1], opacity: [1, 0.3, 1] }}
            transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
          />
        )}
      </div>

      {/* 信息区 */}
      <div className={`flex flex-col ${infoSizeClasses} ${position === 'right' ? 'items-end text-right' : 'items-start text-left'}`}>
        <span className={`text-luxury-ivory font-bold drop-shadow-md tracking-wider whitespace-nowrap ${nameSizeClasses}`}>
          {player.name}
        </span>
        {isDoubleOpen ? (
          <div className="flex -space-x-12 scale-50 origin-top">
            {player.hand.map((card, i) => (
              <div key={card.id} style={{ zIndex: i }}>
                <PlayingCard card={card} />
              </div>
            ))}
          </div>
        ) : (
          <div className={`flex items-center gap-2 mt-1 ${position === 'right' ? 'flex-row-reverse' : 'flex-row'}`}>
            <span className={`text-white/40 uppercase tracking-widest whitespace-nowrap ${handMetaSizeClasses}`}>剩余手牌</span>
            <span className={`${handCountSizeClasses} font-black font-cinzel leading-none ${player.hand.length <= 5 ? 'text-luxury-crimson drop-shadow-[0_0_8px_rgba(139,0,0,0.8)]' : 'text-luxury-goldLight'}`}>
              {player.hand.length}
            </span>
          </div>
        )}
        {/* 队伍标识 */}
        <span className={`${teamTagSizeClasses} rounded-full font-bold tracking-widest uppercase border whitespace-nowrap ${position === 'top' ? 'mt-2 self-end' : 'mt-2'} ${
          player.team === 'teamA' 
            ? 'bg-blue-900/30 border-blue-400/30 text-blue-300' 
            : 'bg-red-900/30 border-red-400/30 text-red-300'
        }`}>
          {player.team === 'teamA' ? '队伍A' : '队伍B'}
        </span>
      </div>
    </motion.div>
  );
};
