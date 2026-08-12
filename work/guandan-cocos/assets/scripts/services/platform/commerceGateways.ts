import type { ShopGateway, ShopOrder, ShopProduct, WalletGateway, WalletSnapshot } from '../FrontPageGatewayContracts'
import { PlatformApiClient } from './client'
import { PlatformApiError } from './contracts'
import { idempotencyKey, malformedResponse, nonNegativeNumber, requireArray, requireNonEmptyString, requireRecord } from './validation'

type RawProduct = Partial<ShopProduct> & {
  price?: number
  points?: number
  tag?: string
  availableStock?: number
}

const normalizeProduct = (product: RawProduct): ShopProduct => {
  const stock = nonNegativeNumber(product.stock ?? product.availableStock, '商品库存')
  if (!Number.isInteger(stock)) throw malformedResponse('商品库存必须是整数', { stock })
  return {
    id: String(product.id ?? ''),
    name: String(product.name ?? '未命名商品'),
    description: String(product.description ?? ''),
    category: String(product.category ?? product.tag ?? '生活'),
    pointsPrice: nonNegativeNumber(product.pointsPrice ?? product.points ?? product.price, '商品积分价格'),
    stock,
    imageUrl: product.imageUrl,
  }
}

export class HttpShopGateway implements ShopGateway {
  private readonly uncertainOrderKeys = new Map<string, string>()

  public constructor (private readonly client: PlatformApiClient) {}

  public async listProducts (): Promise<ShopProduct[]> {
    const payload = requireRecord(await this.client.request<unknown>('/api/v1/products'), '商品列表响应')
    return requireArray(payload.products, '商品列表').map((item, index) => {
      const product = normalizeProduct(requireRecord(item, `第 ${index + 1} 个商品`) as RawProduct)
      if (!product.id) throw malformedResponse(`第 ${index + 1} 个商品缺少 ID`)
      return product
    })
  }

  public async createOrder (productId: string, quantity: number, expectedPointsPrice?: number): Promise<ShopOrder> {
    const safeProductId = productId.trim()
    if (!safeProductId) throw new PlatformApiError('商品 ID 不能为空', { code: 'INVALID_ORDER', retryable: false })
    if (!Number.isInteger(quantity) || quantity <= 0) throw new PlatformApiError('商品数量必须是正整数', { code: 'INVALID_ORDER', retryable: false })
    if (expectedPointsPrice !== undefined && (!Number.isFinite(expectedPointsPrice) || expectedPointsPrice < 0)) {
      throw new PlatformApiError('预期商品积分价格不合法', { code: 'INVALID_ORDER', retryable: false })
    }
    const operation = `${safeProductId}\u0000${quantity}\u0000${expectedPointsPrice ?? ''}`
    const key = this.uncertainOrderKeys.get(operation) ?? idempotencyKey('shop')
    this.uncertainOrderKeys.set(operation, key)
    try {
      const payload = requireRecord(await this.client.request<unknown>('/api/v1/orders/redeem', 'POST', {
        productId: safeProductId,
        quantity,
        ...(expectedPointsPrice === undefined ? {} : { expectedPointsPrice }),
      }, { 'Idempotency-Key': key }), '订单响应')
      const order = requireRecord(payload.order, '订单')
      const status = order.status
      if (!['created', 'paid', 'cancelled', 'fulfilled'].includes(String(status))) throw malformedResponse('订单状态不合法', { status })
      const responseQuantity = nonNegativeNumber(order.quantity, '订单商品数量')
      if (!Number.isInteger(responseQuantity) || responseQuantity <= 0) throw malformedResponse('订单商品数量必须是正整数', { quantity: order.quantity })
      const result: ShopOrder = {
        orderId: requireNonEmptyString(order.orderId, '订单 ID'),
        productId: requireNonEmptyString(order.productId, '订单商品 ID'),
        quantity: responseQuantity,
        totalPoints: nonNegativeNumber(order.totalPoints, '订单总积分'),
        status: status as ShopOrder['status'],
      }
      if (this.uncertainOrderKeys.get(operation) === key) this.uncertainOrderKeys.delete(operation)
      return result
    } catch (error) {
      if (error instanceof PlatformApiError && error.status >= 400 && error.status < 500 && this.uncertainOrderKeys.get(operation) === key) {
        this.uncertainOrderKeys.delete(operation)
      }
      throw error
    }
  }
}

export class HttpWalletGateway implements WalletGateway {
  public constructor (private readonly client: PlatformApiClient) {}

  public async getWallet (): Promise<WalletSnapshot> {
    const payload = requireRecord(await this.client.request<unknown>('/api/v1/wallet'), '钱包响应')
    const wallet = requireRecord(payload.wallet, '钱包') as { balance?: number, points?: number, diamonds?: number }
    return {
      points: nonNegativeNumber(wallet.points ?? wallet.balance, '钱包积分余额'),
      diamonds: wallet.diamonds === undefined ? 0 : nonNegativeNumber(wallet.diamonds, '钱包钻石余额'),
    }
  }
}
