export type MatchWaitingStage = 'requesting' | 'queued'

export const formatMatchElapsed = (elapsedMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(Number.isFinite(elapsedMs) ? elapsedMs / 1000 : 0))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/**
 * Only presents facts the client can verify. The platform currently exposes
 * no queue population or ETA, so the UI must not invent either value.
 */
export const matchWaitingText = (
  queueName: string,
  stage: MatchWaitingStage,
  elapsedMs: number,
): string => {
  const status = stage === 'queued' ? '已进入队列，正在分配牌桌…' : '正在请求匹配服务…'
  return `${queueName}\n${status}\n已等待 ${formatMatchElapsed(elapsedMs)} · 可随时取消`
}
