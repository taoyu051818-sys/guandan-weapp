import React from 'react';
import { motion } from 'framer-motion';
import { useGameStore } from '../store/gameStore';

export const Settlement: React.FC = () => {
  const { 
    settlementInfo, 
    scores, 
    startNextRound, 
    setGameState, 
    currentLevel,
    gameMode,
    campaignProgress,
  } = useGameStore();

  if (!settlementInfo) return null;

  const isMyTeamWin = settlementInfo.winnerTeam === 'teamA';
  const isFinalVictory = settlementInfo.isGameWon;
  const levelDeltaText = settlementInfo.levelUp > 0 ? `+${settlementInfo.levelUp}` : `${settlementInfo.levelUp}`;
  const isCampaignEnd = gameMode === 'campaign' && !!campaignProgress && (campaignProgress.completed || campaignProgress.failed);
  const titleColor = isMyTeamWin ? 'text-luxury-goldLight' : 'text-luxury-crimson';
  const titleGlow = isMyTeamWin ? 'drop-shadow-[0_0_20px_rgba(212,175,55,0.6)]' : 'drop-shadow-[0_0_20px_rgba(139,0,0,0.6)]';
  const bgGlow = isFinalVictory ? 'bg-amber-300' : (isMyTeamWin ? 'bg-luxury-goldDark' : 'bg-luxury-crimson');
  const shouldReturnMenu = isCampaignEnd || isFinalVictory;

  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen bg-luxury-obsidian overflow-hidden font-outfit text-luxury-ivory">
      {/* 噪音和背景 */}
      <div className="absolute inset-0 bg-radial-poker z-0" />
      <div className="absolute inset-0 bg-noise z-0 opacity-30" />
      
      {/* 动态氛围光 */}
      <div className="absolute inset-0 pointer-events-none z-0 flex items-center justify-center">
        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: isFinalVictory ? 1.35 : 1.2, opacity: isFinalVictory ? 0.26 : 0.15 }}
          transition={{ duration: isFinalVictory ? 1.4 : 2, repeat: Infinity, repeatType: "reverse" }}
          className={`w-[60vw] h-[60vw] rounded-full mix-blend-screen filter blur-[150px] ${bgGlow}`} 
        />
      </div>
      {isFinalVictory && (
        <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
          {Array.from({ length: 18 }).map((_, i) => {
            const left = `${(i * 17) % 100}%`;
            const delay = (i % 6) * 0.25;
            const duration = 2.8 + (i % 4) * 0.5;
            return (
              <motion.div
                key={`celebrate-${i}`}
                initial={{ y: -80, opacity: 0 }}
                animate={{ y: ['0%', '35%', '85%'], opacity: [0, 0.95, 0] }}
                transition={{ duration, repeat: Infinity, delay, ease: 'easeIn' }}
                className="absolute top-0 w-2 h-6 rounded-sm"
                style={{
                  left,
                  background: i % 2 === 0 ? '#facc15' : '#f97316',
                  rotate: i % 2 === 0 ? 12 : -12,
                }}
              />
            );
          })}
        </div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 50, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 20 }}
        className="relative z-10 w-full max-w-2xl glass-panel rounded-3xl shadow-2xl border border-luxury-gold/30 p-12 text-center"
      >
        <h1 className={`text-6xl font-black font-cinzel tracking-widest uppercase mb-4 ${titleColor} ${titleGlow}`}>
          {isFinalVictory ? '冲关成功' : (isMyTeamWin ? '胜利' : '失败')}
        </h1>
        {isFinalVictory && (
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: [1, 1.06, 1], opacity: 1 }}
            transition={{ duration: 1.6, repeat: Infinity }}
            className="mb-4 text-2xl text-amber-200 font-cinzel tracking-[0.2em]"
          >
            恭喜A关突破 · 比赛结束
          </motion.div>
        )}
        
        <p className="text-xl text-white/60 tracking-widest font-light mb-10">
          {settlementInfo.message}
        </p>

        {/* 核心数据区 */}
        <div className="grid grid-cols-2 gap-8 mb-12">
          {/* 左侧：升级信息 */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 flex flex-col items-center justify-center">
            <span className="text-sm tracking-widest text-luxury-goldLight/70 uppercase mb-2">队伍晋级</span>
            <div className="flex items-end space-x-2">
              <span className="text-5xl font-cinzel font-bold text-gold-gradient drop-shadow-md">
                {levelDeltaText}
              </span>
              <span className="text-lg text-white/40 mb-1 tracking-widest">级</span>
            </div>
            <div className="mt-4 text-sm text-white/50 bg-black/30 px-4 py-1 rounded-full border border-white/5">
              下一局打 <span className="text-luxury-goldLight font-bold font-cinzel text-lg ml-1">{currentLevel}</span>
            </div>
          </div>

          {/* 右侧：总分比拼 */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 flex flex-col justify-center">
            <span className="text-sm tracking-widest text-luxury-goldLight/70 uppercase mb-4 text-center">当前总分</span>
            <div className="flex justify-between items-center px-4 mb-3">
              <span className="text-blue-300 font-bold tracking-widest">我方队伍</span>
              <span className="text-2xl font-cinzel font-bold text-white">{scores.teamA}</span>
            </div>
            <div className="h-px w-full bg-gradient-to-r from-transparent via-white/20 to-transparent mb-3" />
            <div className="flex justify-between items-center px-4">
              <span className="text-red-300 font-bold tracking-widest">敌方队伍</span>
              <span className="text-2xl font-cinzel font-bold text-white">{scores.teamB}</span>
            </div>
          </div>
        </div>

        {gameMode === 'campaign' && campaignProgress && (
          <div className="mb-8 bg-emerald-900/20 border border-emerald-400/20 rounded-2xl p-4">
            <div className="text-sm tracking-widest text-emerald-200/80 mb-2">闯关进度</div>
            <div className="text-white/80 text-sm">
              第 {campaignProgress.chapter} 章 | 胜场 {campaignProgress.wins}/{campaignProgress.targetWins} | 负场 {campaignProgress.losses}/2
            </div>
          </div>
        )}

        {/* 底部按钮 */}
        <div className="flex flex-col space-y-4 items-center">
          <motion.button
            whileHover={{ scale: 1.05, boxShadow: '0 0 25px rgba(212, 175, 55, 0.4)' }}
            whileTap={{ scale: 0.95 }}
            onClick={() => {
              if (shouldReturnMenu) {
                setGameState({ status: 'menu' });
                return;
              }
              startNextRound();
            }}
            className="group relative px-16 py-4 bg-gradient-to-r from-luxury-goldDark to-luxury-gold text-luxury-obsidian font-cinzel font-black text-xl tracking-[0.2em] rounded-full shadow-gold-glow overflow-hidden transition-all w-full max-w-sm"
          >
            <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
            <span className="relative z-10">{shouldReturnMenu ? '返回主菜单' : '继续下一局'}</span>
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.05, backgroundColor: 'rgba(255,255,255,0.05)' }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setGameState({ status: 'menu', settlementInfo: null })}
            className="px-16 py-3 bg-transparent border border-white/10 text-white/60 hover:text-white rounded-full font-outfit font-bold text-sm tracking-[0.2em] transition-all w-full max-w-sm uppercase"
          >
            返回主菜单
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
};
