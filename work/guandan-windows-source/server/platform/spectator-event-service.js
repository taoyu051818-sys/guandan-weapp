import { canonicalJsonFingerprint as fingerprint, matchesJsonFingerprint } from './canonical-json.js'
import { conflict, forbidden } from './errors.js'
import { friendRoomKind } from './friend-room-service.js'
import { normalizeSpectatorEvent, validateSpectatorEventMatchTime } from './spectator-domain.js'
import { blockTournamentAssignment } from './tournament-orchestrator.js'
import { isFixedTournament, tournamentRunError } from './tournament-service.js'
import { ensureCollections } from './state-collections.js'
import { applyFriendRoomRoster } from './friend-room-roster.js'
import { validateFriendPersonalScores } from './friend-room-personal-scores.js'

/** Owns signed event ingestion and its single atomic transaction, never HTTP/WS transport. */
export class SpectatorEventService {
  constructor ({ store, now, markMatchPlaying, cancelExpiredFriendRoom, cancelExpiredUnstartedMatch, activeFriendTickets }) {
    Object.assign(this, { store, now, markMatchPlaying, cancelExpiredFriendRoom, cancelExpiredUnstartedMatch, activeFriendTickets })
  }

  async accept (eventId, rawEvent) {
    const now = this.now()
    const event = normalizeSpectatorEvent(eventId, rawEvent, now)
    const accepted = await this.store.transaction(state => {
      ensureCollections(state)
      const receiptMatch = state.matches[event.matchId]
      const fixedAssignmentEntryTimeout = Boolean(
        event.type === 'room-closed' &&
        event.reason === 'entry-timeout' &&
        receiptMatch?.tournamentId &&
        receiptMatch?.assignmentId
      )
      const previous = state.spectatorEventReceipts[eventId]
      if (previous) {
        if (!matchesJsonFingerprint(previous.fingerprint, event)) {
          if (fixedAssignmentEntryTimeout) {
            return {
              eventId,
              matchId: event.matchId,
              sequence: event.sequence,
              accepted: true,
              duplicate: true,
              ignored: true,
              assignmentRetained: true,
              processedAt: now,
            }
          }
          throw conflict('SPECTATOR_EVENT_ID_CONFLICT', '同一个观战事件ID不能对应不同内容')
        }
        const previousMatch = receiptMatch
        if (event.type === 'game-start' && previousMatch) {
          this.markMatchPlaying(state, previousMatch, event.at)
          const previousFeed = state.spectatorFeeds[event.matchId]
          if (previousFeed) previousFeed.gameStartedAt ||= event.at
        }
        return {
          eventId,
          matchId: event.matchId,
          sequence: event.sequence,
          accepted: true,
          duplicate: true,
          ignored: Boolean(previous.ignored),
          processedAt: previous.processedAt,
          ...(previous.seatRelease ? { seatRelease: structuredClone(previous.seatRelease) } : {}),
          ...(event.type === 'game-start' && previousMatch ? {
            lifecycleClaim: {
              accepted: true,
              status: previousMatch.status,
              startedAt: Number(previousMatch.startedAt || event.at),
            },
          } : {}),
        }
      }
      const match = receiptMatch
      if (!match || match.roomId !== event.roomId) throw forbidden('观战事件与已分配匹配不一致')
      validateSpectatorEventMatchTime(event, match)
      if (event.type === 'game-start' && (
        this.cancelExpiredFriendRoom(state, match, now) ||
        this.cancelExpiredUnstartedMatch(state, match, now)
      )) {
        return { lifecycleExpired: true, matchId: match.id, expiredAt: now }
      }
      const feed = state.spectatorFeeds[event.matchId]
      if (!feed) throw conflict('SPECTATOR_FEED_NOT_READY', '观战事件流尚未建立')
      if (
        event.type === 'room-closed' &&
        event.reason === 'entry-timeout' &&
        match.tournamentId &&
        match.assignmentId
      ) {
        // A fixed assignment survives credential expiry. The game server may
        // discard its incomplete local waiting room, but that is not a match
        // abort. Do not reserve this sequence/eventId: the recreated room starts
        // its public stream from sequence 1 and must be able to claim game-start.
        return {
          eventId,
          matchId: event.matchId,
          sequence: event.sequence,
          accepted: true,
          duplicate: false,
          ignored: true,
          assignmentRetained: true,
          processedAt: now,
        }
      }
      if (
        event.type === 'room-closed' &&
        event.reason === 'entry-timeout' &&
        match.status === 'cancelled' &&
        match.cancelReason === 'entry-expired' &&
        feed.abortedAt &&
        feed.abortReason === 'entry-timeout'
      ) {
        // Platform TTL sweeping and the game server's local room expiry race by
        // design. Once the platform terminal state wins, acknowledge the later
        // signed close so its durable outbox can drain without adding a fake event.
        const processedAt = now
        state.spectatorEventReceipts[eventId] = {
          eventId,
          matchId: event.matchId,
          sequence: event.sequence,
          fingerprint: fingerprint(event),
          processedAt,
          ignored: true,
        }
        return { eventId, matchId: event.matchId, sequence: event.sequence, accepted: true, duplicate: false, ignored: true, processedAt }
      }
      if (
        event.type === 'room-closed' &&
        match.kind === friendRoomKind &&
        ['cancelled', 'aborted', 'completed'].includes(match.status) &&
        (feed.abortedAt || feed.finishedAt)
      ) {
        const processedAt = now
        state.spectatorEventReceipts[eventId] = {
          eventId,
          matchId: event.matchId,
          sequence: event.sequence,
          fingerprint: fingerprint(event),
          processedAt,
          ignored: true,
        }
        return { eventId, matchId: event.matchId, sequence: event.sequence, accepted: true, duplicate: false, ignored: true, processedAt }
      }
      const waitingFriendRoomLifecycle = Boolean(
        match.kind === friendRoomKind &&
        match.status === 'matching' &&
        (event.type === 'seat-left' || event.type === 'room-closed' || (event.type === 'game-start' && event.friendRoster))
      )
      if (!waitingFriendRoomLifecycle && !['matched', 'playing', 'completed', 'aborted'].includes(match.status)) {
        throw conflict('MATCH_NOT_SPECTATABLE', '当前匹配不能写入观战事件')
      }
      let leavingParticipant = null
      let leavingParticipantWasActive = false
      if (event.type === 'seat-left') {
        if (match.kind !== friendRoomKind) throw conflict('FRIEND_SEAT_EVENT_REQUIRED', '只有好友房可以释放固定席位')
        if (!['matching', 'matched'].includes(match.status) && !(match.status === 'playing' && event.playerId === 'observer')) throw conflict('FRIEND_SEAT_LOCKED', '好友房已经开始或结束，不能释放席位')
        leavingParticipant = match.participants.find(participant => (
          (participant.seat === event.playerId || ((match.roomSettings?.spectator !== 'off' || match.roomSettings?.format === 'duplicate') && match.status !== 'playing')) &&
          participant.userId === event.userId
        ))
        leavingParticipantWasActive = Boolean(leavingParticipant && ['matching', 'matched', 'playing'].includes(leavingParticipant.status))
        const pendingCancellation = Boolean(
          leavingParticipant?.status === 'cancelled' &&
          leavingParticipant.cancellationRequestedAt &&
          !leavingParticipant.seatLifecycleConfirmedAt
        )
        if (!leavingParticipant || (!leavingParticipantWasActive && !pendingCancellation)) {
          throw conflict('FRIEND_SEAT_BINDING_MISMATCH', '离席事件与平台席位绑定不一致')
        }
      }
      let friendMatchEnd = null
      if (event.type === 'match-ended') {
        if (match.kind !== friendRoomKind) throw conflict('FRIEND_MATCH_END_REQUIRED', '只有好友房可以使用配置终局事件')
        if (match.status !== 'playing') throw conflict('FRIEND_MATCH_NOT_PLAYING', '好友房不在可结束的 playing 状态')
        if (Number.isFinite(Number(match.startedAt)) && event.endedAt < Number(match.startedAt)) {
          throw conflict('FRIEND_MATCH_END_BEFORE_START', '好友房结束时间不能早于平台确认的开局时间')
        }
        const configuredRounds = Number(match.roomSettings?.rounds)
        const totalTimeMinutes = Number(match.roomSettings?.totalTimeMinutes)
        validateFriendPersonalScores(match.roomSettings, event)
        const scoreWinner = event.scores.teamA === event.scores.teamB
          ? null
          : (event.scores.teamA > event.scores.teamB ? 'teamA' : 'teamB')
        if (event.reason === 'round-limit') {
          if (!Number.isSafeInteger(configuredRounds) || event.roundsPlayed !== configuredRounds) {
            throw conflict('FRIEND_ROUND_LIMIT_MISMATCH', '好友房完成局数与签名房间配置不一致')
          }
          if (event.winnerTeam !== scoreWinner) throw conflict('FRIEND_MATCH_WINNER_MISMATCH', '好友房胜方必须由最终比分确定')
        } else {
          if (!(totalTimeMinutes > 0)) throw conflict('FRIEND_TIME_LIMIT_DISABLED', '好友房未配置总时限')
          if (event.roundsPlayed > configuredRounds) throw conflict('FRIEND_MATCH_ROUNDS_EXCEEDED', '好友房已完成局数超过签名配置')
          if (event.winnerTeam !== null) throw conflict('FRIEND_TIME_LIMIT_MUST_DRAW', '中局总时限终局必须按 draw 上报')
          const earliestTimeLimitEnd = Number(match.startedAt) + totalTimeMinutes * 60_000
          if (!Number.isSafeInteger(earliestTimeLimitEnd) || event.endedAt < earliestTimeLimitEnd) {
            throw conflict('FRIEND_TIME_LIMIT_EARLY', '好友房尚未达到签名配置的总时限')
          }
        }
        friendMatchEnd = {
          reason: event.reason,
          scores: structuredClone(event.scores),
          roundsPlayed: event.roundsPlayed,
          endedAt: event.endedAt,
          winnerTeam: event.winnerTeam,
          ...(event.playerScores ? { playerScores: structuredClone(event.playerScores) } : {}),
        }
      }
      if (feed.abortedAt) throw conflict('SPECTATOR_FEED_ABORTED', '已终止牌桌不能继续写入观战事件')
      if (feed.finishedAt && event.type === 'room-closed') {
        // 正常结算后的全员离桌只是牌局服资源回收。确认回调以终止发送端重试，
        // 但不追加异常事件、不改变 finished 状态，也不触碰赛事/钱包数据。
        const processedAt = now
        state.spectatorEventReceipts[eventId] = { eventId, matchId: event.matchId, sequence: event.sequence, fingerprint: fingerprint(event), processedAt, ignored: true }
        return { eventId, matchId: event.matchId, sequence: event.sequence, accepted: true, duplicate: false, ignored: true, processedAt }
      }
      // 结算回调和公开事件使用两条独立异步通道。结算可能先到，因此允许牌局实际
      // 结束时间附近、序号连续的尾部公开动作补写；但正常完成后不能改判为 aborted。
      if (feed.finishedAt && event.at > feed.finishedAt + 60_000) throw conflict('SPECTATOR_FEED_FINISHED', '已结算牌桌不能写入该观战事件')
      const expectedSequence = (feed.events.at(-1)?.sequence || 0) + 1
      if (event.sequence !== expectedSequence) throw conflict('SPECTATOR_EVENT_OUT_OF_ORDER', '观战事件序号不连续', { expectedSequence, receivedSequence: event.sequence })
      if (feed.finishedAt && Number.isSafeInteger(feed.finalSpectatorSequence)) {
        if (event.sequence > feed.finalSpectatorSequence) {
          throw conflict('SPECTATOR_EVENT_AFTER_FINAL', '观战事件超过结算声明的最终序号', {
            finalSpectatorSequence: feed.finalSpectatorSequence,
            receivedSequence: event.sequence,
          })
        }
        if (event.sequence === feed.finalSpectatorSequence && (event.type !== 'round-end' || event.isGameWon !== true)) {
          throw conflict('INVALID_FINAL_SPECTATOR_EVENT', '结算声明的最终观战事件必须是获胜局 round-end')
        }
      }
      if (feed.events.length >= 100_000) throw conflict('SPECTATOR_FEED_LIMIT', '单桌观战事件数量已达上限')
      const { friendRoster, ...publicEvent } = event
      feed.events.push(structuredClone(publicEvent))
      if (event.type === 'game-start') {
        applyFriendRoomRoster(match, friendRoster)
        this.markMatchPlaying(state, match, event.at)
        feed.gameStartedAt ||= event.at
      }
      if (event.type === 'match-ended') {
        feed.matchEnd = structuredClone(friendMatchEnd)
        feed.finalSpectatorSequence = event.sequence
        match.friendMatchEnd = structuredClone(friendMatchEnd)
        if (event.reason === 'round-limit') {
          feed.finishedAt = event.endedAt
          feed.abortedAt = null
          feed.abortReason = null
          match.status = 'completed'
          match.completedAt = event.endedAt
          match.completionReason = event.reason
          match.participants.forEach(participant => {
            if (!['matching', 'matched', 'playing'].includes(participant.status)) return
            participant.status = 'completed'
            participant.completedAt = event.endedAt
            if (state.activeMatchByUser[participant.userId] === match.id) delete state.activeMatchByUser[participant.userId]
          })
        } else {
          feed.abortedAt = event.endedAt
          feed.abortReason = event.reason
          match.status = 'aborted'
          match.abortedAt = event.endedAt
          match.abortReason = event.reason
          match.participants.forEach(participant => {
            if (!['matching', 'matched', 'playing'].includes(participant.status)) return
            participant.status = 'aborted'
            participant.abortedAt = event.endedAt
            if (state.activeMatchByUser[participant.userId] === match.id) delete state.activeMatchByUser[participant.userId]
          })
        }
      }
      let seatRelease = null
      if (event.type === 'seat-left') {
        const revokedTickets = this.activeFriendTickets(leavingParticipant, now)
        seatRelease = {
          playerId: event.playerId,
          userId: event.userId,
          revokedTicketJti: leavingParticipant.claims?.jti || null,
          revokedTicketExp: Number(leavingParticipant.claims?.exp) || null,
          revokedTickets,
        }
        leavingParticipant.status = 'cancelled'
        leavingParticipant.cancelledAt = event.at
        leavingParticipant.leaveReason = event.reason
        leavingParticipant.ticketRevokedAt = event.at
        leavingParticipant.seatLifecycleConfirmedAt = event.at
        leavingParticipant.revokedTicketJti = leavingParticipant.claims?.jti || null
        leavingParticipant.revokedTicketExpiresAt = Number(leavingParticipant.expiresAt) || null
        delete leavingParticipant.gameTicket
        delete leavingParticipant.joinToken
        delete leavingParticipant.gameEndpoint
        delete leavingParticipant.expiresAt
        delete leavingParticipant.claims
        delete leavingParticipant.cancellationRequestedAt
        if (state.activeMatchByUser[event.userId] === match.id) delete state.activeMatchByUser[event.userId]
        if (event.reason === 'kicked') {
          match.bannedUserIds ||= []
          if (!match.bannedUserIds.includes(event.userId)) match.bannedUserIds.push(event.userId)
        }
        if (leavingParticipantWasActive && match.status === 'matched') {
          match.status = 'matching'
          delete match.matchedAt
        }
      }
      if (event.type === 'room-closed') {
        feed.abortedAt = event.at
        feed.abortReason = event.reason
        feed.finalSpectatorSequence = event.sequence
        match.status = 'aborted'
        match.abortedAt = event.at
        match.abortReason = event.reason
        match.participants.forEach(participant => {
          participant.status = 'aborted'
          participant.abortedAt = event.at
          if (state.activeMatchByUser[participant.userId] === match.id) delete state.activeMatchByUser[participant.userId]
        })
        const tournament = match.tournamentId ? state.tournaments[match.tournamentId] : null
        if (tournament && isFixedTournament(tournament) && match.assignmentId) {
          try {
            state.tournamentRuns[tournament.id] = blockTournamentAssignment(
              state.tournamentRuns[tournament.id],
              match.assignmentId,
              match.id,
              `牌桌异常终止：${event.reason}`,
              event.at,
            )
          } catch (error) {
            tournamentRunError(error)
          }
        }
      }
      const settledResultId = state.gameResultByMatch?.[event.matchId]
      const replay = settledResultId ? state.replays[`rpl_${settledResultId}`] : null
      if (replay) replay.events = feed.events.map(item => structuredClone(item))
      const processedAt = now
      state.spectatorEventReceipts[eventId] = {
        eventId,
        matchId: event.matchId,
        sequence: event.sequence,
        fingerprint: fingerprint(event),
        processedAt,
        ...(seatRelease ? { seatRelease: structuredClone(seatRelease) } : {}),
      }
      return {
        eventId,
        matchId: event.matchId,
        sequence: event.sequence,
        accepted: true,
        duplicate: false,
        processedAt,
        ...(seatRelease ? { seatRelease } : {}),
        ...(event.type === 'game-start' ? {
          lifecycleClaim: {
            accepted: true,
            status: match.status,
            startedAt: Number(match.startedAt || event.at),
          },
        } : {}),
      }
    })
    if (accepted.lifecycleExpired) {
      throw conflict('MATCH_ENTRY_EXPIRED', '牌桌入桌时限已过，平台已取消整桌；牌局服不得开始发牌', {
        matchId: accepted.matchId,
        expiredAt: accepted.expiredAt,
      })
    }
    return accepted
  }

}
