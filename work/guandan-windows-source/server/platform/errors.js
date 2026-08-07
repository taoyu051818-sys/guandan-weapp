export class PlatformError extends Error {
  constructor (status, code, message, details = undefined) {
    super(message)
    this.name = 'PlatformError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export const badRequest = (code, message, details) => new PlatformError(400, code, message, details)
export const unauthorized = (message = '请先登录') => new PlatformError(401, 'UNAUTHORIZED', message)
export const forbidden = (message = '无权执行此操作') => new PlatformError(403, 'FORBIDDEN', message)
export const notFound = (code, message) => new PlatformError(404, code, message)
export const conflict = (code, message, details) => new PlatformError(409, code, message, details)
export const serviceUnavailable = (code, message) => new PlatformError(503, code, message)
