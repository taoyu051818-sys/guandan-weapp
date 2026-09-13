// Audit-only exact source mutations. The files on disk remain unchanged.
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module')
const { pathToFileURL } = require('node:url')
require('./server-test-preload-32.cjs')
const mutations = {
  privateHand: { file: 'game-session-projection.js',
    from: 'projected.players[id].hand.map((_, index) => ({ id: `hidden-${id}-${index}` }))',
    to: 'projected.players[id].hand.map(card => ({ ...card }))' },
  privateTribute: { file: 'game-session-projection.js',
    from: "tributeCardId: projected.tribute.status === 'selecting_tribute' && exchange.from !== viewerId",
    to: 'tributeCardId: false' },
  replayConflict: { file: 'weapp-command-gateway.js',
    from: 'if (previousAccepted.fingerprint !== requestFingerprint)',
    to: 'if (false && previousAccepted.fingerprint !== requestFingerprint)' },
  durablePublish: { file: 'weapp-match-lifecycle.js',
    from: 'await commitPendingRoundFinalization()',
    to: 'publishRoundEnded(room, pending.result); await commitPendingRoundFinalization()' },
  revokedTicket: { file: 'friend-room-observer-runtime.js',
    from: 'if (room.revokedTicketJtis?.some(item => item.jti === claims.jti))',
    to: 'if (false && room.revokedTicketJtis?.some(item => item.jti === claims.jti))' },
}
const id = process.env.AUDIT33_MUTATION
assert.ok(mutations[id], 'select a fixed audit mutation')
const mutation = mutations[id]
const target = path.resolve(__dirname, '../../../../work/guandan-windows-source/server', mutation.file)
Module.registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context)
  if (url !== pathToFileURL(target).href) return result
  const code = Buffer.isBuffer(result.source) ? result.source.toString('utf8') : String(result.source)
  assert.equal(code.split(mutation.from).length, 2, 'audit mutation requires exactly one source target')
  fs.appendFileSync(path.join(process.env.TMPDIR, 'audit33-mutation-hits.jsonl'),
    JSON.stringify({ id, file: mutation.file, entry: path.basename(process.argv[1]), replacements: 1 }) + '\n')
  return { ...result, source: code.replace(mutation.from, mutation.to) }
} })
// Base safety preload deliberately replaces NODE_OPTIONS. Carry this reviewed
// mutation preload as an explicit node argument into only the allowed child.
const cp = require('node:child_process'), spawn = cp.spawn
cp.spawn = function (command, args, options) {
  return spawn(command, ['--require', __filename, ...args], options)
}
Module.syncBuiltinESMExports()
