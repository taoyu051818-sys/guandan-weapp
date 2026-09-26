import type { PlatformApiClient } from './client'
import type { LobbyServiceGateway, ServiceId, ServiceNotice } from '../OperationsGatewayContracts'
import { malformedResponse, nonNegativeInteger, positiveInteger, requireRecord } from './validation'

/** Server-owned availability copy; never infers an unopened status from a network failure. */
export class HttpLobbyServiceGateway implements LobbyServiceGateway {
  public constructor (private readonly client: PlatformApiClient) {}

  public async getNotice (id: ServiceId): Promise<ServiceNotice> {
    const data = requireRecord(await this.client.requestPublic<unknown>(`/api/v1/lobby/services/${encodeURIComponent(id)}`), '大厅服务状态')
    if (typeof data.title !== 'string' || !data.title.trim() || data.title.length > 40 ||
      typeof data.detail !== 'string' || data.detail.length > 300 || data.id !== id ||
      typeof data.status !== 'string' || !['open', 'closed', 'maintenance'].includes(data.status)) throw malformedResponse('大厅服务状态格式无效')
    return { id, status: data.status as ServiceNotice['status'], title: data.title, detail: data.detail,
      version: positiveInteger(data.version, '服务版本'), updatedAt: nonNegativeInteger(data.updatedAt, '服务更新时间') }
  }
}
