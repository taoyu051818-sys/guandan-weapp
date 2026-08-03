import { _decorator, Component, EventTarget } from 'cc'
import type { PlayerId } from '../core/generated'
import { GameSession } from '../session/GameSession'
import { CocosSocketClient } from './CocosSocketClient'

export type NetworkRoom = { roomId: string, hostName: string, playerCount: number }
export type LobbySnapshot = { connected: boolean, rooms: NetworkRoom[], roomId: string | null, members: PlayerId[], myPlayerId: PlayerId | null, error: string | null }
type Wire<T> = { type: string } & T

const { ccclass, property } = _decorator

/** Cocos counterpart of the desktop Lobby page, using the raw WebSocket protocol. */
@ccclass('LobbyController')
export class LobbyController extends Component {
  @property(GameSession)
  public session: GameSession | null = null

  public readonly events = new EventTarget()
  public snapshot: LobbySnapshot = { connected: false, rooms: [], roomId: null, members: [], myPlayerId: null, error: null }
  private readonly client = new CocosSocketClient()
  private endpoint = ''

  protected onLoad (): void {
    if (!this.session) this.session = this.getComponent(GameSession)
    this.client.on('connected', () => { this.patch({ connected: true, error: null }); this.refreshRooms() })
    this.client.on('disconnected', () => this.patch({ connected: false }))
    this.client.on('error', (message: Wire<{ message?: string }>) => this.patch({ error: message.message ?? '网络错误' }))
    this.client.on('roomList', (message: Wire<{ rooms?: NetworkRoom[] }>) => this.patch({ rooms: message.rooms ?? [] }))
    this.client.on('roomCreated', (message: Wire<{ roomId: string, myPlayerId: PlayerId }>) => this.enterRoom(message.roomId, message.myPlayerId, ['p1']))
    this.client.on('roomJoined', (message: Wire<{ roomId: string, myPlayerId: PlayerId }>) => this.enterRoom(message.roomId, message.myPlayerId, this.snapshot.members))
    this.client.on('roomRejoined', (message: Wire<{ roomId: string, myPlayerId: PlayerId }>) => this.enterRoom(message.roomId, message.myPlayerId, this.snapshot.members))
    this.client.on('roomMembers', (message: Wire<{ memberPlayerIds?: PlayerId[] }>) => this.patch({ members: message.memberPlayerIds ?? [] }))
    this.client.on('gameState', () => this.session?.beginNetworkGrouping())
  }

  public connect (endpoint: string): void {
    if (this.snapshot.connected && endpoint === this.endpoint) return
    this.endpoint = endpoint
    void this.client.connect(endpoint).catch(error => this.patch({ connected: false, error: error instanceof Error ? error.message : '无法连接服务器' }))
  }

  public refreshRooms (): void { this.send('listRooms') }
  public createRoom (hostName = '玩家'): void { this.send('createRoom', { roomId: String(Math.floor(100000 + Math.random() * 900000)), hostName }) }
  public joinRoom (roomId: string): void { if (!/^\d{6}$/.test(roomId)) return this.patch({ error: '房间号必须为六位数字' }); this.send('joinRoom', { roomId }) }
  public startGame (): void { if (!this.snapshot.roomId) return; this.send('startGame', { roomId: this.snapshot.roomId }) }
  public leaveRoom (): void { if (this.snapshot.roomId) this.send('leaveRoom', { roomId: this.snapshot.roomId }); this.patch({ roomId: null, members: [], myPlayerId: null }); this.session?.leaveToMenu() }

  protected onDestroy (): void { this.client.close() }

  private send (type: string, payload?: unknown): void { try { this.client.send(type, payload) } catch (error) { this.patch({ error: error instanceof Error ? error.message : '网络未连接' }) } }
  private enterRoom (roomId: string, myPlayerId: PlayerId, members: PlayerId[]): void { this.patch({ roomId, myPlayerId, members, error: null }); this.session?.joinRoom(roomId) }
  private patch (next: Partial<LobbySnapshot>): void { this.snapshot = { ...this.snapshot, ...next }; this.events.emit('guandan:lobby', this.snapshot) }
}
