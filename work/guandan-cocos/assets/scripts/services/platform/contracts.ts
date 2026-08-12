export type HttpMethod = 'GET' | 'POST' | 'DELETE'

export type HttpRequest = {
  method: HttpMethod
  url: string
  headers?: Record<string, string>
  body?: unknown
  timeoutMs?: number
}

export type HttpResponse = { status: number, body: unknown }

export interface HttpTransport {
  request(input: HttpRequest): Promise<HttpResponse>
}

export interface CredentialStore {
  getAccessToken(): string | null
  setAccessToken(token: string): void
  clearAccessToken(): void
}

export type GameEndpointPolicy = 'secure-only' | 'allow-localhost-insecure' | 'allow-insecure'
export type HttpEndpointPolicy = 'secure-only' | 'allow-localhost-insecure' | 'allow-insecure'

export type PlatformApiConfig = {
  baseUrl: string
  deviceId: string
  displayName?: string
  credentialStore?: CredentialStore
  accessToken?: string
  timeoutMs?: number
  /** Bounds native login providers independently from the HTTP request timeout. */
  loginTimeoutMs?: number
  allowDevelopmentLogin?: boolean
  loginProvider?: () => Promise<PlatformLoginCredential>
  gameEndpointPolicy?: GameEndpointPolicy
  httpEndpointPolicy?: HttpEndpointPolicy
}

export type PlatformLoginCredential =
  | { kind: 'wechat', code: string, displayName?: string }
  | { kind: 'development', deviceId: string, displayName: string }

export type PlatformApiErrorOptions = {
  status?: number
  code?: string
  details?: unknown
  retryable?: boolean
}

export const isRetryableStatus = (status: number): boolean => status === 0 || status === 408 || status === 425 || status === 429 || status >= 500

export class PlatformApiError extends Error {
  public readonly status: number
  public readonly code: string
  public readonly details?: unknown
  public readonly retryable: boolean

  public constructor (message: string, options: PlatformApiErrorOptions = {}) {
    super(message)
    this.name = 'PlatformApiError'
    this.status = options.status ?? 0
    this.code = options.code ?? 'PLATFORM_API_ERROR'
    this.details = options.details
    this.retryable = options.retryable ?? isRetryableStatus(this.status)
  }
}
