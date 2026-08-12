const fs = require('node:fs')
const path = require('node:path')

const cocosTypeScriptRoot = '/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/resources/3d/engine/node_modules/typescript'
const packageTypeScriptRoot = path.dirname(require.resolve('typescript/package.json'))
const useCocosCompiler = process.env.GUANDAN_FORCE_PACKAGE_TYPESCRIPT !== '1' && fs.existsSync(cocosTypeScriptRoot)
const typescriptPath = useCocosCompiler ? cocosTypeScriptRoot : packageTypeScriptRoot
const compilerPath = path.join(typescriptPath, 'lib/typescript.js')

const loadTypeScript = () => require(compilerPath)

module.exports = { compilerPath, loadTypeScript, typescriptPath }
