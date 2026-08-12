const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTypeScript } = require('./support/typescript.cjs')

const projectRoot = path.resolve(__dirname, '..')
const sourcePath = path.join(projectRoot, 'assets/scripts/scenes/TableNetworkEventBridge.ts')
const ts = loadTypeScript()

assert.equal(fs.existsSync(sourcePath), true, 'the table network event bridge source must exist')
assert.equal(fs.existsSync(`${sourcePath}.meta`), true, 'the table network event bridge must be imported by Cocos')

const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  fileName: sourcePath,
  reportDiagnostics: true,
})
const errors = (output.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
assert.deepEqual(errors, [], 'TableNetworkEventBridge must transpile')
const moduleRecord = { exports: {} }
new Function('exports', 'module', 'require', output.outputText)(moduleRecord.exports, moduleRecord, request => {
  throw new Error(`unexpected runtime dependency ${request}`)
})
const { TableNetworkEventBridge } = moduleRecord.exports

class FakeEvents {
  listeners = new Map()
  onCalls = []
  offCalls = []

  on (eventName, callback, target) {
    this.onCalls.push(eventName)
    const listeners = this.listeners.get(eventName) ?? []
    listeners.push({ callback, target })
    this.listeners.set(eventName, listeners)
  }

  off (eventName, callback, target) {
    this.offCalls.push(eventName)
    const listeners = this.listeners.get(eventName) ?? []
    this.listeners.set(eventName, listeners.filter(listener => listener.callback !== callback || listener.target !== target))
  }

  emit (eventName, ...args) {
    for (const listener of this.listeners.get(eventName) ?? []) listener.callback.apply(listener.target, args)
  }
}

const forwarded = []
const events = new FakeEvents()
const bridge = new TableNetworkEventBridge(events, {
  onLobby: value => forwarded.push(['lobby', value]),
  onNetworkState: value => forwarded.push(['state', value]),
  onRoundPrepared: value => forwarded.push(['prepared', value]),
  onRoundEnded: value => forwarded.push(['round-ended', value]),
  onMatchEnded: value => forwarded.push(['match-ended', value]),
  onNetworkResult: value => forwarded.push(['result', value]),
  onNetworkError: value => forwarded.push(['error', value]),
  onRoomClosed: (message, options) => forwarded.push(['room-closed', message, options]),
  onPresentationChanged: () => forwarded.push(['presentation']),
  onTurnTimeout: value => forwarded.push(['timeout', value]),
})

const eventNames = [
  'guandan:lobby', 'guandan:network-state', 'guandan:round-prepared', 'guandan:round-ended',
  'guandan:match-ended', 'guandan:network-result', 'guandan:network-error', 'guandan:room-closed',
  'guandan:trustee', 'guandan:round-ready', 'guandan:turn-deadline', 'guandan:turn-timeout',
]

bridge.mount()
bridge.mount()
assert.deepEqual(events.onCalls, eventNames, 'mount must bind each Lobby event exactly once')

const payload = { marker: 'same-object' }
events.emit('guandan:lobby', payload)
events.emit('guandan:network-state', payload)
events.emit('guandan:round-prepared', payload)
events.emit('guandan:round-ended', payload)
events.emit('guandan:match-ended', payload)
events.emit('guandan:network-result', payload)
events.emit('guandan:network-error', 'offline')
events.emit('guandan:room-closed', 'closed', { compensateReservation: false })
events.emit('guandan:trustee')
events.emit('guandan:round-ready')
events.emit('guandan:turn-deadline')
events.emit('guandan:turn-timeout', payload)
assert.deepEqual(forwarded, [
  ['lobby', payload], ['state', payload], ['prepared', payload], ['round-ended', payload],
  ['match-ended', payload], ['result', payload], ['error', 'offline'],
  ['room-closed', 'closed', { compensateReservation: false }],
  ['presentation'], ['presentation'], ['presentation'], ['timeout', payload],
], 'the bridge must preserve payload identity and consolidate presentation-only events')

bridge.dispose()
bridge.dispose()
assert.deepEqual(events.offCalls, eventNames, 'dispose must unbind every owned listener exactly once')
assert.equal(Array.from(events.listeners.values()).every(listeners => listeners.length === 0), true, 'dispose must leave no retained listener')
events.emit('guandan:lobby', { marker: 'late' })
bridge.mount()
assert.equal(forwarded.length, 12, 'late events and remounts must stay inert after disposal')

process.stdout.write('table network event bridge regression checks passed\n')
