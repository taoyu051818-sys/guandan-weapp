import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../../store/gameStore';

export const TutorialModal: React.FC = () => {
  const { showTutorial, setGameState } = useGameStore();
  const [currentPage, setCurrentPage] = useState(0);

  if (!showTutorial) return null;

  const pages = [
    {
      title: '什么是掼蛋？',
      content: (
        <div className="space-y-4">
          <p><strong>掼蛋</strong>是一种起源于江苏淮安的经典四人扑克牌游戏，结合了“跑得快”与“八十分”的玩法精髓。</p>
          <p>游戏需要<strong>两副牌（共108张）</strong>，四名玩家两两组队，坐在对面的玩家为一队。</p>
          <p>核心目标：通过团队配合，最先把手里的 27 张牌出完，争取拿到“头游”，从而让队伍升级！</p>
        </div>
      )
    },
    {
      title: '特殊牌：级牌与逢人配',
      content: (
        <div className="space-y-4">
          <p><strong>级牌</strong>：如果你们队伍当前打“2”，那么 2 就是级牌。级牌比普通的 A 和 2 都要大，仅次于大小王。</p>
          <p><strong>逢人配（红心级牌）</strong>：也就是万能牌。它可以变成除了大小王之外的任意一张牌，用来凑成顺子、连对、炸弹等高级牌型！</p>
          <div className="bg-slate-700/50 p-4 rounded-lg border border-slate-600">
            <span className="text-red-400 font-bold">举例</span>：当前打2，如果你有一对3、一张4、一张5，再加上一张红心2，红心2就可以当做3，凑成 33345 的“三带二”（或者直接当炸弹）。
          </div>
        </div>
      )
    },
    {
      title: '牌型大小与压制',
      content: (
        <div className="space-y-3">
          <p>除了常见的单牌、对子、顺子外，掼蛋还有以下特殊牌型：</p>
          <ul className="list-disc list-inside ml-4 space-y-2 text-slate-300">
            <li><strong>三连对</strong>：3对相连的牌（如 334455）。</li>
            <li><strong>三带一对</strong>：3张相同的牌带1对（必须是一对，不能带单张）。</li>
            <li><strong>钢板（二连三）</strong>：两个连续的三张（如 333444）。</li>
          </ul>
          <p className="text-yellow-400 font-bold mt-4">炸弹大小排名：</p>
          <div className="text-sm bg-slate-800 p-3 rounded-lg border border-yellow-900/50">
            四大天王（4张王） ＞ 8张炸 ＞ 7张炸 ＞ 6张炸 ＞ <strong>同花顺</strong> ＞ 5张炸 ＞ 4张炸
          </div>
        </div>
      )
    },
    {
      title: '团队配合技巧',
      content: (
        <div className="space-y-4">
          <p>掼蛋的精髓在于<strong>团队配合</strong>：</p>
          <ul className="list-disc list-inside ml-4 space-y-2 text-slate-300">
            <li><strong>不要炸队友</strong>：队友出大牌时，尽量选择“不出”让队友顺利走完。</li>
            <li><strong>掩护队友</strong>：如果你发现队友只剩下几张牌，主动出小牌“送”队友走。</li>
            <li><strong>接风规则</strong>：如果队友出完最后一手牌，其他人都管不上（过牌），那么下一轮的<strong>自由出牌权</strong>将由你接管！</li>
          </ul>
        </div>
      )
    }
  ];

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="relative w-full max-w-2xl bg-luxury-obsidian/95 backdrop-blur-xl rounded-3xl shadow-[0_0_50px_rgba(0,0,0,0.8)] border border-luxury-gold/30 p-10 text-luxury-ivory font-outfit"
        >
          {/* 关闭按钮 */}
          <button
            onClick={() => setGameState({ showTutorial: false })}
            className="absolute top-6 right-6 text-white/30 hover:text-luxury-gold transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <h2 className="text-4xl font-black mb-8 text-center font-cinzel text-gold-gradient tracking-widest drop-shadow-sm">
            新手指南
          </h2>

          <div className="min-h-[280px] px-4">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentPage}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              >
                <h3 className="text-2xl font-bold text-luxury-goldLight mb-6 flex items-center tracking-wide">
                  <span className="bg-luxury-gold/20 text-luxury-gold border border-luxury-gold/50 w-8 h-8 rounded-full flex items-center justify-center mr-3 text-lg shadow-[0_0_10px_rgba(212,175,55,0.2)]">
                    {currentPage + 1}
                  </span>
                  {pages[currentPage].title}
                </h3>
                <div className="text-lg leading-relaxed text-white/80 font-light">
                  {pages[currentPage].content}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* 底部导航 */}
          <div className="mt-10 flex items-center justify-between px-4 border-t border-white/10 pt-8">
            <button
              onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
              disabled={currentPage === 0}
              className="px-6 py-2 rounded-full font-bold tracking-widest uppercase text-sm text-white/50 bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              上一页
            </button>

            <div className="flex space-x-3">
              {pages.map((_, idx) => (
                <div
                  key={idx}
                  className={`w-2 h-2 rounded-full transition-all duration-300 ${
                    idx === currentPage ? 'bg-luxury-gold scale-125 shadow-gold-glow' : 'bg-white/20'
                  }`}
                />
              ))}
            </div>

            <button
              onClick={() => {
                if (currentPage === pages.length - 1) {
                  setGameState({ showTutorial: false });
                  setCurrentPage(0);
                } else {
                  setCurrentPage(Math.min(pages.length - 1, currentPage + 1));
                }
              }}
              className="group relative px-8 py-2 rounded-full font-black tracking-widest uppercase text-sm text-luxury-obsidian bg-luxury-goldDark shadow-gold-glow transition-all overflow-hidden"
            >
              <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
              <span className="relative z-10">{currentPage === pages.length - 1 ? '开始游戏' : '下一页'}</span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
