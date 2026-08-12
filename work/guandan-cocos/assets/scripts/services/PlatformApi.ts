/**
 * Stable public facade for the platform service layer.
 *
 * Keep application imports pointed at this file. Transport, decoding and
 * domain gateways live under ./platform so they can evolve independently.
 */
export type {
  CredentialStore,
  GameEndpointPolicy,
  HttpEndpointPolicy,
  HttpMethod,
  HttpRequest,
  HttpResponse,
  HttpTransport,
  PlatformApiConfig,
  PlatformApiErrorOptions,
  PlatformLoginCredential,
} from './platform/contracts'
export { PlatformApiError } from './platform/contracts'
export { PlatformApiClient, XhrTransport } from './platform/client'
export { createHttpGateways } from './platform/factory'
