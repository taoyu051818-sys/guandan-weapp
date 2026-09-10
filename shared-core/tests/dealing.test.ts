import { describe, expect, it } from 'vitest'
import { CLASSIC_MODES, CLASSIC_QUEUES, classicMatchFormat, classicQueue, createDeck, createGame, dealCards, dealGameCards, getRuleProfile, MATCH_LEVELS, normalizeRoomFormat, roomMatchFormat, shuffleDeck } from '../src'

const rng = (seed: number) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
const seats = ['p1', 'p2', 'p3', 'p4'] as const

describe('public modes and dealing', () => {
  it('exposes only three modes and twelve distinct mode/stake queues', () => {
    expect(CLASSIC_MODES.map(m => m.label)).toEqual(['经典', '不洗牌', '连打过A'])
    expect(new Set(CLASSIC_QUEUES.map(q => q.id)).size).toBe(12)
    for (const q of CLASSIC_QUEUES) {
      expect(classicQueue(q.id)).toEqual(q)
      const format = classicMatchFormat(q.id)!
      expect(format.kind).toBe(q.mode === 'consecutive' ? 'upgrade' : 'independent')
      expect(format.tributeEnabled).toBe(q.mode === 'consecutive')
      expect(format.dealMode === 'no-shuffle').toBe(q.mode === 'no-shuffle')
      if (q.mode === 'consecutive') expect(format).toMatchObject({ levelMode: 'fixed', levelRank: 2, upgradeTarget: 'A' })
    }
    expect(classicMatchFormat('quick')).toEqual(classicMatchFormat('classic_50'))
    for (const id of ['team-turn', 'upgrade80', 'classic_51', 'toString', 'no-shuffle_0']) expect(classicMatchFormat(id)).toBeUndefined()
  })

  it('preserves the original random deal exactly and propagates explicit room dealing', () => {
    for (const level of MATCH_LEVELS) {
      expect(dealGameCards(level, 'random', rng(321))).toEqual(dealCards(shuffleDeck(createDeck(level), rng(321))))
      for (const format of ['rounds', 'upgrade', 'rotating', 'duplicate']) {
        const settings = normalizeRoomFormat({ format, dealMode: 'no-shuffle' })!
        expect(roomMatchFormat(settings).dealMode).toBe('no-shuffle')
        expect(normalizeRoomFormat(JSON.parse(JSON.stringify(settings)))).toEqual(settings)
      }
    }
    expect(() => normalizeRoomFormat({ format: 'rounds', dealMode: 'fake' })).toThrow()
    expect(() => normalizeRoomFormat({ dealMode: 'no-shuffle' })).toThrow()
    expect(roomMatchFormat(normalizeRoomFormat({ format: 'rounds' })!).dealMode).toBeUndefined()
  })

  it('deals all 108 unique cards, 27 per seat, across every level with reproducible level/wild flags', () => {
    for (const level of MATCH_LEVELS) for (let seed = 1; seed <= 60; seed++) {
      const hands = dealGameCards(level, 'no-shuffle', rng(seed))
      const all = seats.flatMap(s => hands[s])
      expect(seats.map(s => hands[s].length)).toEqual([27, 27, 27, 27])
      expect(new Set(all.map(c => c.id)).size).toBe(108)
      expect([...all].sort((a, b) => a.id.localeCompare(b.id))).toEqual(createDeck(level).sort((a, b) => a.id.localeCompare(b.id)))
      expect(hands).toEqual(dealGameCards(level, 'no-shuffle', rng(seed)))
    }
    const game = createGame(7, 'p1', getRuleProfile('classic'), rng(9), 'no-shuffle')
    expect(game.players.p1.hand).toEqual(dealGameCards(7, 'no-shuffle', rng(9)).p1)
    for (const mode of ['random', 'no-shuffle'] as const) for (const n of [-1, 1, NaN, Infinity]) expect(() => dealGameCards(2, mode, () => n)).toThrow('INVALID_DEAL_RANDOM')
    expect(() => dealGameCards(2, 'fake' as never)).toThrow('INVALID_DEAL_MODE')
  })

  it('increases natural bombs without privileging a seat (3000 fixed-seed deals per strategy)', () => {
    const totals: number[] = []
    for (const mode of ['random', 'no-shuffle'] as const) {
      const bombs = [0, 0, 0, 0], bigJokers = [0, 0, 0, 0], values = [0, 0, 0, 0]
      for (let seed = 1; seed <= 3000; seed++) {
        const hands = dealGameCards(7, mode, rng(seed))
        seats.forEach((seat, i) => {
          const counts = new Map<string | number, number>()
          for (const c of hands[seat]) {
            if (c.suit !== 'joker') counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1)
            if (c.rank === 'Big') bigJokers[i]++
            values[i] += c.value
          }
          bombs[i] += [...counts.values()].filter(n => n >= 4).length
        })
      }
      totals.push(bombs.reduce((a, b) => a + b, 0))
      // Deterministic distribution alarms, not a proof of fairness or a per-hand guarantee.
      expect((Math.max(...bombs) - Math.min(...bombs)) / 3000).toBeLessThan(0.15)
      expect((Math.max(...values) - Math.min(...values)) / 3000).toBeLessThan(4)
      for (const count of bigJokers) expect(count / 3000).toBeGreaterThan(0.45)
      for (const count of bigJokers) expect(count / 3000).toBeLessThan(0.55)
    }
    // The six-group opening target replaces the old six-packet deal's 1.4–2x
    // concentration budget. Keep an explicit bound plus the independent
    // arrangement/single-card regression, not only "more bombs than random".
    expect(totals[1] / totals[0]).toBeGreaterThan(2)
    expect(totals[1] / totals[0]).toBeLessThan(2.5)
  })
})
