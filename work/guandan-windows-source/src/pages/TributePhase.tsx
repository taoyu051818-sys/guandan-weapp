import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../store/gameStore';
import { PlayingCard } from '../components/game/PlayingCard';
import { Card } from '../types/game';

export const TributePhase: React.FC = () => {
  const { tributeState, players, executeTribute, executeReturnTribute, finishTribute, settings } = useGameStore();
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);

  const triggered = useRef(new Set<string>());

  const sortCards = (cards: Card[]) => cards.sort((a, b) => settings.sortOrder === 'desc' ? b.value - a.value : a.value - b.value);

  // 自动执行 AI 进贡和还贡
  useEffect(() => {
    if (!tributeState) return;

    if (tributeState.isAntiTribute) {
      const timer = setTimeout(() => finishTribute(), 3000);
      return () => clearTimeout(timer);
    }

    if (tributeState.phase === 'tributing') {
      tributeState.actions.forEach(action => {
        const player = players[action.from];
        if (player.isAI && !action.card && !triggered.current.has(`${action.from}-tribute`)) {
          triggered.current.add(`${action.from}-tribute`);
          // AI 进贡最大的牌 (非红桃级牌)
          const sorted = [...player.hand]
            .filter(c => !(c.isLevelCard && c.suit === 'heart'))
            .sort((a, b) => b.value - a.value); // 选最大牌始终从大到小找
          const maxCard = sorted[0] || player.hand[player.hand.length - 1];
          setTimeout(() => executeTribute(action.from, maxCard.id), 1000 + Math.random() * 500);
        }
      });
    } else if (tributeState.phase === 'returning') {
      tributeState.actions.forEach(action => {
        const player = players[action.to];
        if (player.isAI && !action.returnCard && !triggered.current.has(`${action.to}-return`)) {
          triggered.current.add(`${action.to}-return`);
          // AI 还贡一张小牌 (<=10)
          const sorted = [...player.hand].sort((a, b) => a.value - b.value); // 选小牌始终从小到大找
          const returnCard = sorted.find(c => c.value <= 10) || sorted[0];
          setTimeout(() => executeReturnTribute(action.to, returnCard.id), 1000 + Math.random() * 500);
        }
      });
    } else if (tributeState.phase === 'done') {
      const timer = setTimeout(() => finishTribute(), 2000);
      return () => clearTimeout(timer);
    }
  }, [tributeState, players, executeTribute, executeReturnTribute, finishTribute]);

  if (!tributeState) return null;

  if (tributeState.isAntiTribute) {
    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <motion.div 
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-6xl font-black text-gold-gradient font-cinzel text-center drop-shadow-[0_0_30px_rgba(212,175,55,0.8)]"
        >
          抗贡成功！
        </motion.div>
      </div>
    );
  }

  // 检查我是否需要进贡或还贡
  const myTributeAction = tributeState.phase === 'tributing' 
    ? tributeState.actions.find(a => a.from === 'p1' && !a.card)
    : tributeState.actions.find(a => a.to === 'p1' && !a.returnCard);

  const handleConfirm = () => {
    if (!selectedCard || !myTributeAction) return;
    if (tributeState.phase === 'tributing') {
      executeTribute('p1', selectedCard.id);
    } else {
      executeReturnTribute('p1', selectedCard.id);
    }
    setSelectedCard(null);
  };

  const title = tributeState.phase === 'tributing' ? '进贡阶段' : (tributeState.phase === 'returning' ? '还贡阶段' : '进贡完成');
  const subtitle = tributeState.phase === 'tributing' 
    ? (myTributeAction ? '请选择一张最大的牌进贡' : '等待其他玩家进贡...')
    : (tributeState.phase === 'returning' ? (myTributeAction ? '请选择一张牌还给输家 (≤10)' : '等待赢家还贡...') : '即将开始游戏');

  const displayHand = sortCards([...players['p1'].hand]);

  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md">
      <motion.div 
        initial={{ y: -50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="mb-8 text-center"
      >
        <h2 className="text-4xl font-bold text-luxury-goldLight mb-2 tracking-widest">{title}</h2>
        <p className="text-white/60">{subtitle}</p>
      </motion.div>

      {/* 展示进贡动画区域 */}
      <div className="flex gap-8 mb-12 min-h-[160px]">
        <AnimatePresence>
          {tributeState.actions.map((action, i) => (
            <motion.div 
              key={i} 
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center bg-white/5 p-4 rounded-xl border border-white/10"
            >
              <div className="flex items-center gap-4 mb-4 text-sm text-white/50">
                <span>{players[action.from].name}</span>
                <span className="text-luxury-gold">➔</span>
                <span>{players[action.to].name}</span>
              </div>
              <div className="flex gap-4">
                {/* 进贡的牌 */}
                <div className="flex flex-col items-center">
                  <span className="text-xs mb-2">进贡</span>
                  {action.card ? <PlayingCard card={action.card} className="scale-75 origin-top" /> : <div className="w-[110px] h-[160px] scale-75 border-2 border-dashed border-white/20 rounded-xl" />}
                </div>
                {/* 还贡的牌 */}
                <div className="flex flex-col items-center">
                  <span className="text-xs mb-2">还贡</span>
                  {action.returnCard ? <PlayingCard card={action.returnCard} className="scale-75 origin-top" /> : <div className="w-[110px] h-[160px] scale-75 border-2 border-dashed border-white/20 rounded-xl" />}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* 玩家选择区域 */}
      {myTributeAction && (
        <motion.div 
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="flex flex-col items-center"
        >
          <div className="relative w-full max-w-5xl h-48 mb-8 px-10">
            {displayHand.map((card, index) => {
              const spacing = Math.min(28, 820 / Math.max(1, displayHand.length));
              const x = (index - (displayHand.length - 1) / 2) * spacing;
              const disabled = tributeState.phase === 'returning' && card.value > 10;

              return (
                <motion.div
                  key={card.id}
                  className="absolute left-1/2 -translate-x-1/2"
                  style={{ zIndex: index }}
                  animate={{ x, y: selectedCard?.id === card.id ? -18 : 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 22 }}
                  whileHover={{ y: selectedCard?.id === card.id ? -18 : -10 }}
                >
                  <button
                    type="button"
                    className={`cursor-pointer select-none touch-none outline-none ${disabled ? 'opacity-40' : ''}`}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      if (disabled) return;
                      setSelectedCard(card);
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      if (disabled) return;
                      setSelectedCard(card);
                    }}
                  >
                    <PlayingCard
                      card={card}
                      isSelected={selectedCard?.id === card.id}
                      className="scale-75 origin-bottom"
                    />
                  </button>
                </motion.div>
              );
            })}
          </div>
          <button 
            onClick={handleConfirm}
            disabled={!selectedCard || (tributeState.phase === 'returning' && (selectedCard?.value ?? 0) > 10)}
            className="px-12 py-3 bg-luxury-gold text-luxury-obsidian rounded-full font-bold tracking-widest disabled:opacity-50 disabled:cursor-not-allowed hover:bg-luxury-goldLight transition-all"
          >
            确认选择
          </button>
        </motion.div>
      )}
    </div>
  );
};
