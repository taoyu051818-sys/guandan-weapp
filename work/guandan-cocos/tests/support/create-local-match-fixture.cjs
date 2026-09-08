// Test-only adapter: constructor injection is intentionally not exported by the
// production controller. Tests supply its real JS constructor and rule factory.
exports.createLocalMatchFixtureFactory = (Controller, createMatchState) =>
  (state, teamLevels, random = Math.random) => {
    const base = createMatchState({
      matchFormat: state.matchFormat,
      ruleProfile: state.ruleProfile,
      currentLevel: state.currentLevel,
      levelTeam: 'teamA',
      teamLevels,
      dealerId: state.currentTurn,
      players: state.players,
      turnOrder: state.turnOrder,
      currentTurn: state.currentTurn,
    })
    return new Controller({
      ...base,
      playArea: [...state.playArea],
      playHistory: [...state.playArea],
      lastValidPlay: state.lastValidPlay,
      trick: { winningPlay: state.lastValidPlay, passedPlayerIds: [] },
      finishedPlayers: [...state.finishedPlayers],
    }, random)
  }
