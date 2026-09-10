import { conflict } from './errors.js'

/** Validate signed personal totals without treating temporary partnerships as persistent teams. */
export const validateFriendPersonalScores = (settings, event) => {
  const rotating = settings?.format === 'rotating'
  if (rotating !== Boolean(event.playerScores)) throw conflict('FRIEND_PERSONAL_SCORE_MISMATCH', '个人积分与签名房间赛制不一致')
  if (!rotating) return
  const values = Object.values(event.playerScores)
  const six = settings.rotatingScoring === 6
  const rounds = event.roundsPlayed
  if (event.winnerTeam !== null || event.scores.teamA !== 0 || event.scores.teamB !== 0
    || values.some(score => score < (six ? 0 : -3 * rounds) || score > (six ? 6 : 3) * rounds)
    || values.reduce((sum, score) => sum + score, 0) !== (six ? 12 * rounds : 0)) {
    throw conflict('FRIEND_PERSONAL_SCORE_MISMATCH', '转蛋个人积分与局数、计分方式不一致')
  }
}
