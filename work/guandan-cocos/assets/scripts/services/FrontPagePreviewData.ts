import type { PlayerDashboard, ShopProduct } from './FrontPageGatewayContracts'
import type { DataSnapshot } from './DataSnapshot'

/** Explicit non-authoritative preview data. Never used as fallback for failed production requests. */
export type FrontPagePreviewData = Readonly<{
  products: DataSnapshot<ShopProduct[]>
  dashboard: DataSnapshot<PlayerDashboard>
}>
