// Offline experiment catalogue. These alternatives are NOT shipped to Cocos or
// exposed as engine difficulty/configuration options.
export const reference = Object.freeze({
  route: 1, singles: 1, resource: 1, control: 1, enemyFinish: 1,
  allyFinish: 1, allyFeed: 1, rankConservation: 1, temperature: 1,
})
export const experiments = Object.freeze(Object.fromEntries(Object.entries({
  reference: {},
  exit: { route: 1.3, singles: 1.25, resource: 0.8, control: 0.85, rankConservation: 0.8 },
  control: { route: 0.9, resource: 1.15, control: 1.6, enemyFinish: 1.25 },
  support: { route: 0.9, allyFeed: 1.5, allyFinish: 1.3, enemyFinish: 1.2 },
  pressure: { route: 1.1, control: 1.3, enemyFinish: 1.5, resource: 0.9 },
  reserve: { resource: 1.6, rankConservation: 1.2 },
  precise: { temperature: 0.25 },
  balanced: { route: 1.15, control: 1.3, resource: 1.2, allyFeed: 1.25, enemyFinish: 1.25, temperature: 0.5 },
}).map(([name, changes]) => [name, Object.freeze({ ...reference, ...changes })])))

// Declared before looking at holdout results. No tuning on validation seeds.
export const acceptance = Object.freeze({
  objective: 'team-first-place',
  trainSeed: 2700000, trainPairs: 32,
  finalistSeed: 3100000, finalistPairs: 64,
  holdoutSeed: 3700000, holdoutPairs: 256,
  minimumPairedConfidenceLower: 0.5,
  maximumP95Ratio: 1.5,
  maximumIllegalActions: 0, maximumOpeningBombs: 0,
})
