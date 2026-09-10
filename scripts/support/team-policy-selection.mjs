import { acceptance } from './team-policy-experiments.mjs'

export const validResult = result => result.invalidActions === 0 && result.openingBombs[0] === 0
  && result.timing.p95Ms <= result.opponentTiming.p95Ms * acceptance.maximumP95Ratio
const distance = parameters => Object.values(parameters).reduce((sum, value) => sum + Math.abs(value - 1), 0)
export const rankResults = results => [...results].filter(validResult).sort((a, b) =>
  b.winRate - a.winRate || a.timing.p95Ms - b.timing.p95Ms || distance(a.parameters) - distance(b.parameters))

export const holdoutVerdict = result => ({
  candidate: result.name,
  accepted: validResult(result) && result.paired95.lower > acceptance.minimumPairedConfidenceLower,
  legalityPassed: result.invalidActions === acceptance.maximumIllegalActions,
  openingPassed: result.openingBombs[0] === acceptance.maximumOpeningBombs,
  timingPassed: result.timing.p95Ms <= result.opponentTiming.p95Ms * acceptance.maximumP95Ratio,
  evidencePassed: result.paired95.lower > acceptance.minimumPairedConfidenceLower,
  policy: 'freeze-if-independent-holdout-passes-otherwise-retain-reference',
})
