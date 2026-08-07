import { _decorator, Component, EventTarget } from 'cc'
import type { PlayerId } from '../core/generated'
import { QuickChatPolicy, type QuickChatBubble, type QuickChatDecision, type QuickChatPhrase } from './QuickChatPolicy'

export { QUICK_CHAT_PHRASES } from './QuickChatPolicy'
export type QuickChat = QuickChatBubble

const { ccclass } = _decorator

/** Local, short-lived table chat: mirrors the desktop shortcut-chat experience. */
@ccclass('ChatController')
export class ChatController extends Component {
  public readonly events = new EventTarget()
  private readonly policy = new QuickChatPolicy()
  private viewerId: PlayerId | null = null

  public send (playerId: PlayerId, phrase: QuickChatPhrase): QuickChatDecision {
    return this.show(playerId, phrase.text)
  }

  /** Incoming arbitrary text is rejected unless it matches the audited phrase list. */
  public show (playerId: PlayerId, message: string, _legacyVoice = ''): QuickChatDecision {
    const decision = this.policy.submit(playerId, message)
    if (decision.accepted) {
      this.events.emit('guandan:chat', decision.bubble)
      this.scheduleClear(decision.bubble)
    }
    return decision
  }

  public setViewer (viewerId: PlayerId): void { this.viewerId = viewerId }

  public get (playerId: PlayerId): QuickChat | undefined {
    return this.viewerId
      ? this.policy.getVisibleBubble(this.viewerId, playerId)
      : this.policy.getBubble(playerId)
  }

  public block (viewerId: PlayerId, senderId: PlayerId): void {
    this.viewerId = viewerId
    this.policy.block(viewerId, senderId)
    this.events.emit('guandan:chat', null)
  }

  public unblock (viewerId: PlayerId, senderId: PlayerId): void {
    this.viewerId = viewerId
    this.policy.unblock(viewerId, senderId)
    this.events.emit('guandan:chat', this.get(senderId) ?? null)
  }

  public isBlocked (viewerId: PlayerId, senderId: PlayerId): boolean {
    return this.policy.isBlocked(viewerId, senderId)
  }

  private scheduleClear (chat: QuickChat): void {
    const delaySeconds = Math.max(0, chat.expiresAt - Date.now()) / 1000
    this.scheduleOnce(() => {
      const remainingMs = chat.expiresAt - Date.now()
      if (remainingMs > 0) { this.scheduleClear(chat); return }
      if (this.policy.expire().includes(chat.playerId)) this.events.emit('guandan:chat', null)
    }, delaySeconds)
  }
}
