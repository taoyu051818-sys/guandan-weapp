import React from 'react';
import { useGameStore } from '../../store/gameStore';
import { PlayingCard } from './PlayingCard';
import { PlayerId } from '../../types/game';
import { motion, AnimatePresence } from 'framer-motion';

// 控制打出的牌显示的位置（上下左右），进一步向各家名片靠拢，留出中间大量留白
  const getPlayerPosition = (playerId: PlayerId) => {
    switch (playerId) {
      case 'p1': return 'bottom-[240px] left-1/2 -translate-x-1/2 flex-col';
      case 'p2': return 'right-[150px] top-1/2 -translate-y-1/2 flex-row-reverse';
      case 'p3': return 'top-[100px] left-1/2 -translate-x-1/2 flex-col';
      case 'p4': return 'left-[150px] top-1/2 -translate-y-1/2 flex-row';
      default: return 'bottom-[240px] left-1/2 -translate-x-1/2 flex-col';
    }
  };

  // 控制“不出”对话框的位置，同步紧贴名片正下方
  const getPassDialogPosition = (playerId: PlayerId) => {
    switch (playerId) {
      case 'p1': return 'bottom-[240px] left-1/2 -translate-x-1/2';
      case 'p2': return 'right-[120px] top-1/2 -translate-y-1/2'; 
      case 'p3': return 'top-[100px] left-1/2 -translate-x-1/2'; 
      case 'p4': return 'left-[120px] top-1/2 -translate-y-1/2'; 
      default: return 'bottom-[240px] left-1/2 -translate-x-1/2';
    }
  };

export const PlayArea: React.FC = () => {
  const { playArea } = useGameStore();

  // 获取每个玩家最后一次出牌
  const latestPlays = playArea.slice(-4);

  return (
    <div className="absolute inset-0 w-full h-full pointer-events-none">
      <AnimatePresence>
        {latestPlays.map((action, idx) => (
          <motion.div
            key={`${action.playerId}-${Math.max(0, playArea.length - 4) + idx}`}
            initial={{ opacity: 0, scale: 0.5, y: action.type === 'Pass' ? 0 : 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className={`absolute ${action.type === 'Pass' ? getPassDialogPosition(action.playerId) : `flex gap-6 ${getPlayerPosition(action.playerId)}`}`}
          >
            {/* 玩家名称标签 (由于出牌已经移到名片内侧，这个独立名字标签多余且占地方，直接移除) */}
            
            {/* 牌面或动作展示 */}
            <div className="relative flex justify-center items-center">
              {action.type === 'Pass' ? (
                <div className="relative">
                  <div className="text-xl font-black font-outfit tracking-[0.3em] text-white/80 bg-luxury-slate/60 px-10 py-4 rounded-3xl shadow-[0_10px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl border border-white/20 whitespace-nowrap">
                    <div className="absolute inset-0 rounded-3xl bg-gradient-to-b from-white/10 to-transparent pointer-events-none" />
                    不出
                  </div>
                  {/* 小三角箭头，增加对话框气泡的质感 */}
                  <div className={`absolute w-4 h-4 bg-luxury-slate/60 backdrop-blur-xl rotate-45
                    ${action.playerId === 'p2' ? 'top-1/2 right-[-8px] -translate-y-1/2 border-t border-r border-white/20' : ''}
                    ${action.playerId === 'p4' ? 'top-1/2 left-[-8px] -translate-y-1/2 border-l border-b border-white/20' : ''}
                    ${action.playerId === 'p3' ? 'top-[-8px] left-1/2 -translate-x-1/2 border-t border-l border-white/20' : ''}
                    ${action.playerId === 'p1' ? 'bottom-[-8px] left-1/2 -translate-x-1/2 border-b border-r border-white/20' : ''}
                  `} />
                </div>
              ) : (
                <div className="flex drop-shadow-2xl relative">
                  {action.cards.map((card, i) => (
                    <motion.div
                      key={card.id}
                      className="relative"
                      initial={{ opacity: 0, scale: 1.5, x: 0, y: 100, rotate: (Math.random() - 0.5) * 45 }}
                      animate={{ opacity: 1, scale: 1, x: 0, y: 0, rotate: 0 }}
                      transition={{ 
                        type: "spring", 
                        stiffness: 400, 
                        damping: 20, 
                        delay: i * 0.01 // 极度缩短发牌动画错开时间，解决音画不同步
                      }}
                      style={{ marginLeft: i === 0 ? 0 : '-50px', zIndex: i }}
                    >
                      <PlayingCard card={card} className="scale-50 shadow-card-hover" />
                    </motion.div>
                  ))}
                  
                  {/* 特效提示移入到具体的牌组内部，并与 key 强绑定 */}
                  {(action.type === 'Bomb' || action.type === 'StraightFlush' || action.type === 'Rocket' || action.type === 'Tube' || action.type === 'Plate' || action.type === 'Straight') && (
                    <motion.div 
                      key={`effect-${action.playerId}-${Math.max(0, playArea.length - 4) + idx}-${action.cards.length}`}
                      initial={{ scale: 0, y: 0, opacity: 0 }}
                      animate={{ scale: [0.8, 1.2, 1], y: -50, opacity: [0, 1, 0] }}
                      transition={{ duration: 1.5, times: [0, 0.2, 1] }}
                      className={`absolute left-1/2 top-0 -translate-x-1/2 text-5xl font-cinzel font-black z-50 pointer-events-none tracking-widest whitespace-nowrap ${
                        (action.type === 'Bomb' || action.type === 'StraightFlush' || action.type === 'Rocket') 
                          ? 'text-gold-gradient' 
                          : 'text-luxury-ivory drop-shadow-md'
                      }`}
                      style={{ 
                        filter: (action.type === 'Bomb' || action.type === 'StraightFlush' || action.type === 'Rocket') 
                          ? 'drop-shadow(0 0 15px rgba(212,175,55,0.8)) drop-shadow(0 0 30px rgba(139,0,0,0.6))'
                          : 'drop-shadow(0 0 10px rgba(255,255,255,0.5))',
                        WebkitTextStroke: '1px rgba(255,255,255,0.5)'
                      }}
                    >
                      {action.type === 'Rocket' && '🚀 火箭!'}
                      {action.type === 'Bomb' && '💥 炸弹!'}
                      {action.type === 'StraightFlush' && '✨ 同花顺!'}
                      {action.type === 'Tube' && '⚔️ 连对'}
                      {action.type === 'Plate' && '🛡️ 钢板'}
                      {action.type === 'Straight' && '🌊 顺子'}
                    </motion.div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};
