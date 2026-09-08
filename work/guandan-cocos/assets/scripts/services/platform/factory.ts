import type { FrontPageGateways } from '../FrontPageGatewayContracts'
import { PlatformApiClient, XhrTransport } from './client'
import { HttpWalletGateway } from './commerceGateways'
import { HttpMatchmakingGateway } from './competitionGateways'
import { HttpFriendRoomGateway } from './friendRoomGateway'
import { HttpMatchRecoveryGateway } from './matchRecoveryGateway'
import type { GameEndpointPolicy, HttpTransport, PlatformApiConfig } from './contracts'
import { HttpAuthGateway, HttpPlayerCenterGateway, HttpSeasonGateway } from './profileGateways'
import { HttpReplayGateway } from './replayGateways'

export const createHttpGateways = (config: PlatformApiConfig, transport: HttpTransport = new XhrTransport()): FrontPageGateways => {
  const client = new PlatformApiClient(transport, config)
  return createPlayerGateways(client, config.gameEndpointPolicy ?? 'allow-localhost-insecure')
}

/** All active domains share one authenticated client and login lifetime. */
export const createPlayerGateways = (client: PlatformApiClient, endpointPolicy: GameEndpointPolicy): FrontPageGateways => {
  return {
    configured: true,
    auth: new HttpAuthGateway(client),
    matchmaking: new HttpMatchmakingGateway(client, endpointPolicy),
    friendRooms: new HttpFriendRoomGateway(client, endpointPolicy),
    matchRecovery: new HttpMatchRecoveryGateway(client, endpointPolicy),
    wallet: new HttpWalletGateway(client),
    playerCenter: new HttpPlayerCenterGateway(client),
    seasons: new HttpSeasonGateway(client),
    replays: new HttpReplayGateway(client),
  }
}
