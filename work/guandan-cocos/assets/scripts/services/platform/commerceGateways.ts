import type { WalletGateway, WalletSnapshot } from '../FrontPageGatewayContracts'
import { PlatformApiClient } from './client'
import { nonNegativeNumber, requireRecord } from './validation'

export class HttpWalletGateway implements WalletGateway {
  public constructor (private readonly client: PlatformApiClient) {}

  public async getWallet (): Promise<WalletSnapshot> {
    const payload = requireRecord(await this.client.request<unknown>('/api/v1/wallet'), '钱包响应')
    const wallet = requireRecord(payload.wallet, '钱包') as { balance?: number, points?: number, diamonds?: number }
    return {
      points: nonNegativeNumber(wallet.points ?? wallet.balance, '钱包积分余额'),
      diamonds: wallet.diamonds === undefined ? 0 : nonNegativeNumber(wallet.diamonds, '钱包钻石余额'),
    }
  }
}
