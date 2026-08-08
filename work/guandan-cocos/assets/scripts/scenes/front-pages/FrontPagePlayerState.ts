import type { PlayerDashboard } from '../../services/DevelopmentApis'

/** Shared player projection used by the lobby identity lane and player-center pages. */
export class FrontPagePlayerState {
  public dashboard: PlayerDashboard | null
  public loading = false
  public loadedAt = 0

  public constructor (configured: boolean, developmentDashboard: PlayerDashboard) {
    this.dashboard = configured ? null : developmentDashboard
  }

  public invalidate (): void {
    this.dashboard = null
    this.loadedAt = 0
  }
}
