import type {
  CreatedFriendRoomEntry,
  FriendRoomEntry,
  FriendRoomGateway,
} from '../../services/FrontPageGatewayContracts'
import type { FriendRoomSettings } from '../../network/LobbyModels'

export type FriendRoomPlatformBusyState = 'creating' | 'joining' | null
export type FriendRoomPlatformSnapshot = Readonly<{
  busy: FriendRoomPlatformBusyState
  entry: FriendRoomEntry | null
  inviteText: string | null
}>

export type FriendRoomPlatformFlowDependencies = Readonly<{
  gateway: FriendRoomGateway
  isDisposed: () => boolean
  enterMatchedRoom: (entry: FriendRoomEntry) => void
  showNotice: (title: string, detail?: string) => void
  onChanged: () => void
  copyText: (text: string) => Promise<void>
}>

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : '平台服务暂不可用，请稍后重试'

/** Owns authenticated friend-room async work and platform reservation compensation. */
export class FriendRoomPlatformFlow {
  private state: FriendRoomPlatformSnapshot = { busy: null, entry: null, inviteText: null }
  private generation = 0
  private destroyed = false
  private reservationHandedOff = false
  private readonly pendingCancellations = new Set<string>()
  private readonly cancellationRequests = new Set<string>()

  public constructor (private readonly dependencies: FriendRoomPlatformFlowDependencies) {}

  public get snapshot (): FriendRoomPlatformSnapshot { return { ...this.state } }

  public async create (settings: FriendRoomSettings): Promise<void> {
    await this.run('creating', () => this.dependencies.gateway.create(settings))
  }

  public async join (inviteText: string): Promise<void> {
    const normalized = inviteText.trim()
    await this.run('joining', () => this.dependencies.gateway.join(normalized))
  }

  public async copyInvite (): Promise<void> {
    const inviteText = this.state.inviteText
    if (!inviteText) {
      this.dependencies.showNotice('邀请口令尚未生成', '请等待房间创建完成后再分享')
      return
    }
    const generation = this.generation
    try {
      await this.dependencies.copyText(inviteText)
      if (this.isCurrent(generation)) this.dependencies.showNotice('完整邀请口令已复制', '可直接粘贴给好友加入')
    } catch (error) {
      if (this.isCurrent(generation)) this.dependencies.showNotice('复制失败', errorMessage(error))
    }
  }

  public leave (): void { this.clearAndCompensate() }

  public handleRoomClosed (): void { this.clearAndCompensate() }

  public handoffReservation (): void {
    if (this.state.entry) this.reservationHandedOff = true
  }

  public restoreReservation (entry: FriendRoomEntry | CreatedFriendRoomEntry): void {
    if (this.destroyed || this.dependencies.isDisposed()) return
    this.generation += 1
    this.reservationHandedOff = false
    this.setState({ busy: null, entry, inviteText: 'inviteText' in entry && typeof entry.inviteText === 'string' ? entry.inviteText : null })
  }

  public destroy (): void {
    if (this.destroyed) return
    this.clearAndCompensate()
    this.destroyed = true
  }

  private async run (
    busy: Exclude<FriendRoomPlatformBusyState, null>,
    request: () => Promise<FriendRoomEntry | CreatedFriendRoomEntry>,
  ): Promise<void> {
    if (this.destroyed || this.dependencies.isDisposed()) return
    if (this.state.busy) {
      this.dependencies.showNotice('好友房请求处理中', '请等待当前操作完成')
      return
    }
    const generation = ++this.generation
    this.reservationHandedOff = false
    this.setState({ busy, entry: null, inviteText: null })
    let entry: FriendRoomEntry | CreatedFriendRoomEntry
    try {
      entry = await request()
    } catch (error) {
      if (this.isCurrent(generation)) {
        this.setState({ busy: null, entry: null, inviteText: null })
        this.dependencies.showNotice(busy === 'creating' ? '创建好友房失败' : '加入好友房失败', errorMessage(error))
      }
      return
    }
    if (!this.isCurrent(generation)) {
      this.cancelBestEffort(entry.matchId)
      return
    }
    const inviteText = 'inviteText' in entry ? entry.inviteText : null
    this.setState({ busy: null, entry, inviteText })
    try {
      this.dependencies.enterMatchedRoom(entry)
    } catch (error) {
      this.state = { busy: null, entry: null, inviteText: null }
      this.dependencies.onChanged()
      this.cancelBestEffort(entry.matchId)
      this.dependencies.showNotice('进入好友房失败', errorMessage(error))
    }
  }

  private clearAndCompensate (): void {
    const entry = this.state.entry
    const shouldCompensate = Boolean(entry && !this.reservationHandedOff)
    const changed = Boolean(this.state.busy || entry || this.state.inviteText)
    this.generation += 1
    this.state = { busy: null, entry: null, inviteText: null }
    this.reservationHandedOff = false
    if (changed) this.dependencies.onChanged()
    if (entry && shouldCompensate) this.cancelBestEffort(entry.matchId)
    this.pendingCancellations.forEach(matchId => this.cancelBestEffort(matchId))
  }

  private cancelBestEffort (matchId: string): void {
    if (!matchId) return
    this.pendingCancellations.add(matchId)
    if (this.cancellationRequests.has(matchId)) return
    this.cancellationRequests.add(matchId)
    void this.dependencies.gateway.cancel(matchId).then(
      () => { this.pendingCancellations.delete(matchId) },
      () => {
        if (!this.destroyed && !this.dependencies.isDisposed()) this.dependencies.showNotice('好友房退出待重试', '平台暂未确认释放席位，再次返回大厅时会继续重试')
      },
    ).finally(() => { this.cancellationRequests.delete(matchId) })
  }

  private setState (state: FriendRoomPlatformSnapshot): void {
    this.state = state
    this.dependencies.onChanged()
  }

  private isCurrent (generation: number): boolean {
    return !this.destroyed && !this.dependencies.isDisposed() && generation === this.generation
  }
}
