import type { Difficulty, StrategyProfile } from '../types';

export const EASY_STRATEGY: Readonly<StrategyProfile> = Object.freeze({
  bombPenalty: 20,
  wildcardPenalty: 14,
  highCardPenalty: 2,
  openBigCardPenalty: 2,
  responseSmallCardBias: 1.05,
  comboLeadBonus: 0.8,
  leadLengthBonus: 0.2,
  earlySmallDumpWeight: 0.02,
  conservatism: 0.55,
  humanizeJitter: 0.85,
});

export const MEDIUM_STRATEGY: Readonly<StrategyProfile> = Object.freeze({
  bombPenalty: 80,
  wildcardPenalty: 34,
  highCardPenalty: 4,
  openBigCardPenalty: 4,
  responseSmallCardBias: 0.9,
  comboLeadBonus: 1.2,
  leadLengthBonus: 0.3,
  earlySmallDumpWeight: 0.02,
  conservatism: 1.55,
  humanizeJitter: 0.75,
});

export const HARD_STRATEGY: Readonly<StrategyProfile> = Object.freeze({
  bombPenalty: 120,
  wildcardPenalty: 50,
  highCardPenalty: 6,
  openBigCardPenalty: 6,
  responseSmallCardBias: 2.05,
  comboLeadBonus: 4.8,
  leadLengthBonus: 1.8,
  earlySmallDumpWeight: 0.03,
  conservatism: 0.75,
  humanizeJitter: 0.08,
});

export const MASTER_STRATEGY: Readonly<StrategyProfile> = Object.freeze({
  bombPenalty: 150,
  wildcardPenalty: 62,
  highCardPenalty: 8,
  openBigCardPenalty: 8,
  responseSmallCardBias: 2.35,
  comboLeadBonus: 6.5,
  leadLengthBonus: 2.8,
  earlySmallDumpWeight: 0.05,
  conservatism: 0.45,
  humanizeJitter: 0.01,
});

export const STRATEGY_BY_DIFFICULTY: Readonly<Record<Difficulty, Readonly<StrategyProfile>>> =
  Object.freeze({
    easy: EASY_STRATEGY,
    medium: MEDIUM_STRATEGY,
    hard: HARD_STRATEGY,
    master: MASTER_STRATEGY,
  });
