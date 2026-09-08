import { HttpShopGateway } from './shopGateway'
/** Explicit contract-test/migration entry. Never import from assets. */
import { PlatformApiClient, XhrTransport } from '../../assets/scripts/services/PlatformApi'
import { createPlayerGateways } from '../../assets/scripts/services/platform/factory'
import type { PlatformApiConfig, HttpTransport } from '../../assets/scripts/services/PlatformApi'
import { HttpMerchantGateway } from './merchantGateway'
import { HttpSpectatorGateway } from './spectatorGateway'
import { HttpTournamentGateway } from './tournamentGateway'
export { PlatformApiClient, PlatformApiError } from '../../assets/scripts/services/PlatformApi'

export const createHttpGateways = (config: PlatformApiConfig, transport: HttpTransport = new XhrTransport()) => {
  const client = new PlatformApiClient(transport, config)
  const player = createPlayerGateways(client, config.gameEndpointPolicy ?? 'allow-localhost-insecure')
  return { ...player, shop: new HttpShopGateway(client), merchant: new HttpMerchantGateway(client), spectator: new HttpSpectatorGateway(client), tournaments: new HttpTournamentGateway(client) }
}
