import type { HttpEndpointPolicy, HttpResponse } from './contracts'
import { isRetryableStatus, PlatformApiError } from './contracts'

type ApiEnvelope<T> = {
  ok?: boolean
  data?: T
  error?: string | { code?: string, message?: string, details?: unknown, retryable?: boolean } | null
  message?: string
}

export const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const isLocalHostname = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return normalized === 'localhost' || normalized === '::1' || /^127(?:\.\d{1,3}){3}$/.test(normalized)
}

export const normalizeBaseUrl = (value: string, policy: HttpEndpointPolicy): string => {
  const normalized = value.trim().replace(/\/+$/, '')
  let parsed: URL
  try { parsed = new URL(normalized) } catch { throw new Error('平台服务地址不是有效 URL') }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) throw new Error('平台服务地址必须是不含凭证的 HTTP/HTTPS URL')
  if (parsed.protocol === 'http:' && policy === 'secure-only') throw new Error('生产环境平台服务必须使用 HTTPS')
  if (parsed.protocol === 'http:' && policy === 'allow-localhost-insecure' && !isLocalHostname(parsed.hostname)) throw new Error('非本机平台服务必须使用 HTTPS')
  return normalized
}

const responseError = (body: unknown, status: number, fallback: string): PlatformApiError => {
  const envelope = isRecord(body) ? body as ApiEnvelope<unknown> : undefined
  const rawError = envelope?.error
  const objectError = isRecord(rawError) ? rawError : undefined
  const message = typeof rawError === 'string'
    ? rawError
    : typeof objectError?.message === 'string'
      ? objectError.message
      : typeof envelope?.message === 'string'
        ? envelope.message
        : fallback
  return new PlatformApiError(message, {
    status,
    code: typeof objectError?.code === 'string' && objectError.code.trim() ? objectError.code : `HTTP_${status}`,
    details: objectError?.details,
    retryable: typeof objectError?.retryable === 'boolean' ? objectError.retryable : isRetryableStatus(status),
  })
}

export const unwrap = <T>(response: HttpResponse): T => {
  if (response.status < 200 || response.status >= 300) throw responseError(response.body, response.status, `平台服务请求失败（${response.status}）`)
  if (isRecord(response.body) && ('ok' in response.body || 'data' in response.body)) {
    const envelope = response.body as ApiEnvelope<T>
    if (envelope.ok === false) throw responseError(response.body, response.status, '平台服务拒绝了请求')
    if (envelope.data !== undefined) return envelope.data
    throw new PlatformApiError('平台服务返回了缺少 data 的响应', { status: response.status, code: 'MALFORMED_RESPONSE', retryable: false })
  }
  return response.body as T
}

export const malformedResponse = (message: string, details?: unknown): PlatformApiError => new PlatformApiError(message, {
  status: 200,
  code: 'MALFORMED_RESPONSE',
  details,
  retryable: false,
})

export const nonNegativeNumber = (value: unknown, context: string): number => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') throw malformedResponse(`${context}不合法`, { value })
  const normalized = Number(value)
  if (!Number.isFinite(normalized) || normalized < 0) throw malformedResponse(`${context}不合法`, { value })
  return normalized
}

export const finiteNumber = (value: unknown, context: string): number => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') throw malformedResponse(`${context}不合法`, { value })
  const normalized = Number(value)
  if (!Number.isFinite(normalized)) throw malformedResponse(`${context}不合法`, { value })
  return normalized
}

export const requireRecord = (value: unknown, context: string): Record<string, unknown> => {
  if (!isRecord(value)) throw malformedResponse(`${context}格式不正确`)
  return value
}

export const requireArray = (value: unknown, context: string): unknown[] => {
  if (!Array.isArray(value)) throw malformedResponse(`${context}格式不正确`)
  return value
}

export const requireNonEmptyString = (value: unknown, context: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw malformedResponse(`${context}不能为空`)
  return value.trim()
}

export const requireAccountId = (value: unknown, context: string): string => {
  const accountId = requireNonEmptyString(value, context)
  if (!/^\d{8}$/.test(accountId)) throw malformedResponse(`${context}必须为八位数字`, { value })
  return accountId
}

export const requireBoolean = (value: unknown, context: string): boolean => {
  if (typeof value !== 'boolean') throw malformedResponse(`${context}必须是布尔值`, { value })
  return value
}

export const nonNegativeInteger = (value: unknown, context: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw malformedResponse(`${context}必须是非负整数`, { value })
  return value
}

export const positiveInteger = (value: unknown, context: string): number => {
  const normalized = nonNegativeInteger(value, context)
  if (normalized <= 0) throw malformedResponse(`${context}必须是正整数`, { value })
  return normalized
}

export const idempotencyKey = (prefix: string): string => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`
