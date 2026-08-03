import { create } from 'zustand';
import { devtools, persist, createJSONStorage } from 'zustand/middleware';
import { GameState, PlayerId, Card, PlayAction, Team, PlayType, GameSettings } from '../types/game';
import { createDeck, shuffleDeck, dealCards } from '../lib/deck';
import { audioManager } from '../lib/audio';
import { setRuleProfileByPreset } from '../lib/rules';

interface GameStore extends GameState {
  setGameState: (state: Partial<GameState>) => void;
  updateSettings: (settings: Partial<GameSettings>) => void;
  updatePlayerHand: (playerId: PlayerId, newHand: Card[]) => void;
  nextTurn: () => void;
  playCards: (action: PlayAction) => void;
  passTurn: (playerId: PlayerId) => void;
  resetRound: () => void;
  startGame: (difficulty: 'easy' | 'medium' | 'hard' | 'master', gameMode?: 'standard' | 'double_open' | 'campaign', isMultiplayer?: boolean, roomId?: string | null, myPlayerId?: PlayerId) => void;
  setDealerAndTeams: (dealerId: PlayerId, teamAIds: PlayerId[], teamBIds: PlayerId[]) => void;
  startDealing: () => void;
  finishDealing: () => void;
  startNextRound: () => void;
  executeTribute: (fromId: PlayerId, cardId: string) => void;
  executeReturnTribute: (fromId: PlayerId, cardId: string) => void;
  finishTribute: () => void;
  sendChatMessage: (playerId: PlayerId, message: string) => number;
  clearChatMessage: (playerId: PlayerId, messageId: number) => void;
}

const initialPlayers = {
  p1: { id: 'p1' as PlayerId, name: '玩家', isAI: false, team: 'teamA' as Team, hand: [], role: 'normal' as const },
  p2: { id: 'p2' as PlayerId, name: '电脑(下家)', isAI: true, team: 'teamB' as Team, hand: [], role: 'normal' as const },
  p3: { id: 'p3' as PlayerId, name: '电脑(对家)', isAI: true, team: 'teamA' as Team, hand: [], role: 'normal' as const },
  p4: { id: 'p4' as PlayerId, name: '电脑(上家)', isAI: true, team: 'teamB' as Team, hand: [], role: 'normal' as const },
};

const cloneInitialPlayers = () => ({
  p1: { ...initialPlayers.p1, hand: [] as Card[] },
  p2: { ...initialPlayers.p2, hand: [] as Card[] },
  p3: { ...initialPlayers.p3, hand: [] as Card[] },
  p4: { ...initialPlayers.p4, hand: [] as Card[] },
});

const sortByOrder = (cards: Card[], sortOrder: 'asc' | 'desc') =>
  [...cards].sort((a, b) => sortOrder === 'desc' ? b.value - a.value : a.value - b.value);

export const useGameStore = create<GameStore>()(
  devtools(persist((set) => ({
      status: 'menu',
      gameMode: 'standard',
      isMultiplayer: false,
      roomId: null,
      myPlayerId: 'p1',
      currentLevel: 2,
      levelTeam: 'teamA',
      teamLevels: { teamA: 2, teamB: 2 },
      aFailStreaks: { teamA: 0, teamB: 0 },
      dealerId: null,
      players: cloneInitialPlayers(),
      turnOrder: ['p1', 'p2', 'p3', 'p4'],
      currentTurn: 'p1',
      playArea: [],
      lastValidPlay: null,
      scores: { teamA: 0, teamB: 0 },
      difficulty: 'medium',
      showTutorial: false,
      showSettings: false,
      finishedPlayers: [],
      lastRoundRank: [],
      tributeState: null,
      aiRoundMeta: null,
      settlementInfo: null,
      recentMatch: null,
      campaignProgress: null,
      activeChats: { p1: null, p2: null, p3: null, p4: null },
      playerStats: {
        gamesPlayed: 0,
        wins: 0,
        bombsPlayed: 0,
        firstPlaceFinishes: 0,
        elo: 1000,
      },
      settings: {
          soundEnabled: true,
          volume: 0.5,
          bgmEnabled: true,
          bgmVolume: 0.3,
          sortOrder: 'desc',
          rulePreset: 'classic',
          visualTheme: 'luxury',
        },

      setGameState: (state) => set((prev) => ({ ...prev, ...state })),

      updateSettings: (newSettings) => set((state) => {
        const settings = { ...state.settings, ...newSettings };
        audioManager.setConfig(settings.soundEnabled, settings.volume, settings.bgmEnabled, settings.bgmVolume);
        setRuleProfileByPreset(settings.rulePreset);
        
        // 重新对所有玩家手牌排序
        const newPlayers = { ...state.players };
        Object.keys(newPlayers).forEach(id => {
          newPlayers[id as PlayerId] = {
            ...newPlayers[id as PlayerId],
            hand: sortByOrder(newPlayers[id as PlayerId].hand, settings.sortOrder)
          };
        });

        return { settings, players: newPlayers };
      }),

      updatePlayerHand: (playerId, newHand) => set((state) => {
        const isFinished = newHand.length === 0;
        const newFinishedPlayers = isFinished && !state.finishedPlayers.includes(playerId)
          ? [...state.finishedPlayers, playerId]
          : state.finishedPlayers;

        return {
          players: {
            ...state.players,
            [playerId]: { ...state.players[playerId], hand: newHand },
          },
          finishedPlayers: newFinishedPlayers,
        };
      }),

      nextTurn: () => set((state) => {
        const currentIndex = state.turnOrder.indexOf(state.currentTurn);
        let nextIndex = (currentIndex + 1) % 4;
        let loopCount = 0;
        
        // 如果有3个人已经出完牌了，或者双下（前两名是同一队），游戏其实已经结束了，不需要再nextTurn
        if (state.finishedPlayers.length >= 3) return {};
        if (state.finishedPlayers.length === 2) {
          const p1 = state.players[state.finishedPlayers[0]];
          const p2 = state.players[state.finishedPlayers[1]];
          if (p1.team === p2.team) return {};
        }

        while (state.players[state.turnOrder[nextIndex]].hand.length === 0 && loopCount < 4) {
          nextIndex = (nextIndex + 1) % 4;
          loopCount++;
        }
        
        // 增加一个安全检查：如果 loopCount 达到 4，说明所有人都出完牌了，直接返回
        if (loopCount >= 4) return {};

        const nextTurnId = state.turnOrder[nextIndex];
        let nextValidPlay = state.lastValidPlay;

        // 接风核心逻辑：
        // 如果大家一圈都Pass了，轮转一圈回到了 lastValidPlay 的出牌人身上
        // 1. 如果该出牌人还有牌，那他正常获得新一轮首发权 (lastValidPlay = null)
        // 2. 如果该出牌人已经没牌了（此时他会被上面的 while 循环跳过，导致 nextTurnId 实际上是接风人），
        //    在真实的掼蛋接风规则中，此时应由他的“对家（队友）”接风！
        if (nextValidPlay) {
          const lastPlayerId = nextValidPlay.playerId;
          
          // 判断是否“一圈人都Pass了”：检查最近的出牌记录，看是否连续有 (剩下存活人数-1) 个 Pass
          // 或者更简单的做法：只要 nextTurnId 成了本来应该接手首发权的人
          // 由于跳过了没牌的人，所以这里直接判断：如果当前该轮到 lastPlayerId 出牌（或者因为他没牌而被跳过），都意味着一圈结束
          
          // 获取当前还活着的玩家数量
          const alivePlayers = state.turnOrder.filter(pId => state.players[pId].hand.length > 0);
          
          // 检查 playArea 中，自从 lastValidPlay 之后，是不是其他人全都 Pass 了
          let lastPlayIndex = -1;
          for (let i = state.playArea.length - 1; i >= 0; i--) {
            const p = state.playArea[i];
            if (p.playerId === lastPlayerId && p.type !== PlayType.Pass && p.cards.length > 0) {
              lastPlayIndex = i;
              break;
            }
          }
          if (lastPlayIndex !== -1) {
             const actionsAfterLastPlay = state.playArea.slice(lastPlayIndex + 1);
             const passCount = actionsAfterLastPlay.filter(a => a.type === PlayType.Pass).length;
             
             // 如果在 lastPlay 之后，存活的其他人都 Pass 了
             // 注意：这里需要排除掉 lastPlayerId 本人，所以是 alivePlayers.length - (lastPlayerId 还活着吗 ? 1 : 0)
             const expectedPasses = alivePlayers.length - (state.players[lastPlayerId].hand.length > 0 ? 1 : 0);
             
             if (passCount >= expectedPasses) {
                // 一圈结束，触发首发权移交
                nextValidPlay = null; // 清空上一把牌的记录，开启新一轮

                // 真正的接风规则：如果出牌人已经没牌了，牌权移交给他的队友！
                if (state.players[lastPlayerId].hand.length === 0) {
                   const lastPlayerIndex = state.turnOrder.indexOf(lastPlayerId);
                   const teammateId = state.turnOrder[(lastPlayerIndex + 2) % 4];
                   
                   // 如果队友还有牌，队友接风
                   if (state.players[teammateId].hand.length > 0) {
                     return { currentTurn: teammateId, lastValidPlay: null };
                   } 
                   // 如果队友也没牌了，顺延给此时的 nextTurnId 即可，他自然会获得首发权
                   return { currentTurn: nextTurnId, lastValidPlay: null };
                }

                // 如果自己出的牌，一圈没人管，自己还有牌，重新获得出牌权
                if (state.players[lastPlayerId].hand.length > 0) {
                  return { currentTurn: lastPlayerId, lastValidPlay: null };
                }
             }
          }
        }

        return { currentTurn: nextTurnId, lastValidPlay: nextValidPlay };
      }),

      playCards: (action) => set((state) => {
        const player = state.players[action.playerId];
        const newHand = player.hand.filter(c => !action.cards.find(pc => pc.id === c.id));
        
        const isFinished = newHand.length === 0;
        const newFinishedPlayers = isFinished && !state.finishedPlayers.includes(action.playerId)
          ? [...state.finishedPlayers, action.playerId]
          : state.finishedPlayers;

        const newStats = { ...state.playerStats };
        
        const voiceDelay = action.playerId === state.myPlayerId ? 60 : 200;

        if (action.type === PlayType.Bomb || action.type === PlayType.StraightFlush || action.type === PlayType.Rocket) {
          if (action.playerId === 'p1') newStats.bombsPlayed += 1;
          audioManager.playBombSound();
          
          setTimeout(() => {
            if (action.type === PlayType.Rocket) audioManager.playVoice('rocket');
            else if (action.type === PlayType.StraightFlush) audioManager.playVoice('straight_flush');
            else audioManager.playVoice('bomb');
          }, voiceDelay);
        } else {
          audioManager.playCardSound();
          
          setTimeout(() => {
            if (action.type === PlayType.Straight) audioManager.playVoice('straight');
            else if (action.type === PlayType.Tube) audioManager.playVoice('tube');
            else if (action.type === PlayType.Plate) audioManager.playVoice('plate');
            else {
              // 普通牌型语音播报
              const primaryCard = action.cards.find(c => !c.isRedJoker) || action.cards[0];
              let rankText = primaryCard.rank.toString();
              if (rankText === 'Small') rankText = 'Small';
              else if (rankText === 'Big') rankText = 'Big';
              
              if (action.type === PlayType.Single) audioManager.playVoice(`single_${rankText}`);
              else if (action.type === PlayType.Pair) audioManager.playVoice(`pair_${rankText}`);
              else if (action.type === PlayType.Triple) audioManager.playVoice(`triple_${rankText}`);
              else if (action.type === PlayType.TripleWithPair) audioManager.playVoice('triple_pair');
            }
          }, voiceDelay);
        }

        return {
          players: {
            ...state.players,
            [action.playerId]: { ...player, hand: newHand }
          },
          playArea: [...state.playArea, action],
          lastValidPlay: action,
          finishedPlayers: newFinishedPlayers,
          playerStats: newStats,
        };
      }),

      passTurn: (playerId) => set((state) => {
        // 如果只剩下一个人没出完牌，不记录 pass (因为游戏已经结束了)
        if (state.finishedPlayers.length >= 3) return {};
        
        audioManager.playPassSound();
        const passPhrases = ['pass_1', 'pass_2', 'pass_3'];
        const phrase = passPhrases[Math.floor(Math.random() * passPhrases.length)];
        audioManager.playVoice(phrase);

        return {
          playArea: [...state.playArea, { playerId, cards: [], type: PlayType.Pass }]
        };
      }),

      resetRound: () => set({ playArea: [], lastValidPlay: null }),

      startGame: (difficulty, gameMode = 'standard', isMultiplayer = false, roomId = null, myPlayerId = 'p1' as PlayerId) => set((state) => {
        const campaignProgress = gameMode === 'campaign'
          ? { chapter: 1, targetWins: 3, wins: 0, losses: 0, completed: false, failed: false }
          : null;
        return {
          status: isMultiplayer ? 'lobby' : 'grouping',
          difficulty,
          gameMode,
          isMultiplayer,
          roomId,
          myPlayerId,
          currentLevel: 2,
          levelTeam: 'teamA',
          teamLevels: { teamA: 2, teamB: 2 },
          aFailStreaks: { teamA: 0, teamB: 0 },
          scores: { teamA: 0, teamB: 0 },
          dealerId: null,
          players: cloneInitialPlayers(),
          playArea: [],
          lastValidPlay: null,
          finishedPlayers: [],
          lastRoundRank: [],
          tributeState: null,
          aiRoundMeta: null,
          settlementInfo: null,
          campaignProgress,
          playerStats: {
            ...state.playerStats,
            gamesPlayed: state.playerStats.gamesPlayed + 1
          }
        };
      }),

      startNextRound: () => set((state) => {
        // 由于 GameBoard 结算时已经将头游更新为了 state.dealerId，这里直接沿用即可
        const nextDealerId = state.dealerId || 'p1';
        const deck = createDeck(state.currentLevel);
        const shuffled = shuffleDeck(deck);
        const hands = dealCards(shuffled);

        let tributeState = null;

        // 如果存在上一局排名，则生成进贡信息
        if (state.lastRoundRank && state.lastRoundRank.length === 4) {
          const [first, second, third, last] = state.lastRoundRank;
          const firstTeam = state.players[first].team;
          const secondTeam = state.players[second].team;
          const isDoubleDown = firstTeam === secondTeam;
          
          let losersJokerCount = 0;
          let losersBigJokerCount = 0;
          if (isDoubleDown) {
            losersJokerCount += hands[third].filter(c => c.suit === 'joker').length;
            losersJokerCount += hands[last].filter(c => c.suit === 'joker').length;
            losersBigJokerCount += hands[third].filter(c => c.suit === 'joker' && c.rank === 'Big').length;
            losersBigJokerCount += hands[last].filter(c => c.suit === 'joker' && c.rank === 'Big').length;
          } else {
            losersJokerCount += hands[last].filter(c => c.suit === 'joker').length;
          }

          const isAntiTribute = isDoubleDown ? (losersJokerCount >= 4 || losersBigJokerCount >= 2) : losersJokerCount >= 2;

          tributeState = {
            isDoubleDown,
            isAntiTribute,
            actions: isDoubleDown 
              ? [
                  { from: third, to: first, card: null, returnCard: null },
                  { from: last, to: second, card: null, returnCard: null }
                ]
              : [
                  { from: last, to: first, card: null, returnCard: null }
                ],
            phase: 'tributing' as const
          };
        }

        return {
          status: 'dealing',
          currentTurn: nextDealerId,
          playArea: [],
          lastValidPlay: null,
          finishedPlayers: [],
          tributeState,
          aiRoundMeta: null,
          settlementInfo: null,
          players: {
            ...state.players,
            p1: { ...state.players.p1, hand: sortByOrder(hands.p1, state.settings.sortOrder) },
            p2: { ...state.players.p2, hand: sortByOrder(hands.p2, state.settings.sortOrder) },
            p3: { ...state.players.p3, hand: sortByOrder(hands.p3, state.settings.sortOrder) },
            p4: { ...state.players.p4, hand: sortByOrder(hands.p4, state.settings.sortOrder) },
          }
        };
      }),

      setDealerAndTeams: (dealerId, teamAIds, teamBIds) => set((state) => {
        const newPlayers = {
          p1: { ...state.players.p1 },
          p2: { ...state.players.p2 },
          p3: { ...state.players.p3 },
          p4: { ...state.players.p4 },
        };
        teamAIds.forEach(id => { newPlayers[id] = { ...newPlayers[id], team: 'teamA' }; });
        teamBIds.forEach(id => { newPlayers[id] = { ...newPlayers[id], team: 'teamB' }; });
        
        return {
          dealerId,
          levelTeam: newPlayers[dealerId].team,
          currentTurn: dealerId,
          players: newPlayers,
        };
      }),

      startDealing: () => set((state) => {
        // 在这里发牌
        const deck = createDeck(state.currentLevel);
        const shuffled = shuffleDeck(deck);
        const hands = dealCards(shuffled);
        
        return {
          status: 'dealing',
          aiRoundMeta: null,
          players: {
            ...state.players,
            p1: { ...state.players.p1, hand: sortByOrder(hands.p1, state.settings.sortOrder) },
            p2: { ...state.players.p2, hand: sortByOrder(hands.p2, state.settings.sortOrder) },
            p3: { ...state.players.p3, hand: sortByOrder(hands.p3, state.settings.sortOrder) },
            p4: { ...state.players.p4, hand: sortByOrder(hands.p4, state.settings.sortOrder) },
          }
        };
      }),

      finishDealing: () => set((state) => {
        if (state.tributeState) {
          return { status: 'tribute' };
        }
        return { status: 'playing' };
      }),

      executeTribute: (fromId, cardId) => set((state) => {
        if (!state.tributeState || state.tributeState.phase !== 'tributing') return state;
        const players = {
          p1: { ...state.players.p1, hand: [...state.players.p1.hand] },
          p2: { ...state.players.p2, hand: [...state.players.p2.hand] },
          p3: { ...state.players.p3, hand: [...state.players.p3.hand] },
          p4: { ...state.players.p4, hand: [...state.players.p4.hand] },
        };
        
        const newActions = state.tributeState.actions.map(action => {
          if (action.from === fromId) {
            const card = players[fromId].hand.find(c => c.id === cardId);
            return { ...action, card: card || null };
          }
          return action;
        });

        // 检查是否所有进贡都已完成
        const allTributed = newActions.every(a => a.card !== null);

        let nextPhase: 'tributing' | 'returning' | 'done' = 'tributing';

        if (allTributed) {
          nextPhase = 'returning';
          // 将进贡的牌交给赢家
          newActions.forEach(action => {
            const tributeCard = action.card;
            if (tributeCard) {
              // 从输家手牌移除
              const newFromHand = players[action.from].hand.filter(c => c.id !== tributeCard.id);
              players[action.from] = { ...players[action.from], hand: newFromHand };
              
              // 暂时不放入赢家手牌，等还贡时一起处理，或者直接放入？
              // 掼蛋中，进贡的牌会给赢家，赢家挑一张不要的还给输家
              const newToHand = sortByOrder([...players[action.to].hand, tributeCard], state.settings.sortOrder);
              players[action.to] = { ...players[action.to], hand: newToHand };
            }
          });
        }

        return {
          players,
          tributeState: {
            ...state.tributeState,
            actions: newActions,
            phase: nextPhase
          }
        };
      }),

      executeReturnTribute: (fromId, cardId) => set((state) => {
        if (!state.tributeState || state.tributeState.phase !== 'returning') return {};
        const players = {
          p1: { ...state.players.p1, hand: [...state.players.p1.hand] },
          p2: { ...state.players.p2, hand: [...state.players.p2.hand] },
          p3: { ...state.players.p3, hand: [...state.players.p3.hand] },
          p4: { ...state.players.p4, hand: [...state.players.p4.hand] },
        };
        
        const newActions = state.tributeState.actions.map(action => {
          if (action.to === fromId) { // action.to 是赢家（还贡的人）
            const card = players[fromId].hand.find(c => c.id === cardId);
            return { ...action, returnCard: card || null };
          }
          return action;
        });

        const allReturned = newActions.every(a => a.returnCard !== null);

        let nextPhase: 'tributing' | 'returning' | 'done' = 'returning';

        if (allReturned) {
          nextPhase = 'done';
          // 将还贡的牌交给输家
          newActions.forEach(action => {
            const returnCard = action.returnCard;
            if (returnCard) {
              players[action.to] = {
                ...players[action.to],
                hand: players[action.to].hand.filter(c => c.id !== returnCard.id),
              };
              players[action.from] = {
                ...players[action.from],
                hand: sortByOrder([...players[action.from].hand, returnCard], state.settings.sortOrder),
              };
            }
          });
        }

        return {
          players,
          tributeState: {
            ...state.tributeState,
            actions: newActions,
            phase: nextPhase
          }
        };
      }),

      finishTribute: () => set((state) => {
        // 如果有还贡完成，决定这局由谁首发
        // 规则：还贡后由“末游所在的一方”先出牌（这里取末游本人先手）。
        // 规则：抗贡时由赢家（上游方）先手。
        let nextTurn = state.dealerId || 'p1';
        if (state.tributeState && !state.tributeState.isAntiTribute && state.tributeState.actions.length > 0) {
          nextTurn = state.lastRoundRank[3] || nextTurn;
        }
        return {
          status: 'playing',
          currentTurn: nextTurn,
          tributeState: null,
          aiRoundMeta: {
            fromTribute: true,
            isAntiTribute: !!state.tributeState?.isAntiTribute,
          },
        };
      }),

      sendChatMessage: (playerId: PlayerId, message: string) => {
    let msgId = 0;
    set((state: GameState) => {
      const id = Date.now();
      msgId = id;
      return {
        activeChats: {
          ...state.activeChats,
          [playerId]: { message, id }
        }
      };
    });
    return msgId;
  },

  clearChatMessage: (playerId: PlayerId, messageId: number) => set((state: GameState) => {
    const currentChat = state.activeChats[playerId];
    if (currentChat && currentChat.id === messageId) {
      return {
        activeChats: {
          ...state.activeChats,
          [playerId]: null
        }
      };
    }
    return state;
  }),
  }), {
    name: 'guandan-game-store',
    storage: createJSONStorage(() => localStorage),
    partialize: (state) => ({
      settings: state.settings,
      playerStats: state.playerStats,
      recentMatch: state.recentMatch,
      campaignProgress: state.campaignProgress,
    }),
  }))
);
