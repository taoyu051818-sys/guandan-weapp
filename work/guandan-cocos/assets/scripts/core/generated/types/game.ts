export type Suit = 'spade' | 'heart' | 'club' | 'diamond' | 'joker';
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 'J' | 'Q' | 'K' | 'A' | 'Small' | 'Big';

export interface Card {
  id: string; // 唯一标识符
  suit: Suit;
  rank: Rank;
  value: number; // 比较大小的点数
  isLevelCard: boolean; // 是否为级牌
  isRedJoker?: boolean; // 红心级牌在掼蛋中常作为百搭牌（逢人配）
}

export type PlayerId = 'p1' | 'p2' | 'p3' | 'p4'; // p1是玩家，p2下家，p3对家，p4上家
export type Team = 'teamA' | 'teamB'; // p1和p3为teamA，p2和p4为teamB

export interface Player {
  id: PlayerId;
  name: string;
  isAI: boolean;
  team: Team;
  hand: Card[];
  role: 'first' | 'second' | 'third' | 'last' | 'normal';
}

export enum PlayType {
  Single = 'Single', // 单牌
  Pair = 'Pair', // 对子
  Triple = 'Triple', // 三不带
  Straight = 'Straight', // 顺子
  TripleWithPair = 'TripleWithPair', // 三带一对
  Tube = 'Tube', // 三连对
  Plate = 'Plate', // 钢板
  StraightFlush = 'StraightFlush', // 同花顺
  Bomb = 'Bomb', // 炸弹
  Rocket = 'Rocket', // 火箭 (大小王组合)
  Pass = 'Pass', // 不出
}

export interface PlayAction {
  playerId: PlayerId;
  cards: Card[];
  type: PlayType;
}

export interface SettlementInfo {
  winnerTeam: Team;
  levelUp: number;
  message: string;
  isGameWon: boolean;
}

export interface RecentMatchSnapshot {
  finishedAt: number;
  winnerTeam: Team;
  levelUp: number;
  currentLevel: Rank;
  teamLevels: Record<Team, Rank>;
  scores: Record<Team, number>;
}

export interface TributeAction {
  from: PlayerId;
  to: PlayerId;
  card: Card | null; // 进贡的牌
  returnCard: Card | null; // 还贡的牌
}

export interface TributeState {
  isDoubleDown: boolean;
  isAntiTribute: boolean;
  actions: TributeAction[];
  phase: 'tributing' | 'returning' | 'done';
}

export interface PlayerStats {
  gamesPlayed: number;
  wins: number;
  bombsPlayed: number;
  firstPlaceFinishes: number;
  elo: number; // 积分段位
}

export interface GameSettings {
  soundEnabled: boolean;
  volume: number;
  bgmEnabled: boolean; // 背景音乐开关
  bgmVolume: number;   // 背景音乐音量
  sortOrder: 'asc' | 'desc'; // asc: 小到大, desc: 大到小
  rulePreset: 'classic' | 'tournament'; // 规则预设
  visualTheme: 'luxury' | 'compact'; // 视觉主题
}

export interface CampaignProgress {
  chapter: number;
  targetWins: number;
  wins: number;
  losses: number;
  completed: boolean;
  failed: boolean;
}

export interface AIRoundMeta {
  fromTribute: boolean;
  isAntiTribute: boolean;
}

export interface GameState {
  status: 'menu' | 'grouping' | 'dealing' | 'playing' | 'tribute' | 'gameover' | 'settlement' | 'lobby';
  gameMode: 'standard' | 'double_open' | 'campaign'; // 新增游戏模式
  isMultiplayer: boolean;
  roomId: string | null;
  myPlayerId: PlayerId; // 联机时，当前客户端对应哪个玩家 (p1, p2, p3, p4)
  currentLevel: Rank;
  levelTeam: Team;
  teamLevels: Record<Team, Rank>; // 记录双方队伍各自打到了几
  aFailStreaks: Record<Team, number>; // 连续冲A失败次数（仅在A关卡失败时递增）
  dealerId: PlayerId | null; // 本局庄家
  players: Record<PlayerId, Player>;
  turnOrder: PlayerId[];
  currentTurn: PlayerId;
  playArea: PlayAction[]; // 记录当前轮次出的牌
  lastValidPlay: PlayAction | null; // 上一个有效的出牌（决定了当前需要跟的牌型和大小）
  scores: Record<Team, number>;
  difficulty: 'easy' | 'medium' | 'hard' | 'master';
  showTutorial: boolean;
  showSettings: boolean;
  finishedPlayers: PlayerId[]; // 记录本局已经出完牌的玩家顺序
  lastRoundRank: PlayerId[]; // 记录上一局的排名，用于进贡逻辑
  tributeState: TributeState | null; // 进贡状态
  aiRoundMeta: AIRoundMeta | null; // AI 用于识别是否由贡还贡衔接到本轮
  settlementInfo: SettlementInfo | null;
  recentMatch: RecentMatchSnapshot | null;
  campaignProgress: CampaignProgress | null;
  playerStats: PlayerStats; // 玩家数据看板
  settings: GameSettings; // 游戏设置
  activeChats: Record<PlayerId, { message: string, id: number } | null>; // 聊天气泡状态
  sendChatMessage: (playerId: PlayerId, message: string) => number;
}
