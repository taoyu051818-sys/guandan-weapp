export type DuplicateSeat = 'p1' | 'p2' | 'p3' | 'p4' | 'p5' | 'p6' | 'p7' | 'p8'
export type DuplicateTable = 'A' | 'B'
export type DuplicateSlot = Readonly<{ seat: DuplicateSeat, table: DuplicateTable, direction: string, team: 'red' | 'blue',
  name: string, occupied: boolean, ready: boolean, bot: boolean, online: boolean, host: boolean }>
export type DuplicateRoomSummary = Readonly<{
  phase: 'lobby' | 'playing' | 'ended' | 'closed'
  mySeat: DuplicateSeat | null
  watching: DuplicateTable | null
  round: number
  configuredRounds: number
  scores: { red: number, blue: number }
  ready: boolean
  canStart: boolean
  tables: Record<DuplicateTable, string>
  slots: readonly DuplicateSlot[]
  history: readonly { round: number, red: number, blue: number }[]
}>

export const normalizeDuplicateRoom = (raw: unknown): DuplicateRoomSummary | null => {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as DuplicateRoomSummary
  const seats = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']
  if (!['lobby', 'playing', 'ended', 'closed'].includes(r.phase) || !Array.isArray(r.slots) || r.slots.length !== 8
    || r.slots.some(s => !s || typeof s !== 'object')
    || new Set(r.slots.map(s => s.seat)).size !== 8 || r.slots.some(s => !seats.includes(s.seat)
      || !['A', 'B'].includes(s.table) || !['red', 'blue'].includes(s.team) || typeof s.name !== 'string' || s.name.length > 32
      || ['occupied', 'ready', 'bot', 'online', 'host'].some(k => typeof (s as unknown as Record<string, unknown>)[k] !== 'boolean'))
    || r.mySeat !== null && !seats.includes(r.mySeat) || r.watching !== null && !['A', 'B'].includes(r.watching)
    || !r.scores || !Number.isSafeInteger(r.scores.red) || !Number.isSafeInteger(r.scores.blue)
    || !Number.isSafeInteger(r.round) || !Number.isSafeInteger(r.configuredRounds) || r.configuredRounds < 1 || r.configuredRounds > 32
    || typeof r.ready !== 'boolean' || typeof r.canStart !== 'boolean' || r.round < 1 || r.round > r.configuredRounds
    || r.scores.red < 0 || r.scores.blue < 0 || r.scores.red + r.scores.blue > r.configuredRounds * 6
    || !r.tables || !['lobby', 'playing', 'settled'].includes(r.tables.A) || !['lobby', 'playing', 'settled'].includes(r.tables.B)
    || !Array.isArray(r.history) || r.history.length > 32 || r.history.some(h => !h || !Number.isSafeInteger(h.round)
      || !Number.isSafeInteger(h.red) || !Number.isSafeInteger(h.blue) || h.red < 0 || h.blue < 0 || h.red + h.blue > 6)) return null
  return JSON.parse(JSON.stringify(r)) as DuplicateRoomSummary
}
