/**
 * Keeps rule-engine status strings from becoming permanent table chrome.
 * Visual state already communicates turns, legal selections and phase flow;
 * only actionable exceptions should interrupt the player with a short toast.
 */
export const tableHintToast = (rawHint: string, phase: 'playing' | 'tribute' | 'settlement'): string | null => {
  const hint = rawHint.trim()
  if (!hint || phase !== 'playing') return null

  const silentPatterns: readonly RegExp[] = [
    /^新对局开始/,
    /^轮到你/,
    /正在思考/,
    /^等待其他玩家/,
    /^请等待其他玩家/,
    /^(?:正在)?等待(?:服务器|服务端)确认/,
    /^平台确认中/,
    /^请选择手牌$/,
    /^可出(?:\s*·|$)/,
    /^提示：/,
    /^已选择可出牌组$/,
    /^牌型不合法$/,
    /^牌型不匹配/,
    /^张数不匹配/,
    /^点数压不过$/,
    /^压不过/,
    /^炸弹不够大$/,
    /^天王炸无法压过$/,
  ]
  return silentPatterns.some(pattern => pattern.test(hint)) ? null : hint
}
