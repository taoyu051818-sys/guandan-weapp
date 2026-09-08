import type { ShopProduct } from '../../assets/scripts/services/FrontPageGatewayContracts'
export type ShopOrder = {
  orderId: string
  productId: string
  quantity: number
  totalPoints: number
  status: 'created' | 'paid' | 'cancelled' | 'fulfilled'
}

export interface ShopGateway {
  listProducts(): Promise<ShopProduct[]>
  createOrder(productId: string, quantity: number, expectedPointsPrice?: number): Promise<ShopOrder>
}
