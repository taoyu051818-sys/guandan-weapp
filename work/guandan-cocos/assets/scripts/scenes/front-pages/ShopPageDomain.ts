import { Node, Vec3 } from 'cc'
import type { FrontPageGateways, ShopProduct } from '../../services/FrontPageGatewayContracts'
import { SAMPLE_PRODUCTS } from '../../services/DevelopmentApis'
import type { ScreenAdapter } from '../../ui/ScreenAdapter'
import type { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'
import type { PageRouter } from '../PageRouter'
import type { FrontPageWalletState } from './FrontPageWalletState'

type RemoteDataState = 'development' | 'loading' | 'fresh' | 'empty' | 'stale' | 'unavailable'
type Settled<T> = { status: 'fulfilled', value: T } | { status: 'rejected', reason: unknown }
const settle = <T>(promise: Promise<T>): Promise<Settled<T>> => promise.then(
  value => ({ status: 'fulfilled', value }),
  reason => ({ status: 'rejected', reason }),
)

export type ShopPageDependencies = {
  router: PageRouter
  screen: ScreenAdapter
  gateways: FrontPageGateways
  wallet: FrontPageWalletState
  isDisposed: () => boolean
  issuePageRequest: () => number
  currentPageRequest: () => number
  setTableVisible: (visible: boolean) => void
  showMenu: () => void
  showNotice: (title: string, detail?: string) => void
}

/** Owns the shop catalog, product detail, and redemption transaction pages. */
export class ShopPageDomain {
  private pendingProductId: string | null = null
  private products: ShopProduct[]
  private dataState: RemoteDataState
  private statusText = ''
  private selectedProduct: ShopProduct | null = null

  public constructor (private readonly dependencies: ShopPageDependencies) {
    this.products = dependencies.gateways.configured ? [] : SAMPLE_PRODUCTS
    this.dataState = dependencies.gateways.configured ? 'loading' : 'development'
  }

  public show (): void {
    if (this.dependencies.isDisposed()) return
    const token = this.dependencies.issuePageRequest()
    this.dependencies.setTableVisible(false)
    if (this.dependencies.gateways.configured) {
      this.dataState = 'loading'
      this.dependencies.wallet.invalidate()
    }
    this.render(this.dependencies.gateways.configured ? '正在同步商品和积分…' : '示例商品 · 兑换接口开发中')
    if (this.dependencies.gateways.configured) void this.refresh(token)
  }

  private render (statusText: string): void {
    this.statusText = statusText
    this.selectedProduct = null
    const ui = this.dependencies.router.open('shop')
    ui.menuLabel('积分生活商城', 0, 225, 44)
    ui.menuLabel(statusText, 0, 175, 18)
    const safeWidth = this.dependencies.screen.safeSize().x
    const cardWidth = Math.min(220, Math.max(150, (safeWidth - 120) / 4))
    const gap = Math.min(22, Math.max(10, (safeWidth - cardWidth * 4) / 5))
    this.products.slice(0, 8).forEach((product, index) => {
      const column = index % 4
      const row = Math.floor(index / 4)
      const x = (column - 1.5) * (cardWidth + gap)
      const y = 75 - row * 130
      const stockText = product.stock > 0 ? `库存${product.stock}` : '已售罄'
      this.sizedButton(ui, `${product.category} · ${product.name}\n${product.pointsPrice}积分 · ${stockText}`, x, y, cardWidth, 106, 18, () => this.showProduct(product))
    })
    if (!this.products.length) ui.menuLabel(this.dataState === 'empty' ? '当前没有可兑换商品' : '商品目录暂时不可用', 0, 45, 24)
    this.pageButton(ui, '返回大厅', -205, this.dependencies.showMenu)
  }

  private async refresh (token: number): Promise<void> {
    const [productResult, walletResult] = await Promise.all([
      settle(this.dependencies.gateways.shop.listProducts()),
      settle(this.dependencies.gateways.wallet.getWallet()),
    ])
    if (!this.isCurrent(token, 'shop')) return
    if (productResult.status === 'fulfilled') {
      this.products = productResult.value
      this.dataState = this.products.length ? 'fresh' : 'empty'
    } else this.dataState = this.products.length ? 'stale' : 'unavailable'
    if (walletResult.status === 'fulfilled') this.dependencies.wallet.update(walletResult.value)
    else this.dependencies.wallet.invalidate()
    const catalogText = productResult.status === 'fulfilled'
      ? (this.products.length ? '商品已同步' : '暂无可兑换商品')
      : (this.products.length ? '商品同步失败，缓存仅供浏览' : '商城服务暂时不可用')
    const walletText = this.dependencies.wallet.fresh ? `当前 ${this.dependencies.wallet.value.points} 积分` : '积分暂时无法确认'
    this.render(`${catalogText} · ${walletText}`)
  }

  private showProduct (product: ShopProduct): void {
    if (this.dependencies.isDisposed()) return
    this.dependencies.issuePageRequest()
    this.selectedProduct = product
    this.renderProduct(product)
  }

  private renderProduct (product: ShopProduct): void {
    const ui = this.dependencies.router.open('product')
    ui.menuLabel(product.name, 0, 175, 42)
    ui.menuLabel(`${product.category}\n${product.description}\n${product.pointsPrice} 积分 · 库存 ${product.stock}`, 0, 65, 23)
    const canRedeem = this.dependencies.gateways.configured && this.dataState === 'fresh' && this.dependencies.wallet.fresh && product.stock > 0
    const actionText = !this.dependencies.gateways.configured ? '立即兑换 · 开发中' : product.stock <= 0 ? '商品已售罄' : canRedeem ? '立即兑换' : '刷新后兑换'
    this.pageButton(ui, actionText, -45, () => {
      if (canRedeem) void this.purchase(product)
      else this.dependencies.showNotice('暂时无法兑换', this.dependencies.gateways.configured ? '请返回商城刷新商品、库存与积分信息' : '商城后端接口正在开发中')
    })
    this.pageButton(ui, '返回商城', -120, () => this.show())
  }

  public reflow (): void {
    if (this.dependencies.isDisposed()) return
    if (this.dependencies.router.current === 'shop') this.render(this.statusText)
    else if (this.dependencies.router.current === 'product' && this.selectedProduct) this.renderProduct(this.selectedProduct)
  }

  private async purchase (product: ShopProduct): Promise<void> {
    if (this.dependencies.isDisposed() || this.pendingProductId) return
    const pageToken = this.dependencies.currentPageRequest()
    this.pendingProductId = product.id
    let orderId = ''
    try {
      const order = await this.dependencies.gateways.shop.createOrder(product.id, 1, product.pointsPrice)
      orderId = order.orderId
    } catch (error) {
      if (this.isCurrent(pageToken, 'product')) this.dependencies.showNotice('商城兑换失败', this.errorDetail(error, '请稍后重试'))
      if (this.pendingProductId === product.id) this.pendingProductId = null
      return
    }

    try {
      if (!this.isCurrent(pageToken, 'product')) return
      const [walletResult, productResult] = await Promise.all([
        settle(this.dependencies.gateways.wallet.getWallet()),
        settle(this.dependencies.gateways.shop.listProducts()),
      ])
      if (!this.isCurrent(pageToken, 'product')) return

      if (walletResult.status === 'fulfilled') this.dependencies.wallet.update(walletResult.value)
      else this.dependencies.wallet.invalidate()
      if (productResult.status === 'fulfilled') {
        this.products = productResult.value
        this.dataState = this.products.length ? 'fresh' : 'empty'
      } else this.dataState = this.products.length ? 'stale' : 'unavailable'

      const refreshFailures = [
        walletResult.status === 'rejected' ? '积分' : '',
        productResult.status === 'rejected' ? '商品库存' : '',
      ].filter(Boolean)
      const status = refreshFailures.length
        ? `兑换已提交 · ${refreshFailures.join('、')}待刷新`
        : `兑换成功 · 当前 ${this.dependencies.wallet.value.points} 积分`
      this.render(status)
      this.dependencies.showNotice(
        '兑换成功',
        refreshFailures.length
          ? `订单 ${orderId} 已成功提交；${refreshFailures.join('、')}刷新失败，重新进入商城后会自动同步。`
          : `订单 ${orderId} 已提交，商品与积分已同步。`,
      )
    } finally {
      if (this.pendingProductId === product.id) this.pendingProductId = null
    }
  }

  private isCurrent (token: number, page: 'shop' | 'product'): boolean {
    return !this.dependencies.isDisposed() && token === this.dependencies.currentPageRequest() && this.dependencies.router.current === page
  }

  private pageButton (ui: RuntimeUiFactory, text: string, y: number, action: () => void): Node {
    const node = ui.button('MenuButton', text, 0)
    node.setPosition(new Vec3(0, y, 0))
    node.on(Node.EventType.TOUCH_END, action)
    return node
  }

  private sizedButton (ui: RuntimeUiFactory, text: string, x: number, y: number, width: number, height: number, fontSize: number, action: () => void): Node {
    const node = ui.button('PageButton', text, x, width, height, fontSize)
    node.setPosition(new Vec3(x, y, 0))
    node.on(Node.EventType.TOUCH_END, action)
    return node
  }

  private errorDetail (error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback
  }
}
