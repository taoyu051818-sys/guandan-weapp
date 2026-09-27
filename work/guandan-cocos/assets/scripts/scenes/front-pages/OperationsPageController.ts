import type { FrontPageGateways } from '../../services/FrontPageGatewayContracts'
import { FeedbackSubmission } from '../../services/FeedbackSubmission'
import type { FeedbackCategory, MessagePage, OperationsPage, PlayerFeedback, PlayerMessage } from '../../services/OperationsGatewayContracts'
import type { ScreenAdapter } from '../../ui/ScreenAdapter'
import type { PageRouter } from '../PageRouter'
import { OPERATIONS_PAGE_SIZE, type OperationsMode } from './OperationsPageModel'
import { renderOperationsPage, type OperationsPageActions } from './OperationsPageView'

type Ports = {
  router: PageRouter, gateways: FrontPageGateways, screen: ScreenAdapter,
  isDisposed: () => boolean, showMenu: () => void, setTableVisible: (visible: boolean) => void,
}
const emptyPage = <T>(): OperationsPage<T> => ({ items: [], page: 1, pageSize: OPERATIONS_PAGE_SIZE, total: 0 })

/** Owns only player operations state. Every async result and callback is scoped to the page lifetime. */
export class OperationsPageController {
  private mode: OperationsMode = 'messages'
  private messages: MessagePage = { ...emptyPage<PlayerMessage>(), unreadCount: 0 }
  private feedback = emptyPage<PlayerFeedback>()
  private selected: PlayerMessage | PlayerFeedback | null = null
  private detailOffset = 0
  private composing = false
  private loading = false
  private readonly reads = new Set<string>()
  private error = ''
  private status = ''
  private generation = 0
  private drawing = 0
  private hidden = true
  private closeInput: (() => void) | null = null
  private readonly draft = new FeedbackSubmission()

  public constructor (private readonly ports: Ports) {}

  public open (mode: OperationsMode): void {
    if (this.ports.isDisposed()) return
    this.generation += 1; this.hidden = false; this.mode = mode
    this.selected = null; this.detailOffset = 0; this.composing = false; this.loading = false; this.error = ''; this.status = ''
    this.messages = { ...emptyPage<PlayerMessage>(), unreadCount: 0 }; this.feedback = emptyPage<PlayerFeedback>()
    this.ports.setTableVisible(false)
    this.render(true)
    void this.load(1)
  }

  public suspend (): void {
    this.hidden = true; this.generation += 1; this.drawing += 1
    this.closeInput?.(); this.closeInput = null
    this.loading = false
  }

  public resume (): void {
    if (this.ports.isDisposed() || this.ports.router.current !== this.route) return
    this.hidden = false; this.generation += 1
    this.render()
    if (!this.composing && !this.selected) void this.load(this.page.page)
    else if (this.selected && this.mode === 'messages' && !(this.selected as PlayerMessage).read) void this.read(this.selected as PlayerMessage)
  }

  public reflow (): void { this.render() }
  public destroy (): void { this.suspend() }
  private get route (): 'operations-messages' | 'operations-feedback' { return this.mode === 'messages' ? 'operations-messages' : 'operations-feedback' }
  private get page () { return this.mode === 'messages' ? this.messages : this.feedback }
  private active (generation = this.generation): boolean {
    return !this.hidden && !this.ports.isDisposed() && this.ports.router.current === this.route && generation === this.generation
  }

  private async load (page: number): Promise<void> {
    if (!this.active() || this.loading) return
    const generation = this.generation
    this.loading = true; this.error = ''; this.render()
    try {
      const gateway = this.ports.gateways.operations
      if (!gateway || !this.ports.gateways.configured) throw new Error('尚未连接玩家服务，请返回大厅后重试。')
      const result = this.mode === 'messages' ? await gateway.listMessages(page, OPERATIONS_PAGE_SIZE) : await gateway.listFeedback(page, OPERATIONS_PAGE_SIZE)
      if (!this.active(generation)) return
      if (this.mode === 'messages') this.messages = result as MessagePage
      else this.feedback = result as OperationsPage<PlayerFeedback>
    } catch (error) {
      if (this.active(generation)) this.error = error instanceof Error ? error.message : '列表加载失败，请重试。'
    } finally {
      if (this.active(generation)) { this.loading = false; this.render() }
    }
  }

  private select (id: string): void {
    if (this.loading) return
    this.selected = (this.page.items as Array<PlayerMessage | PlayerFeedback>).find(item => item.id === id) ?? null
    this.detailOffset = 0
    this.error = ''; this.status = ''
    this.render()
    if (this.selected && this.mode === 'messages') void this.read(this.selected as PlayerMessage)
  }

  private async read (message: PlayerMessage): Promise<void> {
    if (!this.active() || message.read || this.reads.has(message.id)) return
    const gateway = this.ports.gateways.operations
    if (!gateway) return
    const generation = this.generation
    this.reads.add(message.id); this.error = ''; this.render()
    try {
      await gateway.readMessage(message.id)
      if (!this.active(generation)) return
      const current = this.messages.items.find(item => item.id === message.id)
      const alreadyCounted = current?.read === true
      message.read = true
      if (current) {
        current.read = true
        if (!alreadyCounted) this.messages.unreadCount = Math.max(0, this.messages.unreadCount - 1)
      } else void this.load(this.messages.page)
    } catch (error) {
      if (this.active(generation) && this.selected?.id === message.id) this.error = `已打开，但已读状态未保存：${error instanceof Error ? error.message : '请重试'}`
    } finally {
      this.reads.delete(message.id)
      if (this.active(generation) || (this.active() && this.mode === 'messages' && this.selected?.id === message.id)) this.render()
    }
  }

  private async submit (): Promise<void> {
    if (!this.active() || !this.composing || this.draft.busy) return
    this.error = this.draft.validate(); this.status = ''
    const gateway = this.ports.gateways.operations
    if (!gateway || !this.ports.gateways.configured) this.error = '尚未连接玩家服务，请返回大厅后重试。'
    if (this.error || !gateway) { this.render(); return }
    const generation = this.generation
    const submission = this.draft.submit(gateway)
    this.render()
    try {
      const result = await submission
      if (!result || !this.active(generation)) return
      this.composing = false; this.selected = result; this.detailOffset = 0; this.status = '反馈已提交，可在“我的反馈”查看回复。'
    } catch (error) {
      if (this.active(generation)) this.error = `${error instanceof Error ? error.message : '提交失败'}；可重试，重试不会重复提交。`
    } finally { if (this.active(generation) || (this.active() && this.mode === 'feedback' && this.composing)) this.render() }
  }

  private back (): void {
    if (this.selected || this.composing) {
      this.selected = null; this.composing = false; this.error = ''; this.status = ''; this.render()
      void this.load(this.page.page)
    } else { this.suspend(); this.ports.showMenu() }
  }

  private render (opening = false): void {
    if (!opening && !this.active()) return
    this.drawing += 1
    this.closeInput?.(); this.closeInput = null
    const drawing = this.drawing, generation = this.generation
    const guard = (callback: () => void) => () => { if (drawing === this.drawing && this.active(generation)) callback() }
    const actions: OperationsPageActions = {
      back: guard(() => this.back()), retry: guard(() => {
        if (this.selected && this.mode === 'messages') void this.read(this.selected as PlayerMessage)
        else void this.load(this.page.page)
      }),
      page: delta => guard(() => { void this.load(Math.max(1, Math.min(Math.ceil(this.page.total / OPERATIONS_PAGE_SIZE), this.page.page + delta))) })(),
      select: id => guard(() => this.select(id))(),
      scrollDetail: offset => guard(() => { if (Number.isFinite(offset)) this.detailOffset = Math.max(0, offset) })(),
      compose: guard(() => { if (!this.loading) { this.selected = null; this.composing = true; this.error = ''; this.status = ''; this.render() } }),
      mine: guard(() => { this.selected = null; this.composing = false; this.error = ''; this.status = ''; this.render(); void this.load(1) }),
      category: category => guard(() => { if (!this.draft.busy) { this.draft.category = category; this.render() } })(),
      content: content => guard(() => { if (!this.draft.busy) this.draft.content = content })(),
      validate: () => {
        if (drawing === this.drawing && this.active(generation) && !this.draft.busy) this.error = this.draft.validate()
        return this.error
      },
      submit: guard(() => { void this.submit() }),
    }
    this.closeInput = renderOperationsPage(this.ports.router.open(this.route), this.ports.screen.viewport, {
      mode: this.mode, messages: this.messages, feedback: this.feedback, selected: this.selected,
      composing: this.composing, loading: this.loading, reading: Boolean(this.selected && this.reads.has(this.selected.id)), submitting: this.draft.busy,
      error: this.error, status: this.status, category: this.draft.category as FeedbackCategory, content: this.draft.content, detailOffset: this.detailOffset,
    }, actions)
  }
}
