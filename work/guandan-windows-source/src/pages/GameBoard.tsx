import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useGameStore } from '../store/gameStore';
import { PlayerArea } from '../components/game/PlayerArea';
import { HandArea } from '../components/game/HandArea';
import { PlayArea } from '../components/game/PlayArea';
import { TributePhase } from './TributePhase';
import {
  makeDecision,
  getHardRuntimeTuning,
  setHardRuntimeTuning,
  type AIDecisionMetrics,
  type HardRuntimeTuning,
} from '../lib/ai';
import { audioManager } from '../lib/audio';
import { getPlayInfo } from '../lib/rules';
import { PlayType, Rank } from '../types/game';
import { AIWorkerClient } from '../lib/aiWorkerClient';

const RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 'J', 'Q', 'K', 'A'];

const getOpposingTeam = (team: 'teamA' | 'teamB'): 'teamA' | 'teamB' =>
  team === 'teamA' ? 'teamB' : 'teamA';

const shiftRank = (rank: Rank, delta: number): Rank => {
  const index = RANKS.indexOf(rank);
  const safeIndex = Math.max(0, Math.min(index + delta, RANKS.length - 1));
  return RANKS[safeIndex];
};

const rankDelta = (from: Rank, to: Rank): number => RANKS.indexOf(to) - RANKS.indexOf(from);

export const GameBoard: React.FC = () => {
  const { 
    currentLevel, levelTeam, status, players, currentTurn, difficulty, lastValidPlay, gameMode, teamLevels, aiRoundMeta,
    setGameState, nextTurn, playCards, passTurn, sendChatMessage, clearChatMessage
  } = useGameStore();

  // AI 逻辑轮询
  const showSettings = useGameStore(state => state.showSettings);
  const showTutorial = useGameStore(state => state.showTutorial);
  const finishedPlayersLength = useGameStore(state => state.finishedPlayers.length);
  const aiWorkerRef = useRef<AIWorkerClient | null>(null);
  const [hardTuning, setHardTuningState] = useState<HardRuntimeTuning>(() => getHardRuntimeTuning());
  const [devMetricSummary, setDevMetricSummary] = useState({
    samples: 0,
    avgElapsedMs: 0,
    avgDepth: 0,
    avgNodes: 0,
  });
  const isDev = import.meta.env.DEV;

  const applyHardTuning = (patch: Partial<HardRuntimeTuning>) => {
    setHardRuntimeTuning(patch);
    setHardTuningState(getHardRuntimeTuning());
  };

  const pushMetric = (metrics: AIDecisionMetrics) => {
    setDevMetricSummary((prev) => {
      const samples = prev.samples + 1;
      return {
        samples,
        avgElapsedMs: (prev.avgElapsedMs * prev.samples + metrics.elapsedMs) / samples,
        avgDepth: (prev.avgDepth * prev.samples + metrics.endgameDepth) / samples,
        avgNodes: (prev.avgNodes * prev.samples + metrics.endgameNodes) / samples,
      };
    });
  };

  useEffect(() => {
    aiWorkerRef.current = new AIWorkerClient();
    return () => {
      aiWorkerRef.current?.dispose();
      aiWorkerRef.current = null;
    };
  }, []);

  // 检查游戏是否结束并结算
  useEffect(() => {
    const { finishedPlayers, players, teamLevels, currentLevel, scores, aFailStreaks, setGameState } = useGameStore.getState();
    if (status !== 'playing') return;

    if (finishedPlayers.length > 0) {
      const firstPlayerId = finishedPlayers[0];
      const firstPlayer = players[firstPlayerId];
      const teammateId = firstPlayer.team === 'teamA' 
        ? (firstPlayerId === 'p1' ? 'p3' : 'p1') 
        : (firstPlayerId === 'p2' ? 'p4' : 'p2');
      
      const secondPlayerId = finishedPlayers.length >= 2 ? finishedPlayers[1] : null;
      const thirdPlayerId = finishedPlayers.length >= 3 ? finishedPlayers[2] : null;

      let isGameOver = false;
      let levelUp = 0;

      // 双下（队友包揽第一和第二名）
      if (secondPlayerId === teammateId) {
        isGameOver = true;
        levelUp = 3;
      } 
      // 单下（队友获得第三名）
      else if (thirdPlayerId === teammateId) {
        isGameOver = true;
        levelUp = 2;
      } 
      // 平局（队友获得最后一名）
      else if (finishedPlayers.length === 3) {
        isGameOver = true;
        levelUp = 1;
      }

      if (isGameOver) {
        const nextTeamLevels = { ...teamLevels };
        const nextAFailStreaks = { ...aFailStreaks };
        let nextLevel = currentLevel;
        const nextTeam = firstPlayer.team;
        const loserTeam = getOpposingTeam(firstPlayer.team);
        let settlementWinnerTeam = firstPlayer.team;
        let settlementLevelDelta = levelUp;
        let isAChallengePassed = false;
        let customMessage = '';

        const winnerCurrentRank = teamLevels[firstPlayer.team];
        const isAChallenge = winnerCurrentRank === 'A';
        const isAChallengeFail = isAChallenge && levelUp < 2;
        const isAChallengeSuccess = isAChallenge && levelUp >= 2;

        if (isAChallengeSuccess) {
          isAChallengePassed = true;
          nextAFailStreaks[firstPlayer.team] = 0;
          nextTeamLevels[firstPlayer.team] = 'A';
          // 打过A后，对手从2重新开始
          nextTeamLevels[loserTeam] = 2;
          nextLevel = 'A';
          customMessage = '恭喜！达成双下/单下，成功打过 A！';
        } else if (isAChallengeFail) {
          const failTimes = nextAFailStreaks[firstPlayer.team] + 1;
          nextAFailStreaks[firstPlayer.team] = failTimes;

          let downgradedRank: Rank;
          if (failTimes >= 3) {
            // 三次不过回2
            downgradedRank = 2;
            nextAFailStreaks[firstPlayer.team] = 0;
          } else {
            downgradedRank = shiftRank('A', -failTimes);
          }

          nextTeamLevels[firstPlayer.team] = downgradedRank;
          // 降级后，对手从当前失败级数+1继续打
          const opponentCarryRank = shiftRank(downgradedRank, 1);
          nextTeamLevels[loserTeam] = opponentCarryRank;
          nextLevel = opponentCarryRank;

          settlementWinnerTeam = loserTeam;
          settlementLevelDelta = rankDelta('A', downgradedRank);
          customMessage =
            failTimes >= 3
              ? '冲A连续三次失败，按规则退回 2 级；对手从 3 级继续。'
              : `冲A失败，第 ${failTimes} 次不过；降至 ${downgradedRank} 级，对手从 ${opponentCarryRank} 级继续。`;
        } else {
          // 非A关卡，正常升级；但 K 打 1 级不能直接上 A（头游+末游不算上A）
          const upgradedRank = shiftRank(winnerCurrentRank, levelUp);
          const blockedToA = winnerCurrentRank === 'K' && levelUp === 1;
          const finalRank = blockedToA ? 'K' : upgradedRank;
          nextTeamLevels[firstPlayer.team] = finalRank;
          nextLevel = finalRank;
          settlementLevelDelta = rankDelta(winnerCurrentRank, finalRank);
          if (blockedToA) {
            customMessage = '本局为头游+末游，不满足上A条件，仍停留在 K 级继续冲A。';
          }
        }

        const newScores = { ...scores };
        if (settlementLevelDelta > 0) {
          newScores[settlementWinnerTeam] += settlementLevelDelta;
        }

        // 计算完整排名
        const allPlayers = ['p1', 'p2', 'p3', 'p4'] as const;
        const remainingPlayers = allPlayers.filter(p => !finishedPlayers.includes(p));
        const fullRank = [...finishedPlayers, ...remainingPlayers];

        // 更新玩家数据
        const { playerStats, campaignProgress } = useGameStore.getState();
        const newStats = { ...playerStats };
        if (firstPlayerId === 'p1') newStats.firstPlaceFinishes += 1;
        if (settlementWinnerTeam === players['p1'].team) {
          newStats.wins += 1;
          newStats.elo += Math.max(1, Math.abs(settlementLevelDelta)) * 10;
        } else {
          newStats.elo = Math.max(0, newStats.elo - Math.max(1, Math.abs(settlementLevelDelta)) * 5);
        }

        let nextCampaignProgress = campaignProgress;
        if (gameMode === 'campaign') {
          const isMyTeamWinRound = settlementWinnerTeam === players['p1'].team;
          if (!campaignProgress) {
            nextCampaignProgress = { chapter: 1, targetWins: 3, wins: 0, losses: 0, completed: false, failed: false };
          } else {
            nextCampaignProgress = { ...campaignProgress };
          }
          if (isMyTeamWinRound) nextCampaignProgress.wins += 1;
          else nextCampaignProgress.losses += 1;
          nextCampaignProgress.completed = nextCampaignProgress.wins >= nextCampaignProgress.targetWins;
          nextCampaignProgress.failed = nextCampaignProgress.losses >= 2;
        }

        setTimeout(() => {
          let msg = customMessage;
          if (!msg) {
            if (levelUp === 3) msg = '达成双下！完美配合！';
            else if (levelUp === 2) msg = '队友获得三游，表现出色！';
            else msg = '队友末游，险胜一筹！';
          }
          if (gameMode === 'campaign' && nextCampaignProgress) {
            if (nextCampaignProgress.completed) msg = `闯关成功！第 ${nextCampaignProgress.chapter} 章已通关。`;
            else if (nextCampaignProgress.failed) msg = `闯关失败：已累计 ${nextCampaignProgress.losses} 负。`;
            else msg = `闯关进度：${nextCampaignProgress.wins}/${nextCampaignProgress.targetWins} 胜，${nextCampaignProgress.losses}/2 负。`;
          }

          setGameState({ 
            status: 'settlement', 
            currentLevel: nextLevel,
            levelTeam: nextTeam,
            teamLevels: nextTeamLevels,
            aFailStreaks: nextAFailStreaks,
            dealerId: firstPlayerId, // 将头游设置为新庄家
            scores: newScores,
            lastRoundRank: fullRank,
            playerStats: newStats,
            finishedPlayers: [],
            settlementInfo: {
              winnerTeam: settlementWinnerTeam,
              levelUp: settlementLevelDelta,
              message: msg,
              isGameWon: isAChallengePassed
            },
            recentMatch: {
              finishedAt: Date.now(),
              winnerTeam: settlementWinnerTeam,
              levelUp: settlementLevelDelta,
              currentLevel: nextLevel,
              teamLevels: nextTeamLevels,
              scores: newScores,
            },
            campaignProgress: nextCampaignProgress,
          });
        }, 1000);
      }
    }
  }, [finishedPlayersLength, status, gameMode]); // 监听完成人数的变化

  useEffect(() => {
    if (status !== 'playing' || showSettings || showTutorial) return;

    const totalCards = Object.values(players).reduce((sum, p) => sum + p.hand.length, 0);
    if (totalCards === 0) return; // 还没发完牌

    const currentPlayer = players[currentTurn];
    let hurryTimer: NodeJS.Timeout;
    
    // 如果当前玩家已经出完牌了，跳过回合
    if (currentPlayer.hand.length === 0) {
      nextTurn();
      return;
    }

    if (currentPlayer.isAI) {
        const timer = setTimeout(() => {
          // AI 的接风逻辑已经移入 gameStore.ts 中的 nextTurn
          const currentLastPlay = lastValidPlay;
          const runAITurn = async () => {
            let decision = null;
            try {
              if (aiWorkerRef.current) {
                decision = await aiWorkerRef.current.requestDecision({
                  hand: currentPlayer.hand,
                  lastPlay: currentLastPlay,
                  difficulty,
                  myTeam: currentPlayer.team,
                  players,
                  myPlayerId: currentTurn,
                  aiContext: {
                    currentLevel,
                    teamLevels,
                    roundMeta: aiRoundMeta,
                  },
                });
                const metrics = aiWorkerRef.current.getLastMetrics();
                if (metrics && import.meta.env.DEV) {
                  pushMetric(metrics);
                  console.debug('[AI metrics]', metrics);
                }
              } else {
                decision = makeDecision(currentPlayer.hand, currentLastPlay, difficulty, currentPlayer.team, players, currentTurn, {
                  currentLevel,
                  teamLevels,
                  roundMeta: aiRoundMeta,
                });
              }
            } catch {
              decision = makeDecision(currentPlayer.hand, currentLastPlay, difficulty, currentPlayer.team, players, currentTurn, {
                currentLevel,
                teamLevels,
                roundMeta: aiRoundMeta,
              });
            }
            
            if (decision) {
              const info = getPlayInfo(decision);
              if (!info) {
                passTurn(currentTurn);
              } else {
                const teammateLed =
                  !!currentLastPlay &&
                  currentLastPlay.type !== PlayType.Pass &&
                  players[currentLastPlay.playerId].team === currentPlayer.team;
                const isBombPlay =
                  info.type === PlayType.Bomb ||
                  info.type === PlayType.StraightFlush ||
                  info.type === PlayType.Rocket;
                // 最后一层保险：严禁同队炸弹互压，防止策略回归导致“炸队友”。
                if (teammateLed && isBombPlay) {
                  passTurn(currentTurn);
                } else {
                  playCards({
                    playerId: currentTurn,
                    cards: decision,
                    type: info.type,
                  });
                }
              }
            } else {
              passTurn(currentTurn);
            }
            
            setTimeout(() => {
              const { finishedPlayers: fp, players: ps } = useGameStore.getState();
              if (fp.length >= 3) return;
              if (fp.length === 2 && ps[fp[0]].team === ps[fp[1]].team) return;
              nextTurn();
            }, 0);
          };

          void runAITurn();

        }, 1000); // 模拟思考时间
        
        return () => clearTimeout(timer);
      } else {
        // 轮到玩家出牌，如果长时间不出牌（15秒），AI随机催促
        hurryTimer = setTimeout(() => {
          // 找一个活着的AI来催促
          const aiPlayers = Object.values(players).filter(p => p.isAI && p.hand.length > 0);
          if (aiPlayers.length > 0) {
            const randomAI = aiPlayers[Math.floor(Math.random() * aiPlayers.length)];
            const hurryMessage = "快点啊，我等的花儿都谢了";
            const msgId = sendChatMessage(randomAI.id, hurryMessage);
            audioManager.playVoice('chat_hurry');
            
            setTimeout(() => {
               useGameStore.getState().clearChatMessage(randomAI.id, msgId);
            }, 2500); // 气泡保留 2.5 秒
          }
        }, 15000);
        
        return () => clearTimeout(hurryTimer);
      }
  }, [currentTurn, players, status, difficulty, lastValidPlay, playCards, passTurn, nextTurn, setGameState, showSettings, showTutorial, sendChatMessage, clearChatMessage, currentLevel, teamLevels, aiRoundMeta]);

  return (
    <div className="relative w-screen h-screen bg-luxury-obsidian overflow-hidden select-none font-outfit text-luxury-ivory">
      {/* 背景装饰 - 高级扑克桌 */}
      <div className="absolute inset-0 bg-radial-poker z-0" />
      <div className="absolute inset-0 bg-noise z-0 opacity-30" />
      <div className="absolute inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[80vw] h-[50vh] bg-luxury-goldLight rounded-full mix-blend-overlay filter blur-[150px] opacity-10" />
      </div>

      {/* 顶部状态栏 - 玻璃拟态 */}
      <motion.div 
        initial={{ y: -50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="absolute top-2 left-4 max-w-3xl glass-panel rounded-full px-8 py-3 flex justify-between items-center z-50 border-luxury-gold/20"
      >
        <div className="flex items-center space-x-6 text-white/90 font-medium">
          <div className="flex items-center">
            <span className="text-white/50 mr-3 text-sm tracking-widest uppercase">当前级别</span>
            <span className="text-3xl font-cinzel text-gold-gradient font-bold drop-shadow-[0_0_10px_rgba(212,175,55,0.5)]">{currentLevel}</span>
          </div>
          <div className="h-6 w-px bg-white/20" />
          <div className="flex items-center text-sm">
            <span className="text-white/50 mr-3 tracking-widest uppercase">庄家</span>
            <span className="bg-luxury-gold/20 border border-luxury-gold/50 text-luxury-goldLight px-4 py-1 rounded-full font-bold shadow-[0_0_10px_rgba(212,175,55,0.2)]">
              {levelTeam === 'teamA' ? '我方队伍' : '敌方队伍'}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <button 
            onClick={() => setGameState({ status: 'menu' })}
            className="px-5 py-2 rounded-full text-xs font-bold tracking-widest uppercase bg-white/5 hover:bg-white/10 text-white/70 hover:text-white border border-white/10 transition-all"
          >
            返回主页
          </button>
          <button 
            onClick={() => setGameState({ showSettings: true })}
            className="px-5 py-2 rounded-full text-xs font-bold tracking-widest uppercase bg-luxury-gold/10 hover:bg-luxury-gold/20 text-luxury-goldLight border border-luxury-gold/30 transition-all"
          >
            设置
          </button>
        </div>
      </motion.div>

      {isDev && (
        <div className="absolute top-20 right-4 z-50 w-[320px] glass-panel border border-emerald-300/20 rounded-2xl p-4 text-xs text-white/85">
          <div className="text-emerald-200 font-bold tracking-widest mb-3">AI DEV 调参</div>
          <div className="space-y-3">
            <label className="block">
              <div className="flex justify-between mb-1">
                <span>六必治阈值</span><span>{hardTuning.interceptThreshold}</span>
              </div>
              <input type="range" min={3} max={10} value={hardTuning.interceptThreshold} onChange={(e) => applyHardTuning({ interceptThreshold: Number(e.target.value) })} className="w-full" />
            </label>
            <label className="block">
              <div className="flex justify-between mb-1">
                <span>探路下限</span><span>{hardTuning.pairProbeMin}</span>
              </div>
              <input type="range" min={3} max={14} value={hardTuning.pairProbeMin} onChange={(e) => applyHardTuning({ pairProbeMin: Number(e.target.value) })} className="w-full" />
            </label>
            <label className="block">
              <div className="flex justify-between mb-1">
                <span>探路上限</span><span>{hardTuning.pairProbeMax}</span>
              </div>
              <input type="range" min={hardTuning.pairProbeMin} max={15} value={hardTuning.pairProbeMax} onChange={(e) => applyHardTuning({ pairProbeMax: Number(e.target.value) })} className="w-full" />
            </label>
            <label className="block">
              <div className="flex justify-between mb-1">
                <span>保炸惩罚</span><span>{hardTuning.straightFlushBombBreakPenalty}</span>
              </div>
              <input type="range" min={0} max={200} value={hardTuning.straightFlushBombBreakPenalty} onChange={(e) => applyHardTuning({ straightFlushBombBreakPenalty: Number(e.target.value) })} className="w-full" />
            </label>
          </div>
          <div className="mt-4 pt-3 border-t border-white/10 text-[11px] text-white/70 space-y-1">
            <div>样本: {devMetricSummary.samples}</div>
            <div>平均耗时: {devMetricSummary.avgElapsedMs.toFixed(2)} ms</div>
            <div>平均残局深度: {devMetricSummary.avgDepth.toFixed(2)}</div>
            <div>平均残局节点: {devMetricSummary.avgNodes.toFixed(2)}</div>
          </div>
        </div>
      )}

      {/* AI 玩家区域 */}
      <PlayerArea playerId="p3" position="top" />
      <PlayerArea playerId="p4" position="left" />
      <PlayerArea playerId="p2" position="right" />

      {/* 中心出牌区域 */}
      <PlayArea />

      {/* 进贡阶段遮罩 */}
      {status === 'tribute' && <TributePhase />}

      {/* 己方手牌区域 */}
      <div className="absolute bottom-0 left-0 w-full z-40">
        <HandArea />
      </div>
    </div>
  );
};
