import { StrategyProfile } from './ai-core-types';

export const EASY_STRATEGY: StrategyProfile = {
  bombPenalty: 20,
  wildcardPenalty: 14,
  highCardPenalty: 2,
  openBigCardPenalty: 2,
  responseSmallCardBias: 1.05,
  comboLeadBonus: 0.8,
  leadLengthBonus: 0.2,
  earlySmallDumpWeight: 0.02,
  conservatism: 0.55,
  takeoverFromTeammateProb: 0.45,
  humanizeJitter: 0.85,
};
