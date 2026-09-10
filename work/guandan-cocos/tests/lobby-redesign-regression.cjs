const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const read = relativePath => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8')
const lobbyPage = read('assets/scripts/scenes/front-pages/LobbyPageDomain.ts')
const lobbyCatalog = read('assets/scripts/scenes/front-pages/LobbyPageCatalog.ts')
const lobbyView = read('assets/scripts/ui/LobbyMenuView.ts')
const lobbyPlayerProfile = read('assets/scripts/scenes/front-pages/LobbyPlayerProfilePresenter.ts')
const friendRoomPresenter = read('assets/scripts/scenes/front-pages/FriendRoomSettingsPresenter.ts')
const friendRoomPolicy = read('assets/scripts/scenes/front-pages/FriendRoomSettingsPolicy.ts')
const matchmakingPage = read('assets/scripts/scenes/front-pages/MatchmakingPageDomain.ts')
const frontPageController = read('assets/scripts/scenes/FrontPageController.ts')
const uiFactory = read('assets/scripts/ui/RuntimeUiFactory.ts')
const pageRouter = read('assets/scripts/scenes/PageRouter.ts')
const lobbyController = read('assets/scripts/network/LobbyController.ts')
const matchedEntryCoordinator = read('assets/scripts/network/LobbyMatchedEntryCoordinator.ts')
const lobbyModels = read('assets/scripts/network/LobbyModels.ts')
const gameSession = read('assets/scripts/session/GameSession.ts')
const gameSessionModel = read('assets/scripts/session/GameSessionModel.ts')
const gameManager = read('assets/scripts/game/GameManager.ts')
const gameScene = read('assets/scripts/scenes/GameScene.ts')
const gameSceneAsset = JSON.parse(read('assets/scenes/Game.scene'))
const safeAreaLayout = read('assets/scripts/ui/SafeAreaLayout.ts')
const platformApi = read('assets/scripts/services/PlatformApi.ts')
const competitionDecoders = read('assets/scripts/services/platform/competitionDecoders.ts')
const gatewayContracts = read('assets/scripts/services/FrontPageGatewayContracts.ts')
const serverRoot = path.resolve(projectRoot, '../guandan-windows-source/server')
const server = fs.readFileSync(path.join(serverRoot, 'weapp-ws.js'), 'utf8')
const entryCommandServer = fs.readFileSync(path.join(serverRoot, 'weapp-entry-command-handler.js'), 'utf8')
const roomPublisherServer = fs.readFileSync(path.join(serverRoot, 'weapp-room-publisher.js'), 'utf8')
const matchLifecycleServer = fs.readFileSync(path.join(serverRoot, 'weapp-match-lifecycle.js'), 'utf8')
const friendRoomSettingsServer = fs.readFileSync(path.join(serverRoot, 'friend-room-settings.js'), 'utf8')
const ratingServer = fs.readFileSync(path.join(serverRoot, 'platform/rating.js'), 'utf8')
const platformService = fs.readFileSync(path.join(serverRoot, 'platform/service.js'), 'utf8')
const matchmakingService = fs.readFileSync(path.join(serverRoot, 'platform/matchmaking-service.js'), 'utf8')
const gameResultService = fs.readFileSync(path.join(serverRoot, 'platform/game-result-service.js'), 'utf8')
const classicStakesServer = fs.readFileSync(path.join(serverRoot, 'platform/classic-stakes.js'), 'utf8')

const artFiles = [
  'entry-classic.jpg', 'entry-friend.jpg', 'entry-tournament.jpg',
  'tier-green.jpg', 'tier-blue.jpg', 'tier-violet.jpg', 'tier-gold.jpg',
  'friend-room-green.jpg', 'shop-float-chick.png', 'coin.png',
]
artFiles.forEach(file => assert.equal(fs.existsSync(path.join(projectRoot, 'assets/game-assets/ui/lobby', file)), true, `${file} must be committed to the game asset bundle`))
const artBytes = artFiles.reduce((total, file) => total + fs.statSync(path.join(projectRoot, 'assets/game-assets/ui/lobby', file)).size, 0)
assert.ok(artBytes < 4 * 1024 * 1024, 'the expanded lobby art set must remain small enough for the downloadable game-assets bundle')
const defaultAvatarPath = path.join(projectRoot, 'assets/game-assets/ui/common/default-avatar.jpg')
assert.equal(fs.existsSync(defaultAvatarPath), true, 'the supplied default avatar image must be committed to the downloadable bundle')
assert.equal(fs.existsSync(`${defaultAvatarPath}.meta`), true, 'the default avatar image must have Cocos metadata')
assert.ok(fs.statSync(defaultAvatarPath).size < 512 * 1024, 'the runtime default avatar must be resized for the WeChat bundle')

assert.match(lobbyCatalog, /entryClassic:[^\n]+entry-classic\/texture/)
assert.match(lobbyCatalog, /entryFriend:[^\n]+entry-friend\/texture/)
assert.match(lobbyCatalog, /entryTournament:[^\n]+entry-tournament\/texture/)
assert.doesNotMatch(lobbyPage, /renderRankMonument|LobbyRankBase|LobbyFloatingGem|rankBase|rankGem/, 'the retired rank monument and floating gem must not return to the lobby runtime')
for (const retiredFile of ['rank-base.png', 'rank-base-leaves.png', 'rank-gem.png', 'rank-gem-leaves.png']) {
  assert.equal(fs.existsSync(path.join(projectRoot, 'assets/game-assets/ui/lobby', retiredFile)), false, `${retiredFile} must stay out of the downloadable bundle`)
}
assert.match(lobbyPage, /ClassicEntryCard[\s\S]*FriendEntryCard[\s\S]*TournamentEntryCard/, 'the main lobby must expose exactly distinguishable classic, friend-room and tournament cards')
assert.match(lobbyCatalog, /score: 50, queueId: 'classic_50'/)
assert.match(lobbyCatalog, /name: '初级场', score: 50/)
assert.match(lobbyCatalog, /score: 300, queueId: 'classic_300'/)
assert.match(lobbyCatalog, /score: 2000, queueId: 'classic_2000'/)
assert.match(lobbyCatalog, /score: 10000, queueId: 'classic_10000'/)
const tierDefinition = lobbyCatalog.match(/const CLASSIC_ROOM_TIERS[\s\S]*?\n\]/)?.[0] ?? ''
assert.doesNotMatch(tierDefinition, /difficulty/, 'classic room tiers must never select AI difficulty')
assert.match(lobbyPage, /startClassicTier[\s\S]*?dependencies\.beginMatch\(tier\.queueId,[\s\S]*?'classic-rooms'\)/, 'classic room cards must enter distinct human matchmaking queues')
assert.match(lobbyPage, /to\(0\.34, \{ position: new Vec3\(targetX, cardY, 0\) \}/, 'classic room cards must enter from right to left')
assert.match(friendRoomPresenter, /describeFriendRoomRules\(this\.settingsDraft\)/, 'rule summary must reflect the selected format')
assert.match(lobbyView, /renderLobbyShop[\s\S]*ShopChickArtwork[\s\S]*'商城'/)
assert.match(lobbyCatalog, /coin:[^\n]+ui\/lobby\/coin\/texture/)
assert.match(lobbyPlayerProfile, /LobbyCoinIcon[\s\S]*LOBBY_ART\.coin/, 'the lobby points row must use the transparent coin asset')
const shopShortcut = lobbyView.slice(lobbyView.indexOf('export function renderLobbyShop'))
assert.match(shopShortcut, /new Node\('ShopShortcut'\)/, 'the shop shortcut container must be transparent')
assert.doesNotMatch(shopShortcut, /ui\.panel\('ShopShortcut'|ShopFade/, 'the transparent shop art must not receive a panel or artificial fade bands')
assert.match(lobbyCatalog, /defaultAvatar:[^\n]+ui\/common\/default-avatar\/texture/, 'the lobby must load the supplied image instead of a text avatar placeholder')
const showMenuSection = lobbyPage.slice(lobbyPage.indexOf('public showMenu'), lobbyPage.indexOf('public renderMenu'))
assert.match(showMenuSection, /if \(this\.dependencies\.gateways\.configured\) \{[\s\S]*this\.dependencies\.player\.invalidate\(\)[\s\S]*this\.dependencies\.wallet\.invalidate\(\)[\s\S]*\}/, 'each online lobby entry must invalidate cached profile and wallet freshness before refreshing')
const profileSection = lobbyPlayerProfile.slice(lobbyPlayerProfile.indexOf('public render'), lobbyPlayerProfile.length)
assert.ok(profileSection.length > 0, 'the horizontal lobby identity lane must exist')
assert.match(profileSection, /const profile = player\.profile \?\? player\.dashboard\?\.user/)
assert.match(profileSection, /platformConfigured && !profile \? '账号同步中'/)
assert.doesNotMatch(profileSection, /localAccountId|ID /)
assert.match(profileSection, /platformConfigured && !wallet\.fresh \? '--'/)
assert.match(profileSection, /LobbyAccountBacking/)
assert.doesNotMatch(profileSection, /id: 'win-rate'|id: 'games'|id: 'comprehensive'|renderPill/, 'detailed performance belongs in the personal center')
assert.match(profileSection, /mountProfileAvatar\(ui\.parent, profile, this\.dependencies\.auth/)
assert.match(profileSection, /leftText\(points, 87, 48, 15, 69\)/)
assert.match(profileSection, /hit\('LobbyPlayerProfileHitArea', 123.5, 121/)
assert.match(profileSection, /LobbyPlayerProfileHitArea[\s\S]*this\.dependencies\.showPlayerCenter/)
assert.doesNotMatch(profileSection, /this\.dependencies\.showNotice\(/)
assert.doesNotMatch(lobbyPlayerProfile, /LOCAL_ACCOUNT_ID_STORAGE_KEY|localStorage\.setItem/, 'removed lobby ID must not retain fake-ID generation')
const personalCenter = read('assets/scripts/scenes/front-pages/PlayerCenterPageDomain.ts')
assert.match(personalCenter, /dashboard\.rating\.games[\s\S]*dashboard\.rating\.wins[\s\S]*综合分[\s\S]*总场数[\s\S]*胜率/, 'performance remains available from authoritative personal-center data')
assert.match(ratingServer, /baseScale: 60_000[\s\S]*priorGames: 50[\s\S]*priorWinRate: 0\.5[\s\S]*winRateExponent: 1\.8[\s\S]*experienceFloor: 0\.3[\s\S]*experienceWeight: 0\.7[\s\S]*experienceReferenceGames: 100[\s\S]*minimumScore: 1_000/, 'the authoritative rating configuration must preserve both win rate and experience weight')
assert.match(ratingServer, /priorWins = config\.priorGames \* config\.priorWinRate[\s\S]*return \(player\.wins \+ priorWins\) \/ \(player\.games \+ config\.priorGames\)/)
assert.match(ratingServer, /config\.experienceFloor \+ config\.experienceWeight \* Math\.log1p\(games\) \/ Math\.log1p\(config\.experienceReferenceGames\)/)
assert.match(ratingServer, /return Math\.max\(config\.minimumScore, calculateBaseScore\(player, config\) \+ player\.eloOffset\)/, 'the authoritative comprehensive score must combine the long-term base with the ELO correction')
assert.match(lobbyPage, /dependencies\.beginMatch\('classic_50', '经典 · 初级场 · 底分50', 'menu'\)/, 'quick start must enter the lowest classic matchmaking queue')
assert.match(matchmakingPage, /returnPage === 'menu'\) this\.dependencies\.showMenu\(\)/, 'quick-start cancellation and failures must return to the main lobby')
const matchErrorSection = read('assets/scripts/services/MatchmakingErrorPresentation.ts')
assert.match(matchErrorSection, /error\.code === 'INSUFFICIENT_CLASSIC_STAKE'/)
assert.match(matchErrorSection, /typeof details\.required === 'number' && Number\.isFinite\(details\.required\)[\s\S]*Math\.max\(0, Math\.round\(details\.required\)\)/, 'classic stake errors must validate and normalize the required points returned by the platform')
assert.match(matchErrorSection, /`积分不足：进入该场至少需要 \$\{required\} 积分`/, 'classic stake errors must tell the player exactly how many points are required')
const prohibitedAudienceClaim = ['真', '人'].join('')
const collectRuntimeSources = root => fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
  const entryPath = path.join(root, entry.name)
  if (entry.isDirectory()) return collectRuntimeSources(entryPath)
  if (/\.(?:test|smoke)\.mjs$/.test(entry.name)) return []
  return /\.(?:ts|js|cjs|mjs)$/.test(entry.name) ? [entryPath] : []
})
for (const filePath of [
  ...collectRuntimeSources(path.join(projectRoot, 'assets/scripts')),
  ...collectRuntimeSources(path.resolve(projectRoot, '../guandan-windows-source/server')),
]) {
  assert.equal(fs.readFileSync(filePath, 'utf8').includes(prohibitedAudienceClaim), false, `${filePath} must not claim the audience type in runtime copy`)
}
assert.doesNotMatch(matchmakingPage, /匹配入桌失败/)
assert.equal((matchmakingPage.match(/this\.failMatch\(/g) ?? []).length, 3, 'join, invalid-ticket and poll failures must offer inline retry instead of abandoning the page')
assert.doesNotMatch(`${gameScene}\n${lobbyController}`, /匹配入桌失败/)
assert.match(gameScene, /showNotice\('比赛匹配失败', '匹配服务返回了不完整的房间凭证'\)/)
assert.match(gameScene, /entryAttemptId: ticket\.entryAttemptId/, 'normal and fixed tournament tickets must preserve the platform-bound entry attempt into WebSocket entry')
assert.match(matchedEntryCoordinator, /this\.fail\('比赛匹配失败，请稍后重试'\)/, 'the matched-entry owner must use the competition-match wording')

const friendTableSection = fs.readFileSync(path.join(projectRoot, 'assets/scripts/scenes/front-pages/FriendRoomWaitingPresenter.ts'), 'utf8')
assert.match(friendTableSection, /ui\.image\(`FriendAvatar-\$\{playerId\}`, this\.defaultAvatar/, 'occupied friend-room seats must render the injected default avatar image')
assert.match(friendTableSection, /botPlayerIds[\s\S]*capabilities\?\.canUseBots[\s\S]*removeBot\(playerId\)[\s\S]*addBot\(playerId\)/, 'only a room whose authoritative capability allows bots may fill and clear seats')
assert.match(friendTableSection, /gameStartPending[\s\S]*if \(!gameStartPending\) this\.compactButton[\s\S]*if \(gameStartPending\) \{\s*return/, 'pending start stays read-only without displaying internal platform confirmation copy')
const friendWaitingSection = gameScene.slice(gameScene.indexOf('private setFriendRoomWaitingVisible'), gameScene.indexOf('private layoutSeats'))
assert.match(friendWaitingSection, /backdropController\?\.setMode\('table'\)/, 'an entered friend room must use the table backdrop instead of the lobby background')

const friendRoomType = lobbyModels.slice(lobbyModels.indexOf('export type FriendRoomSettings'), lobbyModels.indexOf('export const DEFAULT_FRIEND_ROOM_SETTINGS'))
;[
  /mode: 'classic'/,
  /rounds: number/,
  /scoring: 'double-3' \| 'double-4'/,
  /scoreVisibility: 'live' \| 'hidden'/,
  /turnSeconds: 15 \| 20 \| 30 \| 40 \| 60/,
  /trusteeSeconds: 0 \| 15 \| 30 \| 60/,
  /totalTimeMinutes: 0 \| 20 \| 30 \| 60/,
  /spectator: 'off' \| 'live' \| 'delayed-round'/,
  /autoSort: boolean/,
  /disableInteraction: boolean/,
  /sortOrder: 'desc' \| 'asc'/,
  /authoritativeValidation: true/,
].forEach(pattern => assert.match(friendRoomType, pattern, `FriendRoomSettings must include ${pattern}`))
const friendSettingsSection = friendRoomPresenter.slice(friendRoomPresenter.indexOf('public show'), friendRoomPresenter.indexOf('public hide'))
assert.match(friendRoomPresenter, /selectedTab: FriendRoomSettingsTab = 'rules'/)
assert.match(lobbyPage, /new FriendRoomSettingsPresenter\([\s\S]*createRoom: settings => this\.openLobby\(settings\)/, 'the lobby domain must delegate the page draft and rendering to its presenter')
assert.doesNotMatch(lobbyPage, /private friend(?:Stepper|Choice)Row\b/, 'friend-room view helpers must not leak back into lobby orchestration')
assert.match(friendRoomPolicy, /FRIEND_ROOM_SETTINGS_TABS[\s\S]*id: 'rules', label: '基础规则'[\s\S]*id: 'experience', label: '体验设置'/, 'friend-room settings must be split into policy-owned rules and experience tabs')
assert.match(friendRoomPolicy, /FRIEND_ROOM_ROUNDS = Object\.freeze\(\{[\s\S]*minimum: 1,[\s\S]*maximum: 32,[\s\S]*step: 1,/, '定局玩法 supports 1–32 integer hands')
for (const expectedChoice of [
  /id: 'scoring',[^\n]*label: '计分',[^\n]*options: \['双下3分', '双下4分'\]/,
  /id: 'score-visibility',[^\n]*label: '比分',[^\n]*options: \['实时显示', '结算显示'\]/,
  /id: 'turn-seconds',[^\n]*label: '出牌时间',[^\n]*options: \['15秒', '20秒', '30秒', '60秒'\]/,
  /id: 'trustee-seconds',[^\n]*label: '托管',[^\n]*options: \['开启', '关闭'\]/,
  /id: 'total-time',[^\n]*label: '总时长',[^\n]*options: \['不限制', '20分钟', '30分钟', '60分钟'\]/,
  /id: 'spectator',[^\n]*label: '允许观战',[^\n]*options: \['禁止观战', '实时观战', '延迟观战'\]/,
  /id: 'auto-sort',[^\n]*label: '一键理牌',[^\n]*options: \['开启', '关闭'\]/,
  /id: 'sort-order',[^\n]*label: '牌序',[^\n]*options: \['大牌在左', '小牌在左'\]/,
]) assert.match(friendRoomPolicy, expectedChoice)
assert.match(friendSettingsSection, /FRIEND_ROOM_SETTINGS_TABS\.forEach[\s\S]*friendRoomChoiceRows\(this\.settingsDraft, this\.selectedTab\)/, 'the presenter renders policy projections')
assert.match(friendSettingsSection, /updateFriendRoomChoice\(this\.settingsDraft, row\.id, value\)[\s\S]*updateFriendRoomRounds\(this\.settingsDraft, value\)/, 'all friend-room edits flow through the pure policy')
const friendModeTabs = fs.readFileSync(path.join(projectRoot, 'assets/scripts/scenes/front-pages/FriendRoomModeTabs.ts'), 'utf8')
assert.match(friendSettingsSection, /renderFriendRoomModeTabs\(/, 'the presenter delegates mode tabs to their rendering owner')
assert.match(friendModeTabs, /ui\.button\('FriendModeTab',[^\n]*50, Math\.max\(22, Math\.min\(24, width \* 0\.13\)\)/, 'friend-room mode tabs must retain a 22px minimum and 50px container')
assert.match(friendSettingsSection, /ui\.button\('FriendSettingsTab',[^\n]*44, 22,/, 'friend-room settings tabs must retain 22px labels in 44px containers')
assert.match(friendSettingsSection, /compactButton\(ui, '重置',[^\n]*82, 42, 22,/, 'friend-room reset must retain a 22px label and sufficient height')
assert.match(friendRoomPresenter, /ui\.button\('FriendChoice',[^\n]*buttonWidth, 44, Math\.max\(22, Math\.min\(24, buttonWidth \* 0\.17\)\)/, 'friend-room choice buttons must retain a 22px minimum and taller container')

assert.match(safeAreaLayout, /export const resolveSafeHorizontalLane/)
assert.match(safeAreaLayout, /lowerPriorityFirst[\s\S]*entry\.item\.canHide === false[\s\S]*entry\.visible = false/, 'low-priority lane items must leave before protected fields move')
const horizontalLaneSection = safeAreaLayout.slice(safeAreaLayout.indexOf('export const resolveSafeHorizontalLane'), safeAreaLayout.indexOf('const clampCenter'))
const hidePassIndex = horizontalLaneSection.indexOf('entry.visible = false')
const protectedCompressionIndex = horizontalLaneSection.indexOf('// Protected entries cannot leave the safe lane')
assert.ok(hidePassIndex >= 0 && protectedCompressionIndex > hidePassIndex, 'protected fields must only be compressed after hideable low-priority fields have left')
assert.match(horizontalLaneSection.slice(protectedCompressionIndex), /overflow = Math\.max\(0, usedWidth\(\) - laneWidth\)[\s\S]*lowerPriorityFirst\.forEach[\s\S]*entry\.width - 1[\s\S]*entry\.width -= reduction/, 'overflow must be recomputed and protected fields squeezed after the hide pass')
assert.match(horizontalLaneSection, /const width = Math\.min\(entry\.width, Math\.max\(1, laneRight - cursor\)\)[\s\S]*cursor = Math\.min\(laneRight, cursor \+ width \+ layoutGap\)/, 'final widths and cursor movement must be clamped to the safe right boundary')

const serializedGameConfig = gameSceneAsset.find(entry => entry && typeof entry === 'object' && 'lobbyEndpoint' in entry && 'platformEndpoint' in entry)
assert.ok(serializedGameConfig, 'Game.scene must serialize the GameScene network configuration')
assert.equal(serializedGameConfig.lobbyEndpoint, '', 'the release scene must not serialize a localhost lobby endpoint')
assert.equal(serializedGameConfig.platformEndpoint, '', 'the release scene must not serialize a localhost platform endpoint')
assert.equal(serializedGameConfig.platformAllowDevelopmentLogin, false, 'the release scene must not serialize development login')
assert.equal(serializedGameConfig.platformAllowInsecureGameEndpoint, false, 'the release scene must reject insecure game endpoints')
assert.equal(serializedGameConfig.platformAllowInsecureEndpoint, false, 'the release scene must reject insecure platform HTTP')
assert.match(gameScene, /resolveClientNetworkConfig\(\{[\s\S]*lobbyEndpoint: this\.lobbyEndpoint[\s\S]*platformEndpoint: this\.platformEndpoint/, 'validated runtime config must override the empty release scene while preserving localhost preview defaults')
assert.match(gameScene, /getLobbyEndpoint: \(\) => this\.resolvedLobbyEndpoint\(\)/, 'friend rooms must use the environment-resolved lobby endpoint')

assert.match(pageRouter, /'classic-rooms'/)
assert.match(pageRouter, /'friend-room-settings'/)
assert.match(uiFactory, /export const RUNTIME_MIN_TEXT_SIZE = 20/, 'runtime lobby copy must inherit the 20px global minimum')
assert.match(uiFactory, /export const RUNTIME_MIN_BUTTON_TEXT_SIZE = 22/, 'runtime lobby controls must inherit the 22px global minimum')
assert.match(uiFactory, /applyForegroundTextStyle[\s\S]*label\.isBold = true[\s\S]*minimumOutline[\s\S]*Math\.max\(minimumOutline, outlineWidth\)/, 'lobby text must use the common bold, graduated-outline treatment')
assert.match(uiFactory, /label\.enableOutline = true/)
assert.doesNotMatch(uiFactory, /LabelOutline/, 'deprecated LabelOutline components must not be created at runtime')
assert.match(uiFactory, /public imageCard \(/)
assert.match(uiFactory, /loadGameAsset\(assetPath, Texture2D/)

assert.doesNotMatch(lobbyPage, /compactButton\(ui, '规则'|compactButton\(ui, '更多'/)
assert.match(lobbyPage, /ui\.button\('ClassicModeTab',[^\n]*48, Math\.max\(22, Math\.min\(24, leftWidth \* 0\.13\)\)/, 'classic room mode tabs must retain a 22px minimum and 48px container')
assert.match(lobbyPage, /ui\.outlinedLabel\('底分',[^\n]*Math\.max\(20, cardWidth \* 0\.1\)/, 'classic room stake labels must retain the 20px text baseline')
assert.match(lobbyPage, /safeBottomY\(30\), Math\.max\(20, Math\.min\(22, safeHeight \* 0\.038\)\)[\s\S]*height: 36/, 'classic settlement copy must keep readable type and a stable text container')
assert.doesNotMatch(frontPageController, /showMoreMenu|快速开始·人机测试/, 'the retired More menu must not be reconstructed')

assert.doesNotMatch(gameSessionModel, /APPLICATION_AI_DIFFICULTY/, 'local AI defaults must not remain after local mode retirement')
assert.doesNotMatch(gameSession, /import type \{ Difficulty \}/, 'the application session must not expose lower AI difficulty types')
const restoreSessionSection = gameSessionModel.slice(gameSessionModel.indexOf('export const restoreSessionSnapshot'))
assert.match(restoreSessionSection, /const base = createDefaultSessionSnapshot\(\)[\s\S]*\.\.\.base/, 'restored sessions must begin from the master-only default')
assert.doesNotMatch(restoreSessionSection, /difficulty:\s*value\.|\.\.\.value/, 'saved difficulty data must never override the master-only default')
assert.doesNotMatch(gameSession, /setDifficulty\s*\(/)
assert.doesNotMatch(lobbyPage, /切换 AI 难度|setDifficulty\s*\(/)
assert.doesNotMatch(gameManager, /\?\? 'medium'/)
assert.doesNotMatch(gameScene, /\?\? 'medium'/)

;['classic_50', 'classic_300', 'classic_2000', 'classic_10000'].forEach(queueId => {
  assert.match(gatewayContracts, new RegExp(`'${queueId}'`), `${queueId} must be present in the shared client queue registry`)
  assert.match(classicStakesServer, new RegExp(`${queueId}:`), `${queueId} must be present in the authoritative stake registry`)
})
assert.match(matchmakingService, /import \{ CLASSIC_STAKES, classicStakeForMode \} from '\.\/classic-stakes\.js'/)
assert.match(matchmakingService, /\.\.\.Object\.keys\(CLASSIC_STAKES\)/, 'the matchmaking owner must derive accepted classic queues from the stake registry')
assert.match(gameResultService, /import \{ classicStakeForMode, settleClassicStake \} from '\.\/classic-stakes\.js'/, 'the result owner must settle classic stakes through the shared registry')
assert.match(platformApi, /export \{ createHttpGateways \} from '\.\/platform\/factory'/, 'the platform service must retain its stable public facade')
assert.match(competitionDecoders, /import \{ MATCH_QUEUE_IDS \} from '\.\.\/FrontPageGatewayContracts'/, 'match decoders must consume the stable queue registry without depending on development adapters')
assert.match(competitionDecoders, /MATCH_QUEUE_IDS\.includes\(rawQueueId as MatchQueueId\)/, 'match-ticket normalization must validate queue ids against the shared registry')

assert.match(lobbyController, /export type \{[\s\S]*FriendRoomSettings/, 'LobbyController must retain its compatibility type facade')
assert.match(lobbyController, /\{ roomId, hostName, roomSettings \}/, 'friend-room creation must transmit the selected settings')
assert.match(lobbyModels, /next\.roomSettings = message\.roomSettings/, 'room settings must survive entry and reconnect snapshots')
assert.match(friendRoomSettingsServer, /const ROUND_COUNT_MIN = 4[\s\S]*const ROUND_COUNT_MAX = 32/)
assert.match(friendRoomSettingsServer, /const TURN_SECONDS = new Set\(\[15, 20, 30, 40, 60\]\)/)
assert.match(friendRoomSettingsServer, /const TRUSTEE_SECONDS = new Set\(\[0, 15, 30, 60\]\)/)
assert.match(friendRoomSettingsServer, /const TOTAL_TIME_MINUTES = new Set\(\[0, 20, 30, 60\]\)/)
assert.match(friendRoomSettingsServer, /const validRoundCount[\s\S]*value >= ROUND_COUNT_MIN[\s\S]*value <= ROUND_COUNT_MAX[\s\S]*value % 4 === 0/, 'the server must enforce the same round stepper domain')
assert.match(friendRoomSettingsServer, /if \(strict\)[\s\S]*Object\.keys\(source\)\.find\(key => !acceptedFields\.has\(key\)\)[\s\S]*invalid\(`不支持字段 \$\{unknown\}`\)/, 'strict normalization must reject unknown settings')
assert.match(friendRoomSettingsServer, /if \(strict && validationRaw !== true\) invalid\('authoritativeValidation 不能关闭'\)/, 'clients must not disable authoritative validation')
assert.match(friendRoomSettingsServer, /return \{[\s\S]*mode,[\s\S]*rounds,[\s\S]*scoring,[\s\S]*scoreVisibility,[\s\S]*turnSeconds,[\s\S]*trusteeSeconds,[\s\S]*totalTimeMinutes,[\s\S]*spectator,[\s\S]*autoSort,[\s\S]*disableInteraction,[\s\S]*sortOrder,[\s\S]*authoritativeValidation: true/, 'the server must persist every canonical friend-room field')
assert.match(friendRoomSettingsServer, /roomSettings\.scoring !== 'double-4'/, 'double-four scoring must affect authoritative settlement')
assert.match(friendRoomSettingsServer, /roundSequence >= roomSettings\.rounds/, 'round count must stop the authoritative match')
assert.match(friendRoomSettingsServer, /mode: roomSettings\.spectator[\s\S]*allowed: roomSettings\.spectator !== 'off'[\s\S]*delayRounds: roomSettings\.spectator === 'delayed-round' \? 1 : 0/, 'spectator mode must produce an enforceable policy')
assert.match(server, /normalizeFriendRoomSettings/)
assert.match(entryCommandServer, /normalizeFriendRoomSettings\(claims\?\.roomSettings \?\? payload\.roomSettings, \{ strict: true \}\)/, 'ticket-bound settings must take precedence while every room creation path remains strictly normalized')
assert.match(entryCommandServer, /createRoomRecord\(\{[\s\S]*roomSettings: requestedRoomSettings/, 'the normalized settings must be passed into the authoritative room record')
assert.match(roomPublisherServer, /scoreboard: roomSettings\.scoreVisibility === 'live'/, 'score visibility must control authoritative live metadata')
assert.match(roomPublisherServer, /spectatorPolicy: spectatorPolicyFor\(roomSettings\)/, 'spectator policy must be attached to authoritative live metadata')
assert.match(matchLifecycleServer, /room\.totalDeadlineAt = room\.matchStartedAt \+ totalTimeMinutes \* totalMinuteMs/, 'total room duration must arm an authoritative deadline')
assert.match(matchLifecycleServer, /adjustDoubleDownSettlement\(\{[\s\S]*result: settlementEvent\.settlement,[\s\S]*state: transitionResult\.state,[\s\S]*previousTeamLevels: previousState\.teamLevels,[\s\S]*roomSettings,[\s\S]*\}\)/, 'double-four scoring must adjust the atomic settlement emitted by the shared engine')
assert.match(matchLifecycleServer, /hasReachedRoundLimit\(room\.roundSequence, roomSettings\)/)
const turnClockServer = fs.readFileSync(path.join(serverRoot, 'weapp-turn-clock.js'), 'utf8')
assert.doesNotMatch(turnClockServer, /settings\.trusteeSeconds \* friendSecondMs/, 'retired trustee intervals cannot override measured thinking')
assert.match(turnClockServer, /automatic = bot \|\| Boolean\(room\.trustees\[step.playerId\]\)/, 'bots and trustees use the same planning clock')
assert.match(turnClockServer, /settings\.turnSeconds \* friendSecondMs/, 'manual first-play timing must be enforced by the authoritative clock')
assert.doesNotMatch(fs.readFileSync(path.join(serverRoot, 'weapp-game-command-handler.js'), 'utf8'), /type === 'chat'/, 'retired chat has no server handler')

console.log('lobby redesign regression checks passed')
