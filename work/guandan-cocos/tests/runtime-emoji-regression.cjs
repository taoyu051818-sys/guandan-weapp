const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const runtimeSourceRoot = path.join(projectRoot, 'assets/scripts')
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const forbiddenCodePoint = /[\u2190-\u21FF\u2300-\u23FF\u2600-\u27BF\u{1F000}-\u{1FAFF}\uFE0F\u200D]/gu

function sourceFiles (directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) return sourceFiles(entryPath)
      return sourceExtensions.has(path.extname(entry.name)) ? [entryPath] : []
    })
}

function codePointName (value) {
  return `U+${value.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`
}

function findViolations (filePath) {
  const relativePath = path.relative(projectRoot, filePath)
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).flatMap((line, lineIndex) => {
    forbiddenCodePoint.lastIndex = 0
    return Array.from(line.matchAll(forbiddenCodePoint), match => (
      `${relativePath}:${lineIndex + 1}:${match.index + 1} ${codePointName(match[0])}`
    ))
  })
}

assert.equal(fs.existsSync(runtimeSourceRoot), true, 'runtime source directory must exist')
const violations = sourceFiles(runtimeSourceRoot).sort().flatMap(findViolations)
assert.deepEqual(
  violations,
  [],
  `runtime source must use packaged image assets instead of host emoji or symbol glyphs:\n${violations.join('\n')}`,
)

console.log('runtime emoji regression checks passed')
