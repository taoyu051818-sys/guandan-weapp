export const CLASSIC_STAKES = Object.freeze({
  classic_50: 50,
  classic_300: 300,
  classic_2000: 2_000,
  classic_10000: 10_000,
})

export const classicStakeForMode = mode => CLASSIC_STAKES[mode] || null

const requireWalletBalance = (balances, userId) => {
  const balance = balances[userId]
  if (!Number.isSafeInteger(balance) || balance < 0) throw new TypeError(`用户 ${userId} 的钱包余额必须是非负整数`)
  return balance
}

/** Each losing seat transfers exactly one reserved base stake to its paired winner. */
export const settleClassicStake = ({ mode, winnerTeam, userIdsBySeat, balancesByUser }) => {
  const baseStake = classicStakeForMode(mode)
  if (!baseStake) throw new TypeError('仅经典底分场可以执行底分结算')
  if (winnerTeam !== 'teamA' && winnerTeam !== 'teamB') throw new TypeError('winnerTeam 必须是 teamA 或 teamB')
  const seats = ['p1', 'p2', 'p3', 'p4']
  if (!userIdsBySeat || !seats.every(seat => typeof userIdsBySeat[seat] === 'string' && userIdsBySeat[seat])) throw new TypeError('底分结算缺少四个席位用户')
  const userIds = seats.map(seat => userIdsBySeat[seat])
  if (new Set(userIds).size !== 4) throw new TypeError('底分结算的四个席位用户必须互不相同')

  const seatPairs = winnerTeam === 'teamA'
    ? [['p2', 'p1'], ['p4', 'p3']]
    : [['p1', 'p2'], ['p3', 'p4']]
  const balances = Object.fromEntries(userIds.map(userId => [userId, requireWalletBalance(balancesByUser, userId)]))
  seatPairs.forEach(([loserSeat]) => {
    const loserId = userIdsBySeat[loserSeat]
    if (balances[loserId] < baseStake) throw new RangeError(`用户 ${loserId} 的余额不足以完成底分${baseStake}结算`)
  })
  const deltasByUser = Object.fromEntries(userIds.map(userId => [userId, 0]))
  const transfers = seatPairs.map(([loserSeat, winnerSeat]) => {
    const fromUserId = userIdsBySeat[loserSeat]
    const toUserId = userIdsBySeat[winnerSeat]
    deltasByUser[fromUserId] -= baseStake
    deltasByUser[toUserId] += baseStake
    return { fromUserId, toUserId, amount: baseStake }
  })
  const balancesAfter = Object.fromEntries(userIds.map(userId => [userId, balances[userId] + deltasByUser[userId]]))
  if (Object.values(balancesAfter).some(balance => balance < 0)) throw new Error('底分结算不得产生负余额')
  if (Object.values(deltasByUser).reduce((sum, delta) => sum + delta, 0) !== 0) throw new Error('底分结算必须保持积分零和')
  return { mode, baseStake, winnerTeam, transfers, deltasByUser, balancesAfter }
}
