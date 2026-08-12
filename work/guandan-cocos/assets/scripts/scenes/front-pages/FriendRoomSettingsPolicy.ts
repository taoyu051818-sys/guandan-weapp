import {
  DEFAULT_FRIEND_ROOM_SETTINGS,
  type FriendRoomSettings,
} from '../../network/LobbyModels'

export type FriendRoomSettingsTab = 'rules' | 'experience'
export type FriendRoomChoiceId =
  | 'scoring'
  | 'score-visibility'
  | 'turn-seconds'
  | 'trustee-seconds'
  | 'total-time'
  | 'spectator'
  | 'auto-sort'
  | 'interaction'
  | 'sort-order'

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
  { id: 'classic', label: '经典掼蛋', available: true },
  { id: 'egg-turn', label: '转蛋', available: false },
  { id: 'landlord', label: '斗地主', available: false },
  { id: 'duplicate', label: '掼蛋复式', available: false },
] as const

export const FRIEND_ROOM_SETTINGS_TABS: ReadonlyArray<Readonly<{ id: FriendRoomSettingsTab, label: string }>> = [
  { id: 'rules', label: '基础规则' },
  { id: 'experience', label: '体验设置' },
]

export const FRIEND_ROOM_ROUNDS = Object.freeze({
  label: '局数',
  suffix: '局',
  minimum: 4,
  maximum: 32,
  step: 4,
})

const CHOICE_SCHEMAS: readonly FriendRoomChoiceSchema[] = [
  {
    id: 'scoring', tab: 'rules', label: '计分', options: ['双下3分', '双下4分'],
    selected: settings => settings.scoring === 'double-4' ? '双下4分' : '双下3分',
    update: (settings, selected) => ({ ...settings, scoring: selected === '双下4分' ? 'double-4' : 'double-3' }),
  },
  {
    id: 'score-visibility', tab: 'rules', label: '比分', options: ['实时显示', '结算显示'],
    selected: settings => settings.scoreVisibility === 'live' ? '实时显示' : '结算显示',
    update: (settings, selected) => ({ ...settings, scoreVisibility: selected === '实时显示' ? 'live' : 'hidden' }),
  },
  {
    id: 'turn-seconds', tab: 'rules', label: '首出', options: ['20秒', '40秒', '60秒'],
    selected: settings => `${settings.turnSeconds}秒`,
    update: (settings, selected) => ({ ...settings, turnSeconds: Number(selected.replace('秒', '')) as 20 | 40 | 60 }),
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
    id: 'spectator', tab: 'experience', label: '观战', options: ['禁止观战', '实时观战', '延迟1局'],
    selected: settings => settings.spectator === 'live' ? '实时观战' : settings.spectator === 'delayed-round' ? '延迟1局' : '禁止观战',
    update: (settings, selected) => ({ ...settings, spectator: selected === '实时观战' ? 'live' : selected === '延迟1局' ? 'delayed-round' : 'off' }),
  },
  {
    id: 'auto-sort', tab: 'experience', label: '一键理牌', options: ['开启', '关闭'],
    selected: settings => settings.autoSort ? '开启' : '关闭',
    update: (settings, selected) => ({ ...settings, autoSort: selected === '开启' }),
  },
  {
    id: 'interaction', tab: 'experience', label: '互动', options: ['禁止互动', '允许互动'],
    selected: settings => settings.disableInteraction ? '禁止互动' : '允许互动',
    update: (settings, selected) => ({ ...settings, disableInteraction: selected === '禁止互动' }),
  },
  {
    id: 'sort-order', tab: 'experience', label: '牌序', options: ['大牌在左', '小牌在左'],
    selected: settings => settings.sortOrder === 'desc' ? '大牌在左' : '小牌在左',
    update: (settings, selected) => ({ ...settings, sortOrder: selected === '小牌在左' ? 'asc' : 'desc' }),
  },
]

export const createDefaultFriendRoomSettings = (): FriendRoomSettings => ({ ...DEFAULT_FRIEND_ROOM_SETTINGS })

export const friendRoomChoiceRows = (
  settings: FriendRoomSettings,
  tab: FriendRoomSettingsTab,
): readonly FriendRoomChoiceRow[] => CHOICE_SCHEMAS
  .filter(schema => schema.tab === tab)
  .map(schema => ({
    id: schema.id,
    label: schema.label,
    options: schema.options,
    selected: schema.selected(settings),
  }))

export const updateFriendRoomChoice = (
  settings: FriendRoomSettings,
  choiceId: FriendRoomChoiceId,
  selected: string,
): FriendRoomSettings => {
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

export const describeFriendRoomRules = (settings: FriendRoomSettings): string => (
  `${settings.rounds}局 · ${settings.scoring === 'double-4' ? '双下4分' : '双下3分'} · ${settings.scoreVisibility === 'live' ? '实时比分' : '结算比分'} · 首出${settings.turnSeconds}秒 · ${settings.trusteeSeconds ? `托管${settings.trusteeSeconds}秒` : '无托管'}`
)
