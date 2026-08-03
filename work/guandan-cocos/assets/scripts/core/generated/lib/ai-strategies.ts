import { Difficulty, StrategyProfile } from './ai-core-types';
import { EASY_STRATEGY } from './ai-strategy-easy';
import { MEDIUM_STRATEGY } from './ai-strategy-medium';
import { HARD_STRATEGY } from './ai-strategy-hard';
import { MASTER_STRATEGY } from './ai-strategy-master';

export const STRATEGY_BY_DIFFICULTY: Record<Difficulty, StrategyProfile> = {
  easy: EASY_STRATEGY,
  medium: MEDIUM_STRATEGY,
  hard: HARD_STRATEGY,
  master: MASTER_STRATEGY,
};
