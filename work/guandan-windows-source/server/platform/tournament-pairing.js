import { createHash } from 'node:crypto'

export const FIXED_LATIN_PLAYER_COUNT = 16
export const FIXED_LATIN_ROUND_COUNT = 3
export const FIXED_LATIN_TABLE_COUNT = 4
export const FIXED_LATIN_PLAYERS_PER_TABLE = 4

const validateUserIds = (userIds) => {
  if (!Array.isArray(userIds)) throw new TypeError('赛事编排需要 userIds 数组')
  if (userIds.length !== FIXED_LATIN_PLAYER_COUNT) {
    throw new RangeError(`固定 Latin 赛事必须恰好包含 ${FIXED_LATIN_PLAYER_COUNT} 名玩家`)
  }

  userIds.forEach((userId, index) => {
    if (typeof userId !== 'string' || !userId || userId !== userId.trim() || userId.length > 128) {
      throw new TypeError(`userIds[${index}] 必须是 1 到 128 字符、不含首尾空白的字符串`)
    }
  })
  if (new Set(userIds).size !== userIds.length) throw new RangeError('固定 Latin 赛事不允许重复 userId')
}

const rosterKeyFor = (userIds) => createHash('sha256')
  .update(JSON.stringify(userIds))
  .digest('hex')
  .slice(0, 16)

/**
 * Creates a deterministic three-round schedule for exactly sixteen seeded users.
 * Input order is the stable seed order: changing it intentionally creates another
 * schedule. The 4x4 roster is paired by rows, columns, then cyclic diagonals.
 */
export const createFixed16LatinPairings = (userIds) => {
  validateUserIds(userIds)

  const roster = [...userIds]
  const grid = Array.from({ length: FIXED_LATIN_TABLE_COUNT }, (_, row) => (
    roster.slice(row * FIXED_LATIN_PLAYERS_PER_TABLE, (row + 1) * FIXED_LATIN_PLAYERS_PER_TABLE)
  ))
  const tablesByRound = [
    grid.map(row => [...row]),
    Array.from({ length: FIXED_LATIN_TABLE_COUNT }, (_, column) => grid.map(row => row[column])),
    Array.from({ length: FIXED_LATIN_TABLE_COUNT }, (_, diagonal) => (
      grid.map((row, rowIndex) => row[(rowIndex + diagonal) % FIXED_LATIN_PLAYERS_PER_TABLE])
    )),
  ]
  const rosterKey = rosterKeyFor(roster)

  return {
    format: 'fixed16-latin-3',
    rosterKey,
    userIds: roster,
    rounds: tablesByRound.map((tables, roundIndex) => {
      const round = roundIndex + 1
      return {
        round,
        assignments: tables.map((tableUserIds, tableIndex) => {
          const table = tableIndex + 1
          return {
            assignmentId: `tpa_${rosterKey}_r${round}_t${table}`,
            round,
            table,
            userIds: tableUserIds,
          }
        }),
      }
    }),
  }
}
