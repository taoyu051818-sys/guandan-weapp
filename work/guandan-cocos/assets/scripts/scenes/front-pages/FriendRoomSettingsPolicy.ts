import {
  DEFAULT_FRIEND_ROOM_SETTINGS,
  type FriendRoomSettings,
} from '../../network/LobbyModels'
import { MATCH_LEVELS } from '../../core/generated/lib/matchFormat'

export type FriendRoomSettingsTab = 'rules' | 'experience'
export type FriendRoomChoiceId =
  | 'rounds-preset'
  | 'level-mode'
  | 'tribute'
  | 'scoring'
  | 'score-visibility'
  | 'turn-seconds'
  | 'trustee-seconds'
  | 'total-time'
  | 'spectator'
  | 'spectator-delay'
  | 'auto-sort'
  | 'interaction'
  | 'sort-order'
  | 'upgrade-target'
  | 'counter'
  | 'voice'
  | 'team-rotation'
  | 'rotating-scoring'

export type FriendRoomChoiceRow = Readonly<{
  id: FriendRoomChoiceId
  label: string
  options: readonly string[]
  selected: string
}>

type FriendRoomChoiceSchema = Readonly<{
  id: FriendRoomChoiceId
  tab: FriendRoomSettingsTab
  label: string
  options: readonly string[]
  selected: (settings: FriendRoomSettings) => string
  update: (settings: FriendRoomSettings, selected: string) => FriendRoomSettings
}>

export const FRIEND_ROOM_MODES = [
  { id: 'rounds', label: '定局玩法', available: true },
  { id: 'upgrade', label: '传统升级', available: true },
  { id: 'rotating', label: '转蛋', available: true },
  { id: 'duplicate', label: '复式', available: true },
] as const

export const FRIEND_ROOM_SETTINGS_TABS: ReadonlyArray<Readonly<{ id: FriendRoomSettingsTab, label: string }>> = [
  { id: 'rules', label: '基础规则' },
  { id: 'experience', label: '体验设置' },
]

export const FRIEND_ROOM_ROUNDS = Object.freeze({
  label: '局数',
  suffix: '局',
  minimum: 1,
  maximum: 32,
  step: 1,
})

const CHOICE_SCHEMAS: readonly FriendRoomChoiceSchema[] = [
  { id: 'team-rotation', tab: 'rules', label: '队友轮换', options: ['随机抽牌', '顺时针轮换'],
    selected: settings => settings.teamRotation === 'clockwise' ? '顺时针轮换' : '随机抽牌',
    update: (settings, selected) => ({ ...settings, teamRotation: selected === '顺时针轮换' ? 'clockwise' : 'draw' }) },
  { id: 'rotating-scoring', tab: 'rules', label: '个人计分', options: ['3分制', '6分制'],
    selected: settings => settings.rotatingScoring === 6 ? '6分制' : '3分制',
    update: (settings, selected) => ({ ...settings, rotatingScoring: selected === '6分制' ? 6 : 3 }) },
  {
    id: 'upgrade-target', tab: 'rules', label: '目标', options: ['过6', '过10', '过A', '过A翻山'],
    selected: settings => settings.upgradeTarget === 6 ? '过6' : settings.upgradeTarget === 10 ? '过10' : settings.upgradeTarget === 'A-reset' ? '过A翻山' : '过A',
    update: (settings, selected) => ({ ...settings, upgradeTarget: selected === '过6' ? 6 : selected === '过10' ? 10 : selected === '过A翻山' ? 'A-reset' : 'A' }),
  },
  {
    id: 'rounds-preset', tab: 'rules', label: '常用局数', options: ['1局', '4局', '8局', '12局'],
    selected: settings => `${settings.rounds}局`,
    update: (settings, selected) => ({ ...settings, rounds: Number(selected.replace('局', '')) }),
  },
  {
    id: 'level-mode', tab: 'rules', label: '级牌', options: ['每局随机', '固定级牌'],
    selected: settings => settings.levelMode === 'fixed' ? '固定级牌' : '每局随机',
    update: (settings, selected) => ({ ...settings, levelMode: selected === '固定级牌' ? 'fixed' : 'random' }),
  },
  {
    id: 'tribute', tab: 'rules', label: '贡还', options: ['进贡', '不进贡'],
    selected: settings => settings.tributeEnabled ? '进贡' : '不进贡',
    update: (settings, selected) => ({ ...settings, tributeEnabled: selected === '进贡' }),
  },
  {
    id: 'scoring', tab: 'rules', label: '计分', options: ['双下3分', '双下4分'],
    selected: settings => settings.scoring === 'double-4' ? '双下4分' : '双下3分',
    update: (settings, selected) => ({ ...settings, scoring: selected === '双下4分' ? 'double-4' : 'double-3' }),
  },
  {
    id: 'score-visibility', tab: 'experience', label: '比分', options: ['实时显示', '结算显示'],
    selected: settings => settings.scoreVisibility === 'live' ? '实时显示' : '结算显示',
    update: (settings, selected) => ({ ...settings, scoreVisibility: selected === '实时显示' ? 'live' : 'hidden' }),
  },
  {
    id: 'turn-seconds', tab: 'rules', label: '出牌时间', options: ['15秒', '20秒', '30秒', '60秒'],
    selected: settings => `${settings.turnSeconds}秒`,
    update: (settings, selected) => ({ ...settings, turnSeconds: Number(selected.replace('秒', '')) as FriendRoomSettings['turnSeconds'] }),
  },
  {
    id: 'trustee-seconds', tab: 'rules', label: '托管', options: ['无托管', '15秒', '30秒', '60秒'],
    selected: settings => settings.trusteeSeconds === 0 ? '无托管' : `${settings.trusteeSeconds}秒`,
    update: (settings, selected) => ({ ...settings, trusteeSeconds: selected === '无托管' ? 0 : Number(selected.replace('秒', '')) as 15 | 30 | 60 }),
  },
  {
    id: 'total-time', tab: 'experience', label: '总时长', options: ['不限制', '20分钟', '30分钟', '60分钟'],
    selected: settings => settings.totalTimeMinutes === 0 ? '不限制' : `${settings.totalTimeMinutes}分钟`,
    update: (settings, selected) => ({ ...settings, totalTimeMinutes: selected === '不限制' ? 0 : Number(selected.replace('分钟', '')) as 20 | 30 | 60 }),
  },
  {
    id: 'spectator', tab: 'experience', label: '允许观战', options: ['禁止观战', '实时观战', '延迟观战'],
    selected: settings => settings.spectator === 'off' ? '禁止观战' : settings.spectator === 'live' ? '实时观战' : '延迟观战',
    update: (settings, selected) => ({ ...settings, spectator: selected === '实时观战' ? 'live' : selected === '延迟观战' ? 'delay-30' : 'off' }),
  },
  {
    id: 'spectator-delay', tab: 'experience', label: '观战延迟', options: ['15秒', '30秒', '60秒', '1局'],
    selected: settings => settings.spectator === 'delayed-round' ? '1局' : `${settings.spectator.replace('delay-', '')}秒`,
    update: (settings, selected) => ({ ...settings, spectator: selected === '1局' ? 'delayed-round' : `delay-${selected.replace('秒', '')}` as FriendRoomSettings['spectator'] }),
  },
  {
    id: 'auto-sort', tab: 'experience', label: '一键理牌', options: ['开启', '关闭'],
    selected: settings => settings.autoSort ? '开启' : '关闭',
    update: (settings, selected) => ({ ...settings, autoSort: selected === '开启' }),
  },
  {
    id: 'counter', tab: 'experience', label: '记牌器', options: ['开启', '关闭'],
    selected: settings => settings.counterEnabled === false ? '关闭' : '开启',
    update: (settings, selected) => ({ ...settings, counterEnabled: selected === '开启' }),
  },
  {
    id: 'sort-order', tab: 'experience', label: '牌序', options: ['大牌在左', '小牌在左'],
    selected: settings => settings.sortOrder === 'desc' ? '大牌在左' : '小牌在左',
    update: (settings, selected) => ({ ...settings, sortOrder: selected === '小牌在左' ? 'asc' : 'desc' }),
  },
]

export const createDefaultFriendRoomSettings = (): FriendRoomSettings => ({
  ...DEFAULT_FRIEND_ROOM_SETTINGS, format: 'rounds', levelMode: 'random', levelRank: 2, tributeEnabled: false,
})

export const changeFriendRoomFormat = (settings: FriendRoomSettings, format: 'rounds' | 'upgrade' | 'rotating' | 'duplicate'): FriendRoomSettings => ({
  ...settings, format, levelMode: format === 'rounds' ? 'random' : 'fixed', levelRank: 2, tributeEnabled: format === 'upgrade',
  upgradeTarget: format === 'upgrade' ? 'A' : undefined,
  teamRotation: format === 'rotating' ? 'draw' : undefined,
  rotatingScoring: format === 'rotating' ? 3 : undefined,
  scoring: ['rotating', 'duplicate'].includes(format) ? 'double-3' : settings.scoring,
})

export const updateFriendRoomLevel = (settings: FriendRoomSettings, index: number): FriendRoomSettings =>
  settings.format !== 'upgrade' && settings.levelMode === 'fixed' && Number.isInteger(index) && MATCH_LEVELS[index] !== undefined
    ? { ...settings, levelRank: MATCH_LEVELS[index] } : settings

export const friendRoomChoiceRows = (
  settings: FriendRoomSettings,
  tab: FriendRoomSettingsTab,
): readonly FriendRoomChoiceRow[] => CHOICE_SCHEMAS
  .filter(schema => schema.tab === tab)
  .filter(schema => schema.id !== 'spectator-delay' || !['off', 'live'].includes(settings.spectator))
  .filter(schema => ['team-rotation', 'rotating-scoring'].includes(schema.id) ? settings.format === 'rotating' : schema.id !== 'scoring' || !['rotating', 'duplicate'].includes(settings.format || ''))
  .filter(schema => ['tribute', 'upgrade-target'].includes(schema.id) ? settings.format === 'upgrade'
    : ['rounds-preset', 'level-mode'].includes(schema.id) ? settings.format !== 'upgrade' : true)
  .map(schema => ({
    id: schema.id,
    label: schema.id === 'scoring' && settings.format === 'upgrade' ? '升级' : schema.label,
    options: schema.id === 'scoring' && settings.format === 'upgrade' ? ['双上升3级', '双上升4级'] : schema.options,
    selected: schema.id === 'scoring' && settings.format === 'upgrade' ? `双上升${settings.scoring === 'double-4' ? 4 : 3}级` : schema.selected(settings),
  }))

export const updateFriendRoomChoice = (
  settings: FriendRoomSettings,
  choiceId: FriendRoomChoiceId,
  selected: string,
): FriendRoomSettings => {
  if (choiceId === 'scoring' && settings.format === 'upgrade') selected = selected.replace('双上升', '双下').replace('级', '分')
  if (!friendRoomChoiceRows(settings, 'rules').concat(friendRoomChoiceRows(settings, 'experience')).some(row => row.id === choiceId)) return settings
  const schema = CHOICE_SCHEMAS.find(candidate => candidate.id === choiceId)
  if (!schema || !schema.options.includes(selected)) return settings
  return schema.update(settings, selected)
}

export const updateFriendRoomRounds = (
  settings: FriendRoomSettings,
  requestedRounds: number,
): FriendRoomSettings => {
  if (!Number.isFinite(requestedRounds)) return settings
  const clamped = Math.max(FRIEND_ROOM_ROUNDS.minimum, Math.min(FRIEND_ROOM_ROUNDS.maximum, requestedRounds))
  const normalized = FRIEND_ROOM_ROUNDS.minimum + Math.round((clamped - FRIEND_ROOM_ROUNDS.minimum) / FRIEND_ROOM_ROUNDS.step) * FRIEND_ROOM_ROUNDS.step
  return normalized === settings.rounds ? settings : { ...settings, rounds: normalized }
}

export const describeFriendRoomRules = (settings: FriendRoomSettings): string => {
  if (settings.format === 'rotating') return `转蛋 · ${settings.rounds}局 · ${settings.levelMode === 'fixed' ? `固定打${settings.levelRank}` : '每局随机'} · ${settings.teamRotation === 'clockwise' ? '顺时针换队' : '抽牌换队'} · ${settings.rotatingScoring ?? 3}分制`
  if (settings.format === 'duplicate') return `复式 · 八人双桌 · ${settings.rounds}局 · ${settings.levelMode === 'fixed' ? `固定打${settings.levelRank}` : '双桌共同随机级牌'} · 胜方3/2/1分`
  const format = settings.format === 'rounds'
    ? `${settings.rounds}局 · ${settings.levelMode === 'fixed' ? `固定打${settings.levelRank}` : '每局随机2–A'} · 不进贡`
    : settings.format === 'upgrade' ? `从2过${settings.upgradeTarget === 'A-reset' ? 'A翻山' : settings.upgradeTarget ?? 'A'} · ${settings.tributeEnabled ? '进贡' : '不进贡'}` : `${settings.rounds}局 · 经典升级`
  const scoring = settings.format === 'upgrade' ? `双上升${settings.scoring === 'double-4' ? 4 : 3}级` : `双下${settings.scoring === 'double-4' ? 4 : 3}分`
  return `${format} · ${scoring} · ${settings.trusteeSeconds === 0 ? '无托管' : `${settings.turnSeconds}秒`}`
}

export const friendRoomRuleHelp = (settings: FriendRoomSettings, tab: FriendRoomSettingsTab): string => tab === 'experience'
  ? '观战可点头像切换手牌；仅开局前可站起、坐下。延迟由服务器控制。'
  : settings.format === 'rotating' ? '每局换队，积分跟随玩家累计。具体换队与计分见“玩法规则”。'
    : settings.trusteeSeconds === 0 ? '无托管：不倒计时、不自动代打；房间总时长限制仍有效。'
    : settings.format === 'upgrade'
      ? settings.upgradeTarget === 'A-reset' ? 'A必打；头游且搭档非末游过关。己方三次冲A未过回2。'
        : '目标级必打，不能跳过；打目标级时头游且搭档非末游过关。'
      : '定局独立计分，不进贡；固定或每局随机级牌。不等同于复式。'
