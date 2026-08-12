import type { Card, EngineState, MatchState, PlayerId, Rank, SettlementResult, Team, TributeState } from '../core/generated'

export type GameManagerProjection = Readonly<{
  roundId: number | null
  revision: number | null
  phase: 'playing' | 'tribute' | 'settlement'
  teamLevels: Record<Team, Rank>
  aFailStreaks: Record<Team, number>
  scores: Record<Team, number>
  lastRoundRank: PlayerId[]
  tribute: TributeState | null
  settlement: SettlementResult | null
}>

export const createGameManagerProjection = (): GameManagerProjection => ({
  roundId: null,
  revision: null,
  phase: 'playing',
  teamLevels: { teamA: 2, teamB: 2 },
  aFailStreaks: { teamA: 0, teamB: 0 },
  scores: { teamA: 0, teamB: 0 },
  lastRoundRank: [],
  tribute: null,
  settlement: null,
})

export const mergeGameManagerProjection = (
  current: GameManagerProjection,
  patch: Partial<GameManagerProjection>,
): GameManagerProjection => ({
  roundId: patch.roundId === undefined ? current.roundId : patch.roundId,
  revision: patch.revision === undefined ? current.revision : patch.revision,
  phase: patch.phase ?? current.phase,
  teamLevels: { ...(patch.teamLevels ?? current.teamLevels) },
  aFailStreaks: { ...(patch.aFailStreaks ?? current.aFailStreaks) },
  scores: { ...(patch.scores ?? current.scores) },
  lastRoundRank: [...(patch.lastRoundRank ?? current.lastRoundRank)],
  tribute: patch.tribute === undefined ? current.tribute : patch.tribute,
  settlement: patch.settlement === undefined ? current.settlement : patch.settlement,
})

export const authoritativeProgress = (
  current: GameManagerProjection,
  state: EngineState,
): Pick<GameManagerProjection, 'teamLevels' | 'aFailStreaks' | 'scores' | 'lastRoundRank'> => {
  const match = state as Partial<MatchState>
  return {
    teamLevels: match.teamLevels ?? current.teamLevels,
    aFailStreaks: match.aFailStreaks ?? current.aFailStreaks,
    scores: match.scores ?? current.scores,
    lastRoundRank: match.lastRoundRank ?? current.lastRoundRank,
  }
}

export type AuthoritativeProjectionResult = Readonly<{
  accepted: boolean
  projection: GameManagerProjection
}>

const canonicalPhase = (state: EngineState): GameManagerProjection['phase'] | null => {
  const phase = (state as Partial<MatchState>).phase
  if (phase === 'playing' || phase === 'tribute') return phase
  return phase === 'settled' ? 'settlement' : null
}

const canonicalVersion = (state: EngineState): Pick<GameManagerProjection, 'roundId' | 'revision'> => {
  const match = state as Partial<MatchState>
  return {
    roundId: Number.isSafeInteger(match.roundId) ? Number(match.roundId) : null,
    revision: Number.isSafeInteger(match.revision) ? Number(match.revision) : null,
  }
}

const cardById = (state: EngineState, cardId: string | null): Card | null => {
  if (!cardId) return null
  for (const playerId of state.turnOrder) {
    const card = state.players[playerId].hand.find(candidate => candidate.id === cardId)
    if (card) return card
  }
  return null
}

/** Adapts canonical tribute ids to the legacy display shape without creating a second authority. */
export const projectCanonicalTribute = (
  state: MatchState,
  fallback: TributeState | null = null,
): TributeState | null => {
  const tribute = state.tribute
  if (!tribute) return null
  return {
    isDoubleDown: tribute.mode === 'double',
    isAntiTribute: tribute.status === 'resisted',
    phase: tribute.status === 'selecting_tribute'
      ? 'tributing'
      : tribute.status === 'selecting_return'
        ? 'returning'
        : 'done',
    actions: tribute.exchanges.map(exchange => {
      const legacy = fallback?.actions.find(action => action.from === exchange.from && action.to === exchange.to)
      return {
        from: exchange.from,
        to: exchange.to,
        card: cardById(state, exchange.tributeCardId) ?? legacy?.card ?? null,
        returnCard: cardById(state, exchange.returnCardId) ?? legacy?.returnCard ?? null,
      }
    }),
  }
}

/** Canonical MatchState lifecycle wins; split wire fields only adapt legacy EngineState packets. */
export const projectAuthoritativeState = (
  current: GameManagerProjection,
  state: EngineState,
  fallback: Partial<GameManagerProjection> = {},
): AuthoritativeProjectionResult => {
  const version = canonicalVersion(state)
  const phase = canonicalPhase(state)
  const staleRound = version.roundId !== null && current.roundId !== null && version.roundId < current.roundId
  const staleRevision = version.roundId !== null && version.roundId === current.roundId
    && version.revision !== null && current.revision !== null && version.revision < current.revision
  const staleLifecycle = version.roundId !== null && version.roundId === current.roundId
    && current.phase === 'settlement' && phase !== null && phase !== 'settlement'
  if (staleRound || staleRevision || staleLifecycle) return { accepted: false, projection: current }

  const match = state as Partial<MatchState>
  const canonicalLifecycle: Partial<GameManagerProjection> = phase
    ? {
        phase,
        tribute: phase === 'tribute'
          ? projectCanonicalTribute(state as MatchState, fallback.tribute ?? null)
          : null,
        settlement: phase === 'settlement' ? match.settlement ?? fallback.settlement ?? null : null,
      }
    : {}
  return {
    accepted: true,
    projection: mergeGameManagerProjection(current, {
      ...fallback,
      ...authoritativeProgress(current, state),
      roundId: version.roundId ?? current.roundId,
      revision: version.revision ?? current.revision,
      ...canonicalLifecycle,
    }),
  }
}
