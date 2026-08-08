const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const lobby = fs.readFileSync(path.join(projectRoot, 'assets/scripts/network/LobbyController.ts'), 'utf8')
const game = fs.readFileSync(path.join(projectRoot, 'assets/scripts/scenes/GameScene.ts'), 'utf8')
const handWorkspace = fs.readFileSync(path.join(projectRoot, 'assets/scripts/game/HandWorkspace.ts'), 'utf8')

assert.match(lobby, /export type NetworkScoreboard = \{[\s\S]*roundsPlayed: number[\s\S]*currentLevel: Rank[\s\S]*teamLevels: Record<'teamA' \| 'teamB', Rank>/)
assert.match(lobby, /export type LobbySnapshot = \{[\s\S]*scoreboard\?: NetworkScoreboard \| null/)
assert.equal((lobby.match(/scoreboard\?: NetworkScoreboard \| null/g) ?? []).length, 3, 'snapshot, entry wire and live metadata wire must all accept scoreboard')
const metadata = lobby.slice(lobby.indexOf('private applyLiveMetadata'), lobby.indexOf('private acceptVersion'))
assert.match(metadata, /hasOwnProperty\.call\(message, 'scoreboard'\)[\s\S]*next\.scoreboard = message\.scoreboard \?\? null/, 'metadata must distinguish an omitted scoreboard from an authoritative null')
assert.ok((lobby.match(/scoreboard: null/g) ?? []).length >= 5, 'scoreboard must be initialized and cleared across room identity transitions')

const render = game.slice(game.indexOf('private render (snapshot'), game.indexOf('private renderTableHud'))
assert.match(render, /const handSortOrder = this\.effectiveHandSortOrder\(\)/)
assert.match(render, /this\.handWorkspace\.syncAuthoritativeHand\(humanHand, \{[\s\S]*autoSort: !friendRoomSettings \|\| friendRoomSettings\.autoSort/, 'the scene must pass friend-room auto-sort policy into one authoritative hand transaction')
assert.match(handWorkspace, /if \(signature === this\.authoritativeSignature\) return false[\s\S]*if \(options\.autoSort\) this\.grouping\.arrange/, 'auto sort must run once behind the authoritative hand signature guard')
assert.match(game, /if \(packet\.effectSync\.mode === 'recovery'\) this\.handWorkspace\.invalidateAuthoritativeHand\(\)/, 'a recovered table snapshot must be treated as a fresh authoritative hand')

const friendSettings = game.slice(game.indexOf('private activeFriendRoomSettings'), game.indexOf('private tableHudCardCounts'))
assert.match(friendSettings, /lobby\.lobbyReadyRequired !== true/, 'ticket matchmaking rooms must not inherit friend-room presentation restrictions')
assert.doesNotMatch(friendSettings, /scoreVisibility|PlayerPoints|shouldHideFriendRoomScore|setTableHudSeatScoresVisible/, 'score visibility must not leak into a level-only table HUD')

const tableHud = game.slice(game.indexOf('private renderTableHud'), game.indexOf('private activeFriendRoomSettings'))
assert.match(tableHud, /levelLabel: `我方 \$\{String\(teamLevels\[viewerTeam\]\)\}级 · 对方 \$\{String\(teamLevels\[opponentTeam\]\)\}级`/, 'the table summary must retain team levels')
assert.doesNotMatch(tableHud, /snapshot\.scores|scoreLabel|teamScore|比分/, 'the live table must not duplicate levels with a score display')

const chat = game.slice(game.indexOf('private toggleChatPanel'), game.indexOf('private arrangeTableHudHand'))
const firstInteractionGuard = chat.indexOf("this.activeFriendRoomSettings()?.disableInteraction")
const localChatMutation = chat.indexOf('this.chat?.send')
const localVoicePlayback = chat.indexOf('this.audio?.playVoice')
assert.ok(firstInteractionGuard >= 0 && firstInteractionGuard < chat.indexOf('QUICK_CHAT_PHRASES.forEach'), 'disabled rooms must not open the quick-chat panel')
assert.ok(chat.lastIndexOf("this.activeFriendRoomSettings()?.disableInteraction", localChatMutation) > firstInteractionGuard, 'the phrase handler must recheck the immutable room policy')
assert.ok(localChatMutation > firstInteractionGuard && localVoicePlayback > localChatMutation, 'interaction policy must run before local bubble creation and voice playback')

console.log('friend-room runtime settings regression checks passed')
