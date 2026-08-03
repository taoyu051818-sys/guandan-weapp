import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../store/gameStore';
import { Card, PlayerId } from '../types/game';
import { PlayingCard } from '../components/game/PlayingCard';
import { createDeck, shuffleDeck } from '../lib/deck';

export const GroupingPhase: React.FC = () => {
  const { currentLevel, setDealerAndTeams, startDealing, players } = useGameStore();
  
  const [deck] = useState<Card[]>(() => shuffleDeck(createDeck(currentLevel)));
  const [drawnCards, setDrawnCards] = useState<Record<PlayerId, Card | null>>({
    p1: null, p2: null, p3: null, p4: null
  });
  const [isDrawing, setIsDrawing] = useState(false);
  const [resultReady, setResultReady] = useState(false);

  const handleDraw = () => {
    if (isDrawing || resultReady) return;
    setIsDrawing(true);

    // 为了确保游戏分组逻辑简单，我们手动干预抽卡结果，确保必定有两红两黑
    // 真实情况可能会抽到相同的花色，这里为了演示直接从整副牌里挑出符合条件的牌
    const reds = deck.filter(c => c.suit === 'heart' || c.suit === 'diamond');
    const blacks = deck.filter(c => c.suit === 'spade' || c.suit === 'club');
    
    // 为了匹配固定的座位顺序 (p1下, p2右, p3上, p4左)，
    // 队伍A必须是 p1 和 p3 (对门)，队伍B必须是 p2 和 p4。
    // 所以我们直接发红牌给 p1, p3，发黑牌给 p2, p4
    const finalDraws = {
      p1: reds[0],
      p3: reds[1],
      p2: blacks[0],
      p4: blacks[1]
    } as Record<PlayerId, Card>;

    // 逐个翻开动画
    setTimeout(() => setDrawnCards(prev => ({ ...prev, p1: finalDraws.p1 })), 500);
    setTimeout(() => setDrawnCards(prev => ({ ...prev, p2: finalDraws.p2 })), 1000);
    setTimeout(() => setDrawnCards(prev => ({ ...prev, p3: finalDraws.p3 })), 1500);
    setTimeout(() => setDrawnCards(prev => ({ ...prev, p4: finalDraws.p4 })), 2000);

    setTimeout(() => {
      // 找出点数最大的作为庄家
      let maxVal = -1;
      let dealerId: PlayerId = 'p1';
      Object.entries(finalDraws).forEach(([id, card]) => {
        if (card.value > maxVal) {
          maxVal = card.value;
          dealerId = id as PlayerId;
        }
      });

      const teamAIds: PlayerId[] = ['p1', 'p3'];
      const teamBIds: PlayerId[] = ['p2', 'p4'];

      setDealerAndTeams(dealerId, teamAIds, teamBIds);
      setResultReady(true);
    }, 3000);
  };

  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen bg-luxury-obsidian overflow-hidden font-outfit text-luxury-ivory">
      <div className="absolute inset-0 bg-radial-poker z-0" />
      <div className="absolute inset-0 bg-noise z-0 opacity-30" />
      
      <div className="relative z-10 w-full max-w-4xl text-center">
        <motion.h1 
          initial={{ y: -30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="text-5xl font-black font-cinzel text-gold-gradient tracking-widest mb-12 drop-shadow-lg"
        >
          摸牌定庄
        </motion.h1>

        {/* 牌堆展示 */}
        <div className="relative h-48 mb-16 flex justify-center items-center">
          {!isDrawing && !resultReady && (
            <motion.div
              role="button"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleDraw}
              className="relative cursor-pointer group"
            >
              {Array.from({ length: 15 }).map((_, i) => (
                <div 
                  key={i} 
                  className="absolute" 
                  style={{ 
                    transform: `translateX(${(i - 7) * 15}px) rotate(${(i - 7) * 2}deg)`,
                    zIndex: i 
                  }}
                >
                  <PlayingCard card={deck[0]} isFaceDown className="shadow-card" />
                </div>
              ))}
              <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="bg-luxury-goldDark text-luxury-obsidian font-bold px-4 py-1 rounded-full shadow-gold-glow tracking-widest uppercase">点击抽牌</span>
              </div>
            </motion.div>
          )}
        </div>

        {/* 抽牌结果展示 */}
        <div className="flex justify-center items-end space-x-12 h-40">
          {(['p3', 'p4', 'p1', 'p2'] as PlayerId[]).map((id) => (
            <motion.div 
              key={id} 
              className="flex flex-col items-center"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: drawnCards[id] ? 1 : 0.5, y: drawnCards[id] ? 0 : 20 }}
            >
              <div className="mb-4">
                {drawnCards[id] ? (
                  <motion.div
                    initial={{ rotateY: 180, scale: 0.8 }}
                    animate={{ rotateY: 0, scale: 1 }}
                    transition={{ duration: 0.6, type: 'spring' }}
                  >
                    <PlayingCard card={drawnCards[id]!} className="scale-125 shadow-card-hover" />
                  </motion.div>
                ) : (
                  <div className="w-[5.5rem] h-[8rem] scale-125 border-2 border-dashed border-white/20 rounded-xl flex items-center justify-center text-white/20 font-cinzel">
                    ?
                  </div>
                )}
              </div>
              <span className="text-xl font-bold tracking-widest text-luxury-goldLight">{players[id].name}</span>
            </motion.div>
          ))}
        </div>

        {/* 结果确认区 */}
        <AnimatePresence>
          {resultReady && (
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-16 flex flex-col items-center"
            >
              <div className="text-2xl mb-8 tracking-widest text-white/80 font-light">
                红牌为 <span className="text-luxury-crimson font-bold">队伍A</span>，黑牌为 <span className="text-luxury-slate font-bold">队伍B</span>。点数最大者先出。
              </div>
              <button
                onClick={startDealing}
                className="px-16 py-4 bg-gradient-to-r from-luxury-goldDark to-luxury-gold text-luxury-obsidian font-cinzel font-black text-2xl tracking-[0.2em] rounded-full shadow-gold-glow hover:scale-105 transition-all uppercase"
              >
                进入对局
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
