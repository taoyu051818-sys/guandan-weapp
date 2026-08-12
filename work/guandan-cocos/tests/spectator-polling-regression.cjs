const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const { loadTypeScript, typescriptPath } = require('./support/typescript.cjs')
const ts = loadTypeScript()
const compile = (sourcePath) => {
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  }).outputText
  const runtime = new Module(sourcePath, module)
  runtime.filename = sourcePath
  runtime.paths = Module._nodeModulePaths(path.dirname(sourcePath))
  const previousTypeScriptLoader = Module._extensions['.ts']
  Module._extensions['.ts'] = (targetModule, filename) => {
    const dependency = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      fileName: filename,
    }).outputText
    targetModule._compile(dependency, filename)
  }
  try {
    runtime._compile(output, sourcePath)
  } finally {
    if (previousTypeScriptLoader) Module._extensions['.ts'] = previousTypeScriptLoader
    else delete Module._extensions['.ts']
  }
  return runtime.exports
}

const {
  SPECTATOR_MAX_RETRY_DELAY_SECONDS,
  SPECTATOR_POLL_INTERVAL_SECONDS,
  shouldStopSpectatorPolling,
  spectatorRetryDelaySeconds,
} = compile(path.join(root, 'assets/scripts/replay/SpectatorPollingPolicy.ts'))
const { DevelopmentSpectatorGateway } = compile(path.join(root, 'assets/scripts/services/DevelopmentApis.ts'))

assert.equal(SPECTATOR_POLL_INTERVAL_SECONDS, 3)
assert.equal(SPECTATOR_MAX_RETRY_DELAY_SECONDS, 12)
assert.deepEqual([1, 2, 3, 4, 99].map(spectatorRetryDelaySeconds), [3, 6, 12, 12, 12])
assert.equal(spectatorRetryDelaySeconds(Number.NaN), 3)
assert.equal(shouldStopSpectatorPolling({ status: 'running', timelineComplete: false }), false)
assert.equal(shouldStopSpectatorPolling({ status: 'finished', timelineComplete: false }), false, 'terminal status must keep polling until the delayed tail is public')
assert.equal(shouldStopSpectatorPolling({ status: 'aborted', timelineComplete: false }), false)
assert.equal(shouldStopSpectatorPolling({ status: 'finished', timelineComplete: true }), true)
assert.equal(shouldStopSpectatorPolling({ status: 'aborted', timelineComplete: true }), true)

void (async () => {
  const development = new DevelopmentSpectatorGateway()
  const first = await development.getFeed('demo-live-match', 30)
  const second = await development.getFeed('demo-live-match', 30)
  const third = await development.getFeed('demo-live-match', 30)
  assert.equal(first.status, 'playing', 'development coverage must use the canonical active status')
  assert.deepEqual(first.events.map(event => event.sequence), [1, 2, 3], 'development feed must begin with a reviewable delayed prefix')
  assert.deepEqual(second.events.map(event => event.sequence), [1, 2, 3, 4])
  assert.deepEqual(third.events.map(event => event.sequence), [1, 2, 3, 4, 5], 'development polling must visibly demonstrate incremental follow mode')
  assert.equal(third.totalEventCount, 5)
  const finished = await development.getFeed('demo-match', 30)
  assert.equal(finished.status, 'completed', 'development coverage must use the canonical completed status')
  assert.equal(finished.events.length, 6)
  assert.equal(finished.timelineComplete, true)
  process.stdout.write('spectator polling policy and development feed regression checks passed\n')
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
