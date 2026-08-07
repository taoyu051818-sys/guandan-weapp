import { Node, Tween, UITransform } from 'cc'
import { RuntimeUiFactory } from '../ui/RuntimeUiFactory'

export type FrontPageId =
  | 'menu' | 'more' | 'online' | 'classic-rooms' | 'friend-room-settings' | 'competition' | 'tournament-flow' | 'tournament-standings' | 'matching'
  | 'shop' | 'product' | 'settings' | 'lobby'
  | 'player-center' | 'season-tasks' | 'replay-list' | 'replay-detail'
  | 'spectator-list' | 'spectator-feed'
  | 'merchant-console' | 'merchant-apply' | 'merchant-store' | 'merchant-employee' | 'merchant-grant'
  | 'effect-lab'

/** Owns the lifetime of the single front-page tree shown above the backdrop. */
export class PageRouter {
  private readonly layer: Node
  private pageRoot: Node | null = null
  private modalRoot: Node | null = null
  private currentPage: FrontPageId | null = null

  public constructor (
    root: Node,
    private readonly onPageChange?: (previous: FrontPageId | null, next: FrontPageId | null) => void,
  ) {
    this.layer = new Node('FrontPageLayer')
    this.layer.parent = root
    this.layer.addComponent(UITransform).setContentSize(1280, 720)
  }

  public get current (): FrontPageId | null { return this.currentPage }

  public open (page: FrontPageId): RuntimeUiFactory {
    const previous = this.currentPage
    if (previous !== page) this.onPageChange?.(previous, page)
    this.destroyModalRoot()
    this.destroyPageRoot()
    const pageRoot = new Node(`Page-${page}`)
    pageRoot.parent = this.layer
    pageRoot.addComponent(UITransform).setContentSize(1280, 720)
    this.pageRoot = pageRoot
    this.currentPage = page
    return new RuntimeUiFactory(pageRoot)
  }

  /** Opens a transient layer without replacing the page below it. */
  public openModal (name: string): RuntimeUiFactory {
    this.destroyModalRoot()
    const modalRoot = new Node(`Modal-${name}`)
    modalRoot.parent = this.layer
    const size = this.layer.getComponent(UITransform)?.contentSize
    modalRoot.addComponent(UITransform).setContentSize(size?.width ?? 1280, size?.height ?? 720)
    this.modalRoot = modalRoot
    return new RuntimeUiFactory(modalRoot)
  }

  public closeModal (): void { this.destroyModalRoot() }

  public clear (): void {
    const previous = this.currentPage
    if (previous !== null) this.onPageChange?.(previous, null)
    this.destroyModalRoot()
    this.destroyPageRoot()
    this.currentPage = null
  }

  private destroyPageRoot (): void {
    if (this.pageRoot?.isValid) {
      this.pageRoot.active = false
      this.stopTweens(this.pageRoot)
      this.pageRoot.destroy()
    }
    this.pageRoot = null
  }

  public resize (width: number, height: number): void {
    this.layer.getComponent(UITransform)?.setContentSize(width, height)
    this.pageRoot?.getComponent(UITransform)?.setContentSize(width, height)
    this.modalRoot?.getComponent(UITransform)?.setContentSize(width, height)
  }

  public destroy (): void {
    this.clear()
    if (this.layer.isValid) this.layer.destroy()
  }

  private stopTweens (node: Node): void {
    Tween.stopAllByTarget(node)
    node.children.forEach(child => this.stopTweens(child))
  }

  private destroyModalRoot (): void {
    if (this.modalRoot?.isValid) {
      this.modalRoot.active = false
      this.stopTweens(this.modalRoot)
      this.modalRoot.destroy()
    }
    this.modalRoot = null
  }
}
