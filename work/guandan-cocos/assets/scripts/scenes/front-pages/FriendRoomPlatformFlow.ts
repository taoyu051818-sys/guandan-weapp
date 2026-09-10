import type {
  CreatedFriendRoomEntry,
  FriendRoomEntry,
  FriendRoomGateway,
} from '../../services/FrontPageGatewayContracts'
import type { FriendRoomSettings } from '../../network/LobbyModels'
import { FriendRoomReservationCleanup } from './FriendRoomReservationCleanup'

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
}>

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : '平台服务暂不可用，请稍后重试'

/** Owns authenticated friend-room async work and platform reservation compensation. */
export class FriendRoomPlatformFlow {
  private state: FriendRoomPlatformSnapshot = { busy: null, entry: null, inviteText: null }
  private generation = 0
  private destroyed = false
  private readonly reservations: FriendRoomReservationCleanup

  public constructor (private readonly dependencies: FriendRoomPlatformFlowDependencies) {
    this.reservations = new FriendRoomReservationCleanup(
      matchId => dependencies.gateway.cancel(matchId),
      () => {
        if (!this.destroyed && !dependencies.isDisposed()) dependencies.showNotice('好友房退出待重试', '平台暂未确认释放席位，再次返回大厅时会继续重试')
      },
    )
  }

  public get snapshot (): FriendRoomPlatformSnapshot { return { ...this.state } }

  public async create (settings: FriendRoomSettings): Promise<void> {
    await this.run('creating', () => this.dependencies.gateway.create(settings))
  }

  public async join (inviteText: string): Promise<void> {
    const normalized = inviteText.trim()
    await this.run('joining', () => this.dependencies.gateway.join(normalized), normalized)
  }

  public async joinRoomNumber (roomId: string): Promise<void> {
    await this.run('joining', () => this.dependencies.gateway.joinRoomNumber(roomId.trim()))
  }

  public leave (): void { this.clearAndCompensate() }

  public handleRoomClosed (): void { this.clearAndCompensate() }

  public handoffReservation (): void {
    if (this.state.entry) this.reservations.handoff(this.state.entry.matchId)
  }

  public restoreReservation (entry: FriendRoomEntry | CreatedFriendRoomEntry): void {
    if (this.destroyed || this.dependencies.isDisposed()) return
    this.generation += 1
    this.reservations.retain(entry.matchId)
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
    receivedInvite: string | null = null,
  ): Promise<void> {
    if (this.destroyed || this.dependencies.isDisposed()) return
    if (this.state.busy) {
      this.dependencies.showNotice('好友房请求处理中', '请等待当前操作完成')
      return
    }
    const generation = ++this.generation
    this.setState({ busy, entry: null, inviteText: null })
    const releasing = this.reservations.beginRequest()
    try {
      if (releasing) await releasing
      if (this.isCurrent(generation)) await this.resolveRequest(generation, busy, request, receivedInvite)
    } catch (error) {
      if (this.isCurrent(generation)) {
        this.setState({ busy: null, entry: null, inviteText: null })
        this.dependencies.showNotice('好友房退出待重试', errorMessage(error))
      }
    } finally {
      this.reservations.endRequest()
    }
  }

  private async resolveRequest (
    generation: number,
    busy: Exclude<FriendRoomPlatformBusyState, null>,
    request: () => Promise<FriendRoomEntry | CreatedFriendRoomEntry>,
    receivedInvite: string | null,
  ): Promise<void> {
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
      this.reservations.abandon(entry.matchId)
      return
    }
    this.reservations.retain(entry.matchId)
    const inviteText = 'inviteText' in entry ? entry.inviteText : receivedInvite
    this.setState({ busy: null, entry, inviteText })
    try {
      this.dependencies.enterMatchedRoom(entry)
    } catch (error) {
      this.state = { busy: null, entry: null, inviteText: null }
      this.dependencies.onChanged()
      this.reservations.release(entry.matchId)
      this.dependencies.showNotice('进入好友房失败', errorMessage(error))
    }
  }

  private clearAndCompensate (): void {
    const entry = this.state.entry
    const changed = Boolean(this.state.busy || entry || this.state.inviteText)
    this.generation += 1
    this.state = { busy: null, entry: null, inviteText: null }
    if (changed) this.dependencies.onChanged()
    if (entry) this.reservations.release(entry.matchId)
    this.reservations.retry()
  }

  private setState (state: FriendRoomPlatformSnapshot): void {
    this.state = state
    this.dependencies.onChanged()
  }

  private isCurrent (generation: number): boolean {
    return !this.destroyed && !this.dependencies.isDisposed() && generation === this.generation
  }
}
