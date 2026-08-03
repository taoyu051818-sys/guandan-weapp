import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../../store/gameStore';

export const SettingsModal: React.FC = () => {
  const { showSettings, setGameState, difficulty, settings, updateSettings } = useGameStore();

  if (!showSettings) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="relative w-full max-w-md bg-luxury-obsidian/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-luxury-gold/30 p-8 text-luxury-ivory font-outfit"
        >
          <button
            onClick={() => setGameState({ showSettings: false })}
            className="absolute top-4 right-4 text-white/40 hover:text-luxury-gold transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <h2 className="text-3xl font-black mb-8 text-center font-cinzel text-gold-gradient tracking-[0.1em] drop-shadow-[0_0_15px_rgba(212,175,55,0.3)]">
            游戏设置
          </h2>

          <div className="space-y-8">
            {/* 难度设置 */}
            <div className="space-y-4">
              <label className="text-sm font-bold tracking-widest uppercase text-luxury-goldLight/70">AI 难度</label>
              <div className="grid grid-cols-4 gap-2">
                {(['easy', 'medium', 'hard', 'master'] as const).map((level) => (
                  <button
                    key={level}
                    onClick={() => setGameState({ difficulty: level })}
                    className={`py-3 rounded-lg font-bold tracking-widest text-sm transition-all border ${
                      difficulty === level
                        ? 'bg-luxury-gold/10 border-luxury-gold text-luxury-goldLight shadow-[0_0_15px_rgba(212,175,55,0.3)]'
                        : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {level === 'easy' ? '简单' : level === 'medium' ? '中等' : level === 'hard' ? '困难' : '大师'}
                  </button>
                ))}
              </div>
              <p className="text-xs text-white/40 mt-2 leading-relaxed tracking-wide">
                {difficulty === 'easy' && 'AI倾向随机与激进试错，剪枝激进，配合能力弱。'}
                {difficulty === 'medium' && 'AI具备基础配合与攻守平衡，会进行适度让牌。'}
                {difficulty === 'hard' && 'AI强化拦截与冲刺，少Pass，控场更主动。'}
                {difficulty === 'master' && 'AI进行全局规划与队友协同，预判更深，炸弹更精准。'}
              </p>
            </div>

            {/* 排序设置 */}
            <div className="space-y-4 pt-6 border-t border-white/10">
              <label className="text-sm font-bold tracking-widest uppercase text-luxury-goldLight/70">手牌排序方式</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => updateSettings({ sortOrder: 'desc' })}
                  className={`py-3 rounded-lg font-bold tracking-widest text-sm transition-all border ${
                    settings.sortOrder === 'desc'
                      ? 'bg-luxury-gold/10 border-luxury-gold text-luxury-goldLight shadow-[0_0_15px_rgba(212,175,55,0.3)]'
                      : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  大牌在左
                </button>
                <button
                  onClick={() => updateSettings({ sortOrder: 'asc' })}
                  className={`py-3 rounded-lg font-bold tracking-widest text-sm transition-all border ${
                    settings.sortOrder === 'asc'
                      ? 'bg-luxury-gold/10 border-luxury-gold text-luxury-goldLight shadow-[0_0_15px_rgba(212,175,55,0.3)]'
                      : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  小牌在左
                </button>
              </div>
            </div>

            <div className="space-y-4 pt-6 border-t border-white/10">
              <label className="text-sm font-bold tracking-widest uppercase text-luxury-goldLight/70">规则预设</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => updateSettings({ rulePreset: 'classic' })}
                  className={`py-3 rounded-lg font-bold tracking-widest text-sm transition-all border ${
                    settings.rulePreset === 'classic'
                      ? 'bg-luxury-gold/10 border-luxury-gold text-luxury-goldLight shadow-[0_0_15px_rgba(212,175,55,0.3)]'
                      : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  经典规则
                </button>
                <button
                  onClick={() => updateSettings({ rulePreset: 'tournament' })}
                  className={`py-3 rounded-lg font-bold tracking-widest text-sm transition-all border ${
                    settings.rulePreset === 'tournament'
                      ? 'bg-luxury-gold/10 border-luxury-gold text-luxury-goldLight shadow-[0_0_15px_rgba(212,175,55,0.3)]'
                      : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  竞技规则
                </button>
              </div>
            </div>

            <div className="space-y-4 pt-6 border-t border-white/10">
              <label className="text-sm font-bold tracking-widest uppercase text-luxury-goldLight/70">视觉主题</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => updateSettings({ visualTheme: 'luxury' })}
                  className={`py-3 rounded-lg font-bold tracking-widest text-sm transition-all border ${
                    settings.visualTheme === 'luxury'
                      ? 'bg-luxury-gold/10 border-luxury-gold text-luxury-goldLight shadow-[0_0_15px_rgba(212,175,55,0.3)]'
                      : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  华丽主题
                </button>
                <button
                  onClick={() => updateSettings({ visualTheme: 'compact' })}
                  className={`py-3 rounded-lg font-bold tracking-widest text-sm transition-all border ${
                    settings.visualTheme === 'compact'
                      ? 'bg-luxury-gold/10 border-luxury-gold text-luxury-goldLight shadow-[0_0_15px_rgba(212,175,55,0.3)]'
                      : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  竞技简洁
                </button>
              </div>
            </div>

            {/* 音效与音乐设置 */}
            <div className="space-y-4 pt-6 border-t border-white/10">
              <div className="flex items-center justify-between">
                <label className="text-sm font-bold tracking-widest uppercase text-luxury-goldLight/70">游戏音效</label>
                <button 
                  onClick={() => updateSettings({ soundEnabled: !settings.soundEnabled })}
                  className={`w-12 h-6 rounded-full relative transition-colors ${settings.soundEnabled ? 'bg-luxury-gold shadow-[0_0_10px_rgba(212,175,55,0.4)]' : 'bg-white/10 border border-white/20'}`}
                >
                  <div className={`absolute top-1 w-4 h-4 rounded-full shadow-sm transition-transform ${settings.soundEnabled ? 'translate-x-6 bg-luxury-obsidian' : 'translate-x-1 bg-white/50'}`} />
                </button>
              </div>

              {settings.soundEnabled && (
                <div className="flex items-center justify-between pl-4 pt-2">
                  <span className="text-xs text-white/50">音效音量</span>
                  <input 
                    type="range" 
                    min="0" max="1" step="0.1" 
                    value={settings.volume} 
                    onChange={(e) => updateSettings({ volume: parseFloat(e.target.value) })}
                    className="w-32 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-luxury-gold"
                  />
                </div>
              )}
              
              <div className="flex items-center justify-between pt-4 border-t border-white/5">
                <label className="text-sm font-bold tracking-widest uppercase text-luxury-goldLight/70">背景音乐</label>
                <button 
                  onClick={() => updateSettings({ bgmEnabled: !settings.bgmEnabled })}
                  className={`w-12 h-6 rounded-full relative transition-colors ${settings.bgmEnabled ? 'bg-luxury-gold shadow-[0_0_10px_rgba(212,175,55,0.4)]' : 'bg-white/10 border border-white/20'}`}
                >
                  <div className={`absolute top-1 w-4 h-4 rounded-full shadow-sm transition-transform ${settings.bgmEnabled ? 'translate-x-6 bg-luxury-obsidian' : 'translate-x-1 bg-white/50'}`} />
                </button>
              </div>

              {settings.bgmEnabled && (
                <div className="flex items-center justify-between pl-4 pt-2">
                  <span className="text-xs text-white/50">音乐音量</span>
                  <input 
                    type="range" 
                    min="0" max="1" step="0.05" 
                    value={settings.bgmVolume} 
                    onChange={(e) => updateSettings({ bgmVolume: parseFloat(e.target.value) })}
                    className="w-32 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-luxury-gold"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="mt-10 flex justify-center">
            <button
              onClick={() => setGameState({ showSettings: false })}
              className="group relative px-10 py-3 bg-luxury-goldDark text-luxury-obsidian font-black tracking-widest uppercase text-sm rounded-full shadow-gold-glow transition-all transform hover:scale-105 overflow-hidden"
            >
              <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
              <span className="relative z-10">确定返回</span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
