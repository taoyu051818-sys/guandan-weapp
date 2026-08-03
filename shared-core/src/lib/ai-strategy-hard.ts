import { StrategyProfile } from './ai-core-types';

export const HARD_STRATEGY: StrategyProfile = {
  bombPenalty: 120,
  wildcardPenalty: 50,
  highCardPenalty: 6,
  openBigCardPenalty: 6,
  responseSmallCardBias: 2.05,
  comboLeadBonus: 4.8,
  leadLengthBonus: 1.8,
  earlySmallDumpWeight: 0.03,
  conservatism: 0.75,
  takeoverFromTeammateProb: 0.25,
  humanizeJitter: 0.08,
};
