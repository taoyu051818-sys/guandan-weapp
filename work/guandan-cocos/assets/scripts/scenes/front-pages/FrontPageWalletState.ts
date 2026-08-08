import type { WalletSnapshot } from '../../services/DevelopmentApis'

/** Shared wallet projection read by the lobby, shop, tournaments, and player center. */
export class FrontPageWalletState {
  public value: WalletSnapshot = { points: 10_000, diamonds: 0 }
  public fresh: boolean

  public constructor (configured: boolean) {
    this.fresh = !configured
  }

  public invalidate (): void { this.fresh = false }

  public update (wallet: WalletSnapshot): void {
    this.value = wallet
    this.fresh = true
  }
}
