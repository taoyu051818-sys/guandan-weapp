/** Own the exact JSON DTO that is persisted, signed and retried, never the caller's mutable object. */
export const snapshotReportEvent = event => JSON.parse(JSON.stringify(event))

export const requireResultAcknowledgement = (ack, event) => {
  if (!ack || ack.accepted !== true || ack.eventId !== event.eventId) {
    throw new Error('结算回调未确认当前事件')
  }
  return ack
}

export const requireSpectatorAcknowledgement = (ack, event) => {
  if (!ack || ack.accepted !== true || ack.eventId !== event.eventId ||
      ack.matchId !== event.matchId || ack.sequence !== event.sequence) {
    throw new Error('观战回调未确认当前事件')
  }
  return ack
}
