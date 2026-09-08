const fs = require('node:fs')
const { loadTypeScript } = require('./typescript.cjs')
const ts = loadTypeScript()

/** Load actual TS with explicit runtime ports; unexpected dependencies fail instead of being hidden. */
exports.loadTs = (file, dependencies = {}) => {
  const module = { exports: {} }
  const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, experimentalDecorators: true },
    fileName: file,
  })
  new Function('exports', 'require', result.outputText)(module.exports, key => {
    if (key in dependencies) return dependencies[key]
    throw new Error(`unexpected dependency ${key} in ${file}`)
  })
  return module.exports
}
