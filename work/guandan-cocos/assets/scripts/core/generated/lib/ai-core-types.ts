export type Difficulty = 'easy' | 'medium' | 'hard' | 'master';

export type HardRuntimeTuning = {
  interceptThreshold: number; // “六必治”阈值
  pairProbeMin: number; // 对子探路下限
  pairProbeMax: number; // 对子探路上限
  straightFlushBombBreakPenalty: number; // 同花顺拆炸弹惩罚
};

export type MasterRuntimeTuning = {
  strikerEnemyPushThreshold: number; // 中盘进攻阈值（enemy<=N）
  strikerComboPushBonus: number; // 主攻长牌推进加权
  strikerSearchBudgetMs: number; // 主攻残局预算
  supportSearchBudgetMs: number; // 辅助残局预算
  strikerBeam: number; // 主攻搜索宽度
  supportBeam: number; // 辅助搜索宽度
  strikerDepthLimit: number; // 主攻搜索深度
  supportDepthLimit: number; // 辅助搜索深度
  finishBySmall: boolean; // 是否允许刻意小单/小对收尾
  preferOnlySinglesPairsWithSmallLate: boolean; // 是否偏好“只剩单对且含小牌”的尾牌形态
  earlySmallDumpWeight: number; // 前期小单/小对主动清理权重
  routeStabilityWeight: number; // 全局分组路线稳定性权重
  endgameComplexLockThreshold: number; // 终局强制复合收尾阈值
  endgameForceComplexFinish: boolean; // 终局是否强制复合收尾
  endgameRouteWinGuard: boolean; // 是否仅在可赢路线存在时启用强制复合锁定
  endgameStrictLockThreshold: number; // 严格锁定阈值（手牌<=N）
  endgameSinglePairPenalty: number; // 终局单对路径惩罚
};

export type StrategyProfile = {
  bombPenalty: number;
  wildcardPenalty: number;
  highCardPenalty: number;
  openBigCardPenalty: number;
  responseSmallCardBias: number;
  comboLeadBonus: number;
  leadLengthBonus: number;
  earlySmallDumpWeight: number;
  conservatism: number;
  takeoverFromTeammateProb: number;
  humanizeJitter: number;
};
