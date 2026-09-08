import type { HttpMethod, HttpRequest, HttpResponse, HttpTransport, PlatformApiConfig } from './contracts'
import { PlatformApiError } from './contracts'
import { malformedResponse, normalizeBaseUrl, requireRecord, unwrap } from './validation'
import { assertWechatTransportEndpoint } from '../WechatNetworkPolicy'

/** XMLHttpRequest is available in Cocos Web, native and WeChat adapters. */
export class XhrTransport implements HttpTransport {
  public request (input: HttpRequest): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
      assertWechatTransportEndpoint(input.url, 'https:')
      const xhr = new XMLHttpRequest()
      xhr.open(input.method, input.url, true)
      xhr.timeout = input.timeoutMs ?? 8000
      Object.entries(input.headers ?? {}).forEach(([name, value]) => xhr.setRequestHeader(name, value))
      xhr.onload = () => {
        let body: unknown = null
        try { body = xhr.responseText ? JSON.parse(xhr.responseText) : null } catch { body = xhr.responseText }
        resolve({ status: xhr.status, body })
      }
      xhr.onerror = () => reject(new PlatformApiError('无法连接平台服务', { code: 'NETWORK_ERROR', retryable: true }))
      xhr.ontimeout = () => reject(new PlatformApiError('平台服务响应超时', { code: 'REQUEST_TIMEOUT', retryable: true }))
      xhr.send(input.body === undefined ? null : JSON.stringify(input.body))
    })
  }
}

export class PlatformApiClient {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly loginTimeoutMs: number
  private volatileToken: string | null
  private loginPromise: Promise<string> | null = null
  private authGeneration = 0

  public constructor (
    private readonly transport: HttpTransport,
    private readonly config: PlatformApiConfig,
  ) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl, config.httpEndpointPolicy ?? 'secure-only')
    if (!this.baseUrl) throw new Error('平台服务地址不能为空')
    this.timeoutMs = config.timeoutMs ?? 8000
    this.loginTimeoutMs = config.loginTimeoutMs ?? this.timeoutMs
    this.volatileToken = config.accessToken?.trim() || config.credentialStore?.getAccessToken() || null
  }

  public async request<T> (path: string, method: HttpMethod = 'GET', body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const generation = this.authGeneration
    const token = await this.ensureAccessToken()
    this.assertCurrentLogin(generation)
    const response = await this.send(path, method, body, {
      Authorization: `Bearer ${token}`,
      ...headers,
    })
    this.assertCurrentLogin(generation)
    if (response.status !== 401) return unwrap<T>(response)
    const refreshedToken = await this.refreshAfterUnauthorized(token)
    this.assertCurrentLogin(generation)
    const retried = await this.send(path, method, body, { Authorization: `Bearer ${refreshedToken}`, ...headers })
    this.assertCurrentLogin(generation)
    return unwrap<T>(retried)
  }

  public signOut (): void {
    this.authGeneration += 1
    this.loginPromise = null
    this.clearAccessToken()
  }

  private async ensureAccessToken (): Promise<string> {
    if (this.volatileToken) return this.volatileToken
    if (this.loginPromise) return this.loginPromise
    const generation = this.authGeneration
    const activeLogin = this.login(generation)
    this.loginPromise = activeLogin
    try {
      return await activeLogin
    } finally {
      if (this.loginPromise === activeLogin) this.loginPromise = null
    }
  }

  /** Only the token that actually received a 401 may be cleared. Late 401s reuse an already-refreshed token. */
  private async refreshAfterUnauthorized (rejectedToken: string): Promise<string> {
    if (this.volatileToken && this.volatileToken !== rejectedToken) return this.volatileToken
    if (this.volatileToken === rejectedToken) this.clearAccessToken(rejectedToken)
    return this.ensureAccessToken()
  }

  private async login (generation: number): Promise<string> {
    const credential = this.config.loginProvider
      ? await this.loginCredentialWithTimeout(this.config.loginProvider)
      : this.config.allowDevelopmentLogin
        ? { kind: 'development' as const, deviceId: this.config.deviceId, displayName: this.config.displayName ?? '陵水玩家' }
        : null
    this.assertCurrentLogin(generation)
    if (!credential) throw new PlatformApiError('尚未登录平台服务', { code: 'AUTH_REQUIRED', retryable: false })
    const path = credential.kind === 'wechat' ? '/api/v1/auth/wx-login' : '/api/v1/auth/dev-login'
    const body = credential.kind === 'wechat'
      ? { code: credential.code, displayName: credential.displayName ?? this.config.displayName ?? '陵水玩家' }
      : { deviceId: credential.deviceId, displayName: credential.displayName }
    const response = await this.send(path, 'POST', body)
    this.assertCurrentLogin(generation)
    const payload = requireRecord(unwrap<unknown>(response), '登录响应')
    const rawToken = payload.accessToken ?? payload.token
    const token = typeof rawToken === 'string' ? rawToken.trim() : ''
    if (!token) throw malformedResponse('平台服务没有返回登录凭证')
    this.volatileToken = token
    this.config.credentialStore?.setAccessToken(token)
    return token
  }

  private loginCredentialWithTimeout (provider: NonNullable<PlatformApiConfig['loginProvider']>): Promise<Awaited<ReturnType<typeof provider>>> {
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (callback: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(watchdog)
        callback()
      }
      const watchdog = setTimeout(() => finish(() => reject(new PlatformApiError('登录授权响应超时', {
        code: 'LOGIN_PROVIDER_TIMEOUT',
        retryable: true,
      }))), this.loginTimeoutMs)
      void Promise.resolve()
        .then(provider)
        .then(
          credential => finish(() => resolve(credential)),
          error => finish(() => reject(error)),
        )
    })
  }

  private assertCurrentLogin (generation: number): void {
    if (generation === this.authGeneration) return
    throw new PlatformApiError('登录已取消', { code: 'AUTH_CANCELLED', retryable: false })
  }

  private clearAccessToken (expectedToken?: string): void {
    if (expectedToken !== undefined && this.volatileToken !== expectedToken) return
    this.volatileToken = null
    this.config.credentialStore?.clearAccessToken()
  }

  private async send (path: string, method: HttpMethod, body?: unknown, headers: Record<string, string> = {}): Promise<HttpResponse> {
    try {
      const defaultHeaders: Record<string, string> = { Accept: 'application/json' }
      if (method !== 'GET' && body !== undefined) defaultHeaders['Content-Type'] = 'application/json'
      return await this.transport.request({
        method,
        url: `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`,
        headers: { ...defaultHeaders, ...headers },
        body,
        timeoutMs: this.timeoutMs,
      })
    } catch (error) {
      if (error instanceof PlatformApiError) throw error
      throw new PlatformApiError(error instanceof Error ? error.message : '平台服务传输失败', {
        code: 'TRANSPORT_ERROR',
        details: error,
        retryable: true,
      })
    }
  }
}
