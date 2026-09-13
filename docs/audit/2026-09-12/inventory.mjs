// Audit-only manifest generator. Writes no files: prints an apply_patch payload.
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, readdirSync, lstatSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const audit = dirname(fileURLToPath(import.meta.url))
const root = resolve(audit, '../../..')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trimEnd()
const category = path => {
  if (/\/third_party\//.test(path)) return 'third-party-boundary'
  if (/\/core\/generated\/.*\.ts$/.test(path)) return 'generated-core'
  if (/\.meta$/.test(path)) return 'asset-metadata-boundary'
  if (/(^|\/)(?:LICENSE[^/]*|NOTICE[^/]*|[^/]+\.md|[^/]+\.txt)$/i.test(path)) return 'documentation-boundary'
  if (/\.(?:ts|tsx|js|jsx|mjs|cjs|py|sh|ps1|bat|cmd|html|css|effect|ejs)$/.test(path)) return 'first-party-code'
  if (/\.(?:json|yaml|yml|toml|scene|prefab|xml|lock|service|conf)$/.test(path) || /(^|\/)(?:Dockerfile|\.gitignore|\.npmrc|\.env\.example|\.wechatgame)$/.test(path)) return 'first-party-config'
  return 'resource-boundary'
}
const paths = git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean)
const files = Array.from(new Set(paths)).filter(path => !path.startsWith('docs/audit/') && existsSync(resolve(root, path)))
  .sort().map(path => {
    const absolute = resolve(root, path), stat = lstatSync(absolute)
    if (!stat.isFile()) return { path, category: 'filesystem-boundary', sha256: null, bytes: stat.size }
    const data = readFileSync(absolute)
    return { path, category: category(path), sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length }
  })
const reports = existsSync(resolve(audit, 'batches')) ? readdirSync(resolve(audit, 'batches')).filter(path => path.endsWith('.json')).map(path => ({
  path: `batches/${path}`, data: JSON.parse(readFileSync(resolve(audit, 'batches', path), 'utf8')),
})) : []
const reviews = new Map()
for (const report of reports) for (const item of report.data.reviewed ?? []) {
  reviews.set(item.path, { ...item, report: report.path })
}
// Boundary checks are intentionally separate from complete first-party source review.
const boundaryReviews = new Map()
for (const report of reports) for (const item of report.data.boundaryReviewed ?? []) {
  if (boundaryReviews.has(item.path)) throw new Error(`Duplicate boundary review: ${item.path}`)
  const file = files.find(file => file.path === item.path)
  if (!file || !file.category.endsWith('-boundary') || file.category !== item.category) throw new Error(`Invalid boundary category: ${item.path}`)
  boundaryReviews.set(item.path, { ...item, report: report.path })
}
const entries = files.map(file => {
  const review = reviews.get(file.path)
  if (review) return { path: file.path, status: review.sha256 === file.sha256 ? 'reviewed' : 'changed-requires-review', report: review.report }
  if (file.category === 'generated-core') {
    const source = file.path.replace('work/guandan-cocos/assets/scripts/core/generated/', 'shared-core/src/')
    const sourceFile = files.find(item => item.path === source), sourceReview = reviews.get(source)
    return { path: file.path, status: sourceFile?.sha256 === file.sha256 && sourceReview?.sha256 === file.sha256 ? 'source-reviewed-sync-verified' : 'pending-source-review', source }
  }
  const boundary = boundaryReviews.get(file.path)
  if (boundary) return { path: file.path, status: boundary.sha256 === file.sha256 ? 'boundary-checked' : 'boundary-changed-requires-review', report: boundary.report, group: boundary.group }
  return { path: file.path, status: file.category.startsWith('first-party-') ? 'pending' : 'boundary-pending' }
})
const targets = files.filter(file => file.category.startsWith('first-party-'))
const covered = targets.filter(file => entries.find(entry => entry.path === file.path).status === 'reviewed').length
const totals = Object.fromEntries(Array.from(new Set(files.map(file => file.category))).map(kind => [kind, files.filter(file => file.category === kind).length]))
const boundaryCoverage = Object.fromEntries(Object.keys(totals).filter(kind => kind.endsWith('-boundary')).map(kind => [kind, {
  checked: files.filter(file => file.category === kind && entries.find(entry => entry.path === file.path).status === 'boundary-checked').length,
  total: totals[kind],
}]))
const manifest = { schema: 1, repository: root, head: git('rev-parse', 'HEAD'), capturedAt: new Date().toISOString(),
  scope: 'Git tracked plus untracked nonignored files; audit artifacts excluded. Ignored build/runtime/dependencies require separate boundary checks, not counted as reviewed source.',
  dirty: git('status', '--short').split('\n').filter(line => line && !line.includes('docs/audit/')), totals, files }
const coverage = { schema: 1, updatedAt: new Date().toISOString(), head: manifest.head, totalFirstParty: targets.length,
  reviewedFirstParty: covered, percent: targets.length ? +(100 * covered / targets.length).toFixed(2) : 0,
  generatedVerified: entries.filter(entry => entry.status === 'source-reviewed-sync-verified').length,
  boundaryCoverage,
  important: 'Manual review coverage, not test coverage or a guarantee of no defects. Boundary and cross-module review remain separate completion gates.', entries }
if (process.argv.includes('--check')) {
  for (const [name, expected, timestamp] of [['manifest.json', manifest, 'capturedAt'], ['coverage.json', coverage, 'updatedAt']]) {
    const actual = JSON.parse(readFileSync(resolve(audit, name), 'utf8'))
    actual[timestamp] = expected[timestamp]
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${name} is stale or inconsistent`)
  }
  console.log(`Audit inventory verified: ${covered}/${targets.length} first-party files; ${coverage.generatedVerified} generated copies; ${entries.filter(entry => entry.status === 'boundary-checked').length} separately checked boundaries.`)
  process.exit(0)
}
let patch = '*** Begin Patch\n'
// Emit small exact-context hunks so a full inventory refresh cannot exhaust tool output.
const diffHunks = (before, after) => {
  const oldLines = before.trimEnd().split('\n'), newLines = after.trimEnd().split('\n')
  let i = 0, j = 0, out = ''
  while (i < oldLines.length || j < newLines.length) {
    if (oldLines[i] === newLines[j] && i < oldLines.length && j < newLines.length) { i++; j++; continue }
    const startI = i, startJ = j
    let endI = oldLines.length, endJ = newLines.length, found = false
    // Six stable lines normally include a unique path; the preceding path stays in context.
    for (let distance = 1; distance <= 512 && !found; distance++) {
      for (let a = Math.max(0, distance - (newLines.length - j)); a <= distance && i + a < oldLines.length; a++) {
        const b = distance - a
        if (j + b >= newLines.length) continue
        const remaining = Math.min(6, oldLines.length - i - a, newLines.length - j - b)
        if (remaining < 6 && oldLines.length - i - a !== newLines.length - j - b) continue
        if (Array.from({ length: remaining }, (_, k) => oldLines[i + a + k] === newLines[j + b + k]).every(Boolean)) {
          endI = i + a; endJ = j + b; found = true; break
        }
      }
    }
    out += '@@\n' + oldLines.slice(Math.max(0, startI - 3), startI).map(line => ' ' + line).join('\n') + '\n'
    out += oldLines.slice(startI, endI).map(line => '-' + line).join('\n') + (endI > startI ? '\n' : '')
    out += newLines.slice(startJ, endJ).map(line => '+' + line).join('\n') + (endJ > startJ ? '\n' : '')
    out += oldLines.slice(endI, Math.min(oldLines.length, endI + 3)).map(line => ' ' + line).join('\n') + (endI < oldLines.length ? '\n' : '')
    i = endI; j = endJ
  }
  return out
}
for (const [name, value] of [['manifest.json', manifest], ['coverage.json', coverage]]) {
  const path = resolve(audit, name), text = JSON.stringify(value, null, 2) + '\n'
  if (existsSync(path)) {
    const hunks = diffHunks(readFileSync(path, 'utf8'), text)
    if (hunks) patch += `*** Update File: ${path}\n` + hunks
  } else patch += `*** Add File: ${path}\n` + text.trimEnd().split('\n').map(line => '+' + line).join('\n') + '\n'
}
process.stdout.write(patch + '*** End Patch\n')
