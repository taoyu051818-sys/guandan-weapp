import { describe, expect, it } from 'vitest'
import {
  createDeck,
  createGame,
  createMatchState,
  dealCards,
  getRuleProfile,
  highestCard,
  settle,
  settleMatchState,
  transition,
  type Card,
  type MatchState,
  type PlayerId,
  type SettlementResult,
  type Team,
} from '../src'

const commandMeta = (state: MatchState) => ({
  roundId: state.roundId,
  expectedRevision: state.revision,
})

const settledMatch = (rank: PlayerId[]): MatchState => {
  const base = createGame(2)
  const settlement: SettlementResult = {
    winnerTeam: base.players[rank[0]].team,
    levelUp: base.players[rank[0]].team === base.players[rank[1]].team ? 3 : 1,
    currentLevel: 3,
    teamLevels: { teamA: 3, teamB: 2 },
    aFailStreaks: { teamA: 0, teamB: 0 },
    fullRank: rank,
    isGameWon: false,
    message: 'fixture',
  }
  return {
    ...createMatchState({
      ruleProfile: getRuleProfile('classic'),
      currentLevel: 2,
      levelTeam: 'teamA',
      teamLevels: { teamA: 2, teamB: 2 },
      dealerId: rank[0],
      players: base.players,
    }),
    phase: 'settled',
    finishedPlayers: rank.slice(0, 3),
    lastRoundRank: rank,
    settlement,
  }
}

const canonicalHands = (level: Card['rank'] = 3): Record<PlayerId, Card[]> =>
  dealCards(createDeck(level))

const moveCardsTo = (
  hands: Record<PlayerId, Card[]>,
  target: PlayerId,
  predicate: (card: Card) => boolean,
  count: number,
): Record<PlayerId, Card[]> => {
  const copy = Object.fromEntries(Object.entries(hands).map(([id, hand]) => [id, [...hand]])) as Record<PlayerId, Card[]>
  const selected: Card[] = []
  const needed = Math.max(0, count - copy[target].filter(predicate).length)
  for (const source of ['p1', 'p2', 'p3', 'p4'] as const) {
    if (source === target) continue
    for (let index = copy[source].length - 1; index >= 0 && selected.length < needed; index -= 1) {
      if (predicate(copy[source][index])) selected.push(copy[source].splice(index, 1)[0])
    }
  }
  while (copy[target].filter(predicate).length < count && selected.length) {
    const incoming = selected.shift()!
    const outgoingIndex = copy[target].findIndex(card => !predicate(card))
    const outgoing = copy[target].splice(outgoingIndex, 1, incoming)[0]
    const source = (['p1', 'p2', 'p3', 'p4'] as const).find(id => id !== target && copy[id].length < 27)
    if (!source) throw new Error('missing source hand')
    copy[source].push(outgoing)
  }
  return copy
}

describe('settlement progression', () => {
  const ranked = (finishedPlayers: PlayerId[]) => {
    const state = createGame('K')
    state.finishedPlayers = finishedPlayers
    return state
  }

  it('moves K to A only when the winner earns at least two levels', () => {
    const oneLevel = settle(ranked(['p1', 'p2', 'p4']), { teamA: 'K', teamB: 2 }, { teamA: 0, teamB: 0 })
    const twoLevels = settle(ranked(['p1', 'p2', 'p3']), { teamA: 'K', teamB: 2 }, { teamA: 0, teamB: 0 })
    expect(oneLevel?.teamLevels.teamA).toBe('K')
    expect(twoLevels?.teamLevels.teamA).toBe('A')
  })

  it('tracks three consecutive A failures and resets to level 2', () => {
    const state = createGame('A')
    state.finishedPlayers = ['p1', 'p2', 'p4']
    const first = settle(state, { teamA: 'A', teamB: 2 }, { teamA: 0, teamB: 0 })!
    const second = settle(state, { teamA: 'A', teamB: 2 }, first.aFailStreaks)!
    const third = settle(state, { teamA: 'A', teamB: 2 }, second.aFailStreaks)!
    expect([first.teamLevels.teamA, second.teamLevels.teamA, third.teamLevels.teamA]).toEqual(['K', 'Q', 2])
    expect([first.aFailStreaks.teamA, second.aFailStreaks.teamA, third.aFailStreaks.teamA]).toEqual([1, 2, 0])
  })

  it('keeps the negative A-failure level delta without subtracting cumulative scores', () => {
    const engine = createGame('A')
    const state = createMatchState({
      ruleProfile: getRuleProfile('classic'),
      currentLevel: 'A',
      levelTeam: 'teamA',
      teamLevels: { teamA: 'A', teamB: 2 },
      aFailStreaks: { teamA: 0, teamB: 0 },
      scores: { teamA: 4, teamB: 7 },
      dealerId: 'p1',
      players: engine.players,
    })
    state.finishedPlayers = ['p1', 'p2', 'p4']

    const settled = settleMatchState(state)

    expect(settled?.settlement.winnerTeam).toBe('teamB')
    expect(settled?.settlement.levelUp).toBe(-1)
    expect(settled?.state.scores).toEqual({ teamA: 4, teamB: 7 })
    expect(state.scores).toEqual({ teamA: 4, teamB: 7 })

    const upgraded = settleMatchState({
      ...state,
      currentLevel: 2,
      teamLevels: { teamA: 2, teamB: 2 },
      finishedPlayers: ['p1', 'p3'],
    })
    expect(upgraded?.settlement.levelUp).toBe(3)
    expect(upgraded?.state.scores).toEqual({ teamA: 7, teamB: 7 })
  })
})

describe('tribute commands', () => {
  it('prepares single and double tribute through the versioned transition contract', () => {
    for (const [rank, isDoubleDown] of [
      [['p1', 'p2', 'p3', 'p4'], false],
      [['p1', 'p3', 'p2', 'p4'], true],
    ] as const) {
      const state = settledMatch([...rank])
      const result = transition(state, {
        type: 'PREPARE_NEXT_ROUND',
        dealtHands: canonicalHands(state.settlement!.currentLevel),
        ...commandMeta(state),
      })
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      expect(result.state.roundId).toBe(state.roundId + 1)
      expect(result.state.phase).toBe('tribute')
      expect(result.state.tribute?.mode).toBe(isDoubleDown ? 'double' : 'single')
      expect(result.state.revision).toBe(state.revision + 1)
    }
  })

  it('detects anti-tribute and starts only from the computed leader', () => {
    const state = settledMatch(['p1', 'p2', 'p3', 'p4'])
    const hands = moveCardsTo(canonicalHands(state.settlement!.currentLevel), 'p4', card => card.suit === 'joker', 2)
    const prepared = transition(state, {
      type: 'PREPARE_NEXT_ROUND', dealtHands: hands, ...commandMeta(state),
    })
    if (!prepared.ok) throw new Error(prepared.reason)
    expect(prepared.state.tribute?.status).toBe('resisted')
    expect(prepared.events).toEqual([
      { type: 'ROUND_PREPARED', roundId: prepared.state.roundId, mode: 'single', status: 'resisted' },
      { type: 'ANTI_TRIBUTE_DECLARED', mode: 'single' },
    ])
    const wrong = transition(prepared.state, {
      type: 'BEGIN_PLAY_AFTER_TRIBUTE', playerId: 'p2', ...commandMeta(prepared.state),
    })
    expect(wrong).toEqual({ ok: false, reason: 'NOT_TRIBUTE_LEADER' })
    const started = transition(prepared.state, {
      type: 'BEGIN_PLAY_AFTER_TRIBUTE', playerId: prepared.state.dealerId, ...commandMeta(prepared.state),
    })
    expect(started.ok).toBe(true)
    if (started.ok) expect(started.state.phase).toBe('playing')
  })

  it('selects a required tribute card without accepting another player or a stale revision', () => {
    const state = settledMatch(['p1', 'p2', 'p3', 'p4'])
    const prepared = transition(state, {
      type: 'PREPARE_NEXT_ROUND', dealtHands: canonicalHands(state.settlement!.currentLevel), ...commandMeta(state),
    })
    if (!prepared.ok) throw new Error(prepared.reason)
    const action = prepared.state.tribute!.exchanges[0]
    const hand = prepared.state.players[action.from].hand
    const eligible = hand.filter(item => !(item.isLevelCard && item.suit === 'heart'))
    const cardId = highestCard(eligible.length ? eligible : hand).id
    const before = structuredClone(prepared.state)
    const stale = transition(prepared.state, {
      type: 'SELECT_TRIBUTE_CARD', playerId: action.from, cardId,
      roundId: prepared.state.roundId, expectedRevision: prepared.state.revision - 1,
    })
    expect(stale).toEqual({ ok: false, reason: 'STALE_REVISION' })
    expect(prepared.state).toEqual(before)
    const selected = transition(prepared.state, {
      type: 'SELECT_TRIBUTE_CARD', playerId: action.from, cardId, ...commandMeta(prepared.state),
    })
    expect(selected.ok).toBe(true)
    if (selected.ok) expect(selected.state.tribute?.status).toBe('selecting_return')
  })

  it('rejects a tampered next-round deck without changing the settled state', () => {
    const state = settledMatch(['p1', 'p2', 'p3', 'p4'])
    const hands = canonicalHands(state.settlement!.currentLevel)
    hands.p1 = hands.p1.map((card, index) => index === 0 ? { ...card, value: card.value + 1 } : card)
    const before = structuredClone(state)
    const result = transition(state, {
      type: 'PREPARE_NEXT_ROUND', dealtHands: hands, ...commandMeta(state),
    })
    expect(result).toEqual({ ok: false, reason: 'INVALID_DEALT_CARD' })
    expect(state).toEqual(before)
  })

  it('keeps double-tribute choices private and transfers only after both players select', () => {
    const state = settledMatch(['p1', 'p3', 'p2', 'p4'])
    const hands = moveCardsTo(
      canonicalHands(state.settlement!.currentLevel),
      'p1',
      card => card.suit === 'joker',
      4,
    )
    const prepared = transition(state, {
      type: 'PREPARE_NEXT_ROUND', dealtHands: hands, ...commandMeta(state),
    })
    if (!prepared.ok) throw new Error(prepared.reason)
    const [firstExchange, secondExchange] = prepared.state.tribute!.exchanges
    const choose = (current: MatchState, from: PlayerId) => {
      const hand = current.players[from].hand
      const eligible = hand.filter(item => !(item.isLevelCard && item.suit === 'heart'))
      return highestCard(eligible.length ? eligible : hand).id
    }
    const firstCardId = choose(prepared.state, firstExchange.from)
    const first = transition(prepared.state, {
      type: 'SELECT_TRIBUTE_CARD', playerId: firstExchange.from, cardId: firstCardId,
      ...commandMeta(prepared.state),
    })
    if (!first.ok) throw new Error(first.reason)
    expect(first.state.players[firstExchange.from].hand).toHaveLength(27)
    expect(first.state.players[firstExchange.to].hand).toHaveLength(27)
    expect(first.state.tribute?.status).toBe('selecting_tribute')
    expect(first.events).toEqual([{ type: 'TRIBUTE_CARD_SELECTED', playerId: firstExchange.from }])
    expect('cardId' in first.events[0]).toBe(false)

    const secondCardId = choose(first.state, secondExchange.from)
    const second = transition(first.state, {
      type: 'SELECT_TRIBUTE_CARD', playerId: secondExchange.from, cardId: secondCardId,
      ...commandMeta(first.state),
    })
    if (!second.ok) throw new Error(second.reason)
    expect(second.state.tribute?.status).toBe('selecting_return')
    expect(Object.values(second.state.players).reduce((sum, player) => sum + player.hand.length, 0)).toBe(108)
    expect(second.events.filter(event => event.type === 'TRIBUTE_TRANSFERRED')).toHaveLength(2)

    const [firstReturn, secondReturn] = second.state.tribute!.exchanges
    const returnCardId = (current: MatchState, from: PlayerId): string => {
      const hand = current.players[from].hand
      return (hand.find(card => card.value <= 10) ?? [...hand].sort((a, b) => a.value - b.value)[0]).id
    }
    const firstReturnCardId = returnCardId(second.state, firstReturn.to)
    const beforeFirstReturn = Object.fromEntries(
      Object.entries(second.state.players).map(([id, player]) => [id, player.hand.length]),
    )
    const afterFirstReturn = transition(second.state, {
      type: 'SELECT_RETURN_CARD', playerId: firstReturn.to, cardId: firstReturnCardId,
      ...commandMeta(second.state),
    })
    if (!afterFirstReturn.ok) throw new Error(afterFirstReturn.reason)
    expect(Object.fromEntries(
      Object.entries(afterFirstReturn.state.players).map(([id, player]) => [id, player.hand.length]),
    )).toEqual(beforeFirstReturn)
    expect(afterFirstReturn.events).toEqual([{ type: 'RETURN_CARD_SELECTED', playerId: firstReturn.to }])

    const secondReturnCardId = returnCardId(afterFirstReturn.state, secondReturn.to)
    const completed = transition(afterFirstReturn.state, {
      type: 'SELECT_RETURN_CARD', playerId: secondReturn.to, cardId: secondReturnCardId,
      ...commandMeta(afterFirstReturn.state),
    })
    if (!completed.ok) throw new Error(completed.reason)
    expect(completed.state.tribute?.status).toBe('ready')
    expect(Object.values(completed.state.players).reduce((sum, player) => sum + player.hand.length, 0)).toBe(108)
    expect(completed.events.filter(event => event.type === 'RETURN_TRANSFERRED')).toHaveLength(2)
  })
})
