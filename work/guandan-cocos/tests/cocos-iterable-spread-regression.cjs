// Cocos 3.8 loose array/call spread does not materialize Map/Set iterators.
// Guard the TypeScript types, not identifier spelling or minifier output.
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('./support/typescript.cjs').loadTypeScript()
const root = path.resolve(__dirname, '..')
const options = {
  target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.NodeJs, strict: true, skipLibCheck: true, noEmit: true,
}

function unsafeSpreads (program, files) {
  const checker = program.getTypeChecker()
  function isArray (type) {
    if (type.isUnion()) return type.types.every(isArray)
    const constraint = checker.getBaseConstraintOfType(type)
    return checker.isArrayType(type) || checker.isTupleType(type) ||
      Boolean(constraint && constraint !== type && isArray(constraint))
  }
  const failures = []
  for (const file of files) {
    const source = program.getSourceFile(file)
    assert.ok(source, `source not checked: ${file}`)
    function visit (node) {
      if (ts.isSpreadElement(node) && !isArray(checker.getTypeAtLocation(node.expression))) {
        const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1
        failures.push({ file, line, expression: node.expression.getText(source) })
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return failures
}

const fixture = path.join(root, '__iterable_guard_fixture__.ts')
const source = `
const map = new Map<string, number>(); const set = new Set<number>();
const array = [1, 2]; const readonly: readonly number[] = array;
const tuple: [number, string] = [1, 'a'];
const union: number[] | readonly string[] = array;
const ok = [...array, ...readonly, ...tuple, ...union, ...Array.from(map.values())];
const bad = [[...map], [...map.values()], [...set], [...'abc']];
function call(...args: number[]) {} call(...set); call(...array);
function generic<T extends readonly number[]>(items: T) { return [...items]; }
const object = { ...{ a: 1 } };
`
const host = ts.createCompilerHost(options)
const originalGetSourceFile = host.getSourceFile.bind(host)
host.getSourceFile = (file, language, ...rest) => file === fixture
  ? ts.createSourceFile(file, source, language, true) : originalGetSourceFile(file, language, ...rest)
assert.deepEqual(unsafeSpreads(ts.createProgram([fixture], options, host), [fixture]).map(item => item.expression),
  ['map', 'map.values()', 'set', "'abc'", 'set'], 'the guard must reject iterables but accept array and object spreads')

const files = ts.sys.readDirectory(path.join(root, 'assets/scripts'), ['.ts']).filter(file => !file.endsWith('.d.ts'))
files.push(...ts.sys.readDirectory(path.resolve(root, '../../shared-core/src'), ['.ts']).filter(file => !file.endsWith('.d.ts')))
const failures = unsafeSpreads(ts.createProgram(files, options), files)
assert.deepEqual(failures, [], `Use Array.from(iterable) before spreading in Cocos:\n${failures
  .map(item => `${path.relative(root, item.file)}:${item.line} ...${item.expression}`).join('\n')}`)
console.log(`Cocos iterable compatibility passed: ${files.length} runtime source files; array/call spread types checked`)
