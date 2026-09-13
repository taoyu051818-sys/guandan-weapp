import { conflict, forbidden } from './errors.js'

const seats = ['p1', 'p2', 'p3', 'p4']
export const isActiveMatchParticipant = participant => ['matching', 'matched', 'playing'].includes(participant.status)

export const assertFriendRoomMemberCapacity = match => {
  if (match.participants.filter(isActiveMatchParticipant).length >= 12) throw conflict('FRIEND_ROOM_FULL', '房间人数已满')
}

/** Confirmed departures retain seat history, but never participate in settlement.
 * Keep terminal participants eligible for the existing close/result delivery race.
 * An ambiguous live roster is invalid, not last-write-wins by array ordering. */
export const resultParticipantsBySeat = match => {
  const participants = match.participants.filter(p => p.status !== 'cancelled' && seats.includes(p.seat))
  if (participants.length !== 4 || new Set(participants.map(p => p.seat)).size !== 4 || new Set(participants.map(p => p.userId)).size !== 4) {
    throw forbidden('结算席位分配不完整或存在重复席位')
  }
  return Object.fromEntries(participants.map(p => [p.seat, p.userId]))
}
