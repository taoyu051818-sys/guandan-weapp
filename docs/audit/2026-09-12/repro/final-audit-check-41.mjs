// Audit-only final integrity checks. No builds, network, services or product writes.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const audit = resolve(root, 'docs/audit/2026-09-12')
const read = path => fs.readFileSync(path, 'utf8')
const json = path => JSON.parse(read(path))
const hash = path => createHash('sha256').update(fs.readFileSync(path)).digest('hex')
const report = json(resolve(audit, 'batches/cross-module-41.json'))
const env = { PATH: '/opt/homebrew/bin:/usr/bin:/bin' }
const guard = execFileSync(process.execPath, [resolve(audit, 'repro/evidence-check.mjs')], { cwd: root, env, encoding: 'utf8', timeout: 20000 })
const state = JSON.parse(guard)
assert.equal(state.firstParty, '629/629')
assert.equal(state.generatedCopies, 39)
assert.equal(state.boundaryHashes, 1167)
assert.equal(state.uniqueIssues, 41)
for (const e of report.inputEvidence) assert.equal(hash(resolve(root, e.path)), e.sha256, e.path)
const allIssues = new Map()
for (const name of fs.readdirSync(resolve(audit, 'batches')).filter(n => n.endsWith('.json'))) {
  for (const issue of json(resolve(audit, 'batches', name)).findings || []) {
    assert.ok(!allIssues.has(issue.id)); allIssues.set(issue.id, issue)
    assert.ok(issue.line >= 1 && issue.line <= read(resolve(root, issue.path)).split('\n').length, issue.id)
  }
}
assert.equal(allIssues.size, 41)
assert.equal([...allIssues.values()].filter(i => i.severity === 'P2').length, 17)
assert.equal([...allIssues.values()].filter(i => i.severity === 'P3').length, 24)
assert.deepEqual([...allIssues.keys()].sort(), [...report.confirmedIssues.ids].sort())
const plan = read(resolve(audit, 'REMEDIATION_PLAN.md'))
const planIds = [...plan.matchAll(/^\| ([A-Z][A-Z0-9-]+) · (P[23])<br>/gm)]
assert.equal(planIds.length, 41)
assert.equal(new Set(planIds.map(m => m[1])).size, 41)
for (const m of planIds) assert.equal(allIssues.get(m[1]).severity, m[2], m[1])
assert.equal(report.chains.length, 20)
assert.equal(new Set(report.chains.map(x => x.id)).size, 20)
for (const chain of report.chains) for (const name of chain.reports) {
  assert.ok(fs.existsSync(resolve(audit, 'batches', name + '.md')), name)
  assert.ok(fs.existsSync(resolve(audit, 'batches', name + '.json')), name)
}
assert.equal(report.reruns.length, 4)
for (const run of report.reruns) {
  assert.equal(run.exitCode, 0)
  assert.match(run.output, /AUDIT32_SOURCE=.*"redirects":[1-9]/)
  assert.match(run.interpretation, /not a product-fix pass/)
}
const manual = read(resolve(audit, 'MANUAL_ACCEPTANCE.md'))
assert.equal([...manual.matchAll(/^\| M\d{2} \|/gm)].length, 32)
assert.equal(report.manualAcceptance.executed, 0)
assert.ok(report.manualAcceptance.rows.every(x => /待|已知缺陷/.test(x.status)))
let localLinks = 0
for (const filename of report.deliverables) {
  const file = resolve(audit, filename), text = read(file)
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    let href = m[1].replace(/^<|>$/g, '')
    if (/^[a-z][a-z+.-]*:\/\//i.test(href) || href.startsWith('#')) continue
    href = href.split('#')[0]
    const line = /:(\d+)$/.exec(href); if (line) href = href.slice(0, line.index)
    const target = resolve(dirname(file), decodeURIComponent(href))
    assert.ok(fs.existsSync(target), filename + ': ' + href)
    if (line) assert.ok(Number(line[1]) <= read(target).split('\n').length, href)
    localLinks++
  }
}
const dependency = json(resolve(audit, 'batches/dependency-boundaries-40.json'))
assert.equal(dependency.packages.length, 69)
assert.equal(dependency.packages.filter(p => p.localMetadata.length).length, 46)
for (const lock of dependency.locks) assert.equal(hash(resolve(root, lock.path)), lock.sha256)
let metadataCopies = 0, licenseCopies = 0
for (const p of dependency.packages) for (const local of p.localMetadata) {
  assert.equal(hash(resolve(root, local.path)), local.sha256); metadataCopies++
  for (const e of local.licenseFiles) { assert.equal(hash(resolve(root, e.path)), e.sha256); licenseCopies++ }
}
assert.equal(metadataCopies, 47)
assert.equal(dependency.concerns[0].id, 'DEPENDENCY-40-C01')
assert.equal(report.dependencyBoundary.fullOnlineAdvisoryVerified, false)
assert.equal(report.dependencyBoundary.registryAuthenticityVerified, false)
const docs = JSON.parse(execFileSync(process.execPath, [resolve(audit, 'repro/document-baselines-40.mjs')], { cwd: root, env, encoding: 'utf8', timeout: 20000 }))
assert.equal(docs.documentHashes, 18)
assert.equal(docs.docxPages.length, 8)
console.log(JSON.stringify({ auditEvidence: 'verified', productFixes: 0, firstParty: state.firstParty,
  generated: 39, boundaries: state.boundaryHashes, confirmedUnfixed: { P2: 17, P3: 24, total: 41 },
  inputEvidenceHashes: report.inputEvidence.length, crossModuleChains: 20, sourceOnlyReruns: 4,
  manualAcceptanceRows: 32, manualAcceptanceExecuted: 0, localDeliverableLinks: localLinks,
  lockedDependencies: 69, metadataCopies, licenseCopies, onlineAdvisoryGap: true,
  historicalDocxPages: 8, headAndOriginalDirtyHashesUnchanged: true }, null, 2))
