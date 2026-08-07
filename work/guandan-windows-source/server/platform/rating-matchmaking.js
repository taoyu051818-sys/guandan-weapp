export const DEFAULT_RATING_MATCH_CONFIG = Object.freeze({
  initialSpread: 5_000,
  widenEveryMs: 15_000,
  widenBy: 5_000,
  maximumSpread: 90_000_000,
})

export const allowedRatingSpread = (waitMs, config = DEFAULT_RATING_MATCH_CONFIG) => {
  const safeWait = Math.max(0, Number(waitMs) || 0)
  const steps = Math.floor(safeWait / config.widenEveryMs)
  return Math.min(config.maximumSpread, config.initialSpread + steps * config.widenBy)
}

/** Selects one open table in a single queue; callers must pass all queue candidates. */
export const selectRatingMatch = ({ queueId, matches, joiningScore, now, config = DEFAULT_RATING_MATCH_CONFIG }) => {
  if (typeof queueId !== 'string' || !queueId) throw new TypeError('queueId 不能为空')
  if (!Array.isArray(matches)) throw new TypeError('matches 必须是数组')
  if (!Number.isFinite(joiningScore)) throw new TypeError('joiningScore 必须是有限数值')
  const candidates = matches.flatMap(match => {
    if (!match || match.mode !== queueId || match.status !== 'matching') return []
    const waiting = Array.isArray(match.participants) ? match.participants.filter(item => item.status === 'matching') : []
    if (!waiting.length || waiting.length >= 4 || waiting.some(item => !Number.isFinite(item.comprehensiveScoreAtJoin))) return []
    const scores = [...waiting.map(item => item.comprehensiveScoreAtJoin), joiningScore]
    const spread = Math.max(...scores) - Math.min(...scores)
    const oldestJoinedAt = Math.min(...waiting.map(item => Number(item.joinedAt) || Number(match.createdAt) || now))
    const allowedSpread = allowedRatingSpread(now - oldestJoinedAt, config)
    if (spread > allowedSpread) return []
    const average = waiting.reduce((sum, item) => sum + item.comprehensiveScoreAtJoin, 0) / waiting.length
    return [{ match, spread, distance: Math.abs(average - joiningScore), oldestJoinedAt }]
  })
  candidates.sort((left, right) => (
    left.spread - right.spread ||
    left.distance - right.distance ||
    left.oldestJoinedAt - right.oldestJoinedAt ||
    String(left.match.id).localeCompare(String(right.match.id))
  ))
  return candidates[0]?.match || null
}
