import { stateForViewer } from './game-session-projection.js'
import { DUPLICATE_SEATS, TABLE_SEATS, tableOf, globalSeat, localSeat, redSeat, occupant } from './duplicate-room-model.js'

export const duplicateSummary = (room, member) => ({
  phase: room.phase, mySeat: member.seat, watching: member.watch || null, round: room.completedRounds + (room.roundTallied ? 0 : 1),
  configuredRounds: room.settings.rounds, scores: { ...room.scores }, history: structuredClone(room.history),
  ready: Boolean(member.ready), canStart: room.phase === 'lobby' && DUPLICATE_SEATS.every(s => occupant(room, s)?.ready),
  tables: Object.fromEntries(['A', 'B'].map(t => [t, room.tables?.[t]?.state.phase || 'lobby'])),
  slots: DUPLICATE_SEATS.map(seat => {
    const m = occupant(room, seat)
    return { seat, table: tableOf(seat), direction: ['南', '东', '北', '西'][Number(localSeat(seat).slice(1)) - 1],
      team: redSeat(seat) ? 'red' : 'blue', name: m?.name || '', occupied: Boolean(m), ready: Boolean(m?.ready),
      bot: Boolean(m?.bot), online: Boolean(m?.bot || m?.connectionId), host: m?.userId === room.hostUserId }
  }),
})

/** No sibling-table state appears in a playing client's payload. */
export const duplicateSnapshot = (room, member, now) => {
  const home = tableOf(member.seat)
  const tableName = member.watch || home
  const observing = !member.seat || tableName !== home
  let viewer = localSeat(member.seat)
  if (observing && member.seat) viewer = TABLE_SEATS.find(s => redSeat(globalSeat(tableName, s)) === redSeat(member.seat))
  let table = room.tables?.[tableName]
  let publicRoom = room
  if (!member.seat && table) {
    const policy = room.settings.spectator
    if (policy !== 'live') {
      const delay = /^delay-\d+$/.test(policy) ? Number(policy.slice(6)) * 1000 : 0
      const history = room.observerFrames || []
      const frame = [...history].reverse().find(f => policy === 'delayed-round' ? room.phase === 'ended' || f.round < table.state.roundId : f.at <= now - delay)
      table = frame?.tables?.[tableName]
      publicRoom = { ...room, ...(frame?.publicState || { scores: { red: 0, blue: 0 }, history: [], completedRounds: 0, roundTallied: false, phase: 'playing' }), tables: frame?.tables }
    }
  }
  const state = table && stateForViewer(table.state, viewer)
  const tableMembers = TABLE_SEATS.filter(s => occupant(room, globalSeat(tableName, s))?.connectionId)
  const result = state?.settlement || null
  const scores = { teamA: publicRoom.scores.red, teamB: publicRoom.scores.blue }
  const metadata = {
    duplicate: duplicateSummary(publicRoom, member), roomId: room.roomId, myPlayerId: viewer,
    memberPlayerIds: tableMembers, roomRole: observing ? 'observer' : 'player', seatedPlayerId: member.seat ? localSeat(member.seat) : null,
    viewPlayerId: viewer, isRoomHost: room.hostUserId === member.userId, hostPlayerId: localSeat(room.members.find(m => m.userId === room.hostUserId)?.seat),
    observerWaiting: Boolean(room.tables && !table), observerClockAt: now, observers: room.members.filter(m => !m.seat && !m.left).map(m => ({ name: m.name, isHost: m.userId === room.hostUserId })),
    state: state || null, roundResult: result, tribute: null, phase: table ? state.phase === 'settled' ? 'settlement' : 'playing' : 'lobby',
    version: room.version, gameVersion: table?.state.revision || 0, entryKind: 'friend', roomSettings: room.settings,
    lobbyReadyRequired: true, lobbyReadyPlayerIds: TABLE_SEATS.filter(s => occupant(room, globalSeat(home, s))?.ready),
    roundReadyPlayerIds: TABLE_SEATS.filter(s => occupant(room, globalSeat(home, s))?.ready),
    gameStartPending: Boolean(room.pendingStart), capabilities: { canUseBots: true, canKickMembers: false, requiresLobbyReady: true },
    botPlayerIds: TABLE_SEATS.filter(s => occupant(room, globalSeat(tableName, s))?.bot),
    turnDeadlineAt: observing ? null : table?.deadlineAt || null, deadlinePlayerId: table?.state.currentTurn || null, deadlineAction: 'play',
    trustees: Object.fromEntries(TABLE_SEATS.filter(s => { const m = occupant(room, globalSeat(tableName, s)); return m?.trustee || !m?.connectionId }).map(s => [s, { reason: 'manual', since: now }])),
    consecutiveTimeouts: {}, dissolveVote: null, matchStartedAt: room.startedAt || null, totalDeadlineAt: room.totalDeadlineAt || null,
    matchEnded: publicRoom.phase === 'ended' ? { reason: publicRoom.endReason || 'round-limit', endedAt: publicRoom.endedAt, roundsPlayed: publicRoom.completedRounds,
      configuredRounds: room.settings.rounds, scores, winnerTeam: room.endReason === 'time-limit' || scores.teamA === scores.teamB ? null : scores.teamA > scores.teamB ? 'teamA' : 'teamB' } : null,
    scoreboard: null, viewerRoundStats: { bombsPlayed: 0 },
  }
  return metadata
}

export const captureDuplicateObservers = (room, now) => {
  if (!room.tables || room.settings.spectator === 'off' || room.settings.spectator === 'live') return
  room.observerFrames ||= []
  const last = room.observerFrames.at(-1)
  if (now - (last?.at || 0) < 1000 && last?.publicState?.phase === room.phase && last?.round === room.tables.A.state.roundId) return
  room.observerFrames.push({ at: now, round: room.tables.A.state.roundId, tables: structuredClone(room.tables), publicState: {
    scores: { ...room.scores }, history: structuredClone(room.history), completedRounds: room.completedRounds,
    roundTallied: room.roundTallied, phase: room.phase, endedAt: room.endedAt, endReason: room.endReason } })
  // Keep at most one minute plus one full previous-round snapshot; never substitute a live snapshot.
  const previousRound = room.observerFrames.filter(f => f.round < room.tables.A.state.roundId).at(-1)
  room.observerFrames = room.observerFrames.filter(f => f.at >= now - 65000 || f === previousRound)
}
