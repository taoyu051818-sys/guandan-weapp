import React, { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings } from 'lucide-react';

export const MainMenu: React.FC = () => {
  const { startGame, setGameState, playerStats, recentMatch } = useGameStore();
  const [showModeSelect, setShowModeSelect] = useState(false);
  const [showStats, setShowStats] = useState(false);

  const handleStart = (
    difficulty: 'easy' | 'medium' | 'hard' | 'master',
    gameMode: 'standard' | 'double_open' | 'campaign',
    isMultiplayer: boolean = false
  ) => {
    startGame(difficulty, gameMode, isMultiplayer, null, 'p1');
  };

  const winRate = playerStats.gamesPlayed > 0 
    ? Math.round((playerStats.wins / playerStats.gamesPlayed) * 100) 
    : 0;
  const recentMatchLevelDeltaText = recentMatch
    ? (recentMatch.levelUp > 0 ? `+${recentMatch.levelUp}` : `${recentMatch.levelUp}`)
    : '0';

  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen bg-luxury-obsidian overflow-hidden font-outfit text-luxury-ivory">
      {/* 背景光影效果 */}
      <div className="absolute inset-0 bg-radial-poker z-0" />
      <div className="absolute inset-0 bg-noise z-0 opacity-40" />
      <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-luxury-goldDark rounded-full mix-blend-screen filter blur-[150px] opacity-20 animate-pulse" />
      <div className="absolute -bottom-[20%] -right-[10%] w-[50%] h-[50%] bg-luxury-crimson rounded-full mix-blend-screen filter blur-[150px] opacity-10 animate-pulse" style={{ animationDelay: '2s' }} />

      {/* 主标题 */}
      <motion.div 
        initial={{ y: -50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 1, ease: "easeOut" }}
        className="z-10 flex flex-col items-center mb-16"
      >
        <h1 className="text-8xl font-black text-transparent bg-clip-text bg-gradient-to-b from-luxury-goldLight via-luxury-gold to-luxury-goldDark drop-shadow-[0_0_40px_rgba(212,175,55,0.6)] font-cinzel tracking-[0.2em] uppercase text-center mb-4">
          掼蛋大师
        </h1>
        <div className="h-px w-64 bg-gradient-to-r from-transparent via-luxury-gold to-transparent opacity-50" />
        <p className="mt-4 text-luxury-goldLight/70 tracking-[0.5em] uppercase text-sm font-bold">The Royal Guandan</p>
      </motion.div>

      {/* 按钮区域 */}
      <div className="z-10 flex flex-col items-center space-y-6 w-full max-w-sm">
        <AnimatePresence mode="wait">
          {!showModeSelect && !showStats ? (
            <motion.div 
              key="main-buttons"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="flex flex-col w-full space-y-5"
            >
              <button
                onClick={() => setShowModeSelect(true)}
                className="relative group px-8 py-4 w-full bg-gradient-to-r from-luxury-goldDark to-luxury-gold text-luxury-obsidian rounded-xl overflow-hidden shadow-gold-glow transition-all hover:scale-105"
              >
                <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                <span className="relative z-10 text-xl font-black tracking-[0.3em] uppercase">开始游戏</span>
              </button>
              
              <button
                onClick={() => handleStart('medium', 'standard', true)}
                className="relative group px-8 py-4 w-full bg-luxury-slate/60 backdrop-blur-md border border-blue-400/30 text-blue-200 rounded-xl overflow-hidden shadow-[0_0_15px_rgba(59,130,246,0.2)] transition-all hover:scale-105"
              >
                <div className="absolute inset-0 bg-blue-500/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                <span className="relative z-10 text-lg font-black tracking-[0.2em] uppercase">🌐 多人联机大厅</span>
              </button>
              
              <button
                onClick={() => setShowStats(true)}
                className="px-8 py-4 w-full bg-luxury-slate/60 backdrop-blur-md border border-luxury-gold/30 text-luxury-goldLight rounded-xl hover:bg-luxury-slate hover:border-luxury-gold shadow-lg transition-all hover:scale-105 font-bold tracking-[0.2em] uppercase text-sm"
              >
                玩家数据看板
              </button>

              <button
                onClick={() => setGameState({ showTutorial: true })}
                className="px-8 py-4 w-full bg-luxury-slate/60 backdrop-blur-md border border-white/10 text-white/80 rounded-xl hover:bg-luxury-slate hover:text-white hover:border-white/30 shadow-lg transition-all hover:scale-105 font-bold tracking-[0.2em] uppercase text-sm"
              >
                新手教程
              </button>

              <button
                onClick={() => setGameState({ showSettings: true })}
                className="px-8 py-4 w-full bg-black/40 backdrop-blur-md border border-white/5 text-white/50 rounded-xl hover:bg-black/60 hover:text-white hover:border-white/20 transition-all flex items-center justify-center space-x-3 font-bold tracking-[0.2em] uppercase text-sm"
              >
                <Settings size={18} />
                <span>游戏设置</span>
              </button>
            </motion.div>
          ) : showStats ? (
            <motion.div
              key="stats-menu"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="flex flex-col w-full glass-panel rounded-2xl p-8 border-luxury-gold/30"
            >
              <h2 className="text-2xl font-cinzel font-bold text-luxury-goldLight mb-6 text-center tracking-widest">玩家数据看板</h2>
              
              <div className="grid grid-cols-2 gap-4 mb-8">
                <div className="bg-black/40 p-4 rounded-xl text-center border border-white/10">
                  <div className="text-white/50 text-xs tracking-widest mb-1">当前积分 (ELO)</div>
                  <div className="text-3xl font-black text-luxury-gold font-cinzel">{playerStats.elo}</div>
                </div>
                <div className="bg-black/40 p-4 rounded-xl text-center border border-white/10">
                  <div className="text-white/50 text-xs tracking-widest mb-1">总场数</div>
                  <div className="text-3xl font-black text-white font-cinzel">{playerStats.gamesPlayed}</div>
                </div>
                <div className="bg-black/40 p-4 rounded-xl text-center border border-white/10">
                  <div className="text-white/50 text-xs tracking-widest mb-1">胜率</div>
                  <div className="text-3xl font-black text-blue-400 font-cinzel">{winRate}%</div>
                </div>
                <div className="bg-black/40 p-4 rounded-xl text-center border border-white/10">
                  <div className="text-white/50 text-xs tracking-widest mb-1">头游次数</div>
                  <div className="text-3xl font-black text-purple-400 font-cinzel">{playerStats.firstPlaceFinishes}</div>
                </div>
                <div className="bg-black/40 p-4 rounded-xl text-center border border-white/10 col-span-2">
                  <div className="text-white/50 text-xs tracking-widest mb-1">炸弹使用次数</div>
                  <div className="text-3xl font-black text-red-400 font-cinzel">{playerStats.bombsPlayed}</div>
                </div>
              </div>

              {recentMatch && (
                <div className="bg-black/40 p-4 rounded-xl border border-luxury-gold/20 mb-6 text-left">
                  <div className="text-white/50 text-xs tracking-widest mb-2">最近一局</div>
                  <div className="text-sm text-white/80">
                    胜方: {recentMatch.winnerTeam === 'teamA' ? '我方队伍' : '敌方队伍'} | 等级变化: {recentMatchLevelDeltaText}
                  </div>
                  <div className="text-xs text-white/50 mt-1">
                    当前级别: {recentMatch.currentLevel} | 比分: {recentMatch.scores.teamA}:{recentMatch.scores.teamB}
                  </div>
                </div>
              )}

              <button
                onClick={() => setShowStats(false)}
                className="px-8 py-4 w-full bg-luxury-slate/60 border border-white/10 text-white/80 rounded-xl hover:bg-luxury-slate hover:text-white transition-all font-bold tracking-[0.2em] uppercase text-sm"
              >
                返回主菜单
              </button>
            </motion.div>
          ) : (
            <motion.div 
              key="mode-select"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="flex flex-col w-full space-y-4 bg-luxury-slate/40 backdrop-blur-xl p-6 rounded-2xl border border-luxury-gold/20"
            >
              <h2 className="text-center text-luxury-goldLight font-bold tracking-[0.2em] mb-2">选择游戏模式</h2>
              
              <div className="space-y-2 mb-4">
                <button
                  onClick={() => handleStart('medium', 'standard')}
                  className="w-full px-6 py-4 bg-black/40 border border-luxury-gold/30 hover:bg-luxury-gold/20 rounded-xl text-left transition-all group"
                >
                  <div className="font-bold text-luxury-goldLight text-lg tracking-widest mb-1">标准模式</div>
                  <div className="text-xs text-white/50">经典的掼蛋对战体验，难度适中。</div>
                </button>
                <button
                  onClick={() => handleStart('easy', 'double_open')}
                  className="w-full px-6 py-4 bg-black/40 border border-white/20 hover:bg-white/10 rounded-xl text-left transition-all group"
                >
                  <div className="font-bold text-white/90 text-lg tracking-widest mb-1">双明牌模式 (教学)</div>
                  <div className="text-xs text-white/50">队友手牌全程可见，适合新手学习配合。</div>
                </button>
                <button
                  onClick={() => handleStart('master', 'standard')}
                  className="w-full px-6 py-4 bg-black/40 border border-red-500/30 hover:bg-red-500/20 rounded-xl text-left transition-all group"
                >
                  <div className="font-bold text-red-400 text-lg tracking-widest mb-1">大师挑战</div>
                  <div className="text-xs text-white/50">面对最高难度AI，算牌与防守的极致考验。</div>
                </button>
                <button
                  onClick={() => handleStart('medium', 'campaign')}
                  className="w-full px-6 py-4 bg-black/40 border border-emerald-500/30 hover:bg-emerald-500/20 rounded-xl text-left transition-all group"
                >
                  <div className="font-bold text-emerald-300 text-lg tracking-widest mb-1">闯关模式</div>
                  <div className="text-xs text-white/50">3胜通关，2负失败，适合持续挑战与成长。</div>
                </button>
              </div>

              <button
                onClick={() => setShowModeSelect(false)}
                className="px-8 py-3 w-full bg-transparent border border-white/10 text-white/60 rounded-xl hover:bg-white/5 hover:text-white transition-all font-bold tracking-[0.2em] uppercase text-sm"
              >
                返回
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
