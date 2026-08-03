import { StrategyProfile } from './ai-core-types';

export const MEDIUM_STRATEGY: StrategyProfile = {
  bombPenalty: 80,
  wildcardPenalty: 34,
  highCardPenalty: 4,
  openBigCardPenalty: 4,
  responseSmallCardBias: 0.9,
  comboLeadBonus: 1.2,
  leadLengthBonus: 0.3,
  earlySmallDumpWeight: 0.02,
  conservatism: 1.55,
  takeoverFromTeammateProb: 0.4,
  humanizeJitter: 0.75,
};
