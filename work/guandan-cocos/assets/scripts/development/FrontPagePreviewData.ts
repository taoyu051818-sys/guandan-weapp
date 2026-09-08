import { SAMPLE_DASHBOARD, SAMPLE_PRODUCTS } from '../services/DevelopmentApis'
import type { FrontPagePreviewData } from '../services/FrontPagePreviewData'
import { snapshotData } from '../services/DataSnapshot'

/** Selected by the composition root, not imported by page domains or production gateways. */
export const createFrontPagePreviewData = (): FrontPagePreviewData => ({
  products: snapshotData(SAMPLE_PRODUCTS),
  dashboard: snapshotData(SAMPLE_DASHBOARD),
})
