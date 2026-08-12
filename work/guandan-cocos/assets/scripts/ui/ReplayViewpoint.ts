import type { ReplaySeatId } from '../replay/ReplayTimeline'

export type ReplayViewpoint =
  | Readonly<{ kind: 'player', seat: ReplaySeatId }>
  | Readonly<{ kind: 'neutral' }>

export type ReplaySeatLane = 'bottom' | 'right' | 'top' | 'left'
export type ReplaySeatPlacement = Readonly<{
  seat: ReplaySeatId
  lane: ReplaySeatLane
  side: string
  x: number
  y: number
}>

const SEATS: readonly ReplaySeatId[] = ['p1', 'p2', 'p3', 'p4']
const LANES: ReadonlyArray<Readonly<{ lane: ReplaySeatLane, x: number, y: number }>> = [
  { lane: 'bottom', x: 0, y: -118 },
  { lane: 'right', x: 310, y: 0 },
  { lane: 'top', x: 0, y: 128 },
  { lane: 'left', x: -310, y: 0 },
]
const RELATIVE_SIDES = ['本人', '右家', '对家', '左家'] as const
const NEUTRAL_SIDES = ['一号位', '二号位', '三号位', '四号位'] as const

export const neutralReplayViewpoint = (): ReplayViewpoint => Object.freeze({ kind: 'neutral' })

export const playerReplayViewpoint = (seat: ReplaySeatId): ReplayViewpoint => Object.freeze({ kind: 'player', seat })

export const projectReplaySeats = (viewpoint: ReplayViewpoint): readonly ReplaySeatPlacement[] => {
  const start = viewpoint.kind === 'player' ? Math.max(0, SEATS.indexOf(viewpoint.seat)) : 0
  return Object.freeze(LANES.map((lane, index) => Object.freeze({
    seat: SEATS[(start + index) % SEATS.length],
    ...lane,
    side: viewpoint.kind === 'player' ? RELATIVE_SIDES[index] : NEUTRAL_SIDES[index],
  })))
}

export const replayWinnerLabel = (winnerTeam: string, viewpoint: ReplayViewpoint): string => {
  if (viewpoint.kind === 'neutral') return winnerTeam === 'teamA' ? 'A队胜' : winnerTeam === 'teamB' ? 'B队胜' : `${winnerTeam}胜`
  const viewerTeam = viewpoint.seat === 'p1' || viewpoint.seat === 'p3' ? 'teamA' : 'teamB'
  return winnerTeam === viewerTeam ? '我方队胜' : '对方队胜'
}
