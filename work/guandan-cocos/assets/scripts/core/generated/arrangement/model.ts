import type { Card, PlayResolution } from '../types/game';

/** Units are relative to one prospective play (100), not win probabilities. */
export interface ArrangementWeights {
  single: number;
  splitPair: number;
  splitTriple: number;
  splitBomb: number;
  wildOrdinary: number;
  wildControl: number;
  control: number;
}

/** One production policy. Alternative weights belong only in offline tuning. */
export const DEFAULT_ARRANGEMENT_WEIGHTS: Readonly<ArrangementWeights> = Object.freeze({
  single: 18, splitPair: 36, splitTriple: 50, splitBomb: 260,
  wildOrdinary: 100, wildControl: 12, control: 160,
});

export interface ArrangementGroup { cards: Card[]; resolution: PlayResolution }
export interface ArrangementMetrics {
  turns: number;
  singles: number;
  splitPairs: number;
  splitBombs: number;
  ordinaryWildcards: number;
  controlWildcards: number;
  controls: number;
}
export interface ArrangementPlan {
  groups: ArrangementGroup[];
  metrics: ArrangementMetrics;
  score: number;
  nodes: number;
  /** False means a bounded search estimate, never a proof of optimality. */
  exact: boolean;
}
