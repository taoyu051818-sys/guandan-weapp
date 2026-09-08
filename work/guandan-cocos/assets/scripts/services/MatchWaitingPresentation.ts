export type MatchWaitingStage = 'requesting' | 'queued' | 'cancelling' | 'cancel-uncertain' | 'entering' | 'failed'

export const formatMatchElapsed = (elapsedMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(Number.isFinite(elapsedMs) ? elapsedMs / 1000 : 0))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/**
 * Routine progress is shown by the matching animation. Only actionable failures
 * need copy; never invent population, a human identity, or a completion ETA.
 */
export const matchWaitingText = (
  _queueName: string,
  stage: MatchWaitingStage,
  _elapsedMs: number,
  _botFillEnabled = false,
): string => {
  if (stage === 'cancel-uncertain') return '网络不稳定，取消尚未完成，请重试。'
  return ''
}
