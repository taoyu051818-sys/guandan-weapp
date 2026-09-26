import type { Node } from 'cc'
import { lobbyArtwork } from './LobbyMenuView'
import type { LobbyServiceId } from './LobbyServicePolicy'

/** Official Phosphor Fill 2.1.1, MIT. Offline exports preserve the source geometry.
 * Reuse the artwork loader's cancellation and SpriteFrame cleanup on page destruction. */
export function drawLobbyServiceIcon (parent: Node, id: LobbyServiceId, scale: number): void {
  lobbyArtwork(parent, 'ServiceIcon', `ui/lobby-services/${id}/texture`, {
    x: 0, y: 8 * scale, width: 36 * scale, height: 36 * scale,
  })
}
