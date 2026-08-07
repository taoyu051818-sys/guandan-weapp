import { createEmptyPlatformState } from './storage.js'

export const SAMPLE_PRODUCTS = [
  { id: 'tissue', name: '柔韧抽纸', pointsPrice: 900, description: '三层柔韧抽纸，示例规格3包。', category: '居家', stock: 99 },
  { id: 'detergent', name: '清香洗衣液', pointsPrice: 1900, description: '低泡易漂洗，示例容量1千克。', category: '清洁', stock: 60 },
  { id: 'thermos', name: '便携保温杯', pointsPrice: 2900, description: '轻量杯身，示例容量450毫升。', category: '出行', stock: 30 },
  { id: 'umbrella', name: '折叠晴雨伞', pointsPrice: 2400, description: '晴雨两用便携折叠伞。', category: '出行', stock: 45 },
  { id: 'dish_soap', name: '清新洗洁精', pointsPrice: 1200, description: '厨房清洁用品，示例容量500克。', category: '清洁', stock: 80 },
  { id: 'trash_bag', name: '加厚垃圾袋', pointsPrice: 800, description: '抽绳加厚垃圾袋，示例规格30只。', category: '居家', stock: 120 },
  { id: 'towel', name: '柔软面巾', pointsPrice: 1500, description: '吸水柔软日用毛巾。', category: '个护', stock: 75 },
  { id: 'soap', name: '植物香皂', pointsPrice: 600, description: '温和清洁香皂，示例规格100克。', category: '个护', stock: 150 },
]

export const SAMPLE_TOURNAMENTS = [
  { id: 'lingshui-16-cup', name: '陵水16人积分赛', description: '固定16人 · 三轮不重复同桌 · 前八晋级', status: 'open', entryPoints: 0, queueId: 'lingshui_16_cup', format: 'fixed16-latin-3', capacity: 16, roundsTotal: 3, currentRound: 0, advanceCount: 8 },
  { id: 'rookie-cup', name: '新手体验赛', description: '随时报名 · 三轮积分', status: 'open', entryPoints: 0, queueId: 'rookie_cup', roundsTotal: 3, currentRound: 1, advanceCount: 16 },
  { id: 'weekend-cup', name: '周末挑战赛', description: '三轮积分 · 前八晋级', status: 'open', entryPoints: 200, queueId: 'weekend_cup', roundsTotal: 3, currentRound: 1, advanceCount: 8 },
  { id: 'master-cup', name: '大师晋级赛', description: '五轮积分 · 前四晋级', status: 'scheduled', entryPoints: 500, queueId: 'master_cup', roundsTotal: 5, currentRound: 1, advanceCount: 4 },
]

export const SAMPLE_SEASONS = [
  { id: 'season-2026-lingshui', name: '陵水夏季赛季', status: 'active', startsAt: 1785513600000, endsAt: 1788191999000 },
]

export const SAMPLE_TASKS = [
  { id: 'daily-play-1', seasonId: 'season-2026-lingshui', name: '完成一局', metric: 'gamesPlayed', target: 1, rewardPoints: 80, cadence: 'daily' },
  { id: 'season-win-3', seasonId: 'season-2026-lingshui', name: '赢得三局', metric: 'wins', target: 3, rewardPoints: 300, cadence: 'season' },
  { id: 'season-bomb-5', seasonId: 'season-2026-lingshui', name: '打出五次炸弹', metric: 'bombsPlayed', target: 5, rewardPoints: 240, cadence: 'season' },
]

export const createSeededPlatformState = () => {
  const state = createEmptyPlatformState()
  SAMPLE_PRODUCTS.forEach(product => { state.products[product.id] = structuredClone(product) })
  SAMPLE_TOURNAMENTS.forEach(tournament => { state.tournaments[tournament.id] = structuredClone(tournament) })
  SAMPLE_SEASONS.forEach(season => { state.seasons[season.id] = structuredClone(season) })
  SAMPLE_TASKS.forEach(task => { state.taskDefinitions[task.id] = structuredClone(task) })
  return state
}
