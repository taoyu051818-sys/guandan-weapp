import { StrategyProfile } from './ai-core-types';

export const MASTER_STRATEGY: StrategyProfile = {
  bombPenalty: 150,
  wildcardPenalty: 62,
  highCardPenalty: 8,
  openBigCardPenalty: 8,
  responseSmallCardBias: 2.35,
  comboLeadBonus: 6.5,
  leadLengthBonus: 2.8,
  earlySmallDumpWeight: 0.05,
  conservatism: 0.45,
  takeoverFromTeammateProb: 0.38,
  humanizeJitter: 0.01,
};
