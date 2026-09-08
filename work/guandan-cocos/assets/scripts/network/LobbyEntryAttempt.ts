const BASE64_URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const ENTRY_ATTEMPT_ID_PATTERN = /^[A-Za-z0-9_-]{22,128}$/

export type SecureRandomSource = Readonly<{
  getRandomValues: (target: Uint8Array) => Uint8Array
}>

export type EntryAttemptIdFactory = () => string
export type AsyncEntryAttemptIdFactory = () => string | Promise<string>

type NativeRandomSource = Readonly<{
  getRandomValues: (options: { length: number, success: (result: { randomValues: ArrayBuffer }) => void, fail: () => void }) => void
}>

const defaultRandomSource = (): SecureRandomSource => {
  const source = (globalThis as typeof globalThis & { crypto?: SecureRandomSource }).crypto
  if (!source?.getRandomValues) throw new Error('当前运行环境不支持加密安全随机数')
  return source
}

const encodeBase64Url = (bytes: Uint8Array): string => {
  let encoded = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]
    const second = bytes[index + 1]
    const third = bytes[index + 2]
    encoded += BASE64_URL_ALPHABET[first >> 2]
    encoded += BASE64_URL_ALPHABET[((first & 3) << 4) | ((second ?? 0) >> 4)]
    if (second !== undefined) encoded += BASE64_URL_ALPHABET[((second & 15) << 2) | ((third ?? 0) >> 6)]
    if (third !== undefined) encoded += BASE64_URL_ALPHABET[third & 63]
  }
  return encoded
}

/** Creates a 128-bit, unpadded base64url key for one logical room-entry attempt. */
export const createEntryAttemptId = (source: SecureRandomSource = defaultRandomSource()): string => {
  const bytes = new Uint8Array(16)
  source.getRandomValues(bytes)
  return encodeBase64Url(bytes)
}

/** WeChat Mini Game exposes callback-based crypto, not the browser Web Crypto API. */
export const createEntryAttemptIdAsync = async (): Promise<string> => {
  const runtime = globalThis as typeof globalThis & {
    wx?: { getUserCryptoManager?: () => NativeRandomSource, getRandomValues?: NativeRandomSource['getRandomValues'] }
  }
  const wx = runtime.wx
  const native = wx?.getUserCryptoManager?.() ?? (wx?.getRandomValues ? wx as NativeRandomSource : undefined)
  if (!native?.getRandomValues) return createEntryAttemptId()
  return new Promise<string>((resolve, reject) => {
    let settled = false
    const finish = (id?: string, message?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (id) resolve(id)
      else reject(new Error(message))
    }
    const timeout = setTimeout(() => finish(undefined, '安全随机数生成超时，请重试'), 5000)
    try {
      native.getRandomValues({
        length: 16,
        success: result => {
          try {
            const buffer = result?.randomValues
            if (Object.prototype.toString.call(buffer) !== '[object ArrayBuffer]' || buffer.byteLength !== 16) {
              finish(undefined, '安全随机数返回无效，请重试')
              return
            }
            finish(encodeBase64Url(new Uint8Array(buffer)))
          } catch { finish(undefined, '安全随机数返回无效，请重试') }
        },
        fail: () => finish(undefined, '安全随机数生成失败，请重试'),
      })
    } catch { finish(undefined, '安全随机数生成失败，请重试') }
  })
}

export const isEntryAttemptId = (value: unknown): value is string => (
  typeof value === 'string' && ENTRY_ATTEMPT_ID_PATTERN.test(value)
)

/** Separates one-shot manual entries from retryable platform-matched entries. */
export class LobbyEntryAttemptTracker {
  private matchedAttemptId: string | null = null

  public constructor (private readonly createId: EntryAttemptIdFactory = createEntryAttemptId) {}

  public decorate (payload: Record<string, unknown>, reuseMatchedAttempt: boolean): Record<string, unknown> {
    if (Object.prototype.hasOwnProperty.call(payload, 'entryAttemptId')) {
      if (!isEntryAttemptId(payload.entryAttemptId)) throw new Error('入桌随机凭证格式无效')
      if (reuseMatchedAttempt) {
        if (this.matchedAttemptId && this.matchedAttemptId !== payload.entryAttemptId) throw new Error('入桌随机凭证不能在重试中变更')
        this.matchedAttemptId = payload.entryAttemptId
      }
      return { ...payload, entryAttemptId: payload.entryAttemptId }
    }
    const entryAttemptId = reuseMatchedAttempt
      ? this.matchedAttemptId ?? (this.matchedAttemptId = this.nextId())
      : this.nextId()
    return { ...payload, entryAttemptId }
  }

  public clearMatched (): void { this.matchedAttemptId = null }

  private nextId (): string {
    const entryAttemptId = this.createId()
    if (!isEntryAttemptId(entryAttemptId)) throw new Error('入桌随机凭证格式无效')
    return entryAttemptId
  }
}
