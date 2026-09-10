const SCORE_KEY = 'comprehensive_score_v1'
const PAGE_SIZE = 5
function rowsFromFriends (data) {
  const seen = new Set()
  const rows = []
  for (const friend of Array.isArray(data) ? data : []) {
    if (!friend || typeof friend.openid !== 'string' || seen.has(friend.openid)) continue
    const kv = Array.isArray(friend.KVDataList) ? friend.KVDataList.find(item => item && item.key === SCORE_KEY) : null
    if (!kv || typeof kv.value !== 'string' || !/^-?\d{1,12}$/.test(kv.value)) continue
    seen.add(friend.openid)
    rows.push({ nickname: typeof friend.nickname === 'string' ? friend.nickname : '微信玩家',
      avatarUrl: typeof friend.avatarUrl === 'string' && /^https:\/\//.test(friend.avatarUrl) ? friend.avatarUrl : '',
      score: Number(kv.value) })
  }
  rows.sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname))
  let rank = 0
  return rows.map((row, index) => {
    if (!index || row.score !== rows[index - 1].score) rank = index + 1
    return { ...row, rank }
  })
}
function pageCount (rows) { return Math.max(1, Math.ceil(rows.length / PAGE_SIZE)) }
module.exports = { SCORE_KEY, PAGE_SIZE, rowsFromFriends, pageCount }
