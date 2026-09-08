import type { PlayerDashboard, UserProfile } from './FrontPageGatewayContracts'
import { copyData, snapshotData, type DataSnapshot } from './DataSnapshot'

/** Auth and dashboard share one development session, never module-global mutable fixtures. */
export class DevelopmentPlayerStore {
  private dashboard: DataSnapshot<PlayerDashboard>

  public constructor (seed: DataSnapshot<PlayerDashboard>) { this.dashboard = snapshotData<PlayerDashboard>(seed) }
  public getDashboard (): PlayerDashboard { return copyData<PlayerDashboard>(this.dashboard) }
  public getProfile (): UserProfile { return copyData<UserProfile>(this.dashboard.user) }
  public updateProfile (profile: Pick<UserProfile, 'displayName' | 'avatarUrl'>): UserProfile {
    this.dashboard = snapshotData<PlayerDashboard>({ ...this.dashboard, user: { ...this.dashboard.user, ...profile } })
    return this.getProfile()
  }
}
