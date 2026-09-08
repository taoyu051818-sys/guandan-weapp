import { Color, Graphics, Node } from 'cc'
import type { ShopProduct } from '../../services/FrontPageGatewayContracts'
import { coastalButton, coastalText } from '../../ui/CoastalUi'
import type { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'
import type { ScreenAdapter } from '../../ui/ScreenAdapter'

const ink = new Color(27, 76, 95)
const muted = new Color(76, 117, 131)

const frame = (ui: RuntimeUiFactory, screen: ScreenAdapter, title: string, subtitle: string, back: () => void, backLabel = '返回大厅'): { width: number, height: number } => {
  const size = screen.safeSize()
  const width = Math.min(1060, size.x - 64)
  const height = Math.min(530, size.y - 42)
  ui.panel('FeatureSurface', 0, 0, width, height, { fill: new Color(17, 52, 72, 247), stroke: new Color(109, 160, 181), lineWidth: 1, radius: 26 })
  coastalText(ui, title, 0, height / 2 - 48, width - 270, 52, 34, { bold: true })
  coastalText(ui, subtitle, 0, height / 2 - 92, width - 64, 38, 21, { color: new Color(168, 204, 218) })
  coastalButton(ui, backLabel, 0, -height / 2 + 45, 210, 56, back)
  return { width, height }
}

/** Preview renderers have no gateway/wallet dependency: browsing cannot create orders or enrollments. */
export const renderShopPreview = (ui: RuntimeUiFactory, screen: ScreenAdapter, products: readonly ShopProduct[], back: () => void, select: (product: ShopProduct) => void): void => {
  const { width, height } = frame(ui, screen, '积分生活商城', '商品示例 · 兑换功能开发中，不扣除积分', back)
  const items = ['tissue', 'detergent', 'towel'].map(id => products.find(item => item.id === id)).filter((item): item is ShopProduct => Boolean(item))
  const gap = 18
  const cardWidth = (width - 72 - gap * 2) / 3
  const cardHeight = Math.min(286, height - 208)
  items.forEach((product, index) => {
    const card = ui.panel(`PreviewProduct-${product.id}`, (index - 1) * (cardWidth + gap), -5, cardWidth, cardHeight, {
      fill: new Color(226, 242, 245), stroke: new Color(251, 249, 226), lineWidth: 1, radius: 18,
    })
    drawProduct(card, product.id, cardHeight * .19)
    coastalText(ui, product.name, 0, -cardHeight * .17, cardWidth - 20, 38, 27, { parent: card, color: ink, bold: true })
    coastalText(ui, `示例 ${product.pointsPrice} 积分`, 0, -cardHeight * .33, cardWidth - 20, 32, 22, { parent: card, color: muted })
    ui.makeInteractive(card, () => select(product), .98)
  })
}

const drawProduct = (parent: Node, id: string, y: number): void => {
  const node = new Node('ProductIllustration')
  node.parent = parent
  node.setPosition(0, y, 0)
  const g = node.addComponent(Graphics)
  g.fillColor = new Color(93, 178, 194)
  g.strokeColor = new Color(255, 255, 244)
  g.lineWidth = 3
  if (id === 'detergent') {
    g.roundRect(-28, -42, 56, 72, 12); g.fill(); g.stroke()
    g.fillColor = new Color(36, 98, 122); g.roundRect(-17, 30, 34, 15, 4); g.fill()
    g.fillColor = new Color(244, 247, 218); g.roundRect(-21, -20, 42, 34, 6); g.fill()
  } else if (id === 'tissue') {
    g.roundRect(-48, -30, 96, 55, 12); g.fill(); g.stroke()
    g.fillColor = new Color(255, 254, 238); g.moveTo(-14, 25); g.lineTo(-20, 57); g.lineTo(10, 52); g.lineTo(20, 25); g.close(); g.fill()
  } else {
    for (let row = 0; row < 3; row++) {
      g.fillColor = new Color(119 + row * 32, 187 + row * 14, 192 + row * 10)
      g.roundRect(-49, -30 + row * 20, 98, 25, 8); g.fill(); g.stroke()
    }
  }
}

export const renderProductPreview = (ui: RuntimeUiFactory, screen: ScreenAdapter, product: ShopProduct, back: () => void, notice: () => void): void => {
  const { width, height } = frame(ui, screen, product.name, '示例商品详情 · 尚未开放兑换', back, '返回商城')
  drawProduct(ui.parent, product.id, 60)
  coastalText(ui, product.description, 0, -8, width - 90, 54, 24)
  coastalText(ui, `示例兑换价 ${product.pointsPrice} 积分 · 规格以上线信息为准`, 0, -60, width - 90, 42, 21)
  coastalButton(ui, '兑换 · 开发中', 0, -height / 2 + 120, 250, 56, notice, true)
}
