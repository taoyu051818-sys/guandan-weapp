import type { FrontPageGateways } from '../FrontPageGatewayContracts'
import { PlatformApiClient, XhrTransport } from './client'
import { HttpShopGateway, HttpWalletGateway } from './commerceGateways'
import { HttpMatchmakingGateway, HttpTournamentGateway } from './competitionGateways'
import { HttpFriendRoomGateway } from './friendRoomGateway'
import { HttpMatchRecoveryGateway } from './matchRecoveryGateway'
import type { HttpTransport, PlatformApiConfig } from './contracts'
import { HttpMerchantGateway } from './merchantGateway'
import { HttpAuthGateway, HttpPlayerCenterGateway, HttpSeasonGateway } from './profileGateways'
import { HttpReplayGateway, HttpSpectatorGateway } from './replayGateways'

export const createHttpGateways = (config: PlatformApiConfig, transport: HttpTransport = new XhrTransport()): FrontPageGateways => {
  const client = new PlatformApiClient(transport, config)
  return {
    configured: true,
    auth: new HttpAuthGateway(client),
    matchmaking: new HttpMatchmakingGateway(client, config.gameEndpointPolicy ?? 'allow-localhost-insecure'),
    friendRooms: new HttpFriendRoomGateway(client, config.gameEndpointPolicy ?? 'allow-localhost-insecure'),
    matchRecovery: new HttpMatchRecoveryGateway(client, config.gameEndpointPolicy ?? 'allow-localhost-insecure'),
    shop: new HttpShopGateway(client),
    wallet: new HttpWalletGateway(client),
    tournaments: new HttpTournamentGateway(client),
    playerCenter: new HttpPlayerCenterGateway(client),
    seasons: new HttpSeasonGateway(client),
    replays: new HttpReplayGateway(client),
    spectator: new HttpSpectatorGateway(client),
    merchant: new HttpMerchantGateway(client),
  }
}
