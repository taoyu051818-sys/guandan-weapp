import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '../../types/game';
import { PlayingCard } from './PlayingCard';
import { useGameStore } from '../../store/gameStore';
import { canPlay, getPlayInfo } from '../../lib/rules';
import { getPossiblePlays } from '../../lib/ai';
import { audioManager } from '../../lib/audio';

// 快捷语列表及对应的音频映射
const CHAT_PHRASES = [
  { text: "快点啊，我等的花儿都谢了", voice: "chat_hurry" },
  { text: "你是MM还是GG？", voice: "chat_mmgg" },
  { text: "你的牌打得也太好了", voice: "chat_good" },
  { text: "交个朋友吧", voice: "chat_friend" },
  { text: "不要走，决战到天亮", voice: "chat_stay" },
  { text: "风水轮流转，底裤都输穿", voice: "chat_lose" }
];

export const HandArea: React.FC = () => {
  const { players, currentTurn, lastValidPlay, playCards, passTurn, nextTurn, status, finishDealing, sendChatMessage, clearChatMessage, activeChats } = useGameStore();
  const player = players['p1'];
  const hand = player.hand;
  const isMyTurn = currentTurn === 'p1' && status === 'playing';

  const [selectedCards, setSelectedCards] = useState<Card[]>([]);
  const [showChatPanel, setShowChatPanel] = useState(false);
  const [hintIndex, setHintIndex] = useState<number>(0);
  const [possiblePlays, setPossiblePlays] = useState<Card[][]>([]);
  const isDragging = useRef(false);

  
  // 发牌动画状态
  const [phase, setPhase] = useState<'dealing' | 'flipping' | 'sorting' | 'done'>('done');
  const [visibleCount, setVisibleCount] = useState(27);
  const [unsortedHand, setUnsortedHand] = useState<Card[]>([]);

  useEffect(() => {
    if (status === 'dealing') {
      setPhase('dealing');
      setVisibleCount(0);
      // 打乱真实手牌作为发牌时的无序手牌
      setUnsortedHand([...hand].sort(() => Math.random() - 0.5));
      
      const interval = setInterval(() => {
        setVisibleCount(c => {
          if (c >= 27) {
            clearInterval(interval);
            setTimeout(() => setPhase('flipping'), 600);
            return 27;
          }
          return c + 1;
        });
      }, 80); // 发牌速度
      
      return () => clearInterval(interval);
    } else if (status === 'playing' && phase !== 'done') {
      // 容错：如果状态已经被外部改为playing，强制结束动画
      setPhase('done');
      setVisibleCount(hand.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]); // 这里故意不依赖hand，只在进入dealing时初始化

  useEffect(() => {
    if (phase === 'flipping') {
      const timer = setTimeout(() => {
        setPhase('sorting');
      }, 1000);
      return () => clearTimeout(timer);
    }
    if (phase === 'sorting') {
      const timer = setTimeout(() => {
        setPhase('done');
        finishDealing(); // 动画结束，通知进入 playing 状态
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [phase, finishDealing]);

  // 用户的接风逻辑已经移入 gameStore.ts 的 nextTurn 中
  // lastValidPlay 在新回合开始时如果是 null，就代表用户获得了首发权
  const effectiveLastPlay = lastValidPlay;

  useEffect(() => {
    // 当轮到我出牌时，预先计算所有可能合法的出牌
    if (isMyTurn && status === 'playing' && phase === 'done') {
      const plays = getPossiblePlays(hand, effectiveLastPlay);
      setPossiblePlays(plays);
      setHintIndex(0);
    } else {
      setPossiblePlays([]);
      setHintIndex(0);
    }
  }, [isMyTurn, status, phase, hand, effectiveLastPlay]);

  const handleHint = () => {
    if (possiblePlays.length === 0) return;
    const playToSelect = possiblePlays[hintIndex];
    setSelectedCards([...playToSelect]);
    setHintIndex((prev) => (prev + 1) % possiblePlays.length);
  };

  const handlePointerDown = (card: Card) => {
    if (phase !== 'done') return;
    isDragging.current = true;
    handleCardClick(card);
  };

  const handlePointerEnter = (card: Card) => {
    if (isDragging.current && phase === 'done') {
      handleCardClick(card);
    }
  };

  const handlePointerUp = () => {
    isDragging.current = false;
  };

  useEffect(() => {
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);

  const handleCardClick = (card: Card) => {
    setSelectedCards(prev => {
      const isSelected = prev.find(c => c.id === card.id);
      if (isSelected) {
        return prev.filter(c => c.id !== card.id);
      } else {
        return [...prev, card];
      }
    });
  };

  const handlePlay = () => {
    if (!isMyTurn || selectedCards.length === 0) return;
    
    // 检查是否合法
    if (canPlay(selectedCards, effectiveLastPlay)) {
      const info = getPlayInfo(selectedCards);
      if (info) {
        playCards({
          playerId: 'p1',
          cards: selectedCards,
          type: info.type,
        });
        setSelectedCards([]);
        
        // 延迟调用 nextTurn，确保状态更新完成并且触发了 GameBoard 里的结算拦截
        setTimeout(() => {
          const { finishedPlayers, players } = useGameStore.getState();
          // 如果满足结束条件，则不要再轮转回合了，否则会导致死循环或报错
          if (finishedPlayers.length >= 3) return;
          if (finishedPlayers.length === 2 && players[finishedPlayers[0]].team === players[finishedPlayers[1]].team) return;
          
          nextTurn();
        }, 0);
      }
    } else {
      console.warn('出牌不符合规则');
      // 可以用更优雅的UI提示代替alert
    }
  };

  const handlePass = () => {
    if (!isMyTurn) return;
    if (!effectiveLastPlay) {
      console.warn('您现在是首发（或接风），必须出牌！');
      return;
    }
    passTurn('p1');
    setSelectedCards([]);
    
    setTimeout(() => {
      const { finishedPlayers, players } = useGameStore.getState();
      if (finishedPlayers.length >= 3) return;
      if (finishedPlayers.length === 2 && players[finishedPlayers[0]].team === players[finishedPlayers[1]].team) return;
      nextTurn();
    }, 0);
  };

  const handleSendChat = (phrase: { text: string, voice: string }) => {
    const msgId = sendChatMessage('p1', phrase.text);
    audioManager.playVoice(phrase.voice);
    setShowChatPanel(false);
    setTimeout(() => {
      clearChatMessage('p1', msgId);
    }, 2500); // 保留 2.5 秒后消失
  };

  return (
    <div className="flex flex-col items-center justify-end w-full pb-0 relative">
      
      {/* 聊天气泡 (玩家自己) */}
      <AnimatePresence>
        {activeChats['p1'] && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 10 }}
            className="absolute bottom-[280px] left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-white text-gray-900 rounded-2xl shadow-xl text-sm font-bold whitespace-nowrap border-2 border-luxury-gold/50"
          >
            {activeChats['p1'].message}
            <div className="absolute bottom-[-7px] left-1/2 -translate-x-1/2 w-3 h-3 bg-white border-b-2 border-r-2 border-luxury-gold/50 rotate-45" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 快捷聊天面板 */}
      <AnimatePresence>
        {showChatPanel && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute bottom-[250px] left-10 z-50 bg-luxury-obsidian/90 backdrop-blur-md border border-luxury-gold/30 rounded-xl p-3 shadow-2xl flex flex-col gap-2 w-64"
          >
            <div className="text-luxury-goldLight text-xs mb-1 font-bold border-b border-luxury-gold/20 pb-1">快捷语录</div>
            {CHAT_PHRASES.map((phrase, idx) => (
              <button
                key={idx}
                onClick={() => handleSendChat(phrase)}
                className="text-left text-sm text-white/80 hover:text-luxury-gold hover:bg-white/5 px-2 py-1.5 rounded transition-colors"
              >
                {phrase.text}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 聊天呼出按钮 */}
      <button
        onClick={() => setShowChatPanel(!showChatPanel)}
        className="absolute left-10 bottom-[180px] z-40 w-12 h-12 rounded-full bg-luxury-gray/80 border border-luxury-gold/30 flex items-center justify-center text-luxury-gold hover:bg-luxury-gray hover:scale-110 transition-all shadow-lg group"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </button>

      {/* 动作区 (悬浮在手牌上方) */}
      <div className="absolute bottom-44 w-full flex justify-center items-end z-30 pointer-events-none">
        {isMyTurn && (
          <motion.div 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="flex space-x-6 pointer-events-auto drop-shadow-2xl"
          >
            <button
              onClick={handlePass}
              className="px-8 py-3 bg-luxury-slate/80 backdrop-blur-sm border border-white/10 text-white/80 rounded-full hover:bg-luxury-slate hover:text-white hover:border-white/30 shadow-lg transition-all font-outfit font-bold tracking-[0.2em] uppercase text-sm"
            >
              不出
            </button>
            <button
              onClick={handleHint}
              disabled={possiblePlays.length === 0}
              className="px-8 py-3 bg-luxury-gold/20 backdrop-blur-sm border border-luxury-gold/50 text-luxury-goldLight rounded-full hover:bg-luxury-gold/40 hover:border-luxury-gold shadow-lg transition-all font-outfit font-bold tracking-[0.2em] uppercase text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              提示
            </button>
            <button
              onClick={() => setSelectedCards([])}
              className="px-8 py-3 bg-luxury-midnight/80 backdrop-blur-sm border border-luxury-gold/30 text-luxury-goldLight rounded-full hover:bg-luxury-obsidian hover:border-luxury-gold/60 shadow-lg transition-all font-outfit font-bold tracking-[0.2em] uppercase text-sm"
            >
              重置
            </button>
            <button
              onClick={handlePlay}
              disabled={selectedCards.length === 0}
              className="relative group px-12 py-3 bg-gradient-to-r from-luxury-goldDark to-luxury-gold text-luxury-obsidian rounded-full disabled:opacity-50 disabled:cursor-not-allowed shadow-gold-glow transition-all font-outfit font-black tracking-[0.2em] uppercase text-sm overflow-hidden"
            >
              <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
              <span className="relative z-10">出牌</span>
            </button>
          </motion.div>
        )}
      </div>

      {/* 手牌区 (放在下方贴底)  */}
      <div className="relative flex justify-center w-full max-w-5xl h-36 px-10 pt-2 pb-2 z-20">
        <AnimatePresence>
          {(phase === 'done' ? hand : unsortedHand).map((card, index) => {
            // 在发牌阶段，根据 visibleCount 控制显示几张牌
            if (phase === 'dealing' && index >= visibleCount) return null;

            const isSelected = !!selectedCards.find(c => c.id === card.id);
            
            // 排序阶段的平滑过渡
            const displayHandLength = phase === 'done' ? hand.length : unsortedHand.length;
            const spacing = Math.min(25, 800 / Math.max(1, displayHandLength));
            
            // 动画计算：如果处于 sorting 阶段，卡牌应该从 unsorted 位置移动到 sorted 位置
            let offset = (index - (displayHandLength - 1) / 2) * spacing;
            
            if (phase === 'sorting') {
              // 寻找这张牌在排好序的 hand 中的位置
              const targetIndex = hand.findIndex(c => c.id === card.id);
              offset = (targetIndex - (hand.length - 1) / 2) * spacing;
            }

            // 是否翻面
            const isFaceDown = phase === 'dealing';

            return (
                <motion.div
                  key={card.id}
                  initial={{ opacity: 0, y: 50, scale: 0.8, x: 0 }}
                  animate={{ 
                    opacity: 1, 
                    y: isSelected ? -20 : 0, 
                    x: offset,
                    scale: 1,
                    rotateY: isFaceDown ? 180 : 0 // 翻牌动画
                  }}
                  transition={{ 
                    type: 'spring', 
                    stiffness: phase === 'sorting' ? 60 : 300, 
                    damping: phase === 'sorting' ? 14 : 20 
                  }}
                  className="absolute cursor-pointer touch-none"
                  style={{
                    zIndex: phase === 'sorting' || phase === 'done' ? hand.findIndex(c => c.id === card.id) : index,
                  }}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    handlePointerDown(card);
                  }}
                  onPointerEnter={(e) => {
                    e.preventDefault();
                    handlePointerEnter(card);
                  }}
                >
                  <PlayingCard
                    card={card}
                    isSelected={isSelected}
                    className="hover:scale-105"
                    isFaceDown={isFaceDown}
                  />
                </motion.div>
              );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
};
