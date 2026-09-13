import { PlatformService } from './service.js'
import { MemoryPlatformStore, createEmptyPlatformState } from './storage.js'
import { AccessTokenService, GameTicketService } from './crypto.js'

// No environment, disk store, server listener or external fetch is used here.
export const lifecycleTestSecret = 'platform-lifecycle-synthetic-test-only-secret'
export const lifecycleSeats = ['p1', 'p2', 'p3', 'p4']
export const activeParticipant = p => ['matching', 'matched', 'playing'].includes(p.status)
class FaultStore extends MemoryPlatformStore {
  async persist () {
    if (this.failNext) { this.failNext = false; throw new Error('synthetic persist failure') }
  }
}
export const lifecycleFixture = (userCount = 16) => {
  let now = 1_800_000_000_000, serial = 0, room = 650000
  const seed = createEmptyPlatformState()
  for (let i = 0; i < userCount; i++) {
    const id = `u${i}`
    seed.users[id] = { id, displayName: id }
    seed.wallets[id] = { userId: id, balance: 1000, currency: 'points' }
  }
  let store = new FaultStore(seed), service, issued = 0
  const tickets = new GameTicketService({ secret: lifecycleTestSecret, now: () => now,
    gameEndpoint: 'ws://127.0.0.1:1/not-connected' })
  const issue = tickets.issue.bind(tickets)
  tickets.issue = input => { issued++; return issue(input) }
  const bind = () => {
    service = new PlatformService({ store, gameTickets: tickets, now: () => now,
      accessTokens: new AccessTokenService({ secret: lifecycleTestSecret, now: () => now }),
      createId: () => `lifecycle-${++serial}`, createRoomId: () => String(++room),
      createInviteCode: () => `lifecycle-invite-${String(++serial).padStart(10, '0')}`,
      createEntryAttemptId: () => `lifecycle-attempt-${String(++serial).padStart(10, '0')}` })
  }
  bind()
  return { get store () { return store }, get service () { return service }, tickets,
    get issued () { return issued }, now: () => now, setTime: value => { now = value },
    snapshot: () => store.read(s => s),
    restart: async () => { store = new FaultStore(await store.read(s => s)); bind() } }
}
export const createLifecycleFriendRoom = async (f, roomSettings = {}) => {
  const host = await f.service.createFriendRoom('u0', {
    entryAttemptId: 'lifecycle-host-attempt-00001', roomSettings: { spectator: 'live', ...roomSettings },
  })
  let sequence = 0
  const event = detail => ({ eventId: `spectate:${host.matchId}:${++sequence}`, matchId: host.matchId,
    roomId: host.roomId, sequence, roundSequence: 1, at: f.now(), ...detail })
  const accept = detail => { const e = event(detail); return f.service.acceptSpectatorEvent(e.eventId, e) }
  const join = (i, attempt = 1, byNumber = false) => f.service[byNumber ? 'joinFriendRoomByNumber' : 'joinFriendRoom'](`u${i}`, {
    roomId: host.roomId, inviteCode: host.inviteCode, entryAttemptId: `lifecycle-guest-${i}-attempt-${attempt}-0000`,
  })
  const leave = async (i, reason = 'left') => {
    const seat = await f.store.read(s => s.matches[host.matchId].participants.find(p => p.userId === `u${i}`).seat)
    return accept({ type: 'seat-left', playerId: seat, userId: `u${i}`, reason })
  }
  const start = async () => {
    const roster = await f.store.read(s => Object.fromEntries(s.matches[host.matchId].participants
      .filter(p => activeParticipant(p) && /^p[1-8]$/.test(p.seat)).map(p => [p.seat, p.userId])))
    await accept({ type: 'game-start', friendRoster: roster })
    return roster
  }
  return { host, join, leave, start, event, accept }
}
