import type { ReplayEvent } from '../services/DevelopmentApis'

export const REPLAY_SEATS = ['p1', 'p2', 'p3', 'p4'] as const

export type ReplaySeatId = typeof REPLAY_SEATS[number]
export type ReplayPhase =
  | 'idle'
  | 'game-start'
  | 'round-start'
  | 'tribute'
  | 'anti-tribute'
  | 'playing'
  | 'round-ended'
  | 'room-closed'

export type ReplayEventLike = Omit<ReplayEvent, 'cards' | 'ranking'> & {
  cards?: ReadonlyArray<Readonly<{ rank: string, suit: string }>>
  ranking?: readonly string[]
}

export type ReplayTimelineEvent = Readonly<Omit<ReplayEvent, 'cards' | 'ranking'> & {
  cards?: ReadonlyArray<Readonly<{ rank: string, suit: string }>>
  ranking?: readonly string[]
}>

export type ReplaySeatAction = Readonly<{
  sequence: number
  at: number
  type: 'tribute' | 'return-tribute' | 'play' | 'pass'
  playerId: ReplaySeatId
  cards: ReadonlyArray<Readonly<{ rank: string, suit: string }>>
  playType: string | null
  automatic: boolean | null
}>

export type ReplayTimelineState = Readonly<{
  roundSequence: number | null
  phase: ReplayPhase
  tableCards: ReadonlyArray<Readonly<{ rank: string, suit: string }>>
  tablePlayerId: ReplaySeatId | null
  tablePlayType: string | null
  seatActions: Readonly<Record<ReplaySeatId, ReplaySeatAction | null>>
  ranking: readonly string[]
  winnerTeam: string | null
  isGameWon: boolean | null
  closedReason: string | null
}>

export type ReplayMergeResult = Readonly<{
  previousEventCount: number
  eventCount: number
  addedCount: number
  wasAtEnd: boolean
  followedEnd: boolean
  cursor: number
}>

const EMPTY_CARDS: ReadonlyArray<Readonly<{ rank: string, suit: string }>> = Object.freeze([])
const EMPTY_RANKING: readonly string[] = Object.freeze([])

const emptySeatActions = (): Readonly<Record<ReplaySeatId, ReplaySeatAction | null>> => Object.freeze({
  p1: null,
  p2: null,
  p3: null,
  p4: null,
})

const initialReplayState = (): ReplayTimelineState => Object.freeze({
  roundSequence: null,
  phase: 'idle',
  tableCards: EMPTY_CARDS,
  tablePlayerId: null,
  tablePlayType: null,
  seatActions: emptySeatActions(),
  ranking: EMPTY_RANKING,
  winnerTeam: null,
  isGameWon: null,
  closedReason: null,
})

const isSeatId = (value: string | undefined): value is ReplaySeatId => (
  value === 'p1' || value === 'p2' || value === 'p3' || value === 'p4'
)

const cloneCards = (
  cards: ReplayEventLike['cards'],
): ReadonlyArray<Readonly<{ rank: string, suit: string }>> => {
  if (!cards?.length) return EMPTY_CARDS
  return Object.freeze(cards.map(card => Object.freeze({ rank: card.rank, suit: card.suit })))
}

const cloneEvent = (event: ReplayEventLike): ReplayTimelineEvent => {
  const cards = event.cards === undefined ? undefined : cloneCards(event.cards)
  const ranking = event.ranking === undefined ? undefined : Object.freeze([...event.ranking])
  return Object.freeze({
    sequence: event.sequence,
    at: event.at,
    type: event.type,
    ...(event.roundSequence === undefined ? {} : { roundSequence: event.roundSequence }),
    ...(event.playerId === undefined ? {} : { playerId: event.playerId }),
    ...(cards === undefined ? {} : { cards }),
    ...(event.playType === undefined ? {} : { playType: event.playType }),
    ...(event.automatic === undefined ? {} : { automatic: event.automatic }),
    ...(ranking === undefined ? {} : { ranking }),
    ...(event.winnerTeam === undefined ? {} : { winnerTeam: event.winnerTeam }),
    ...(event.isGameWon === undefined ? {} : { isGameWon: event.isGameWon }),
    ...(event.reason === undefined ? {} : { reason: event.reason }),
    ...(event.text === undefined ? {} : { text: event.text }),
  })
}

const eventFingerprint = (event: ReplayTimelineEvent): string => JSON.stringify(event)

/**
 * Produces an immutable, sequence-ordered public event stream. Sequence is the
 * server identity of an event, so repeated deliveries with the same sequence
 * collapse to one entry. A fingerprint tie-break makes conflicting duplicates
 * deterministic even if their arrival order differs.
 */
export const normalizeReplayEvents = (events: readonly ReplayEventLike[]): readonly ReplayTimelineEvent[] => {
  const ordered = events
    .map(event => {
      const cloned = cloneEvent(event)
      return { event: cloned, fingerprint: eventFingerprint(cloned) }
    })
    .sort((left, right) => left.event.sequence - right.event.sequence || left.fingerprint.localeCompare(right.fingerprint))

  const unique: ReplayTimelineEvent[] = []
  for (const item of ordered) {
    if (unique[unique.length - 1]?.sequence !== item.event.sequence) unique.push(item.event)
  }
  return Object.freeze(unique)
}

const stateWithRound = (state: ReplayTimelineState, event: ReplayTimelineEvent): ReplayTimelineState => (
  event.roundSequence === undefined || event.roundSequence === state.roundSequence
    ? state
    : Object.freeze({ ...state, roundSequence: event.roundSequence })
)

const resetForStart = (
  state: ReplayTimelineState,
  event: ReplayTimelineEvent,
  phase: 'game-start' | 'round-start',
): ReplayTimelineState => Object.freeze({
  ...state,
  roundSequence: event.roundSequence ?? state.roundSequence,
  phase,
  tableCards: EMPTY_CARDS,
  tablePlayerId: null,
  tablePlayType: null,
  seatActions: emptySeatActions(),
  ranking: EMPTY_RANKING,
  winnerTeam: null,
  isGameWon: null,
  closedReason: null,
})

const actionFromEvent = (event: ReplayTimelineEvent): ReplaySeatAction | null => {
  if (!isSeatId(event.playerId)) return null
  if (event.type !== 'tribute' && event.type !== 'return-tribute' && event.type !== 'play' && event.type !== 'pass') return null
  return Object.freeze({
    sequence: event.sequence,
    at: event.at,
    type: event.type,
    playerId: event.playerId,
    cards: event.type === 'play' ? (event.cards ?? EMPTY_CARDS) : EMPTY_CARDS,
    playType: event.type === 'play' ? (event.playType ?? null) : null,
    automatic: event.type === 'play' || event.type === 'pass' ? (event.automatic ?? null) : null,
  })
}

const applyReplayEvent = (previous: ReplayTimelineState, event: ReplayTimelineEvent): ReplayTimelineState => {
  if (event.type === 'game-start' || event.type === 'round-start') return resetForStart(previous, event, event.type)

  const state = stateWithRound(previous, event)
  if (event.type === 'tribute-start') {
    return Object.freeze({ ...state, phase: 'tribute', tableCards: EMPTY_CARDS, tablePlayerId: null, tablePlayType: null })
  }
  if (event.type === 'anti-tribute') {
    return Object.freeze({ ...state, phase: 'anti-tribute', tableCards: EMPTY_CARDS, tablePlayerId: null, tablePlayType: null })
  }
  if (event.type === 'play-start') {
    return Object.freeze({
      ...state,
      phase: 'playing',
      tableCards: EMPTY_CARDS,
      tablePlayerId: null,
      tablePlayType: null,
      seatActions: emptySeatActions(),
      ranking: EMPTY_RANKING,
      winnerTeam: null,
      isGameWon: null,
    })
  }

  const action = actionFromEvent(event)
  if (action) {
    const phase: ReplayPhase = action.type === 'tribute' || action.type === 'return-tribute' ? 'tribute' : 'playing'
    return Object.freeze({
      ...state,
      phase,
      ...(action.type === 'play'
        ? { tableCards: action.cards, tablePlayerId: action.playerId, tablePlayType: action.playType }
        : {}),
      seatActions: Object.freeze({ ...state.seatActions, [action.playerId]: action }),
    })
  }

  if (event.type === 'round-end' || event.type === 'settlement') {
    return Object.freeze({
      ...state,
      phase: 'round-ended',
      ranking: event.ranking === undefined ? EMPTY_RANKING : Object.freeze([...event.ranking]),
      winnerTeam: event.winnerTeam ?? null,
      isGameWon: event.isGameWon ?? null,
    })
  }
  if (event.type === 'room-closed') {
    return Object.freeze({ ...state, phase: 'room-closed', closedReason: event.reason ?? null })
  }
  return state
}

const buildReplayStates = (
  events: readonly ReplayTimelineEvent[],
  initialState: ReplayTimelineState = initialReplayState(),
): readonly ReplayTimelineState[] => {
  const states: ReplayTimelineState[] = []
  let state = initialState
  for (const event of events) {
    state = applyReplayEvent(state, event)
    states.push(state)
  }
  return Object.freeze(states)
}

/** Reduces the normalized public timeline through the inclusive cursor. */
export const reduceReplayState = (
  events: readonly ReplayEventLike[],
  cursor?: number,
): ReplayTimelineState => {
  const normalized = normalizeReplayEvents(events)
  const requestedCursor = cursor === undefined
    ? normalized.length - 1
    : (Number.isFinite(cursor) ? Math.trunc(cursor) : -1)
  const end = Math.min(normalized.length - 1, requestedCursor)
  let state = initialReplayState()
  for (let index = 0; index <= end; index += 1) state = applyReplayEvent(state, normalized[index])
  return state
}

/**
 * Cursor-only replay model. It owns no timer and never models private hands;
 * callers decide when to call next() while isPlaying is true.
 */
export class ReplayTimeline {
  private timelineEvents: readonly ReplayTimelineEvent[]
  private states: readonly ReplayTimelineState[]
  private cursorIndex: number
  private playing = false

  public constructor (events: readonly ReplayEventLike[] = []) {
    this.timelineEvents = normalizeReplayEvents(events)
    this.states = buildReplayStates(this.timelineEvents)
    this.cursorIndex = this.timelineEvents.length ? 0 : -1
  }

  public get eventCount (): number { return this.timelineEvents.length }
  public get cursor (): number { return this.cursorIndex }
  public get currentEvent (): ReplayTimelineEvent | null { return this.timelineEvents[this.cursorIndex] ?? null }
  public get state (): ReplayTimelineState { return this.states[this.cursorIndex] ?? initialReplayState() }
  public get isPlaying (): boolean { return this.playing }
  public get isAtEnd (): boolean { return !this.timelineEvents.length || this.cursorIndex >= this.timelineEvents.length - 1 }
  public get newerEventCount (): number { return Math.max(0, this.timelineEvents.length - this.cursorIndex - 1) }

  /**
   * Merges repeated spectator snapshots by authoritative sequence. Existing
   * sequences are immutable and retained; only newly observed public events
   * are appended or inserted. The current event is preserved while reviewing
   * history, whereas a cursor already at the live edge follows new arrivals.
   */
  public merge (events: readonly ReplayEventLike[], followIfAtEnd = true): ReplayMergeResult {
    const previousEventCount = this.timelineEvents.length
    const wasAtEnd = this.isAtEnd
    const currentSequence = this.currentEvent?.sequence ?? null
    const existingSequences = new Set(this.timelineEvents.map(event => event.sequence))
    const additions = normalizeReplayEvents(events).filter(event => !existingSequences.has(event.sequence))
    if (!additions.length) {
      return Object.freeze({ previousEventCount, eventCount: previousEventCount, addedCount: 0, wasAtEnd, followedEnd: false, cursor: this.cursorIndex })
    }

    const lastSequence = this.timelineEvents[this.timelineEvents.length - 1]?.sequence ?? Number.NEGATIVE_INFINITY
    const appendOnly = additions.every(event => event.sequence > lastSequence)
    if (appendOnly) {
      const previousState = this.states[this.states.length - 1] ?? initialReplayState()
      this.timelineEvents = Object.freeze([...this.timelineEvents, ...additions])
      this.states = Object.freeze([...this.states, ...buildReplayStates(additions, previousState)])
    } else {
      this.timelineEvents = normalizeReplayEvents([...this.timelineEvents, ...additions])
      this.states = buildReplayStates(this.timelineEvents)
    }

    const followedEnd = followIfAtEnd && wasAtEnd
    if (followedEnd) this.cursorIndex = this.timelineEvents.length - 1
    else if (currentSequence !== null) this.cursorIndex = this.timelineEvents.findIndex(event => event.sequence === currentSequence)
    else this.cursorIndex = 0
    return Object.freeze({
      previousEventCount,
      eventCount: this.timelineEvents.length,
      addedCount: additions.length,
      wasAtEnd,
      followedEnd,
      cursor: this.cursorIndex,
    })
  }

  public play (): boolean {
    if (!this.timelineEvents.length) return false
    this.playing = true
    return true
  }

  public pause (): void { this.playing = false }

  public toggle (): boolean {
    if (this.playing) this.pause()
    else this.play()
    return this.playing
  }

  public next (): boolean { return this.seek(this.cursorIndex + 1) }
  public previous (): boolean { return this.seek(this.cursorIndex - 1) }

  public seek (index: number): boolean {
    if (!this.timelineEvents.length) return false
    const finiteIndex = Number.isFinite(index) ? Math.trunc(index) : 0
    const target = Math.max(0, Math.min(this.timelineEvents.length - 1, finiteIndex))
    if (target === this.cursorIndex) return false
    this.cursorIndex = target
    return true
  }

  public seekRatio (ratio: number): boolean {
    if (!this.timelineEvents.length) return false
    const finiteRatio = Number.isFinite(ratio) ? ratio : 0
    const clamped = Math.max(0, Math.min(1, finiteRatio))
    return this.seek(Math.round((this.timelineEvents.length - 1) * clamped))
  }

  public toStart (): boolean { return this.seek(0) }
  public toEnd (): boolean { return this.seek(this.timelineEvents.length - 1) }
}
