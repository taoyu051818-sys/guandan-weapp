// Audit-only preload. Core source redirect plus owned child-process isolation.
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module')
const cp = require('node:child_process')
const root = path.resolve(__dirname, '../../../..')
const ts = require(path.join(root, 'work/guandan-cocos/tests/support/typescript.cjs')).loadTypeScript()
const oldLoad = Module._load
let redirected = 0
Module._extensions['.ts'] = (m, filename) => m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename)
Module._load = function (name, parent, isMain) {
  if (typeof name === 'string' && parent?.filename && (name.startsWith('.') || path.isAbsolute(name))) {
    const absolute = path.resolve(path.dirname(parent.filename), name)
    const dist = path.join(root, 'shared-core/dist')
    if (absolute === dist || absolute.startsWith(dist + path.sep)) {
      const source = path.join(root, 'shared-core/src', path.relative(dist, absolute))
      const candidate = [source + '.ts', path.join(source, 'index.ts')].find(p => fs.existsSync(p))
      if (!candidate) throw Error('Audit source redirect missing: ' + source)
      redirected++
      return oldLoad.call(this, candidate, parent, isMain)
    }
  }
  return oldLoad.call(this, name, parent, isMain)
}
const allowedHost = value => ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(value)
for (const key of ['GAME_RESULT_ENDPOINT', 'GAME_SPECTATOR_EVENT_ENDPOINT']) {
  if (process.env[key] && !allowedHost(new URL(process.env[key]).hostname)) throw Error('Audit denied external endpoint: ' + key)
}
for (const key of ['WEAPP_ROOM_STATE_FILE', 'GAME_RESULT_OUTBOX_FILE', 'GAME_SPECTATOR_OUTBOX_FILE']) {
  if (process.env[key] && !path.resolve(process.env[key]).startsWith(path.resolve(process.env.TMPDIR) + path.sep)) throw Error('Audit denied non-temporary persistence: ' + key)
}
if (process.env.WEAPP_HOST && !allowedHost(process.env.WEAPP_HOST)) throw Error('Audit denied public listener')
const fetch = globalThis.fetch
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (!allowedHost(url.hostname)) throw Error('Audit denied external fetch')
  return fetch(input, options)
}
const children = new Set()
const spawn = cp.spawn
cp.spawn = function (command, args, options = {}) {
  if (command !== process.execPath || !args?.some(a => a === 'server/weapp-ws.js')) throw Error('Audit denied unexpected child process')
  const env = { ...(options.env || process.env), NODE_ENV: 'test', WEAPP_HOST: '127.0.0.1',
    TMPDIR: process.env.TMPDIR, NODE_OPTIONS: '--require=' + __filename }
  const child = spawn(command, args, { ...options, env })
  children.add(child); child.once('close', () => children.delete(child))
  return child
}
Module.syncBuiltinESMExports()
process.once('exit', () => {
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  process.stderr.write('AUDIT32_SOURCE=' + JSON.stringify({ entry: path.basename(process.argv[1]), redirects: redirected }) + '\n')
})
