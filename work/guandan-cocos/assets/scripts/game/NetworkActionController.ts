export type NetworkActionAvailability = Readonly<{
  connected: boolean
  roomId: string | null
  roomStatus: string
}>

export type NetworkActionResult = Readonly<{
  ok: boolean
  requestId: number | null
  requestType: string | null
  message: string
}>

export type NetworkActionScheduleOnce = (callback: () => void, delaySeconds: number) => void

/** Owns one in-flight client intent and rejects late timeout/result callbacks. */
export class NetworkActionController {
  private generation = 0
  private requestId: number | null = null
  private requestType: string | null = null
  public pending = false

  public constructor (
    private readonly scheduleOnce: NetworkActionScheduleOnce,
    private readonly publishHint: (hint: string) => void,
  ) {}

  public begin (
    availability: NetworkActionAvailability,
    hint: string,
    requestType: string,
    submit: () => number | null,
  ): boolean {
    if (!availability.connected || !availability.roomId || availability.roomStatus !== 'ready') {
      this.publishHint(availability.roomStatus === 'rejoining' ? '正在恢复房间，请稍后操作' : '网络未连接，请稍后重试')
      return false
    }
    const generation = ++this.generation
    this.pending = true
    this.requestId = null
    this.requestType = requestType
    this.publishHint(hint)
    const requestId = submit()
    if (requestId === null) {
      this.fail('操作未发送，请检查网络后重试')
      return false
    }
    this.requestId = requestId
    this.scheduleOnce(() => {
      if (this.pending && generation === this.generation) this.fail('服务器响应超时，请重试')
    }, 8)
    return true
  }

  public applyResult (result: NetworkActionResult): void {
    if (!this.pending || result.ok) return
    const sameType = result.requestType === this.requestType
    const sameRequest = this.requestId === null
      ? result.requestId === null && sameType
      : result.requestId === this.requestId
    if (sameRequest) this.fail(result.message || '服务器拒绝了操作，请重试')
  }

  public fail (message: string): void {
    this.cancel()
    this.publishHint(message || '网络操作失败，请重试')
  }

  public cancel (): void {
    this.generation += 1
    this.pending = false
    this.requestId = null
    this.requestType = null
  }
}
