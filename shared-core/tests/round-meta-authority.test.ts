import { describe, expect, it } from 'vitest'
import * as core from '../src'
import type { MatchState, Player, PlayerId, Team } from '../src'

const teamFor = (id: PlayerId): Team => id === 'p1' || id === 'p3' ? 'teamA' : 'teamB'
const player = (id: PlayerId): Player => ({
  id, name: id, isAI: id !== 'p1', team: teamFor(id), hand: [], role: 'normal',
})

describe('round metadata and tribute authority', () => {
  it('stores tribute provenance in MatchState when the next round is prepared', () => {
    const base = core.createMatchState({
      ruleProfile: core.getRuleProfile('classic'),
      currentLevel: 2,
      levelTeam: 'teamA',
      teamLevels: { teamA: 2, teamB: 2 },
      dealerId: 'p1',
      players: { p1: player('p1'), p2: player('p2'), p3: player('p3'), p4: player('p4') },
    })
    expect(base.roundMeta).toBeNull()
    const settled: MatchState = {
      ...base,
      phase: 'settled',
      lastRoundRank: ['p1', 'p3', 'p2', 'p4'],
      settlement: {
        winnerTeam: 'teamA', levelUp: 3, currentLevel: 5,
        teamLevels: { teamA: 5, teamB: 2 }, aFailStreaks: { teamA: 0, teamB: 0 },
        fullRank: ['p1', 'p3', 'p2', 'p4'], isGameWon: false, message: 'next',
      },
    }
    const dealtHands = core.dealCards(core.createDeck(5))
    const result = core.transition(settled, {
      type: 'PREPARE_NEXT_ROUND', dealtHands,
      roundId: settled.roundId, expectedRevision: settled.revision,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.roundMeta).toEqual({
      fromTribute: true,
      isAntiTribute: result.state.tribute?.status === 'resisted',
    })
  })

  it('does not export the retired mutable EngineState tribute workflow', () => {
    expect('createTribute' in core).toBe(false)
    expect('giveTribute' in core).toBe(false)
    expect('returnTribute' in core).toBe(false)
    expect('tributeLeader' in core).toBe(false)
    expect(typeof core.automaticReturnCard).toBe('function')
  })
})
