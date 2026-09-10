const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
for (const name of ['ChatController', 'QuickChatPolicy']) {
  assert.equal(fs.existsSync(path.join(root, 'assets/scripts/ui', name + '.ts')), false)
  assert.equal(fs.existsSync(path.join(root, 'assets/scripts/ui', name + '.ts.meta')), false)
}
for (const file of ['scenes/GameScene.ts', 'scenes/TableOverlayController.ts', 'ui/TableGameHud.ts', 'ui/RuntimeUiFactory.ts', 'network/LobbyController.ts', 'network/LobbyMessageRouter.ts']) {
  const source = fs.readFileSync(path.join(root, 'assets/scripts', file), 'utf8')
  assert.doesNotMatch(source, /QuickChat|quickChat|guandan:chat|toggleChatPanel|onChat/)
}
const hud = fs.readFileSync(path.join(root, 'assets/scripts/ui/TableGameHud.ts'), 'utf8')
assert.match(hud, /'TableTrustee', '托管'/)
assert.match(hud, /onTrustee/)
assert.match(hud, /'取消托管'/)
console.log('Shortcut chat retired; toolbar trustee replaces its entry')
