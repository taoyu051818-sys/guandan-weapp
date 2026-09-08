import { FRIEND_SEATS } from './friend-room-members.js'

export const observerDelayMs = mode => ({ live: 0, 'delay-15': 15000, 'delay-30': 30000, 'delay-60': 60000 })[mode] ?? null

/** Private snapshots stay on the game server. Only a time-qualified, single-hand projection leaves it. */
export class FriendRoomObserverBuffer {
  constructor ({ now = () => Date.now(), maxSnapshots = 2048 } = {}) {
    this.now = now
    this.maxSnapshots = maxSnapshots
    this.histories = new WeakMap()
  }

  capture (room, payload) {
    if (!room.state || room.pendingGameStartEvent) return
    let history = this.histories.get(room)
    if (!history) { history = []; this.histories.set(room, history) }
    if (history.at(-1)?.version === room.version) return
    history.push({ at: this.now(), version: room.version, round: room.roundSequence || 1, payload: structuredClone(payload) })
    // A count ceiling is deliberate: if an unusually busy table exhausts history,
    // the viewer waits rather than receiving a newer, disallowed snapshot.
    while (history.length > this.maxSnapshots) history.shift()
    if (room.roomSettings.spectator !== 'delayed-round') {
      const cutoff = this.now() - 65000
      while (history.length > 1 && history[1].at <= cutoff) history.shift()
    }
  }

  project (room, playerId) {
    if (!FRIEND_SEATS.includes(playerId) || room.roomSettings?.spectator === 'off') return null
    const mode = room.roomSettings.spectator
    const delay = observerDelayMs(mode)
    if (delay === null && mode !== 'delayed-round') return null
    const history = this.histories.get(room) || []
    const eligible = history.filter(item => mode === 'delayed-round'
      ? item.round < (room.roundSequence || 1) || Boolean(room.matchEnded)
      : item.at <= this.now() - delay)
    const sample = eligible.at(-1)
    if (!sample) return null
    const payload = structuredClone(sample.payload)
    for (const seat of FRIEND_SEATS) {
      if (seat !== playerId) payload.state.players[seat].hand = payload.state.players[seat].hand.map((_, index) => ({ id: `hidden-${seat}-${index}` }))
    }
    // Tribute internals contain identities of cards that have not become public.
    if (payload.state.tribute) payload.state.tribute = null
    payload.tribute = null
    return { ...payload, observedAt: sample.at, observerClockAt: this.now() - (delay || 0) }
  }
}
