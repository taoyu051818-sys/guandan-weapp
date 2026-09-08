import type { ShopProduct } from '../../services/FrontPageGatewayContracts'
import type { ScreenAdapter } from '../../ui/ScreenAdapter'
import type { PageRouter } from '../PageRouter'
import { renderProductPreview, renderShopPreview } from './CoastalPreviewPages'

export type ShopPageDependencies = {
  router: PageRouter
  screen: ScreenAdapter
  previewProducts?: readonly ShopProduct[]
  isDisposed: () => boolean
  issuePageRequest: () => number
  setTableVisible: (visible: boolean) => void
  showMenu: () => void
  showNotice: (title: string, detail?: string) => void
}

/** Read-only product previews: deliberately has no wallet or ordering capability. */
export class ShopPageDomain {
  private selectedProduct: ShopProduct | null = null
  public constructor (private readonly dependencies: ShopPageDependencies) {}

  public showPreview (): void {
    if (this.dependencies.isDisposed()) return
    this.selectedProduct = null
    this.dependencies.issuePageRequest()
    this.dependencies.setTableVisible(false)
    renderShopPreview(this.dependencies.router.open('shop'), this.dependencies.screen, (this.dependencies.previewProducts ?? []), this.dependencies.showMenu, product => {
      this.selectedProduct = product
      this.dependencies.issuePageRequest()
      this.renderPreviewProduct(product)
    })
  }

  private renderPreviewProduct (product: ShopProduct): void {
    renderProductPreview(this.dependencies.router.open('product'), this.dependencies.screen, product, () => this.showPreview(), () => {
      this.dependencies.showNotice('兑换功能开发中', '当前为示例商品，不会创建订单或扣除积分。')
    })
  }

  public reflow (): void {
    if (this.dependencies.isDisposed()) return
    if (this.dependencies.router.current === 'shop') this.showPreview()
    else if (this.dependencies.router.current === 'product' && this.selectedProduct) this.renderPreviewProduct(this.selectedProduct)
  }
}
