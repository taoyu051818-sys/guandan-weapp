import type { SpectatorMatchStatus } from '../../assets/scripts/services/FrontPageGatewayContracts'

export const SPECTATOR_POLL_INTERVAL_SECONDS = 3
export const SPECTATOR_MAX_RETRY_DELAY_SECONDS = 12

export type SpectatorCompletion = Readonly<{
  status: SpectatorMatchStatus
  timelineComplete: boolean
}>

export const shouldStopSpectatorPolling = (feed: SpectatorCompletion): boolean => (
  feed.timelineComplete && (feed.status === 'finished' || feed.status === 'aborted')
)

/** 3s, 6s, then a bounded 12s retry cadence while preserving the current board. */
export const spectatorRetryDelaySeconds = (consecutiveFailures: number): number => {
  const failures = Number.isFinite(consecutiveFailures) ? Math.max(1, Math.trunc(consecutiveFailures)) : 1
  return Math.min(SPECTATOR_MAX_RETRY_DELAY_SECONDS, SPECTATOR_POLL_INTERVAL_SECONDS * (2 ** Math.min(2, failures - 1)))
}
