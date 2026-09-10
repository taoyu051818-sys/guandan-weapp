const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const policyPath = path.join(projectRoot, 'assets/scripts/scenes/front-pages/FriendRoomSettingsPolicy.ts')
const policyMetaPath = `${policyPath}.meta`
const lobbyModelsPath = path.join(projectRoot, 'assets/scripts/network/LobbyModels.ts')
const { loadTypeScript } = require('./support/typescript.cjs')
const ts = loadTypeScript()

const compile = (sourcePath, dependencies = {}) => {
  const result = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
    fileName: sourcePath,
    reportDiagnostics: true,
  })
  const errors = (result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
  assert.deepEqual(errors, [])
  const loadedModule = { exports: {} }
  new Function('exports', 'module', 'require', result.outputText)(loadedModule.exports, loadedModule, request => {
    if (Object.prototype.hasOwnProperty.call(dependencies, request)) return dependencies[request]
    throw new Error(`unexpected dependency ${request} in ${sourcePath}`)
  })
  return loadedModule.exports
}

assert.equal(fs.existsSync(policyMetaPath), true, 'the pure friend-room settings policy needs Cocos metadata')
const policySource = fs.readFileSync(policyPath, 'utf8')
assert.doesNotMatch(policySource, /from ['"]cc['"]/, 'the settings policy must remain executable without the Cocos runtime')

const lobbyModels = compile(lobbyModelsPath, { './DuplicateRoomModel': compile(path.join(projectRoot, 'assets/scripts/network/DuplicateRoomModel.ts')) })
const format = compile(path.join(projectRoot, 'assets/scripts/core/generated/lib/matchFormat.ts'))
const policy = compile(policyPath, { '../../network/LobbyModels': lobbyModels, '../../core/generated/lib/matchFormat': format })
const {
  createDefaultFriendRoomSettings,
  describeFriendRoomRules,
  FRIEND_ROOM_MODES,
  FRIEND_ROOM_ROUNDS,
  FRIEND_ROOM_SETTINGS_TABS,
  friendRoomChoiceRows,
  updateFriendRoomChoice,
  updateFriendRoomRounds,
} = policy

const firstDefault = createDefaultFriendRoomSettings()
const secondDefault = createDefaultFriendRoomSettings()
assert.deepEqual(firstDefault, { ...lobbyModels.DEFAULT_FRIEND_ROOM_SETTINGS, format: 'rounds', levelMode: 'random', levelRank: 2, tributeEnabled: false })
assert.notEqual(firstDefault, secondDefault, 'each page instance must receive independent mutable settings state')
assert.deepEqual(FRIEND_ROOM_MODES.map(({ id, label, available }) => ({ id, label, available })), [
  { id: 'rounds', label: '定局玩法', available: true },
  { id: 'upgrade', label: '传统升级', available: true },
  { id: 'rotating', label: '转蛋', available: true },
  { id: 'duplicate', label: '复式', available: true },
])
assert.deepEqual(FRIEND_ROOM_SETTINGS_TABS, [
  { id: 'rules', label: '基础规则' },
  { id: 'experience', label: '体验设置' },
])
assert.deepEqual(FRIEND_ROOM_ROUNDS, { label: '局数', suffix: '局', minimum: 1, maximum: 32, step: 1 })

const rulesRows = friendRoomChoiceRows(firstDefault, 'rules')
assert.deepEqual(rulesRows.map(row => [row.id, row.label, row.options, row.selected]), [
  ['deal-mode', '发牌方式', ['随机发牌', '不洗牌'], '随机发牌'],
  ['rounds-preset', '常用局数', ['1局', '4局', '8局', '12局'], '4局'],
  ['level-mode', '级牌', ['每局随机', '固定级牌'], '每局随机'],
  ['scoring', '计分', ['双下3分', '双下4分'], '双下3分'],
  ['turn-seconds', '出牌时间', ['15秒', '20秒', '30秒', '60秒'], '20秒'],
  ['trustee-seconds', '托管', ['开启', '关闭'], '开启'],
])
const experienceRows = friendRoomChoiceRows(firstDefault, 'experience')
assert.deepEqual(experienceRows.map(row => [row.id, row.label, row.options, row.selected]), [
  ['score-visibility', '比分', ['实时显示', '结算显示'], '实时显示'],
  ['total-time', '总时长', ['不限制', '20分钟', '30分钟', '60分钟'], '不限制'],
  ['spectator', '允许观战', ['禁止观战', '实时观战', '延迟观战'], '禁止观战'],
  ['auto-sort', '一键理牌', ['开启', '关闭'], '开启'],
  ['counter', '记牌器', ['开启', '关闭'], '开启'],
  ['sort-order', '牌序', ['大牌在左', '小牌在左'], '大牌在左'],
])

let settings = firstDefault
for (const [id, selected] of [
  ['scoring', '双下4分'],
  ['score-visibility', '结算显示'],
  ['turn-seconds', '60秒'],
  ['trustee-seconds', '关闭'],
  ['total-time', '30分钟'],
  ['spectator', '延迟观战'],
  ['spectator-delay', '1局'],
  ['auto-sort', '关闭'],
  ['sort-order', '小牌在左'],
]) settings = updateFriendRoomChoice(settings, id, selected)
assert.deepEqual(settings, {
  ...firstDefault,
  scoring: 'double-4',
  scoreVisibility: 'hidden',
  turnSeconds: 60,
  trusteeSeconds: 0,
  totalTimeMinutes: 30,
  spectator: 'delayed-round',
  autoSort: false,
  sortOrder: 'asc',
})
assert.equal(updateFriendRoomChoice(settings, 'scoring', '无效值'), settings, 'unknown labels must not mutate the room contract')

assert.equal(updateFriendRoomRounds(firstDefault, 100).rounds, 32)
assert.equal(updateFriendRoomRounds(firstDefault, -10).rounds, 1)
assert.equal(updateFriendRoomRounds(firstDefault, 14).rounds, 14)
assert.equal(updateFriendRoomRounds(firstDefault, Number.NaN), firstDefault)
assert.equal(
  describeFriendRoomRules({ ...settings, rounds: 16 }),
  '16局 · 每局随机2–A · 不进贡 · 双下4分 · 无托管',
)

let fixed = updateFriendRoomChoice(firstDefault, 'level-mode', '固定级牌')
fixed = policy.updateFriendRoomLevel(fixed, 12)
assert.equal(fixed.levelRank, 'A')
assert.match(describeFriendRoomRules(fixed), /固定打A/)
const upgraded = policy.changeFriendRoomFormat(fixed, 'upgrade')
const rotating = policy.changeFriendRoomFormat(upgraded, 'rotating')
assert.equal(rotating.tributeEnabled, false)
assert.equal(rotating.levelMode, 'fixed')
assert.equal(rotating.scoring, 'double-3')
assert.equal(rotating.rotatingScoring, 3)
assert.equal(rotating.upgradeTarget, undefined)
assert.equal(updateFriendRoomChoice(rotating, 'rotating-scoring', '6分制').rotatingScoring, 6)
assert.equal(updateFriendRoomChoice(rotating, 'team-rotation', '顺时针轮换').teamRotation, 'clockwise')
assert.ok(!friendRoomChoiceRows(rotating, 'rules').some(row => row.id === 'tribute' || row.id === 'scoring'))
const backToRounds = policy.changeFriendRoomFormat(rotating, 'rounds')
assert.equal(backToRounds.teamRotation, undefined)
assert.equal(backToRounds.rotatingScoring, undefined)
assert.doesNotThrow(() => format.normalizeRoomFormat(backToRounds))
assert.equal(upgraded.levelRank, 2)
assert.equal(upgraded.levelMode, 'fixed')
assert.equal(upgraded.tributeEnabled, true)
assert.equal(friendRoomChoiceRows(upgraded, 'rules').some(row => row.id === 'level-mode'), false)
assert.equal(updateFriendRoomChoice(upgraded, 'level-mode', '每局随机'), upgraded)
assert.equal(updateFriendRoomChoice(upgraded, 'scoring', '双上升4级').scoring, 'double-4')
assert.equal(updateFriendRoomChoice(upgraded, 'upgrade-target', '过6').upgradeTarget, 6)
assert.equal(updateFriendRoomChoice(upgraded, 'upgrade-target', '过A翻山').upgradeTarget, 'A-reset')
assert.equal(updateFriendRoomChoice(firstDefault, 'upgrade-target', '过6'), firstDefault)
assert.equal(updateFriendRoomChoice(firstDefault, 'counter', '关闭').counterEnabled, false)
assert.equal(policy.changeFriendRoomFormat(upgraded, 'rounds').tributeEnabled, false)
const noShuffle = updateFriendRoomChoice(firstDefault, 'deal-mode', '不洗牌')
assert.equal(noShuffle.dealMode, 'no-shuffle')
for (const mode of FRIEND_ROOM_MODES) {
  const draft = policy.changeFriendRoomFormat(noShuffle, mode.id)
  assert.equal(format.normalizeRoomFormat(draft).dealMode, 'no-shuffle')
  assert.match(describeFriendRoomRules(draft), /不洗牌/)
  assert.equal(friendRoomChoiceRows(draft, 'rules').find(row => row.id === 'deal-mode').selected, '不洗牌')
}
assert.equal(updateFriendRoomChoice(noShuffle, 'deal-mode', '随机发牌').dealMode, 'random')
assert.equal(updateFriendRoomChoice(noShuffle, 'deal-mode', '伪造模式'), noShuffle)

process.stdout.write('friend room settings policy regression checks passed\n')
