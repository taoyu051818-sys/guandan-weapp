export class LobbyCleanupTracker {
  private readonly requestRooms = new Map<number, string>()
  private readonly roomIds = new Set<string>()

  public consumeResult (requestId: number): boolean {
    const roomId = this.requestRooms.get(requestId)
    if (!roomId) return false
    this.finish(requestId, roomId)
    return true
  }

  public isCleaning (roomId: string): boolean { return this.roomIds.has(roomId) }

  public request (
    roomId: string,
    send: (roomId: string) => number,
    schedule: (callback: () => void) => void,
  ): void {
    try {
      const requestId = send(roomId)
      this.requestRooms.set(requestId, roomId)
      this.roomIds.add(roomId)
      schedule(() => this.finish(requestId, roomId))
    } catch {
      // Socket disconnect cleanup remains best-effort.
    }
  }

  private finish (requestId: number, roomId: string): void {
    if (this.requestRooms.get(requestId) !== roomId) return
    this.requestRooms.delete(requestId)
    if (![...this.requestRooms.values()].includes(roomId)) this.roomIds.delete(roomId)
  }
}
