// Load the delivered System.register JavaScript, never re-transpile the source.
// Pure gameplay runs unchanged; Cocos rendering/native services remain test doubles.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')

function createBuiltRuntime (target = 'wechatgame', overrides = {}) {
  assert.ok(['wechatgame', 'web-desktop'].includes(target), 'unknown build target')
  const registrations = new Map()
  const cache = new Map()
  const substitutes = {
    cc: {
      cclegacy: { _RF: { push () {}, pop () {} } }, game: { restart: () => Promise.resolve() },
      Component: class {}, _decorator: { ccclass: () => value => value },
    },
    ...overrides,
  }
  const context = vm.createContext({
    URL: undefined, URLSearchParams: undefined, crypto: undefined, console, setTimeout, clearTimeout,
    System: { register (name, deps, declare) {
      if (Array.isArray(name)) {
        assert.equal(name.length, 0, 'only the dependency-free generated chunk wrapper is expected')
        deps(() => {}, {}).execute()
        return
      }
      registrations.set(name, { deps, declare })
    } },
  })
  for (const relative of ['src/chunks/bundle.js', 'assets/main/index.js']) {
    const file = path.resolve(__dirname, '../../build', target, relative)
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file })
  }
  function load (id) {
    if (substitutes[id]) return substitutes[id]
    if (cache.has(id)) return cache.get(id)
    const entry = registrations.get(id)
    assert.ok(entry, `missing built module ${id}`)
    const result = {}
    cache.set(id, result)
    const body = entry.declare((key, value) => {
      if (typeof key === 'object') { Object.assign(result, key); return key }
      result[key] = value
      return value // SystemJS _export also returns the assigned value.
    }, { id })
    entry.deps.forEach((dep, index) => {
      const resolved = dep.startsWith('./') ? id.slice(0, id.lastIndexOf('/') + 1) + dep.slice(2) : dep
      body.setters[index]?.(load(resolved))
    })
    body.execute()
    return result
  }
  return { get: name => load(`chunks:///_virtual/${name}.ts`), context }
}

module.exports = { createBuiltRuntime }
