import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../store/gameStore';

export const Tutorial: React.FC = () => {
  const { setGameState } = useGameStore();
  const [step, setStep] = useState(0);

  const steps = [
    {
      title: "游戏目标",
      content: "掼蛋是一种两两配合的扑克游戏（四人打两副牌）。您的目标是尽快出完手中的牌，争取拿到“头游”（第一名），并与队友配合获得更多积分。"
    },
    {
      title: "基本牌型",
      content: "游戏支持以下牌型：单张、对子、三张、三带二、顺子（5张）、三连对（6张）、钢板（两个连续三张）、炸弹（4张及以上同数值）、同花顺、火箭（四张王）。"
    },
    {
      title: "逢人配 (百搭牌)",
      content: "每局游戏中，当前打的级别的红桃（例如打 2 时，红桃 2）是“逢人配”，它可以当做除大小王之外的任何牌来使用，帮助您组成顺子、同花顺或炸弹。"
    },
    {
      title: "进贡与还贡",
      content: "上一局输掉的玩家（双下或末游），在下一局开始前必须将最大的牌进贡给赢家。赢家则需要挑一张不超过 10 的小牌还给输家。如果您摸到两张或四张大王，可以触发“抗贡”。"
    }
  ];

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative w-full max-w-2xl bg-luxury-slate/90 border border-luxury-gold/50 rounded-2xl p-8 shadow-gold-glow"
      >
        <div className="flex justify-between items-center mb-8 border-b border-white/10 pb-4">
          <h2 className="text-3xl font-cinzel font-bold text-luxury-goldLight tracking-widest">新手教程</h2>
          <button 
            onClick={() => setGameState({ showTutorial: false })}
            className="text-white/50 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="min-h-[200px] mb-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <h3 className="text-xl font-bold text-luxury-ivory mb-4 tracking-widest">{steps[step].title}</h3>
              <p className="text-white/80 leading-relaxed text-lg">{steps[step].content}</p>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex justify-between items-center">
          <button
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0}
            className="px-6 py-2 border border-white/20 rounded-full text-white/70 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/5"
          >
            上一页
          </button>
          
          <div className="flex space-x-2">
            {steps.map((_, i) => (
              <div 
                key={i} 
                className={`w-2 h-2 rounded-full transition-all ${i === step ? 'bg-luxury-gold w-6' : 'bg-white/20'}`}
              />
            ))}
          </div>

          <button
            onClick={() => {
              if (step === steps.length - 1) {
                setGameState({ showTutorial: false });
              } else {
                setStep(step + 1);
              }
            }}
            className="px-6 py-2 bg-luxury-gold text-luxury-obsidian font-bold rounded-full hover:bg-luxury-goldLight"
          >
            {step === steps.length - 1 ? '开始游戏' : '下一页'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};
