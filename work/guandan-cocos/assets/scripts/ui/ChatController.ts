import { _decorator, Component, EventTarget } from 'cc'
import type { PlayerId } from '../core/generated'

export const QUICK_CHAT_PHRASES = [
  { text: '快点啊，我等的花儿都谢了', voice: 'chat_hurry' },
  { text: '你是MM还是GG？', voice: 'chat_mmgg' },
  { text: '你的牌打得也太好了', voice: 'chat_good' },
  { text: '交个朋友吧', voice: 'chat_friend' },
  { text: '不要走，决战到天亮', voice: 'chat_stay' },
  { text: '风水轮流转，底裤都输穿', voice: 'chat_lose' },
] as const

export type QuickChat = { id: number, playerId: PlayerId, message: string, voice: string }

const { ccclass } = _decorator

/** Local, short-lived table chat: mirrors the desktop shortcut-chat experience. */
@ccclass('ChatController')
export class ChatController extends Component {
  public readonly events = new EventTarget()
  private messages = new Map<PlayerId, QuickChat>()
  private nextId = 1

  public send (playerId: PlayerId, phrase: typeof QUICK_CHAT_PHRASES[number]): void {
    this.show(playerId, phrase.text, phrase.voice)
  }

  public show (playerId: PlayerId, message: string, voice = ''): void {
    const chat: QuickChat = { id: this.nextId++, playerId, message, voice }
    this.messages.set(playerId, chat)
    this.events.emit('guandan:chat', chat)
    this.scheduleClear(chat)
  }

  public get (playerId: PlayerId): QuickChat | undefined { return this.messages.get(playerId) }

  private scheduleClear (chat: QuickChat): void {
    this.scheduleOnce(() => {
      if (this.messages.get(chat.playerId)?.id !== chat.id) return
      this.messages.delete(chat.playerId)
      this.events.emit('guandan:chat', null)
    }, 2.5)
  }
}
