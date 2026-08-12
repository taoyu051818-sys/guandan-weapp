import { describe, expect, it } from 'vitest'
import {
  createMatchState,
  getRuleProfile,
  settleMatchState,
  transition,
  type Card,
  type Player,
  type PlayerId,
  type Team,
} from '../src'

const teamFor = (id: PlayerId): Team => id === 'p1' || id === 'p3' ? 'teamA' : 'teamB'
const card = (id: string, value: number): Card => ({
  id,
  suit: 'spade',
  rank: value as Card['rank'],
  value,
  isLevelCard: false,
})
const player = (id: PlayerId, hand: Card[]): Player => ({
  id,
  name: id,
  isAI: id !== 'p1',
  team: teamFor(id),
  hand,
  role: 'normal',
})

describe('turn result ownership', () => {
  it('isolates event and state action payloads from each other', () => {
    const state = createMatchState({
      ruleProfile: getRuleProfile('classic'),
      currentLevel: 2,
      levelTeam: 'teamA',
      teamLevels: { teamA: 2, teamB: 2 },
      dealerId: 'p1',
      currentTurn: 'p1',
      players: {
        p1: player('p1', [card('p1-3', 3), card('p1-8', 8)]),
        p2: player('p2', [card('p2-4', 4)]),
        p3: player('p3', [card('p3-5', 5)]),
        p4: player('p4', [card('p4-6', 6)]),
      },
    })
    const result = transition(state, {
      type: 'PLAY_CARDS',
      playerId: 'p1',
      cardIds: ['p1-3'],
      roundId: state.roundId,
      expectedRevision: state.revision,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const event = result.events.find(item => item.type === 'CARDS_PLAYED')
    if (!event || event.type !== 'CARDS_PLAYED') throw new Error('missing CARDS_PLAYED event')
    event.action.cards[0].value = 99
    event.action.cards.push(card('forged', 10))
    if (event.action.resolution) event.action.resolution.maxValue = 99

    expect(result.state.trick.winningPlay?.cards).toEqual([expect.objectContaining({ id: 'p1-3', value: 3 })])
    expect(result.state.trick.winningPlay?.resolution?.maxValue).toBe(3)
    expect(result.state.playArea[0].cards).toHaveLength(1)
    expect(result.state.playHistory[0].cards).toHaveLength(1)
    expect(result.state.lastValidPlay?.cards).toHaveLength(1)

    result.state.playArea[0].cards[0].value = 77
    expect(result.state.playHistory[0].cards[0].value).toBe(3)
    expect(result.state.trick.winningPlay?.cards[0].value).toBe(3)
    expect(result.state.lastValidPlay?.cards[0].value).toBe(3)
  })

  it('isolates settlement operation, committed state, and domain event payloads', () => {
    const base = createMatchState({
      ruleProfile: getRuleProfile('classic'),
      currentLevel: 2,
      levelTeam: 'teamA',
      teamLevels: { teamA: 2, teamB: 2 },
      dealerId: 'p3',
      currentTurn: 'p3',
      players: {
        p1: player('p1', []),
        p2: player('p2', [card('p2-4', 4)]),
        p3: player('p3', [card('p3-5', 5)]),
        p4: player('p4', [card('p4-6', 6)]),
      },
    })
    const readyToSettle = { ...base, finishedPlayers: ['p1' as PlayerId] }
    const operation = settleMatchState({ ...readyToSettle, finishedPlayers: ['p1', 'p3'] })
    if (!operation) throw new Error('missing settlement operation')
    operation.settlement.teamLevels.teamA = 'A'
    operation.settlement.aFailStreaks.teamA = 9
    operation.settlement.fullRank.reverse()
    expect(operation.state.settlement?.teamLevels.teamA).toBe(5)
    expect(operation.state.settlement?.aFailStreaks.teamA).toBe(0)
    expect(operation.state.settlement?.fullRank).toEqual(['p1', 'p3', 'p2', 'p4'])

    const result = transition(readyToSettle, {
      type: 'PLAY_CARDS',
      playerId: 'p3',
      cardIds: ['p3-5'],
      roundId: readyToSettle.roundId,
      expectedRevision: readyToSettle.revision,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const event = result.events.find(item => item.type === 'ROUND_SETTLED')
    if (!event || event.type !== 'ROUND_SETTLED') throw new Error('missing ROUND_SETTLED event')
    event.settlement.teamLevels.teamA = 'A'
    event.settlement.aFailStreaks.teamA = 9
    event.settlement.fullRank.reverse()
    expect(result.state.settlement?.teamLevels.teamA).toBe(5)
    expect(result.state.settlement?.aFailStreaks.teamA).toBe(0)
    expect(result.state.settlement?.fullRank).toEqual(['p1', 'p3', 'p2', 'p4'])
  })
})
