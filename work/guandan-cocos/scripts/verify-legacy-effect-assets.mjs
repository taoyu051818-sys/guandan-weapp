import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, extname, isAbsolute, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const defaultManifestPath = resolve(projectRoot, 'third_party/legacy-effects/manifest.json')
const shaPattern = /^[a-f0-9]{64}$/
const commitPattern = /^[a-f0-9]{40}$/
const allowedMigrationModes = new Set(['adapt-clip', 'adapt-graph', 'extract-timing'])

function usage () {
  return [
    'Usage: node scripts/verify-legacy-effect-assets.mjs [options]',
    '',
    '  --manifest <path>     Override the compliance manifest.',
    '  --source-root <path>  Verify every source hash against a local checkout.',
    '  --strict-source       Require a source checkout (argument or LEGACY_EFFECT_SOURCE_ROOT).',
    '  --help                Show this message.',
  ].join('\n')
}

function parseArguments (argv) {
  const options = {
    manifestPath: defaultManifestPath,
    sourceRoot: process.env.LEGACY_EFFECT_SOURCE_ROOT || null,
    strictSource: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help') {
      process.stdout.write(`${usage()}\n`)
      process.exit(0)
    }
    if (argument === '--strict-source') {
      options.strictSource = true
      continue
    }
    if (argument === '--manifest' || argument === '--source-root') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a path`)
      index += 1
      if (argument === '--manifest') options.manifestPath = resolve(process.cwd(), value)
      else options.sourceRoot = resolve(process.cwd(), value)
      continue
    }
    throw new Error(`unknown argument: ${argument}\n\n${usage()}`)
  }
  return options
}

function sha256 (buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function isSafeRelativePath (value) {
  if (typeof value !== 'string' || value.length === 0 || isAbsolute(value) || value.includes('\\')) return false
  const normalized = posix.normalize(value)
  return normalized === value && normalized !== '..' && !normalized.startsWith('../')
}

async function walkFiles (root, predicate = () => true) {
  if (!existsSync(root)) return []
  const result = []
  const pending = [root]
  while (pending.length > 0) {
    const directory = pending.pop()
    const children = await readdir(directory, { withFileTypes: true })
    for (const child of children) {
      const childPath = resolve(directory, child.name)
      if (child.isDirectory()) pending.push(childPath)
      else if (child.isFile() && predicate(childPath)) result.push(childPath)
    }
  }
  return result.sort()
}

function validateManifestShape (manifest, errors) {
  const check = (condition, message) => {
    if (!condition) errors.push(message)
  }

  check(manifest?.schemaVersion === 1, 'schemaVersion must be 1')
  check(/^https:\/\/github\.com\/niuma-wj\/client-cocos(?:\.git)?$/.test(manifest?.source?.repository ?? ''), 'source.repository must identify niuma-wj/client-cocos')
  check(commitPattern.test(manifest?.source?.commit ?? ''), 'source.commit must be a full 40-character Git commit')
  check(manifest?.license?.spdx === 'MIT', 'license.spdx must be MIT')
  check(shaPattern.test(manifest?.license?.sourceSha256 ?? ''), 'license.sourceSha256 must be SHA-256')
  check(isSafeRelativePath(manifest?.license?.copiedPath), 'license.copiedPath must be a safe relative path')
  check(shaPattern.test(manifest?.license?.copiedSha256 ?? ''), 'license.copiedSha256 must be SHA-256')
  check(manifest?.runtimePolicy?.runtimeAssetRoot === 'assets', 'runtimePolicy.runtimeAssetRoot must remain assets')
  check(manifest?.runtimePolicy?.defaultDecision === 'rejected', 'unlisted legacy effect assets must default to rejected')
  check(manifest?.runtimePolicy?.allowedRequiresExplicitEntry === true, 'allowed assets must require an explicit manifest entry')
  check(manifest?.runtimePolicy?.rejectedHashScan === true, 'rejected hash scanning must remain enabled')
  check(manifest?.runtimePolicy?.copyUpstreamMeta === false, 'upstream Cocos .meta files must remain excluded')
  check(Array.isArray(manifest?.entries), 'entries must be an array')

  const ids = new Set()
  const sourcePaths = new Set()
  const targetPaths = new Set()
  for (const [index, entry] of (manifest.entries ?? []).entries()) {
    const label = `entries[${index}]${entry?.id ? ` (${entry.id})` : ''}`
    check(typeof entry?.id === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(entry.id), `${label}: id must be kebab-case`)
    check(!ids.has(entry?.id), `${label}: duplicate id`)
    ids.add(entry?.id)
    check(typeof entry?.category === 'string' && entry.category.length > 0, `${label}: category is required`)
    check(entry?.status === 'allowed' || entry?.status === 'rejected', `${label}: status must be allowed or rejected`)
    check(isSafeRelativePath(entry?.sourcePath), `${label}: sourcePath must be a safe relative path`)
    check(!sourcePaths.has(entry?.sourcePath), `${label}: duplicate sourcePath`)
    sourcePaths.add(entry?.sourcePath)
    check(entry?.license === manifest?.license?.spdx, `${label}: license must match the catalog license`)
    check(shaPattern.test(entry?.sha256 ?? ''), `${label}: sha256 is invalid`)
    check(Number.isSafeInteger(entry?.bytes) && entry.bytes > 0, `${label}: bytes must be a positive integer`)
    check(typeof entry?.reason === 'string' && entry.reason.length >= 12, `${label}: a review reason is required`)
    check(typeof entry?.runtimeIncluded === 'boolean', `${label}: runtimeIncluded must be boolean`)

    if (entry?.status === 'allowed') {
      check(allowedMigrationModes.has(entry?.migrationMode), `${label}: unsupported allowed migrationMode`)
      check(isSafeRelativePath(entry?.targetPath), `${label}: allowed entries require a safe targetPath`)
      check(entry?.targetPath?.startsWith('assets/game-assets/effects/legacy/'), `${label}: legacy runtime targets must stay under assets/game-assets/effects/legacy`)
      check(!targetPaths.has(entry?.targetPath), `${label}: duplicate targetPath`)
      targetPaths.add(entry?.targetPath)
      if (entry?.runtimeIncluded) check(shaPattern.test(entry?.targetSha256 ?? ''), `${label}: included targets require targetSha256`)
      else check(entry?.targetSha256 === null, `${label}: a planned target must use null targetSha256`)
    } else {
      check(entry?.migrationMode === 'do-not-import', `${label}: rejected entries must use do-not-import`)
      check(entry?.targetPath === null, `${label}: rejected entries must not have a targetPath`)
      check(entry?.runtimeIncluded === false, `${label}: rejected entries cannot be included at runtime`)
      check(entry?.targetSha256 === null, `${label}: rejected entries cannot have targetSha256`)
    }
  }

  const rejectedDirectories = manifest?.runtimePolicy?.fullyRejectedSourceDirectories
  check(Array.isArray(rejectedDirectories) && rejectedDirectories.length > 0, 'fullyRejectedSourceDirectories must list the rejected legacy effect groups')
  for (const directory of rejectedDirectories ?? []) {
    check(isSafeRelativePath(directory), `fully rejected directory is unsafe: ${directory}`)
    const children = (manifest.entries ?? []).filter(entry => entry.sourcePath.startsWith(`${directory}/`))
    check(children.length > 0, `fully rejected directory has no catalog entries: ${directory}`)
    check(children.every(entry => entry.status === 'rejected'), `fully rejected directory contains an allowed entry: ${directory}`)
  }
}

async function verifyPackagedLicense (manifest, errors) {
  const licensePath = resolve(projectRoot, manifest.license.copiedPath)
  if (!existsSync(licensePath)) {
    errors.push(`packaged license is missing: ${manifest.license.copiedPath}`)
    return
  }
  const buffer = await readFile(licensePath)
  if (sha256(buffer) !== manifest.license.copiedSha256) errors.push(`packaged license hash changed: ${manifest.license.copiedPath}`)
  const text = buffer.toString('utf8')
  if (!text.includes('MIT License') || !text.includes('Copyright (c) 2025 NiuMa') || !text.includes('Permission is hereby granted')) {
    errors.push(`packaged license is incomplete: ${manifest.license.copiedPath}`)
  }
}

async function verifyRuntime (manifest, errors) {
  const runtimeRoot = resolve(projectRoot, manifest.runtimePolicy.runtimeAssetRoot)
  const rejectedEntriesByHash = new Map()
  const rejectedExtensions = new Set()
  for (const entry of manifest.entries.filter(candidate => candidate.status === 'rejected')) {
    rejectedEntriesByHash.set(entry.sha256, entry)
    rejectedExtensions.add(extname(entry.sourcePath).toLowerCase())
  }

  const runtimeFiles = await walkFiles(runtimeRoot, filePath => rejectedExtensions.has(extname(filePath).toLowerCase()))
  for (const runtimePath of runtimeFiles) {
    const digest = sha256(await readFile(runtimePath))
    const rejectedEntry = rejectedEntriesByHash.get(digest)
    if (rejectedEntry) {
      errors.push(`rejected asset entered runtime as ${relative(projectRoot, runtimePath).split(sep).join('/')}: ${rejectedEntry.sourcePath}`)
    }
  }

  let includedCount = 0
  for (const entry of manifest.entries.filter(candidate => candidate.status === 'allowed')) {
    const targetPath = resolve(projectRoot, entry.targetPath)
    const targetExists = existsSync(targetPath)
    if (entry.runtimeIncluded) {
      includedCount += 1
      if (!targetExists) {
        errors.push(`runtimeIncluded target is missing: ${entry.targetPath}`)
        continue
      }
      const targetBuffer = await readFile(targetPath)
      if (sha256(targetBuffer) !== entry.targetSha256) errors.push(`runtime target hash changed: ${entry.targetPath}`)
    } else if (targetExists) {
      errors.push(`planned legacy target exists but runtimeIncluded is false: ${entry.targetPath}`)
    }
  }
  return { includedCount, scannedCount: runtimeFiles.length }
}

async function verifySourceCheckout (manifest, sourceRoot, errors) {
  if (!sourceRoot) return false
  if (!existsSync(sourceRoot) || !(await stat(sourceRoot)).isDirectory()) {
    errors.push(`source checkout is unavailable: ${sourceRoot}`)
    return false
  }

  try {
    const head = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    if (head !== manifest.source.commit) errors.push(`source checkout commit is ${head}, expected ${manifest.source.commit}`)
  } catch (error) {
    errors.push(`cannot read source checkout Git revision: ${error.message}`)
  }

  const sourceLicensePath = resolve(sourceRoot, manifest.license.sourcePath)
  if (!existsSync(sourceLicensePath)) errors.push(`source license is missing: ${manifest.license.sourcePath}`)
  else if (sha256(await readFile(sourceLicensePath)) !== manifest.license.sourceSha256) errors.push(`source license hash changed: ${manifest.license.sourcePath}`)

  for (const entry of manifest.entries) {
    const sourcePath = resolve(sourceRoot, entry.sourcePath)
    if (!existsSync(sourcePath)) {
      errors.push(`source asset is missing: ${entry.sourcePath}`)
      continue
    }
    const buffer = await readFile(sourcePath)
    if (buffer.length !== entry.bytes) errors.push(`source byte count changed: ${entry.sourcePath}`)
    if (sha256(buffer) !== entry.sha256) errors.push(`source hash changed: ${entry.sourcePath}`)
  }

  const catalogPaths = new Set(manifest.entries.map(entry => entry.sourcePath))
  for (const directory of manifest.runtimePolicy.fullyRejectedSourceDirectories) {
    const absoluteDirectory = resolve(sourceRoot, directory)
    if (!existsSync(absoluteDirectory)) {
      errors.push(`fully rejected source directory is missing: ${directory}`)
      continue
    }
    const pngFiles = await walkFiles(absoluteDirectory, filePath => extname(filePath).toLowerCase() === '.png')
    for (const filePath of pngFiles) {
      const sourcePath = relative(sourceRoot, filePath).split(sep).join('/')
      if (!catalogPaths.has(sourcePath)) errors.push(`uncatalogued file in fully rejected directory: ${sourcePath}`)
    }
  }
  return true
}

async function main () {
  const options = parseArguments(process.argv.slice(2))
  const manifest = JSON.parse(await readFile(options.manifestPath, 'utf8'))
  const errors = []
  validateManifestShape(manifest, errors)
  await verifyPackagedLicense(manifest, errors)
  const runtime = await verifyRuntime(manifest, errors)
  if (options.strictSource && !options.sourceRoot) errors.push('--strict-source requires --source-root or LEGACY_EFFECT_SOURCE_ROOT')
  const sourceChecked = await verifySourceCheckout(manifest, options.sourceRoot, errors)

  if (errors.length > 0) {
    throw new Error(`legacy effect asset verification failed:\n- ${errors.join('\n- ')}`)
  }

  const allowedCount = manifest.entries.filter(entry => entry.status === 'allowed').length
  const rejectedCount = manifest.entries.length - allowedCount
  process.stdout.write(
    `legacy effect asset verification passed (${allowedCount} allowed, ${rejectedCount} rejected, ${runtime.includedCount} runtime; ` +
    `source ${sourceChecked ? 'checked' : 'skipped'}; scanned ${runtime.scannedCount} runtime candidate files)\n`,
  )
}

main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
