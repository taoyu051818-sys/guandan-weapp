const BASE64_URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const ENTRY_ATTEMPT_ID_PATTERN = /^[A-Za-z0-9_-]{22,128}$/

export type SecureRandomSource = Readonly<{
  getRandomValues: (target: Uint8Array) => Uint8Array
}>

export type EntryAttemptIdFactory = () => string

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
