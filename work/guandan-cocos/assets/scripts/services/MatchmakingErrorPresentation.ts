import { PlatformApiError } from './PlatformApi'

/** Safe user-facing errors, shared by matching retry and return flows. */
export const matchErrorDetail = (error: unknown): string => {
  if (error instanceof PlatformApiError) {
    if (error.status === 401 || error.status === 403) return '登录状态已失效，请重新进入游戏'
    if (error.status === 429) return '当前匹配请求较多，请稍后重试'
    if (error.retryable) return '匹配服务暂时不可用，请稍后重试'
    if (error.code === 'MATCH_TICKET_EXPIRED') return '本次匹配凭证已过期，请重新匹配'
    if (error.code === 'INSUFFICIENT_CLASSIC_STAKE') {
      const details = error.details && typeof error.details === 'object' ? error.details as Record<string, unknown> : null
      const required = details && typeof details.required === 'number' && Number.isFinite(details.required)
        ? Math.max(0, Math.round(details.required)) : null
      return required === null ? '积分不足，无法进入该场' : `积分不足：进入该场至少需要 ${required} 积分`
    }
  }
  if (error instanceof Error && error.message.includes('功能正在开发中')) return '比赛匹配服务暂未开放'
  return '请稍后重试'
}
