import type { AuthGateway, UserProfile } from './FrontPageGatewayContracts'

type ProfileChange = Parameters<AuthGateway['updateProfile']>[0]

/** Mutation lifetime is independent of modal visibility. Server writes retain submission order. */
export class ProfileSaveCoordinator {
  private tail: Promise<void> = Promise.resolve()
  private revision = 0

  public constructor (private readonly auth: Pick<AuthGateway, 'getProfile' | 'updateProfile'>,
    private readonly publish: (profile: UserProfile) => void) {}

  public save (change: ProfileChange, expectedUserId: string): Promise<UserProfile> {
    const revision = ++this.revision
    const snapshot = { ...change }
    const operation = this.tail.then(async () => {
      // A queued mutation must not inherit a different account while waiting for the previous save.
      const current = await this.auth.getProfile()
      if (current.id !== expectedUserId) throw new Error('账号已切换，请重新打开个人资料')
      return this.auth.updateProfile(snapshot)
    })
    const result = operation.then(profile => {
      if (revision === this.revision) this.publish({ ...profile })
      return profile
    }, async error => {
      // A response may be lost after the server committed. Reconcile, never publish a failed draft.
      if (revision === this.revision) {
        try {
          const current = await this.auth.getProfile()
          if (revision === this.revision && current.id === expectedUserId) this.publish({ ...current })
        } catch { /* Keep the last visible confirmed profile when recovery is also offline. */ }
      }
      throw error
    })
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }
}
