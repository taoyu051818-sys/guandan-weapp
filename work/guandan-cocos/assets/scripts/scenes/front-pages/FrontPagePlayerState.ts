import type { PlayerDashboard, UserProfile } from '../../services/FrontPageGatewayContracts'
import { snapshotData, type DataSnapshot } from '../../services/DataSnapshot'

/** Shared player projection used by the lobby identity lane and player-center pages. */
export class FrontPagePlayerState {
  private currentProfile: DataSnapshot<UserProfile> | null = null
  private currentDashboard: DataSnapshot<PlayerDashboard> | null
  public get profile (): DataSnapshot<UserProfile> | null { return this.currentProfile }
  public get dashboard (): DataSnapshot<PlayerDashboard> | null { return this.currentDashboard }
  public loading = false
  public loadedAt = 0

  public constructor (configured: boolean, developmentDashboard: DataSnapshot<PlayerDashboard>) {
    this.currentDashboard = configured ? null : snapshotData<PlayerDashboard>(developmentDashboard)
  }

  public updateDashboard (dashboard: DataSnapshot<PlayerDashboard>): void {
    this.currentDashboard = snapshotData<PlayerDashboard>(dashboard)
  }

  public updateProfile (profile: DataSnapshot<UserProfile>): void {
    this.currentProfile = snapshotData<UserProfile>(profile)
    if (this.currentDashboard) this.updateDashboard({ ...this.currentDashboard, user: this.currentProfile })
  }

  public invalidate (): void {
    this.currentProfile = null
    this.currentDashboard = null
    this.loadedAt = 0
  }
}
